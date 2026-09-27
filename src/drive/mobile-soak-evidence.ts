type UnknownRecord = Record<string, unknown>;
type Check = { id: string; pass: boolean; actual: number | string | boolean | null; expected: string };

const record = (value: unknown): UnknownRecord => value !== null && typeof value === 'object' ? value as UnknownRecord : {};
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const check = (id: string, pass: boolean, actual: Check['actual'], expected: string): Check => ({ id, pass, actual, expected });

function p95(window: UnknownRecord, stage: string) {
  return finite(record(record(window.stages)[stage]).p95Ms);
}

export interface MobileSoakVerdict {
  schema: 'drivesense-mobile-soak-acceptance-v1';
  status: 'invalid' | 'warming' | 'smoke-observed' | 'soak-observed';
  contract: { pass: boolean; checks: Check[] };
  performanceTrend: { status: 'unavailable' | 'stable' | 'degrading'; firstWindowP95Ms: number | null; tenToTwentyP95Ms: number | null; ratio: number | null };
  dominantObservedStage: 'decode-processing' | 'detector-request' | 'frame-to-overlay' | 'unavailable';
  claimBoundary: string;
}

/** Validate completeness and trends without turning runtime evidence into a safety claim. */
export function evaluateMobileSoakEvidence(input: unknown): MobileSoakVerdict {
  const report = record(input), soak = record(report.mobileSoak), session = record(soak.session);
  const privacy = record(soak.privacy), camera = record(record(soak.camera).settings), bounded = record(soak.boundedState);
  const overall = record(soak.overall), counts = record(overall.counts), windows = Array.isArray(soak.windows) ? soak.windows.map(record) : [];
  const durationMs = finite(session.durationMs), started = finite(counts.detectorStarted), accepted = finite(counts.detectorAccepted);
  const sum = (key: string) => windows.reduce((total, window) => total + (finite(record(window.counts)[key]) ?? 0), 0);
  const detectorReady = Array.isArray(soak.models) && soak.models.some(value => {
    const model = record(value); return model.kind === 'detector' && model.outcome === 'ready' && typeof model.resolvedBackend === 'string';
  });
  const checks = [
    check('schema', soak.schema === 'drivesense-mobile-soak-v1', String(soak.schema ?? 'missing'), 'drivesense-mobile-soak-v1'),
    check('live-camera', report.sourceKind === 'camera' && report.synthetic !== true, String(report.sourceKind ?? 'missing'), 'camera and non-synthetic'),
    check('pixel-free', privacy.pixelFree === true && privacy.cameraSettingsAllowlist === true, Boolean(privacy.pixelFree), 'true with camera allowlist'),
    check('camera-dimensions', (finite(camera.width) ?? 0) > 0 && (finite(camera.height) ?? 0) > 0,
      finite(camera.width) === null || finite(camera.height) === null ? null : `${camera.width}x${camera.height}`, 'positive actual width and height'),
    check('detector-ready', detectorReady, detectorReady, 'one resolved detector attempt'),
    check('detector-observed', (started ?? 0) > 0 && (accepted ?? 0) > 0, accepted, 'started and accepted frames > 0'),
    check('bounded-state', finite(bounded.inflightTraces) !== null && (finite(bounded.inflightTraces) ?? Infinity) <= (finite(bounded.maxInflightTraces) ?? -1) && bounded.retainedFrameRows === 0,
      finite(bounded.inflightTraces), 'inflight <= limit and retainedFrameRows = 0'),
    check('four-windows', windows.length === 4, windows.length, '4'),
    check('window-started-sum', started !== null && sum('detectorStarted') === started, sum('detectorStarted'), String(started)),
    check('window-accepted-sum', accepted !== null && sum('detectorAccepted') === accepted, sum('detectorAccepted'), String(accepted))
  ];
  const first = windows[0] ?? {}, later = windows[2] ?? {}, firstP95 = p95(first, 'frameToOverlay'), laterP95 = p95(later, 'frameToOverlay');
  const ratio = firstP95 !== null && laterP95 !== null && firstP95 > 0 ? laterP95 / firstP95 : null;
  const trend = ratio === null ? 'unavailable' : ratio > 1.25 ? 'degrading' : 'stable';
  const stages: Array<readonly ['decode-processing' | 'detector-request' | 'frame-to-overlay', number | null]> = [
    ['decode-processing', finite(record(record(overall.stages).decodeProcessing).p95Ms)],
    ['detector-request', finite(record(record(overall.stages).requestToResult).p95Ms)],
    ['frame-to-overlay', finite(record(record(overall.stages).frameToOverlay).p95Ms)]
  ];
  let dominant: MobileSoakVerdict['dominantObservedStage'] = 'unavailable', dominantMs = -Infinity;
  for (const [name, value] of stages) if (value !== null && value > dominantMs) { dominant = name; dominantMs = value; }
  const valid = checks.every(item => item.pass), status: MobileSoakVerdict['status'] = !valid ? 'invalid' :
    (durationMs ?? 0) >= 30 * 60_000 ? 'soak-observed' : (durationMs ?? 0) >= 60_000 ? 'smoke-observed' : 'warming';
  return { schema: 'drivesense-mobile-soak-acceptance-v1', status, contract: { pass: valid, checks },
    performanceTrend: { status: trend, firstWindowP95Ms: firstP95, tenToTwentyP95Ms: laterP95, ratio },
    dominantObservedStage: dominant,
    claimBoundary: 'Completeness and runtime trend only. This does not validate distance accuracy, collision-warning safety or public-road readiness.' };
}
