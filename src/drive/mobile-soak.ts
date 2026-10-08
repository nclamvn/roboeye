export interface SafeCameraSettings {
  width?: number;
  height?: number;
  frameRate?: number;
  aspectRatio?: number;
  facingMode?: 'user' | 'environment' | 'left' | 'right';
  resizeMode?: 'none' | 'crop-and-scale';
}

export interface PresentedFrameMetadata {
  presentedFrames?: number;
  expectedDisplayTime?: number;
  captureTime?: number;
  processingDuration?: number;
}

type ModelKind = 'detector' | 'metric-depth';
type DropReason = 'stale-result' | 'geometry-change' | 'source-reset' | 'worker-error' | 'trace-overflow';
type LifecycleEvent = 'timelineReset' | 'visibilityHidden' | 'visibilityVisible' | 'cameraEnded' |
  'detectorWorkerError' | 'metricWorkerError' | 'detectorLoadError' | 'metricLoadError';

const MAX_HISTOGRAM_MS = 5000;
const MAX_INFLIGHT_TRACES = 64;
const WINDOW_DEFINITIONS = [
  { id: '0-5m', startMs: 0, endMs: 5 * 60_000 },
  { id: '5-10m', startMs: 5 * 60_000, endMs: 10 * 60_000 },
  { id: '10-20m', startMs: 10 * 60_000, endMs: 20 * 60_000 },
  { id: '20m+', startMs: 20 * 60_000, endMs: null }
] as const;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Closed allowlist: intentionally excludes deviceId, groupId and camera label. */
export function safeCameraSettings(input: unknown): SafeCameraSettings {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>, result: SafeCameraSettings = {};
  for (const key of ['width', 'height', 'frameRate', 'aspectRatio'] as const) {
    const value = source[key];
    if (finite(value) && value > 0) result[key] = value;
  }
  if (['user', 'environment', 'left', 'right'].includes(String(source.facingMode))) {
    result.facingMode = source.facingMode as SafeCameraSettings['facingMode'];
  }
  if (['none', 'crop-and-scale'].includes(String(source.resizeMode))) {
    result.resizeMode = source.resizeMode as SafeCameraSettings['resizeMode'];
  }
  return result;
}

class Histogram {
  private bins = new Uint32Array(MAX_HISTOGRAM_MS + 2);
  private total = 0;
  private sum = 0;
  private high = 0;
  private clipped = 0;

  add(value: number) {
    if (!finite(value) || value < 0) return false;
    const rounded = Math.round(value), index = Math.min(MAX_HISTOGRAM_MS + 1, rounded);
    this.bins[index]++; this.total++; this.sum += value; this.high = Math.max(this.high, value);
    if (rounded > MAX_HISTOGRAM_MS) this.clipped++;
    return true;
  }

  private percentile(p: number) {
    if (!this.total) return null;
    const target = Math.max(1, Math.ceil(this.total * p)); let seen = 0;
    for (let index = 0; index < this.bins.length; index++) {
      seen += this.bins[index];
      if (seen >= target) return index > MAX_HISTOGRAM_MS ? `>${MAX_HISTOGRAM_MS}` : index;
    }
    return null;
  }

  report(denominator: number) {
    return { samples: this.total, unavailable: Math.max(0, denominator - this.total),
      resolutionMs: 1, histogramMaxMs: MAX_HISTOGRAM_MS, clipped: this.clipped,
      meanMs: this.total ? this.sum / this.total : null, p50Ms: this.percentile(.5),
      p95Ms: this.percentile(.95), p99Ms: this.percentile(.99), maxMs: this.total ? this.high : null };
  }
}

interface Counters {
  presentedCallbacks: number;
  presentedFrameGaps: number;
  detectorStarted: number;
  detectorAccepted: number;
  detectorDropped: number;
  detectorBusySkips: number;
  overlays: number;
  alertOverlays: number;
  metricAttempts: number;
  metricAccepted: number;
  metricDropped: number;
  trackSnapshots: number;
  trackObservations: number;
  trackBirths: number;
  trackLosses: number;
}

function counters(): Counters {
  return { presentedCallbacks: 0, presentedFrameGaps: 0, detectorStarted: 0, detectorAccepted: 0,
    detectorDropped: 0, detectorBusySkips: 0, overlays: 0, alertOverlays: 0,
    metricAttempts: 0, metricAccepted: 0, metricDropped: 0, trackSnapshots: 0,
    trackObservations: 0, trackBirths: 0, trackLosses: 0 };
}

class Aggregate {
  readonly counts = counters();
  readonly dropReasons: Partial<Record<DropReason, number>> = {};
  readonly callbackVsExpectedDisplay = new Histogram();
  readonly captureToCallback = new Histogram();
  readonly decodeProcessing = new Histogram();
  readonly requestToResult = new Histogram();
  readonly frameToOverlay = new Histogram();
  readonly metricInference = new Histogram();

  report() {
    const c = this.counts;
    return { counts: { ...c, dropReasons: { ...this.dropReasons } },
      rates: {
        detectorAccepted: c.detectorStarted ? c.detectorAccepted / c.detectorStarted : null,
        detectorDropped: c.detectorStarted ? c.detectorDropped / c.detectorStarted : null,
        busy: c.detectorStarted + c.detectorBusySkips ? c.detectorBusySkips / (c.detectorStarted + c.detectorBusySkips) : null,
        metricAccepted: c.metricAttempts ? c.metricAccepted / c.metricAttempts : null,
        trackSetTurnoverProxy: c.trackObservations ? (c.trackBirths + c.trackLosses) / c.trackObservations : null
      },
      stages: {
        callbackVsExpectedDisplay: this.callbackVsExpectedDisplay.report(c.presentedCallbacks),
        captureToCallback: this.captureToCallback.report(c.presentedCallbacks),
        decodeProcessing: this.decodeProcessing.report(c.presentedCallbacks),
        requestToResult: this.requestToResult.report(c.detectorStarted),
        frameToOverlay: this.frameToOverlay.report(c.detectorAccepted),
        metricInference: this.metricInference.report(c.metricAttempts)
      } };
  }
}

interface Trace {
  id: number;
  epoch: number;
  frameAvailableAt: number;
  dispatchedAt: number | null;
  accepted: boolean;
}

interface ModelAttempt {
  kind: ModelKind;
  requestedBackend: string;
  resolvedBackend: string | null;
  totalLoadMs: number | null;
  warmupMs: number | null;
  outcome: 'loading' | 'ready' | 'error';
  startedAt: number;
}

/** Bounded, pixel-free long-session telemetry for mobile capability decisions. */
export class MobileSoakTelemetry {
  private provenance = 'live-camera-runtime';
  private epoch = 0;
  private active = false;
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private camera: SafeCameraSettings = {};
  private overall = new Aggregate();
  private windows = WINDOW_DEFINITIONS.map(() => new Aggregate());
  private traces = new Map<number, Trace>();
  private models: ModelAttempt[] = [];
  private events: Partial<Record<LifecycleEvent, number>> = {};
  private lastPresentedFrames: number | null = null;
  private lastTrackIds = new Set<number>();

  private clear(epoch: number) {
    this.epoch = epoch; this.active = false; this.startedAt = null; this.endedAt = null; this.camera = {};
    this.overall = new Aggregate(); this.windows = WINDOW_DEFINITIONS.map(() => new Aggregate());
    this.traces.clear(); this.models = []; this.events = {}; this.lastPresentedFrames = null; this.lastTrackIds.clear();
  }

  reset(epoch: number) { this.clear(epoch); }

  cameraOpened(epoch: number, at: number, settings: unknown, provenance = 'live-camera-runtime') {
    this.clear(epoch); if (!finite(at)) return false;
    this.provenance = provenance;
    this.active = true; this.startedAt = at; this.camera = safeCameraSettings(settings); return true;
  }

  cameraEnded(at: number) {
    if (!this.active || !finite(at)) return false;
    this.event('cameraEnded'); this.active = false; this.endedAt = Math.max(this.startedAt ?? at, at); this.traces.clear(); return true;
  }

  timelineReset(epoch: number) {
    if (!this.active) { this.epoch = epoch; return false; }
    this.epoch = epoch; this.traces.clear(); this.lastTrackIds.clear(); this.event('timelineReset'); return true;
  }

  event(name: LifecycleEvent) { this.events[name] = (this.events[name] ?? 0) + 1; }

  private aggregates(at: number) {
    if (!this.active || this.startedAt === null || !finite(at)) return [];
    const elapsed = Math.max(0, at - this.startedAt);
    const index = WINDOW_DEFINITIONS.findIndex(window => elapsed >= window.startMs && (window.endMs === null || elapsed < window.endMs));
    return index < 0 ? [this.overall] : [this.overall, this.windows[index]];
  }

  modelLoadStarted(kind: ModelKind, requestedBackend: string, at: number) {
    if (!this.active || !finite(at)) return false;
    this.models.push({ kind, requestedBackend, resolvedBackend: null, totalLoadMs: null, warmupMs: null, outcome: 'loading', startedAt: at });
    if (this.models.length > 20) this.models.shift(); return true;
  }

  modelObserved(kind: ModelKind, resolvedBackend: string) {
    if (!this.active || !resolvedBackend) return false;
    this.models.push({ kind, requestedBackend: 'preloaded-before-camera-session', resolvedBackend,
      totalLoadMs: null, warmupMs: null, outcome: 'ready', startedAt: this.startedAt ?? 0 });
    if (this.models.length > 20) this.models.shift(); return true;
  }

  modelReady(kind: ModelKind, resolvedBackend: string, at: number, warmupMs: number | null = null) {
    const attempt = [...this.models].reverse().find(item => item.kind === kind && item.outcome === 'loading');
    if (!attempt || !finite(at) || at < attempt.startedAt) return false;
    attempt.resolvedBackend = resolvedBackend; attempt.totalLoadMs = at - attempt.startedAt;
    attempt.warmupMs = finite(warmupMs) && warmupMs >= 0 ? warmupMs : null; attempt.outcome = 'ready'; return true;
  }

  modelError(kind: ModelKind, event: Extract<LifecycleEvent, 'detectorLoadError' | 'metricLoadError'>) {
    const attempt = [...this.models].reverse().find(item => item.kind === kind && item.outcome === 'loading');
    if (!attempt) return false;
    attempt.outcome = 'error'; this.event(event); return true;
  }

  presentedFrame(at: number, metadata: PresentedFrameMetadata = {}) {
    const targets = this.aggregates(at); if (!targets.length) return false;
    let gaps = 0;
    if (finite(metadata.presentedFrames)) {
      if (this.lastPresentedFrames !== null && metadata.presentedFrames > this.lastPresentedFrames + 1) gaps = metadata.presentedFrames - this.lastPresentedFrames - 1;
      this.lastPresentedFrames = metadata.presentedFrames;
    }
    for (const target of targets) {
      target.counts.presentedCallbacks++; target.counts.presentedFrameGaps += gaps;
      if (finite(metadata.expectedDisplayTime)) target.callbackVsExpectedDisplay.add(Math.max(0, at - metadata.expectedDisplayTime));
      if (finite(metadata.captureTime) && at >= metadata.captureTime && at - metadata.captureTime <= 60_000) target.captureToCallback.add(at - metadata.captureTime);
      if (finite(metadata.processingDuration) && metadata.processingDuration >= 0) target.decodeProcessing.add(metadata.processingDuration * 1000);
    }
    return true;
  }

  busy(at: number) { const targets = this.aggregates(at); for (const target of targets) target.counts.detectorBusySkips++; return targets.length > 0; }

  begin(id: number, epoch: number, at: number) {
    const targets = this.aggregates(at);
    if (!targets.length || epoch !== this.epoch || !Number.isInteger(id) || this.traces.has(id)) return false;
    if (this.traces.size >= MAX_INFLIGHT_TRACES) {
      const oldest = this.traces.keys().next().value as number | undefined;
      if (oldest !== undefined) { this.traces.delete(oldest); for (const target of targets) { target.counts.detectorDropped++; target.dropReasons['trace-overflow'] = (target.dropReasons['trace-overflow'] ?? 0) + 1; } }
    }
    this.traces.set(id, { id, epoch, frameAvailableAt: at, dispatchedAt: null, accepted: false });
    for (const target of targets) target.counts.detectorStarted++; return true;
  }

  dispatched(id: number, at: number) {
    const trace = this.traces.get(id);
    if (!trace || trace.epoch !== this.epoch || trace.dispatchedAt !== null || !finite(at) || at < trace.frameAvailableAt) return false;
    trace.dispatchedAt = at; return true;
  }

  result(id: number, at: number) {
    const trace = this.traces.get(id);
    if (!trace || trace.epoch !== this.epoch || trace.dispatchedAt === null || !finite(at) || at < trace.dispatchedAt) return false;
    for (const target of this.aggregates(trace.frameAvailableAt)) target.requestToResult.add(at - trace.dispatchedAt); return true;
  }

  accept(id: number) {
    const trace = this.traces.get(id); if (!trace || trace.epoch !== this.epoch || trace.accepted) return false;
    trace.accepted = true; for (const target of this.aggregates(trace.frameAvailableAt)) target.counts.detectorAccepted++; return true;
  }

  drop(id: number, reason: DropReason) {
    const trace = this.traces.get(id); if (!trace || trace.epoch !== this.epoch || trace.accepted) return false;
    for (const target of this.aggregates(trace.frameAvailableAt)) { target.counts.detectorDropped++; target.dropReasons[reason] = (target.dropReasons[reason] ?? 0) + 1; }
    this.traces.delete(id); return true;
  }

  overlay(id: number, at: number, hasAlert: boolean) {
    const trace = this.traces.get(id);
    if (!trace || !trace.accepted || !finite(at) || at < trace.frameAvailableAt) return false;
    for (const target of this.aggregates(trace.frameAvailableAt)) {
      target.counts.overlays++; if (hasAlert) target.counts.alertOverlays++;
      target.frameToOverlay.add(at - trace.frameAvailableAt);
    }
    this.traces.delete(id); return true;
  }

  metricAttempt(at: number) { const targets = this.aggregates(at); for (const target of targets) target.counts.metricAttempts++; return targets.length > 0; }

  metricResult(at: number, latencyMs: number, accepted: boolean) {
    this.metricInferenceOnly(at,latencyMs);return this.metricOutcome(at,accepted);
  }

  /** A join may expire before depth returns. Count its outcome once without
   * inventing model execution time from the wall-clock watchdog duration. */
  metricInferenceOnly(at:number,latencyMs:number){
    const targets = this.aggregates(at);
    for(const target of targets)target.metricInference.add(latencyMs);
    return targets.length>0;
  }

  metricOutcome(at:number,accepted:boolean){
    const targets=this.aggregates(at);
    for(const target of targets){if(accepted)target.counts.metricAccepted++;else target.counts.metricDropped++;}
    return targets.length > 0;
  }

  tracks(at: number, ids: readonly number[]) {
    const targets = this.aggregates(at); if (!targets.length) return false;
    const current = new Set(ids.filter(Number.isFinite)), births = [...current].filter(id => !this.lastTrackIds.has(id)).length;
    const losses = [...this.lastTrackIds].filter(id => !current.has(id)).length;
    for (const target of targets) {
      target.counts.trackSnapshots++; target.counts.trackObservations += current.size;
      target.counts.trackBirths += births; target.counts.trackLosses += losses;
    }
    this.lastTrackIds = current; return true;
  }

  status(at: number) {
    const end = this.endedAt ?? (finite(at) ? at : this.startedAt ?? 0);
    const durationMs = this.startedAt === null ? 0 : Math.max(0, end - this.startedAt);
    return { active: this.active, durationMs,
      phase: durationMs >= 30 * 60_000 ? 'soak' as const : durationMs >= 60_000 ? 'smoke' as const : 'warming' as const };
  }

  report(at: number) {
    const { durationMs, phase } = this.status(at);
    return { schema: 'drivesense-mobile-soak-v1', clock: 'performance.now monotonic milliseconds',
      provenance: this.provenance, active: this.active, epoch: this.epoch,
      session: { durationMs, phase },
      privacy: { pixelFree: true, cameraSettingsAllowlist: true, excluded: ['pixels', 'video', 'camera-label', 'deviceId', 'groupId', 'local-path', 'gps'] },
      camera: { settings: { ...this.camera } },
      models: this.models.map(model => ({ kind: model.kind, requestedBackend: model.requestedBackend,
        resolvedBackend: model.resolvedBackend, totalLoadMs: model.totalLoadMs,
        warmupMs: model.warmupMs, outcome: model.outcome })),
      lifecycle: { ...this.events },
      boundedState: { inflightTraces: this.traces.size, maxInflightTraces: MAX_INFLIGHT_TRACES,
        histogramResolutionMs: 1, histogramMaxMs: MAX_HISTOGRAM_MS, retainedFrameRows: 0 },
      overall: this.overall.report(),
      windows: WINDOW_DEFINITIONS.map((definition, index) => ({ ...definition,
        observedDurationMs: Math.max(0, Math.min(durationMs, definition.endMs ?? durationMs) - definition.startMs),
        ...this.windows[index].report() })),
      claims: { trackSetTurnover: 'proxy-only; not ground-truth ID switches',
        captureTime: 'browser metadata when exposed; otherwise unavailable',
        boundary: 'Runtime capability evidence only; not distance accuracy, collision-warning safety or public-road validation.' } };
  }
}
