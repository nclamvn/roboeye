/** TIP-64A metadata boundary. No RGB/depth tensors, GPS or persistent device IDs. */
export const LIMITS = Object.freeze({ frames: 600, durationMs: 120_000, bytes: 2 * 1024 * 1024, targets: 24, samples: 128 });
export type Label = 'person' | 'chair' | 'bottle' | 'phone' | 'book' | 'wall' | 'vehicle' | 'unknown';
export type Box = { x: number; y: number; width: number; height: number };
export interface Intrinsics { fx: number; fy: number; cx: number; cy: number }
export interface DisplayGeometry { crop: Box; rotation: 0 | 90 | 180 | 270; mirrored: boolean }
export interface DepthSample { u: number; v: number; value: number; confidence: number }
export interface DepthPacket {
  captureId: string; capturedAtMs: number;
  kind: 'metre-z' | 'metre-ray' | 'relative';
  provenance: 'arcore' | 'arkit' | 'learned-unverified' | 'unscaled' | 'synthetic';
  samples: DepthSample[];
}
export interface Target {
  id: string; label: Label; box: Box; score: number;
  support: 'foreground-associated' | 'bbox-only'; sampleIndices: number[];
}
export interface FramePacket {
  schema: 'assistive-frame-v1'; id: number; clock: 'session-monotonic-ms';
  provider: 'fixture' | 'browser-camera' | 'arcore' | 'arkit' | 'rgb-model';
  rgb: { capturedAtMs: number; readyAtMs: number; width: number; height: number; timestampBasis: 'sensor-capture' | 'browser-availability' | 'synthetic' };
  display: DisplayGeometry; intrinsics: Intrinsics | null;
  /** Row-major rigid matrix; camera +X right, +Y down, +Z forward, in metres.
   * Native adapters must convert AR SDK conventions before this boundary. */
  cameraToWorld: number[] | null;
  depth: DepthPacket | null; targets: Target[];
}
export interface GroundTruth {
  frameId: number; targetId: string; metres: number;
  kind: 'camera-to-supported-point'; method: 'tape' | 'laser' | 'synthetic';
  split: 'development' | 'holdout';
}
export interface Recording {
  schema: 'assistive-recording-v1'; id: string; createdUtc: string;
  origin: 'synthetic-fixture' | 'browser-camera' | 'native-import';
  consent: 'metadata-only'; frames: FramePacket[]; truth: GroundTruth[];
  counters: { rejectedFrames: number; stopReason: 'user' | 'frame-cap' | 'time-cap' | 'byte-cap' | 'revoked' };
}
export interface Envelope { schema: 'assistive-envelope-v1'; recording: Recording; sha256: string }
const labels: Label[] = ['person', 'chair', 'bottle', 'phone', 'book', 'wall', 'vehicle', 'unknown'];
const bad = (path: string): never => { throw Error(`Dữ liệu không hợp lệ: ${path}.`); };
function object(v: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return bad(path);
  const r = v as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k)) || Object.keys(r).some(k => !keys.includes(k))) return bad(path);
  return r;
}
function n(v: unknown, min: number, max: number, path: string, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) return bad(path);
  return v;
}
function choice<T extends string | number>(v: unknown, choices: readonly T[], p: string): T {
  if (!choices.includes(v as T)) return bad(p); return v as T;
}
function id(v: unknown, p: string): string {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(v)) return bad(p); return v;
}
function array(v: unknown, max: number, p: string): unknown[] {
  if (!Array.isArray(v) || v.length > max) return bad(p); return v;
}
function box(v: unknown, w: number, h: number, p: string): Box {
  const b = object(v, ['x', 'y', 'width', 'height'], p);
  const out = { x: n(b.x, 0, w, p), y: n(b.y, 0, h, p), width: n(b.width, .001, w, p), height: n(b.height, .001, h, p) };
  if (out.x + out.width > w || out.y + out.height > h) return bad(p); return out;
}
export function parseFrame(v: unknown): FramePacket {
  const f = object(v, ['schema', 'id', 'clock', 'provider', 'rgb', 'display', 'intrinsics', 'cameraToWorld', 'depth', 'targets'], 'frame');
  choice(f.schema, ['assistive-frame-v1'], 'schema'); choice(f.clock, ['session-monotonic-ms'], 'clock');
  const provider = choice(f.provider, ['fixture', 'browser-camera', 'arcore', 'arkit', 'rgb-model'] as const, 'provider');
  const rgb = object(f.rgb, ['capturedAtMs', 'readyAtMs', 'width', 'height', 'timestampBasis'], 'rgb');
  const width = n(rgb.width, 2, 8192, 'width', true), height = n(rgb.height, 2, 8192, 'height', true);
  const capturedAtMs = n(rgb.capturedAtMs, 0, 86_400_000, 'capture'), readyAtMs = n(rgb.readyAtMs, capturedAtMs, capturedAtMs + 60_000, 'ready');
  const timestampBasis = choice(rgb.timestampBasis, ['sensor-capture', 'browser-availability', 'synthetic'] as const, 'timestamp basis');
  if ((provider === 'fixture') !== (timestampBasis === 'synthetic') || (provider === 'browser-camera' && timestampBasis !== 'browser-availability') || (['arcore', 'arkit'].includes(provider) && timestampBasis !== 'sensor-capture')) return bad('timestamp/provider semantics');
  const d = object(f.display, ['crop', 'rotation', 'mirrored'], 'display');
  if (typeof d.mirrored !== 'boolean') return bad('mirror');
  const display = { crop: box(d.crop, width, height, 'crop'), rotation: choice(d.rotation, [0, 90, 180, 270] as const, 'rotation'), mirrored: d.mirrored };
  let intrinsics: Intrinsics | null = null;
  if (f.intrinsics !== null) {
    const k = object(f.intrinsics, ['fx', 'fy', 'cx', 'cy'], 'intrinsics');
    intrinsics = { fx: n(k.fx, .01, 1e6, 'fx'), fy: n(k.fy, .01, 1e6, 'fy'), cx: n(k.cx, 0, width, 'cx'), cy: n(k.cy, 0, height, 'cy') };
  }
  let cameraToWorld: number[] | null = null;
  if (f.cameraToWorld !== null) {
    cameraToWorld = array(f.cameraToWorld, 16, 'pose').map(v => n(v, -1e6, 1e6, 'pose'));
    if (cameraToWorld.length !== 16 || cameraToWorld.slice(12).some((v, i) => Math.abs(v - (i === 3 ? 1 : 0)) > 1e-6)) return bad('pose homogeneous');
    const rows = [0, 4, 8].map(i => cameraToWorld!.slice(i, i + 3));
    const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
    if (rows.some(a => Math.abs(dot(a, a) - 1) > 1e-4) || Math.abs(dot(rows[0], rows[1])) > 1e-4 || Math.abs(dot(rows[0], rows[2])) > 1e-4 || Math.abs(dot(rows[1], rows[2])) > 1e-4) return bad('pose orthonormal');
    const [a, b, c] = rows;
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    if (Math.abs(det - 1) > 1e-4) return bad('pose handedness');
  }
  let depth: DepthPacket | null = null;
  if (f.depth !== null) {
    const dp = object(f.depth, ['captureId', 'capturedAtMs', 'kind', 'provenance', 'samples'], 'depth');
    const kind = choice(dp.kind, ['metre-z', 'metre-ray', 'relative'] as const, 'depth kind');
    const provenance = choice(dp.provenance, ['arcore', 'arkit', 'learned-unverified', 'unscaled', 'synthetic'] as const, 'depth provenance');
    if ((kind === 'relative') !== (provenance === 'unscaled') || (provider === 'browser-camera') || (provider !== 'fixture' && (provenance === 'synthetic' || (provenance === 'arcore' && provider !== 'arcore') || (provenance === 'arkit' && provider !== 'arkit')))) return bad('depth/provider semantics');
    depth = { captureId: id(dp.captureId, 'depth id'), capturedAtMs: n(dp.capturedAtMs, 0, readyAtMs, 'depth time'), kind, provenance,
      samples: array(dp.samples, LIMITS.samples, 'samples').map(raw => {
        const s = object(raw, ['u', 'v', 'value', 'confidence'], 'sample');
        return { u: n(s.u, 0, width - 1, 'u'), v: n(s.v, 0, height - 1, 'v'), value: n(s.value, .000001, kind === 'relative' ? 1e6 : 100, 'depth value'), confidence: n(s.confidence, 0, 1, 'confidence') };
      }) };
  }
  const seen = new Set<string>();
  const targets = array(f.targets, LIMITS.targets, 'targets').map((raw): Target => {
    const t = object(raw, ['id', 'label', 'box', 'score', 'support', 'sampleIndices'], 'target');
    const targetId = id(t.id, 'target id'); if (seen.has(targetId)) return bad('duplicate target'); seen.add(targetId);
    const b = box(t.box, width, height, 'target box');
    const indices = array(t.sampleIndices, LIMITS.samples, 'support indices').map(v => n(v, 0, (depth?.samples.length ?? 0) - 1, 'index', true));
    if (new Set(indices).size !== indices.length) return bad('duplicate sample');
    if (indices.some(i => { const s = depth!.samples[i]; return s.u < b.x || s.u > b.x + b.width || s.v < b.y || s.v > b.y + b.height; })) return bad('support outside target');
    return { id: targetId, label: choice(t.label, labels, 'label'), box: b, score: n(t.score, 0, 1, 'score'), support: choice(t.support, ['foreground-associated', 'bbox-only'] as const, 'support'), sampleIndices: indices };
  });
  return { schema: 'assistive-frame-v1', id: n(f.id, 0, 1e9, 'frame id', true), clock: 'session-monotonic-ms', provider,
    rgb: { width, height, capturedAtMs, readyAtMs, timestampBasis }, display, intrinsics, cameraToWorld, depth, targets };
}
export function parseRecording(v: unknown): Recording {
  const r = object(v, ['schema', 'id', 'createdUtc', 'origin', 'consent', 'frames', 'truth', 'counters'], 'recording');
  choice(r.schema, ['assistive-recording-v1'], 'recording schema'); choice(r.consent, ['metadata-only'], 'consent');
  if (typeof r.createdUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.createdUtc) || !Number.isFinite(Date.parse(r.createdUtc))) return bad('UTC');
  if (new Date(r.createdUtc).toISOString() !== r.createdUtc) return bad('UTC calendar');
  const origin = choice(r.origin, ['synthetic-fixture', 'browser-camera', 'native-import'] as const, 'origin');
  const frames = array(r.frames, LIMITS.frames, 'frames').map(parseFrame), depthTimes = new Map<string, number>();
  const ids = new Map<number, FramePacket>(); let previousId = -1, previousTime = -1;
  for (const f of frames) {
    if (f.id <= previousId || f.rgb.capturedAtMs <= previousTime || f.rgb.capturedAtMs > LIMITS.durationMs || (origin === 'synthetic-fixture' ? f.provider !== 'fixture' : f.provider === 'fixture') || (origin === 'browser-camera' && f.provider !== 'browser-camera')) return bad('recording frame identity/order/origin');
    if (f.depth) {
      if (depthTimes.has(f.depth.captureId) && depthTimes.get(f.depth.captureId) !== f.depth.capturedAtMs) return bad('reused depth timestamp');
      depthTimes.set(f.depth.captureId, f.depth.capturedAtMs);
    }
    previousId = f.id; previousTime = f.rgb.capturedAtMs; ids.set(f.id, f);
  }
  const truthSeen = new Set<string>();
  const truth = array(r.truth, LIMITS.frames * LIMITS.targets, 'truth').map((raw): GroundTruth => {
    const t = object(raw, ['frameId', 'targetId', 'metres', 'kind', 'method', 'split'], 'truth');
    const frameId = n(t.frameId, 0, 1e9, 'truth frame', true), targetId = id(t.targetId, 'truth target');
    const method = choice(t.method, ['tape', 'laser', 'synthetic'] as const, 'truth method');
    const key = `${frameId}/${targetId}`;
    if (!ids.get(frameId)?.targets.some(t => t.id === targetId) || truthSeen.has(key) || (method === 'synthetic') !== (origin === 'synthetic-fixture')) return bad('truth binding/provenance');
    truthSeen.add(key);
    return { frameId, targetId, metres: n(t.metres, .01, 100, 'truth metres'), kind: choice(t.kind, ['camera-to-supported-point'], 'truth kind'), method, split: choice(t.split, ['development', 'holdout'] as const, 'truth split') };
  });
  const c = object(r.counters, ['rejectedFrames', 'stopReason'], 'counters');
  const result: Recording = { schema: 'assistive-recording-v1', id: id(r.id, 'recording id'), createdUtc: r.createdUtc, origin, consent: 'metadata-only', frames, truth,
    counters: { rejectedFrames: n(c.rejectedFrames, 0, 1e9, 'rejections', true), stopReason: choice(c.stopReason, ['user', 'frame-cap', 'time-cap', 'byte-cap', 'revoked'] as const, 'stop reason') } };
  if (jsonBytes(result) > LIMITS.bytes) return bad('recording byte cap'); return result;
}
export function jsonBytes(v: unknown): number { return new TextEncoder().encode(JSON.stringify(v)).byteLength; }
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(v);
}
async function digest(v: unknown) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(v)));
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function exportRecording(value: Recording): Promise<Envelope> {
  const recording = parseRecording(value);
  const envelope: Envelope = { schema: 'assistive-envelope-v1', recording, sha256: await digest(recording) };
  if (jsonBytes(envelope) > LIMITS.bytes) throw Error('Bản xuất vượt 2 MiB.'); return envelope;
}
/** Integrity only: a valid checksum does not authenticate provider, consent or measured truth. */
export async function importRecording(text: string): Promise<Recording> {
  if (new TextEncoder().encode(text).byteLength > LIMITS.bytes) throw Error('JSON vượt 2 MiB.');
  const e = object(JSON.parse(text), ['schema', 'recording', 'sha256'], 'envelope');
  choice(e.schema, ['assistive-envelope-v1'], 'envelope schema');
  const recording = parseRecording(e.recording);
  if (typeof e.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.sha256) || await digest(recording) !== e.sha256) throw Error('Checksum sai; không nhập dữ liệu.');
  return recording;
}
