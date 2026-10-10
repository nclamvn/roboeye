import { parseRecording, type Recording, type FramePacket } from './contract';
import { rangesAt } from './range';

export const SCENARIOS = [
  { id: 'static', title: 'Vật đứng yên', note: 'Đối chiếu Z và khoảng cách tới điểm 3D.' },
  { id: 'target-motion', title: 'Vật tiến lại', note: 'Chuyển động mô phỏng; chưa có bộ nhận biết vận tốc.' },
  { id: 'camera-motion', title: 'Camera di chuyển', note: 'Pose có dịch chuyển; không suy ra vật đang tiến lại từ hộp 2D.' },
  { id: 'transforms', title: 'Xoay, crop, lật', note: 'Tọa độ màn hình đổi, khoảng cách điểm không đổi.' },
  { id: 'occlusion', title: 'Mất vùng hỗ trợ', note: 'Không dùng số đo cũ khi không còn dữ liệu.' },
  { id: 'confidence', title: 'Depth thiếu tin cậy', note: 'Từ chối vùng nền lẫn vào vật và confidence thấp.' },
  { id: 'stale', title: 'Depth cũ / dùng lại', note: 'Capture ID và timestamp không được làm mới bằng replay.' },
  { id: 'relative', title: 'Chỉ depth tương đối', note: 'Không thể tự đổi sang mét.' },
  { id: 'learned', title: 'Ước lượng AI', note: 'Tính toán mẫu; độ chính xác vật lý vẫn chưa kiểm chứng.' },
] as const;
export type ScenarioId = typeof SCENARIOS[number]['id'];
const pose = (x = 0) => [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function syntheticScenario(scenario: ScenarioId): Recording {
  if (!SCENARIOS.some(s => s.id === scenario)) throw Error('Scenario chưa hỗ trợ.');
  const frames: FramePacket[] = Array.from({ length: 41 }, (_, i) => {
    const time = 1000 + i * 100, value = scenario === 'target-motion' ? 3.5 - i * .05 : 2;
    const frame: FramePacket = { schema: 'assistive-frame-v1', id: i, clock: 'session-monotonic-ms', provider: 'fixture',
      rgb: { capturedAtMs: time, readyAtMs: time + 35, width: 640, height: 480, timestampBasis: 'synthetic' },
      intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 }, cameraToWorld: pose(scenario === 'camera-motion' ? i * .01 : 0),
      display: { crop: { x: 0, y: 0, width: 640, height: 480 }, rotation: 0, mirrored: false },
      depth: { captureId: `depth-${i}`, capturedAtMs: time, kind: 'metre-z', provenance: 'synthetic', samples: [-2, -1, 0, 1, 2].map(x => ({ u: 410 + x, v: 240, value, confidence: .9 })) },
      targets: [{ id: 'object-1', label: 'bottle', box: { x: 360, y: 140, width: 110, height: 220 }, score: .92, support: 'foreground-associated', sampleIndices: [0, 1, 2, 3, 4] }] };
    if (scenario === 'camera-motion') {
      // World point remains X=.36, Z=2 while the camera translates right.
      const pixelShift = i * .01 * 500 / 2;
      frame.depth!.samples.forEach(s => s.u -= pixelShift); frame.targets[0].box.x -= pixelShift;
    }
    if (scenario === 'transforms') {
      frame.display = { crop: { x: 80, y: 40, width: 500, height: 400 }, rotation: ([0, 90, 180, 270] as const)[Math.floor(i / 10) % 4], mirrored: i >= 20 };
    }
    if (scenario === 'occlusion' && i >= 15 && i <= 28) { frame.depth = null; frame.targets[0].sampleIndices = []; }
    if (scenario === 'confidence' && i >= 12) {
      if (i < 26) frame.depth!.samples.forEach(s => s.confidence = .3);
      else frame.depth!.samples[0].value = 4;
      if (i >= 35) frame.targets[0].support = 'bbox-only';
    }
    if (scenario === 'stale' && i >= 12) {
      frame.depth!.captureId = 'depth-11'; frame.depth!.capturedAtMs = 2100;
      if (i >= 25) { frame.depth!.captureId = `old-${i}`; frame.depth!.capturedAtMs = time - 700; }
    }
    if (scenario === 'relative') { frame.depth!.kind = 'relative'; frame.depth!.provenance = 'unscaled'; }
    if (scenario === 'learned') frame.depth!.provenance = 'learned-unverified';
    return frame;
  });
  return parseRecording({ schema: 'assistive-recording-v1', id: `synthetic-${scenario}`, createdUtc: '2026-10-10T00:00:00.000Z', origin: 'synthetic-fixture', consent: 'metadata-only', frames,
    truth: frames.filter(f => f.depth && scenario !== 'relative').map(f => ({ frameId: f.id, targetId: 'object-1', metres: Math.hypot((f.depth!.samples[2].u - 320) / 500 * f.depth!.samples[2].value, f.depth!.samples[2].value), kind: 'camera-to-supported-point', method: 'synthetic', split: 'holdout' })),
    counters: { rejectedFrames: 0, stopReason: 'user' } });
}

/** Six distances × four controlled observation conditions; not collected data. */
export const COLLECTION_PLAN = [.5, 1, 1.5, 2, 3, 5].flatMap((distance, i) => ['center-static', 'edge-static', 'target-moving', 'camera-moving'].map((condition, j) => ({
  id: `position-${i * 4 + j + 1}`, plannedMetres: distance, condition,
  split: i % 2 ? 'holdout' : 'development', measuredMetres: null, recordingId: null, frameId: null, targetId: null,
  status: 'not-collected', measurementKind: 'camera-to-supported-point',
})));

export function evaluateRecording(input: Recording) {
  const r = parseRecording(input), estimates = r.frames.map((_, i) => rangesAt(r.frames, i));
  const all = estimates.flat(), supported = all.filter(e => e.metres !== null);
  const errors: number[] = [];
  let labelled = 0;
  for (const truth of r.truth.filter(t => t.method !== 'synthetic' && t.split === 'holdout')) {
    labelled++;
    const index = r.frames.findIndex(f => f.id === truth.frameId), e = estimates[index].find(e => e.targetId === truth.targetId);
    if (e?.metres !== null && e?.metres !== undefined) errors.push(Math.abs(e.metres - truth.metres));
  }
  const sorted = errors.slice().sort((a, b) => a - b);
  return { targetObservations: all.length, supportedObservations: supported.length, coverage: all.length ? supported.length / all.length : null,
    measuredHoldoutLabels: labelled, pairedMeasuredHoldouts: errors.length,
    maeM: errors.length ? errors.reduce((s, v) => s + v, 0) / errors.length : null,
    p95ErrorM: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null,
    labelledCoverage: labelled ? errors.length / labelled : null,
    verdict: 'physical-validation-pending' as const,
    // Metadata/import has no trusted latency origin or audio-onset measurement.
    phoneLatencyP95Ms: null, audioOnsetP95Ms: null };
}
