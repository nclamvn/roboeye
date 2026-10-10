import { parseFrame, type FramePacket, type Intrinsics, type DisplayGeometry, type Target } from './contract';

export const RANGE_POLICY = Object.freeze({ maxAgeMs: 300, maxSkewMs: 50, minimumConfidence: .7, minimumSamples: 5, nearM: .5, farM: 5 });
export type RangeReason = 'supported' | 'no-depth' | 'relative-only' | 'no-intrinsics' | 'stale' | 'clock-future' | 'rgb-depth-skew' | 'depth-reused' | 'no-foreground' | 'low-support' | 'ambiguous-support' | 'outside-domain';
export interface RangeEvidence {
  targetId: string; metres: number | null; kind: 'camera-to-supported-point';
  reason: RangeReason; provenance: 'synthetic' | 'native-unverified' | 'learned-unverified' | 'unavailable';
  physicalValidation: 'pending'; captureToReadyMs: number; depthAgeMs: number | null;
}
/** Display coordinates are normalized after source crop, clockwise rotation, then mirror.
 * Intrinsics/support remain in original camera pixel coordinates. */
export function toDisplay(u: number, v: number, d: DisplayGeometry): [number, number] {
  let x = (u - d.crop.x) / d.crop.width, y = (v - d.crop.y) / d.crop.height;
  if (d.rotation === 90) [x, y] = [1 - y, x];
  else if (d.rotation === 180) [x, y] = [1 - x, 1 - y];
  else if (d.rotation === 270) [x, y] = [y, 1 - x];
  if (d.mirrored) x = 1 - x;
  return [x, y];
}
export function fromDisplay(x: number, y: number, d: DisplayGeometry): [number, number] {
  if (d.mirrored) x = 1 - x;
  if (d.rotation === 90) [x, y] = [y, 1 - x];
  else if (d.rotation === 180) [x, y] = [1 - x, 1 - y];
  else if (d.rotation === 270) [x, y] = [1 - y, x];
  return [d.crop.x + x * d.crop.width, d.crop.y + y * d.crop.height];
}
export function unproject(u: number, v: number, value: number, kind: 'metre-z' | 'metre-ray', k: Intrinsics): [number, number, number] {
  if (!['metre-z', 'metre-ray'].includes(kind) || ![u, v, value, k.fx, k.fy, k.cx, k.cy].every(Number.isFinite) || value <= 0 || k.fx <= 0 || k.fy <= 0) throw Error('Unprojection không hợp lệ.');
  const x = (u - k.cx) / k.fx, y = (v - k.cy) / k.fy;
  const z = kind === 'metre-z' ? value : value / Math.hypot(x, y, 1);
  return [x * z, y * z, z];
}
const median = (v: number[]) => { const s = v.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
/** Reference maths, NOT a shipped segmentation/ranging model. Foreground support
 * must be supplied by an adapter; bbox-only depth is never upgraded to foreground. */
export function rangeForTarget(packet: FramePacket, targetId: string, nowMs = packet.rgb.readyAtMs, depthReused = false): RangeEvidence {
  const f = parseFrame(packet), t: Target | undefined = f.targets.find(t => t.id === targetId);
  if (!t) throw Error('Target không thuộc frame.');
  return rangeForValidatedTarget(f, t, nowMs, depthReused);
}
function rangeForValidatedTarget(f: FramePacket, t: Target, nowMs: number, depthReused: boolean): RangeEvidence {
  const d = f.depth;
  const evidence: RangeEvidence = { targetId: t.id, metres: null, kind: 'camera-to-supported-point', reason: 'no-depth',
    provenance: f.provider === 'fixture' ? 'synthetic' : d?.provenance === 'learned-unverified' ? 'learned-unverified' : d && d.provenance !== 'unscaled' ? 'native-unverified' : 'unavailable',
    physicalValidation: 'pending', captureToReadyMs: f.rgb.readyAtMs - f.rgb.capturedAtMs, depthAgeMs: d ? nowMs - d.capturedAtMs : null };
  const refuse = (reason: RangeReason) => ({ ...evidence, reason });
  if (!Number.isFinite(nowMs) || nowMs < f.rgb.readyAtMs || (d && nowMs < d.capturedAtMs)) return refuse('clock-future');
  if (!d) return refuse('no-depth');
  if (d.kind === 'relative') return refuse('relative-only');
  if (!f.intrinsics) return refuse('no-intrinsics');
  if (depthReused) return refuse('depth-reused');
  if (nowMs - d.capturedAtMs > RANGE_POLICY.maxAgeMs || nowMs - f.rgb.capturedAtMs > RANGE_POLICY.maxAgeMs) return refuse('stale');
  if (Math.abs(f.rgb.capturedAtMs - d.capturedAtMs) > RANGE_POLICY.maxSkewMs) return refuse('rgb-depth-skew');
  if (t.support !== 'foreground-associated') return refuse('no-foreground');
  const samples = t.sampleIndices.map(i => d.samples[i]).filter(s => s.confidence >= RANGE_POLICY.minimumConfidence);
  if (samples.length < RANGE_POLICY.minimumSamples || new Set(samples.map(s => `${s.u}/${s.v}`)).size < RANGE_POLICY.minimumSamples) return refuse('low-support');
  const values = samples.map(s => Math.hypot(...unproject(s.u, s.v, s.value, d.kind as 'metre-z' | 'metre-ray', f.intrinsics!)));
  const m = median(values);
  // Tight reference support gate; not a calibrated probability or surface mask.
  if (values.filter(v => Math.abs(v - m) > Math.max(.15, m * .15)).length >= values.length * .2) return refuse('ambiguous-support');
  if (m < RANGE_POLICY.nearM || m > RANGE_POLICY.farM) return refuse('outside-domain');
  return { ...evidence, reason: 'supported', metres: m };
}
/** Every replay frame keeps a reused depth map visibly unknown, also after seek. */
export function rangesAt(frames: FramePacket[], index: number): RangeEvidence[] {
  const raw = frames[index]; if (!raw) return [];
  const f = parseFrame(raw);
  const reused = !!f.depth && frames.slice(0, index).some(p => p.depth?.captureId === f.depth!.captureId);
  return f.targets.map(t => rangeForValidatedTarget(f, t, f.rgb.readyAtMs, reused));
}
