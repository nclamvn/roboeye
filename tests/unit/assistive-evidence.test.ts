import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, parseFrame, parseRecording, exportRecording, importRecording, type FramePacket, type Recording } from '../../src/assistive/contract';
import { rangeForTarget, rangesAt, unproject, toDisplay, fromDisplay } from '../../src/assistive/range';
import { SCENARIOS, syntheticScenario, COLLECTION_PLAN, evaluateRecording } from '../../src/assistive/corpus';
import { MetadataRecorder, ReplayCursor, CameraLease } from '../../src/assistive/recording';
const frame = () => syntheticScenario('static').frames[0];
function cameraFrame(id = 0, time = 0): FramePacket {
  const f = frame(); f.id = id; f.provider = 'browser-camera'; f.rgb = { ...f.rgb, capturedAtMs: time, readyAtMs: time, timestampBasis: 'browser-availability' };
  f.intrinsics = null; f.cameraToWorld = null; f.depth = null; f.targets = []; return f;
}
test('R1 closed frame parser rejects private/unknown data at each boundary', () => {
  for (const mutate of [
    (f: any) => f.pixels = [1, 2], (f: any) => f.rgb.deviceId = 'phone', (f: any) => f.display.gps = 'x',
    (f: any) => f.depth.samples[0].rgba = [], (f: any) => f.targets[0].localPath = '/tmp',
    (f: any) => f.intrinsics.secret = 'x',
  ]) { const f = frame(); mutate(f); assert.throws(() => parseFrame(f)); }
});
test('R1 malformed/nonfinite temporal and geometric fields fail loudly', () => {
  for (const mutate of [
    (f: FramePacket) => f.rgb.width = 0, f => f.rgb.height = 1.2, f => f.rgb.readyAtMs = 0,
    f => f.intrinsics!.fx = NaN, f => f.display.crop.width = 1000, f => f.depth!.samples[0].u = 640,
    f => f.depth!.samples[0].value = Infinity, f => f.targets[0].sampleIndices = [128],
    f => f.targets[0].sampleIndices = [0, 0], f => f.targets[0].box.x = 420,
    f => f.targets.push(structuredClone(f.targets[0])),
  ] as ((f: FramePacket) => void)[]) { const f = frame(); mutate(f); assert.throws(() => parseFrame(f)); }
});
test('R1 pose rejects scale, reflection, nonrigid/homogeneous and invalid dimensions', () => {
  for (const pose of [[1], [2,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], [-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], [1,0,0,0,0,1,0,0,0,0,1,0,0,0,1,1]]) {
    const f = frame(); f.cameraToWorld = pose; assert.throws(() => parseFrame(f));
  }
  assert.ok(parseFrame(frame()).cameraToWorld);
});
test('R1 provider/unit/timestamp declarations cannot contradict their channel', () => {
  const f = frame(); f.provider = 'browser-camera'; assert.throws(() => parseFrame(f));
  f.rgb.timestampBasis = 'browser-availability'; assert.throws(() => parseFrame(f));
  const relative = frame(); relative.depth!.kind = 'relative'; assert.throws(() => parseFrame(relative));
  const native = frame(); native.provider = 'arcore'; native.rgb.timestampBasis = 'sensor-capture'; native.depth!.provenance = 'arkit'; assert.throws(() => parseFrame(native));
  native.depth!.provenance = 'arcore'; assert.equal(parseFrame(native).depth?.provenance, 'arcore');
});
test('R2 Z and ray range unprojection differ at camera edge', () => {
  const k = { fx: 500, fy: 500, cx: 320, cy: 240 };
  assert.deepEqual(unproject(320, 240, 2, 'metre-z', k), [0, 0, 2]);
  assert.ok(Math.abs(Math.hypot(...unproject(620, 240, 2, 'metre-z', k)) - 2 * Math.sqrt(1.36)) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...unproject(620, 240, 2, 'metre-ray', k)) - 2) < 1e-12);
  assert.throws(() => unproject(0, 0, 2, 'metre-z', { ...k, fx: 0 }));
});
test('R2 all rotations/mirror/crop round-trip without modifying intrinsics or range', () => {
  for (const rotation of [0, 90, 180, 270] as const) for (const mirrored of [false, true]) {
    const d = { crop: { x: 80, y: 40, width: 500, height: 400 }, rotation, mirrored };
    const p = fromDisplay(...toDisplay(410, 240, d), d);
    assert.ok(Math.abs(p[0] - 410) < 1e-9 && Math.abs(p[1] - 240) < 1e-9);
    const f = frame(); f.display = d; assert.equal(rangeForTarget(f, 'object-1').metres, rangeForTarget(frame(), 'object-1').metres);
  }
  assert.deepEqual(toDisplay(580, 40, { crop: { x: 80, y: 40, width: 500, height: 400 }, rotation: 90, mirrored: true }), [0, 1]);
});
test('R2 relative, missing K, stale, future clock and RGB-depth skew never yield metres', () => {
  const relative = syntheticScenario('relative').frames[0]; assert.equal(rangeForTarget(relative, 'object-1').reason, 'relative-only');
  const noK = frame(); noK.intrinsics = null; assert.equal(rangeForTarget(noK, 'object-1').reason, 'no-intrinsics');
  assert.equal(rangeForTarget(frame(), 'object-1', 1400).reason, 'stale');
  assert.equal(rangeForTarget(frame(), 'object-1', 999).reason, 'clock-future');
  const skew = frame(); skew.depth!.capturedAtMs -= 60; assert.equal(rangeForTarget(skew, 'object-1').reason, 'rgb-depth-skew');
});
test('R2 bbox-only, weak, mixed foreground and outside-domain depth rejected', () => {
  const bbox = frame(); bbox.targets[0].support = 'bbox-only'; assert.equal(rangeForTarget(bbox, 'object-1').reason, 'no-foreground');
  const low = frame(); low.depth!.samples[0].confidence = .2; assert.equal(rangeForTarget(low, 'object-1').reason, 'low-support');
  const mixed = frame(); mixed.depth!.samples[0].value = 4; assert.equal(rangeForTarget(mixed, 'object-1').reason, 'ambiguous-support');
  const far = frame(); far.depth!.samples.forEach(s => s.value = 10); assert.equal(rangeForTarget(far, 'object-1').reason, 'outside-domain');
  const duplicatePixels = frame(); duplicatePixels.depth!.samples.forEach(s => s.u = 410); assert.equal(rangeForTarget(duplicatePixels, 'object-1').reason, 'low-support');
});
test('R3 invalid budgets/calendar and relative unprojection cannot bypass validation', () => {
  assert.throws(() => new MetadataRecorder({ ...LIMITS, frames: NaN }));
  assert.throws(() => new MetadataRecorder({ ...LIMITS, frames: 2.5 }));
  const r = syntheticScenario('static'); r.createdUtc = '2026-02-30T00:00:00.000Z'; assert.throws(() => parseRecording(r));
  assert.throws(() => unproject(0, 0, 2, 'relative' as any, { fx: 500, fy: 500, cx: 320, cy: 240 }));
});
test('R2 learned/native/fixture values are never physically accepted', () => {
  const f = frame(); assert.equal(rangeForTarget(f, 'object-1').provenance, 'synthetic');
  f.provider = 'rgb-model'; f.rgb.timestampBasis = 'browser-availability'; f.depth!.provenance = 'learned-unverified';
  assert.equal(rangeForTarget(f, 'object-1').provenance, 'learned-unverified');
  f.provider = 'arkit'; f.rgb.timestampBasis = 'sensor-capture'; f.depth!.provenance = 'arkit';
  assert.equal(rangeForTarget(f, 'object-1').provenance, 'native-unverified');
  assert.equal(rangeForTarget(f, 'object-1').physicalValidation, 'pending');
});
test('R3 recorder requires consent and rejects fixture/provider replacement', () => {
  const r = new MetadataRecorder(); assert.throws(() => r.start(false, 'browser-camera'));
  assert.equal(r.append(cameraFrame()), false); r.start(true, 'browser-camera');
  assert.equal(r.append(frame()), false); assert.equal(r.count, 0); assert.equal(r.snapshot()!.counters.rejectedFrames, 1);
  assert.equal(r.append(cameraFrame()), true); const snapshot = r.snapshot()!; snapshot.frames.length = 0; assert.equal(r.count, 1);
  r.stop(); assert.equal(r.append(cameraFrame(1, 100)), false); assert.throws(() => r.start(true, 'browser-camera'));
  r.clear(); assert.equal(r.snapshot(), null); assert.equal(r.state, 'idle'); assert.equal(r.append(cameraFrame()), false);
});
test('R3 recorder enforces actual frame/time/byte limits and includes stop reason', () => {
  const r = new MetadataRecorder(); r.start(true, 'browser-camera');
  for (let i = 0; i < LIMITS.frames; i++) assert.equal(r.append(cameraFrame(i, i * 100)), true);
  assert.equal(r.state, 'stopped'); assert.equal(r.snapshot()!.counters.stopReason, 'frame-cap'); assert.equal(r.append(cameraFrame(601, 60100)), false);
  const time = new MetadataRecorder({ ...LIMITS, durationMs: 100 }); time.start(true, 'browser-camera');
  assert.equal(time.append(cameraFrame(0, 101)), false); assert.equal(time.snapshot()!.counters.stopReason, 'time-cap');
  const tick = new MetadataRecorder(); tick.start(true, 'browser-camera'); tick.tick(LIMITS.durationMs); assert.equal(tick.state, 'stopped');
  const bytes = new MetadataRecorder({ ...LIMITS, bytes: 1500 }); bytes.start(true, 'browser-camera'); assert.equal(bytes.append(cameraFrame()), false); assert.equal(bytes.snapshot()!.counters.stopReason, 'byte-cap');
});
test('R3 unknown privacy fields/order and inconsistent reused depth IDs rejected', () => {
  const r = syntheticScenario('static'); r.frames[1].id = r.frames[0].id; assert.throws(() => parseRecording(r));
  const t = syntheticScenario('static'); t.frames[1].rgb.capturedAtMs = t.frames[0].rgb.capturedAtMs; assert.throws(() => parseRecording(t));
  const d = syntheticScenario('static'); d.frames[1].depth!.captureId = d.frames[0].depth!.captureId; assert.throws(() => parseRecording(d));
  const big = syntheticScenario('static'); big.frames = Array.from({ length: 601 }, () => frame()); assert.throws(() => parseRecording(big));
  assert.throws(() => parseRecording({ ...syntheticScenario('static'), gps: [1, 2] }));
});
test('R3 JSON checksum round-trip/tamper/oversize and import isolation', async () => {
  const r = syntheticScenario('static'), e = await exportRecording(r);
  assert.deepEqual(await importRecording(JSON.stringify(e)), r);
  e.recording.frames[0].depth!.samples[0].value = 3; await assert.rejects(importRecording(JSON.stringify(e)), /Checksum/);
  await assert.rejects(importRecording(' '.repeat(LIMITS.bytes + 1)), /2 MiB/);
  await assert.rejects(importRecording(JSON.stringify({ ...(await exportRecording(r)), pixelConsent: true })));
  const recorder = new MetadataRecorder(); await importRecording(JSON.stringify(await exportRecording(r))); assert.equal(recorder.state, 'idle');
});
test('R3 CameraLease stops late/cancelled/previous streams', async () => {
  let stopped = 0; const stream = () => ({ getTracks: () => [{ stop: () => stopped++ }] }) as unknown as MediaStream;
  let resolve!: (s: MediaStream) => void; const lease = new CameraLease();
  const promise = lease.acquire(() => new Promise(r => resolve = r)); lease.stop(); resolve(stream()); assert.equal(await promise, null); assert.equal(stopped, 1);
  assert.ok(await lease.acquire(async () => stream())); assert.ok(await lease.acquire(async () => stream())); assert.equal(stopped, 2); lease.stop(); assert.equal(stopped, 3);
});
test('R4 every deterministic scenario parses and remains synthetic', () => {
  for (const s of SCENARIOS) { const r = syntheticScenario(s.id); assert.equal(r.frames.length, 41); assert.equal(r.origin, 'synthetic-fixture'); assert.equal(evaluateRecording(r).maeM, null); }
});
test('R4 camera motion fixture keeps supported world point stationary', () => {
  const r = syntheticScenario('camera-motion');
  for (const f of r.frames) {
    const s = f.depth!.samples[2], p = unproject(s.u, s.v, s.value, 'metre-z', f.intrinsics!);
    assert.ok(Math.abs(p[0] + f.cameraToWorld![3] - .36) < 1e-12); assert.equal(p[2], 2);
  }
});
test('R4 binary seek clamps time and handles empty/single recording', () => {
  const c = new ReplayCursor(syntheticScenario('static')); assert.equal(c.durationMs, 4000);
  assert.equal(c.seek(151)?.id, 1); assert.equal(c.seek(-1)?.id, 0); assert.equal(c.seek(99999)?.id, 40); assert.throws(() => c.seek(NaN));
  const r = syntheticScenario('static'); r.frames = []; r.truth = []; assert.equal(new ReplayCursor(r).seek(0), null);
});
test('R4 depth ID cannot be refreshed by playback or seek; occlusion drops metres', () => {
  const stale = syntheticScenario('stale'); assert.equal(rangesAt(stale.frames, 12)[0].reason, 'depth-reused');
  assert.equal(rangesAt(stale.frames, 26)[0].reason, 'stale');
  const occ = syntheticScenario('occlusion'); assert.equal(rangesAt(occ.frames, 18)[0].metres, null); assert.ok(rangesAt(occ.frames, 30)[0].metres);
});
test('R5 24 physical collection slots stay uncollected, synthetic scores excluded', () => {
  assert.equal(COLLECTION_PLAN.length, 24); assert.equal(new Set(COLLECTION_PLAN.map(p => p.id)).size, 24);
  assert.ok(COLLECTION_PLAN.every(p => p.measuredMetres === null && p.status === 'not-collected'));
  const m = evaluateRecording(syntheticScenario('static')); assert.equal(m.measuredHoldoutLabels, 0); assert.equal(m.maeM, null); assert.equal(m.phoneLatencyP95Ms, null);
});
function declaredPhysical(): Recording {
  const r = syntheticScenario('static'); r.origin = 'native-import';
  r.frames.forEach(f => { f.provider = 'arcore'; f.rgb.timestampBasis = 'sensor-capture'; f.depth!.provenance = 'arcore'; });
  r.truth = [{ frameId: 0, targetId: 'object-1', metres: 2, kind: 'camera-to-supported-point', method: 'tape', split: 'holdout' }]; return r;
}
test('R5 matching measured holdouts produce error but no acceptance; missing/duplicate/mixed truth rejected', () => {
  const r = declaredPhysical(), m = evaluateRecording(r); assert.equal(m.pairedMeasuredHoldouts, 1); assert.ok(m.maeM! > 0); assert.equal(m.verdict, 'physical-validation-pending');
  const invalid = declaredPhysical(); invalid.truth[0].frameId = 888; assert.throws(() => parseRecording(invalid));
  const duplicate = declaredPhysical(); duplicate.truth.push({ ...duplicate.truth[0] }); assert.throws(() => parseRecording(duplicate));
  const mixed = declaredPhysical(); mixed.truth[0].method = 'synthetic'; assert.throws(() => parseRecording(mixed));
});
test('R5 coverage reports refused measured holdouts instead of hiding misses', () => {
  const r = declaredPhysical(); r.frames[0].targets[0].support = 'bbox-only'; const m = evaluateRecording(r);
  assert.equal(m.measuredHoldoutLabels, 1); assert.equal(m.pairedMeasuredHoldouts, 0); assert.equal(m.labelledCoverage, 0); assert.equal(m.maeM, null);
});
