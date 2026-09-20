export type LiveDropReason = 'stale-result' | 'geometry-change' | 'source-reset' | 'worker-error' | 'trace-overflow';
export type LiveSkipReason = 'busy';
type TimeKey = 'captureDoneAt' | 'dispatchedAt' | 'resultAt' | 'acceptedAt' | 'riskAt' | 'overlayAt' | 'alertOverlayAt' | 'audioAt';

interface LiveTrace {
  id: number; epoch: number; mediaTimeMs: number; frameAvailableAt: number;
  captureDoneAt: number | null; dispatchedAt: number | null; resultAt: number | null;
  acceptedAt: number | null; riskAt: number | null; overlayAt: number | null;
  alertOverlayAt: number | null; audioAt: number | null; hasAlert: boolean;
  droppedReason: LiveDropReason | null;
}
interface Distribution { samples: number; unavailable: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; maxMs: number | null }

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1];
}
function distribution(values: number[], denominator: number): Distribution {
  return { samples: values.length, unavailable: Math.max(0, denominator - values.length),
    p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99),
    maxMs: values.length ? Math.max(...values) : null };
}

/** Bounded, pixel-free instrumentation for the live camera hot path. */
export class LiveTelemetry {
  private readonly limit: number;
  private rows: LiveTrace[] = [];
  private byId = new Map<number, LiveTrace>();
  private epoch = 0;
  private totals = { started: 0, accepted: 0, dropped: 0, alertFrames: 0, overlays: 0, audioRequests: 0 };
  private dropReasons: Partial<Record<LiveDropReason, number>> = {};
  private skipReasons: Partial<Record<LiveSkipReason, number>> = {};
  private firstFrameAvailableAt: number | null = null;
  private lastFrameAvailableAt: number | null = null;

  constructor(limit = 5000) { this.limit = Math.max(50, Math.min(20000, Math.floor(limit))); }

  reset(epoch: number) {
    this.epoch = epoch; this.rows = []; this.byId.clear();
    this.totals = { started: 0, accepted: 0, dropped: 0, alertFrames: 0, overlays: 0, audioRequests: 0 };
    this.dropReasons = {}; this.skipReasons = {};
    this.firstFrameAvailableAt = null; this.lastFrameAvailableAt = null;
  }
  skip(reason: LiveSkipReason) { this.skipReasons[reason] = (this.skipReasons[reason] ?? 0) + 1; }
  begin(id: number, epoch: number, mediaTimeMs: number, frameAvailableAt: number) {
    if (![id, epoch, mediaTimeMs, frameAvailableAt].every(Number.isFinite) || epoch !== this.epoch || this.byId.has(id)) return false;
    const row: LiveTrace = { id, epoch, mediaTimeMs, frameAvailableAt, captureDoneAt: null, dispatchedAt: null,
      resultAt: null, acceptedAt: null, riskAt: null, overlayAt: null, alertOverlayAt: null, audioAt: null,
      hasAlert: false, droppedReason: null };
    this.rows.push(row); this.byId.set(id, row); this.totals.started++;
    this.firstFrameAvailableAt ??= frameAvailableAt;
    this.lastFrameAvailableAt = frameAvailableAt;
    while (this.rows.length > this.limit) {
      const removed = this.rows.shift()!;
      this.byId.delete(removed.id);
      if (removed.acceptedAt === null && removed.droppedReason === null) {
        this.totals.dropped++; this.dropReasons['trace-overflow'] = (this.dropReasons['trace-overflow'] ?? 0) + 1;
      }
    }
    return true;
  }
  private mark(id: number, key: TimeKey, at: number) {
    const row = this.byId.get(id);
    if (!row || row.epoch !== this.epoch || row.droppedReason || row[key] !== null || !Number.isFinite(at) || at < row.frameAvailableAt) return false;
    row[key] = at; return true;
  }
  captureDone(id: number, at: number) { return this.mark(id, 'captureDoneAt', at); }
  dispatched(id: number, at: number) { return this.mark(id, 'dispatchedAt', at); }
  result(id: number, at: number) { return this.mark(id, 'resultAt', at); }
  accept(id: number, at: number) {
    const changed = this.mark(id, 'acceptedAt', at); if (changed) this.totals.accepted++; return changed;
  }
  risk(id: number, at: number, hasAlert: boolean) {
    const row = this.byId.get(id), changed = this.mark(id, 'riskAt', at);
    if (changed && row) { row.hasAlert = hasAlert; if (hasAlert) this.totals.alertFrames++; }
    return changed;
  }
  overlay(id: number, at: number, hasAlert: boolean) {
    const row = this.byId.get(id), changed = this.mark(id, 'overlayAt', at);
    if (changed) this.totals.overlays++;
    if (row && hasAlert) { row.hasAlert = true; this.mark(id, 'alertOverlayAt', at); }
    return changed;
  }
  audio(id: number, at: number) {
    const changed = this.mark(id, 'audioAt', at); if (changed) this.totals.audioRequests++; return changed;
  }
  drop(id: number, reason: LiveDropReason) {
    const row = this.byId.get(id);
    if (!row || row.epoch !== this.epoch || row.droppedReason || row.acceptedAt !== null) return false;
    row.droppedReason = reason; this.totals.dropped++; this.dropReasons[reason] = (this.dropReasons[reason] ?? 0) + 1; return true;
  }

  report() {
    const retained = this.rows.length, accepted = this.rows.filter(row => row.acceptedAt !== null);
    const alertRows = accepted.filter(row => row.hasAlert);
    const duration = (rows: LiveTrace[], end: TimeKey, start: keyof LiveTrace) => rows.flatMap(row => {
      const a = row[start], b = row[end];
      return typeof a === 'number' && typeof b === 'number' && b >= a ? [b - a] : [];
    });
    return { schema: 'drivesense-live-timing-v1', epoch: this.epoch,
      clock: 'performance.now monotonic milliseconds', provenance: 'live-camera',
      session: { durationMs: this.firstFrameAvailableAt === null || this.lastFrameAvailableAt === null
        ? 0 : Math.max(0, this.lastFrameAvailableAt - this.firstFrameAvailableAt),
        firstFrameAvailableAt: this.firstFrameAvailableAt, lastFrameAvailableAt: this.lastFrameAvailableAt },
      percentileWindow: { retained, limit: this.limit, policy: 'most-recent traces; lifetime counters remain cumulative' },
      counts: { ...this.totals, inflightRetained: this.rows.filter(row => row.acceptedAt === null && row.droppedReason === null).length,
        skipped: Object.values(this.skipReasons).reduce((sum, value) => sum + (value ?? 0), 0),
        dropReasons: { ...this.dropReasons }, skipReasons: { ...this.skipReasons } },
      stages: {
        frameCallbackToCapture: distribution(duration(this.rows, 'captureDoneAt', 'frameAvailableAt'), retained),
        captureToDispatch: distribution(duration(this.rows, 'dispatchedAt', 'captureDoneAt'), retained),
        requestToResult: distribution(duration(this.rows, 'resultAt', 'dispatchedAt'), retained),
        frameAgeAtAcceptance: distribution(duration(accepted, 'acceptedAt', 'frameAvailableAt'), accepted.length),
        resultToRisk: distribution(duration(accepted, 'riskAt', 'resultAt'), accepted.length),
        riskToOverlay: distribution(duration(accepted, 'overlayAt', 'riskAt'), accepted.length),
        frameToOverlay: distribution(duration(accepted, 'overlayAt', 'frameAvailableAt'), accepted.length),
        riskToAlertOverlay: distribution(duration(alertRows, 'alertOverlayAt', 'riskAt'), alertRows.length),
        frameToAlertOverlay: distribution(duration(alertRows, 'alertOverlayAt', 'frameAvailableAt'), alertRows.length),
        riskToAudioRequest: distribution(duration(alertRows, 'audioAt', 'riskAt'), alertRows.length),
        frameToAudioRequest: distribution(duration(alertRows, 'audioAt', 'frameAvailableAt'), alertRows.length)
      },
      traceRows: this.rows.map(row => ({ id: row.id, mediaTimeMs: row.mediaTimeMs, droppedReason: row.droppedReason,
        hasAlert: row.hasAlert, frameCallbackToCaptureMs: row.captureDoneAt === null ? null : row.captureDoneAt - row.frameAvailableAt,
        requestToResultMs: row.resultAt === null || row.dispatchedAt === null ? null : row.resultAt - row.dispatchedAt,
        frameToOverlayMs: row.overlayAt === null ? null : row.overlayAt - row.frameAvailableAt,
        frameToAlertOverlayMs: row.alertOverlayAt === null ? null : row.alertOverlayAt - row.frameAvailableAt,
        frameToAudioRequestMs: row.audioAt === null ? null : row.audioAt - row.frameAvailableAt })) };
  }
}
