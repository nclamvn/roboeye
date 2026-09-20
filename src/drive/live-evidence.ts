export const LIVE_EVIDENCE_GATE = {
  smoke: { minDurationMs: 60_000, minAcceptedFrames: 100 },
  soak: { minDurationMs: 30 * 60_000, minAcceptedFrames: 3_000 },
  runtime: { maxFrameToOverlayP95Ms: 150, maxDroppedRate: .01 },
  metric: { minAttempts: 10, minAcceptedRate: .8, maxDroppedRate: .2 }
} as const;

type UnknownRecord = Record<string, unknown>;
type Check = { id: string; pass: boolean; actual: number | string | boolean | null; expected: string };

export interface LiveEvidenceVerdict {
  schema: 'drivesense-live-acceptance-v1';
  status: 'invalid' | 'not-camera' | 'smoke-pending' | 'smoke-pass' | 'soak-pass';
  runtimeSmoke: { pass: boolean; checks: Check[] };
  runtimeSoak: { pass: boolean; checks: Check[] };
  metricPath: { status: 'not-observed' | 'pass' | 'fail'; checks: Check[] };
  claimBoundary: string;
}

const record = (value: unknown): UnknownRecord => value !== null && typeof value === 'object' ? value as UnknownRecord : {};
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const ratio = (part: number | null, total: number | null) => part === null || total === null || total <= 0 ? null : part / total;
const check = (id: string, pass: boolean, actual: Check['actual'], expected: string): Check => ({ id, pass, actual, expected });

/** Evaluate exported, pixel-free live telemetry without upgrading it into an accuracy claim. */
export function evaluateLiveEvidence(input: unknown): LiveEvidenceVerdict {
  const report = record(input), timing = record(report.liveTiming), session = record(timing.session);
  const counts = record(timing.counts), stages = record(timing.stages), overlay = record(stages.frameToOverlay);
  const dimensions = record(record(report.runtime).sourceDimensions), drops = record(counts.dropReasons);
  const durationMs = finite(session.durationMs), started = finite(counts.started), accepted = finite(counts.accepted);
  const dropped = finite(counts.dropped), p95 = finite(overlay.p95Ms), width = finite(dimensions.width), height = finite(dimensions.height);
  const droppedRate = ratio(dropped, started);
  const common = [
    check('camera-source', report.sourceKind === 'camera' && report.synthetic !== true, String(report.sourceKind ?? 'missing'), 'camera and non-synthetic'),
    check('source-dimensions', (width ?? 0) > 0 && (height ?? 0) > 0, width === null || height === null ? null : `${width}x${height}`, 'positive width and height'),
    check('accepted-rate', ratio(accepted, started) !== null && ratio(accepted, started)! >= 1 - LIVE_EVIDENCE_GATE.runtime.maxDroppedRate,
      ratio(accepted, started), `>= ${1 - LIVE_EVIDENCE_GATE.runtime.maxDroppedRate}`),
    check('dropped-rate', droppedRate !== null && droppedRate <= LIVE_EVIDENCE_GATE.runtime.maxDroppedRate,
      droppedRate, `<= ${LIVE_EVIDENCE_GATE.runtime.maxDroppedRate}`),
    check('frame-to-overlay-p95', p95 !== null && p95 <= LIVE_EVIDENCE_GATE.runtime.maxFrameToOverlayP95Ms,
      p95, `<= ${LIVE_EVIDENCE_GATE.runtime.maxFrameToOverlayP95Ms} ms`),
    check('no-worker-or-geometry-drop', (finite(drops['worker-error']) ?? 0) === 0 && (finite(drops['geometry-change']) ?? 0) === 0,
      (finite(drops['worker-error']) ?? 0) + (finite(drops['geometry-change']) ?? 0), '0')
  ];
  const smokeChecks = [...common,
    check('smoke-duration', durationMs !== null && durationMs >= LIVE_EVIDENCE_GATE.smoke.minDurationMs,
      durationMs, `>= ${LIVE_EVIDENCE_GATE.smoke.minDurationMs} ms`),
    check('smoke-accepted-frames', accepted !== null && accepted >= LIVE_EVIDENCE_GATE.smoke.minAcceptedFrames,
      accepted, `>= ${LIVE_EVIDENCE_GATE.smoke.minAcceptedFrames}`)
  ];
  const soakChecks = [...common,
    check('soak-duration', durationMs !== null && durationMs >= LIVE_EVIDENCE_GATE.soak.minDurationMs,
      durationMs, `>= ${LIVE_EVIDENCE_GATE.soak.minDurationMs} ms`),
    check('soak-accepted-frames', accepted !== null && accepted >= LIVE_EVIDENCE_GATE.soak.minAcceptedFrames,
      accepted, `>= ${LIVE_EVIDENCE_GATE.soak.minAcceptedFrames}`)
  ];
  const metric = record(report.liveMetric), attempts = finite(metric.attempts), metricAccepted = finite(metric.accepted);
  const metricDropped = finite(metric.droppedOrUnmatched), acceptedRate = ratio(metricAccepted, attempts), metricDroppedRate = ratio(metricDropped, attempts);
  const metricChecks = [
    check('metric-model-loaded', report.rangeModel !== null && report.rangeModel !== undefined, Boolean(report.rangeModel), 'true'),
    check('metric-attempts', attempts !== null && attempts >= LIVE_EVIDENCE_GATE.metric.minAttempts,
      attempts, `>= ${LIVE_EVIDENCE_GATE.metric.minAttempts}`),
    check('metric-accepted-rate', acceptedRate !== null && acceptedRate >= LIVE_EVIDENCE_GATE.metric.minAcceptedRate,
      acceptedRate, `>= ${LIVE_EVIDENCE_GATE.metric.minAcceptedRate}`),
    check('metric-dropped-rate', metricDroppedRate !== null && metricDroppedRate <= LIVE_EVIDENCE_GATE.metric.maxDroppedRate,
      metricDroppedRate, `<= ${LIVE_EVIDENCE_GATE.metric.maxDroppedRate}`)
  ];
  const runtimeSmoke = smokeChecks.every(item => item.pass), runtimeSoak = soakChecks.every(item => item.pass);
  const metricObserved = (attempts ?? 0) > 0;
  const structurallyValid = timing.schema === 'drivesense-live-timing-v1' && durationMs !== null && started !== null && accepted !== null && dropped !== null;
  const camera = report.sourceKind === 'camera' && report.synthetic !== true;
  const status: LiveEvidenceVerdict['status'] = !structurallyValid ? 'invalid' : !camera ? 'not-camera' : runtimeSoak ? 'soak-pass' : runtimeSmoke ? 'smoke-pass' : 'smoke-pending';
  return { schema: 'drivesense-live-acceptance-v1', status,
    runtimeSmoke: { pass: runtimeSmoke, checks: smokeChecks }, runtimeSoak: { pass: runtimeSoak, checks: soakChecks },
    metricPath: { status: !metricObserved ? 'not-observed' : metricChecks.every(item => item.pass) ? 'pass' : 'fail', checks: metricChecks },
    claimBoundary: 'Runtime-only evidence. It does not validate distance accuracy, collision-warning safety, sensor exposure latency or public-road readiness.' };
}
