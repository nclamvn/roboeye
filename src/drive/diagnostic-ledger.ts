/** Pixel-free attempt accounting. A terminal outcome is counted exactly once,
 * even when a worker returns after the capture deadline or a source reset. */
export type DiagnosticSource = 'live-camera' | 'fixture-live-replay';
import {MAX_DIAGNOSTIC_OBJECTS,type MetricObjectDiagnostic,type MetricCaptureDiagnostic,type MetricReasonCode} from './metric-diagnostics';
export type AttemptKind = 'detector' | 'metric';
export type AttemptStage = 'capture' | 'dispatch' | 'result' | 'join' | 'roi' | 'policy' | 'binding' | 'filter' | 'publication';
export type AttemptOutcome = 'accepted-observed' | 'stale' | 'wrong-generation' | 'roi-rejected' |
  'binding-rejected' | 'filter-rejected' | 'publication-rejected' | 'worker-error' | 'unsupported';
export type SkipReason = 'busy' | 'not-ready' | 'cadence' | 'alignment' | 'no-vehicle' | 'profile' | 'paused';
interface Attempt {
  kind: AttemptKind; id: number; epoch: number; capturedAt: number;
  stages: Partial<Record<AttemptStage, number>>;
  outcome: AttemptOutcome | null; completedAt: number | null;
  context?: MetricCaptureDiagnostic;
  objects?: MetricObjectDiagnostic[];
}
const MAX_DETAILS = 128, MAX_PENDING = 8;
const validTime = (at: number) => Number.isFinite(at) && at >= 0;

export class DiagnosticLedger {
  private pending = new Map<string, Attempt>();
  private details: Attempt[] = [];
  private lastId: Record<AttemptKind, number> = { detector: -1, metric: -1 };
  private started = { detector: 0, metric: 0 };
  private outcomes: Record<AttemptKind, Partial<Record<AttemptOutcome, number>>> = { detector: {}, metric: {} };
  private stageCounts: Record<AttemptKind, Partial<Record<AttemptStage, number>>> = { detector: {}, metric: {} };
  private skips: Partial<Record<SkipReason, number>> = {};
  private discardedDetails = 0;
  private unmatchedResults = 0;
  private firstFailure: Attempt | null = null;
  private lastPresentationAt: number | null = null;
  private lastVisible = false;
  private visibleMs = 0;
  private observedMs = 0;
  private blackoutMs = 0;
  private maxBlackoutMs = 0;
  private predictedOnly = 0;
  private generations = 0;
  private objectReasons: Partial<Record<MetricReasonCode,number>> = {};
  private discardedObjects = 0;

  begin(kind: AttemptKind, id: number, epoch: number, at: number) {
    if (!Number.isInteger(id) || id <= this.lastId[kind] || !Number.isInteger(epoch) || !validTime(at)) return false;
    if (this.pending.size >= MAX_PENDING) return false;
    this.lastId[kind] = id;
    const row: Attempt = { kind, id, epoch, capturedAt: at, stages: { capture: at }, outcome: null, completedAt: null };
    this.pending.set(`${kind}:${id}`, row); this.details.push(row); this.started[kind]++;
    this.stageCounts[kind].capture = (this.stageCounts[kind].capture ?? 0) + 1;
    if (this.details.length > MAX_DETAILS) { this.details.shift(); this.discardedDetails++; }
    return true;
  }
  stage(kind: AttemptKind, id: number, stage: AttemptStage, at: number) {
    // Late result timing is real evidence but cannot reverse a stale outcome.
    const row = this.pending.get(`${kind}:${id}`) ?? this.details.find(item => item.kind === kind && item.id === id);
    if (!row) { if (stage === 'result') this.unmatchedResults++; return false; }
    if (!validTime(at) || at < row.capturedAt || row.stages[stage] !== undefined) return false;
    row.stages[stage] = at; this.stageCounts[kind][stage] = (this.stageCounts[kind][stage] ?? 0) + 1; return true;
  }
  metricContext(id:number,context:MetricCaptureDiagnostic) {
    const row=this.pending.get(`metric:${id}`);if(!row||row.context)return false;
    if(!/^[a-f0-9]{64}$/.test(context.modelSha256)||
      ![context.sourceWidth,context.sourceHeight,context.targetWidth,context.targetHeight].every(n=>Number.isInteger(n)&&n>0)||
      ![context.contentFraction,context.preparationMs,context.requestedIntervalMs].every(Number.isFinite)||
      context.contentFraction<=0||context.contentFraction>1||context.preparationMs<0||context.requestedIntervalMs<0)return false;
    row.context={...context};return true;
  }
  metricObjects(id:number,objects:readonly MetricObjectDiagnostic[]) {
    const row=this.pending.get(`metric:${id}`);if(!row||row.objects)return false;
    // Exactly once, before the terminal attempt outcome. Cumulative counts do
    // not depend on the detail ring; the original capture clock never changes.
    for(const object of objects)this.objectReasons[object.code]=(this.objectReasons[object.code]??0)+1;
    row.objects=structuredClone(objects.slice(0,MAX_DIAGNOSTIC_OBJECTS));
    this.discardedObjects+=Math.max(0,objects.length-MAX_DIAGNOSTIC_OBJECTS);return true;
  }
  finish(kind: AttemptKind, id: number, outcome: AttemptOutcome, at: number) {
    const key = `${kind}:${id}`, row = this.pending.get(key);
    if (!row || !validTime(at) || at < row.capturedAt) return false;
    row.outcome = outcome; row.completedAt = at; this.pending.delete(key);
    this.outcomes[kind][outcome] = (this.outcomes[kind][outcome] ?? 0) + 1;
    if (outcome !== 'accepted-observed' && !this.firstFailure) this.firstFailure = structuredClone(row);
    return true;
  }
  reset(at: number) {
    for (const row of [...this.pending.values()]) this.finish(row.kind, row.id, 'wrong-generation', at);
    this.generations++; this.pausePresentation();
  }
  fail(kind: AttemptKind, at: number) {
    for (const row of [...this.pending.values()]) if (row.kind === kind) this.finish(kind, row.id, 'worker-error', at);
  }
  skip(reason: SkipReason) { this.skips[reason] = (this.skips[reason] ?? 0) + 1; }
  /** Time-weighted availability, NOT render FPS or fresh measurement count.
   * No automatic eligibility claim: labels must come from independent fixtures. */
  presentation(at: number, visibleMetres: boolean, predictedBoxOnly: boolean) {
    if (!validTime(at)) return;
    if (this.lastPresentationAt !== null && at >= this.lastPresentationAt) {
      const dt = at - this.lastPresentationAt; this.observedMs += dt;
      if (this.lastVisible) { this.visibleMs += dt; this.blackoutMs = 0; }
      else { this.blackoutMs += dt; this.maxBlackoutMs = Math.max(this.maxBlackoutMs, this.blackoutMs); }
    }
    if (predictedBoxOnly && !visibleMetres) this.predictedOnly++;
    this.lastPresentationAt = at; this.lastVisible = visibleMetres;
  }
  pausePresentation() { this.lastPresentationAt = null; this.blackoutMs = 0; }
  reasonSummary(){return {...this.objectReasons};}
  report() {
    const accounting = (kind: AttemptKind) => {
      const completed = Object.values(this.outcomes[kind]).reduce((sum, n) => sum + (n ?? 0), 0);
      const inflight = [...this.pending.values()].filter(row => row.kind === kind).length;
      return { started: this.started[kind], completed, inflight, balanced: this.started[kind] === completed + inflight,
        outcomes: { ...this.outcomes[kind] }, stages: { ...this.stageCounts[kind] } };
    };
    return { schema: 'drivesense-attempt-ledger-v2', clock: 'performance.now; within this page/session only',
      detector: accounting('detector'), metric: accounting('metric'),
      notRequestedWithReason: { ...this.skips }, generations: this.generations, unmatchedResults: this.unmatchedResults,
      availability: { observedMs: this.observedMs, visibleMs: this.visibleMs,
        fullSessionCoverage: this.observedMs ? this.visibleMs / this.observedMs : null,
        maxBlackoutMs: this.maxBlackoutMs, predictedOnlyPresentations: this.predictedOnly,
        eligibleCoverage: null, eligibility: 'not annotated; no automatic exclusion based on model failure',
        freshAcceptedMeasurements: this.outcomes.metric['accepted-observed'] ?? 0 },
      boundedState: { maxDetails: MAX_DETAILS, retainedDetails: this.details.length,
        discardedDetails: this.discardedDetails, maxInflight: MAX_PENDING, maxObjectsPerAttempt:MAX_DIAGNOSTIC_OBJECTS,discardedObjects:this.discardedObjects },
      objectTerminalReasons:{...this.objectReasons},
      firstFailure: this.firstFailure ? structuredClone(this.firstFailure) : null,
      details: structuredClone(this.details),
      claims: { mobile: 'unverified without actual device run', metres: 'accuracy unvalidated without independent distance truth' } };
  }
}
