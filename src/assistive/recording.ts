import { LIMITS, parseFrame, parseRecording, jsonBytes, type Recording } from './contract';

/** Bounded volatile recorder. No storage API, pixels, network or implicit consent. */
export class MetadataRecorder {
  private data: Recording | null = null;
  private allowed = false;
  private priorDepth = new Map<string, number>();
  private size = 0;
  state: 'idle' | 'recording' | 'stopped' = 'idle';
  lastError: string | null = null;
  constructor(private limits = LIMITS) {
    if (![limits.frames, limits.bytes, limits.durationMs].every(Number.isFinite) || !Number.isInteger(limits.frames) || !Number.isInteger(limits.bytes) || limits.frames < 1 || limits.frames > LIMITS.frames || limits.bytes < 1024 || limits.bytes > LIMITS.bytes || limits.durationMs <= 0 || limits.durationMs > LIMITS.durationMs) throw Error('Ngân sách recorder không hợp lệ.');
  }
  start(consent: boolean, origin: 'browser-camera' | 'native-import', nowUtc = new Date().toISOString()) {
    if (!consent) throw Error('Cần đồng ý ghi metadata trước khi bắt đầu.');
    if (this.data?.frames.length) throw Error('Xuất hoặc xóa phiên cũ trước khi ghi phiên mới.');
    this.data = parseRecording({ schema: 'assistive-recording-v1', id: `session-${crypto.randomUUID()}`, createdUtc: nowUtc, origin,
      consent: 'metadata-only', frames: [], truth: [], counters: { rejectedFrames: 0, stopReason: 'user' } });
    this.priorDepth.clear(); this.size = jsonBytes(this.data) + 1024; this.allowed = true;
    this.state = 'recording'; this.lastError = null;
  }
  append(value: unknown): boolean {
    if (!this.allowed || this.state !== 'recording' || !this.data) return false;
    try {
      const f = parseFrame(value), previous = this.data.frames.at(-1);
      if ((this.data.origin === 'browser-camera' && f.provider !== 'browser-camera') || f.provider === 'fixture' ||
        (previous && (f.id <= previous.id || f.rgb.capturedAtMs <= previous.rgb.capturedAtMs))) throw Error('Frame sai nguồn hoặc thứ tự.');
      if (f.depth && this.priorDepth.has(f.depth.captureId) && this.priorDepth.get(f.depth.captureId) !== f.depth.capturedAtMs) throw Error('Depth ID đã bị đổi timestamp.');
      if (this.data.frames.length >= this.limits.frames) { this.refuseCap('frame-cap'); return false; }
      if (f.rgb.capturedAtMs > this.limits.durationMs) { this.refuseCap('time-cap'); return false; }
      const bytes = jsonBytes(f) + 1;
      if (this.size + bytes > this.limits.bytes) { this.refuseCap('byte-cap'); return false; }
      this.data.frames.push(f); this.size += bytes;
      if (f.depth) this.priorDepth.set(f.depth.captureId, f.depth.capturedAtMs);
      // Stop immediately at the bound; no additional callback is required.
      if (this.data.frames.length === this.limits.frames) this.stop('frame-cap');
      if (f.rgb.capturedAtMs === this.limits.durationMs) this.stop('time-cap');
      return true;
    } catch (e) {
      this.data.counters.rejectedFrames++; this.lastError = e instanceof Error ? e.message : 'Frame bị từ chối.'; return false;
    }
  }
  private refuseCap(reason: Recording['counters']['stopReason']) { this.data!.counters.rejectedFrames++; this.stop(reason); }
  tick(elapsedMs: number) { if (this.state === 'recording' && elapsedMs >= this.limits.durationMs) this.stop('time-cap'); }
  stop(reason: Recording['counters']['stopReason'] = 'user') {
    if (this.data && this.state === 'recording') this.data.counters.stopReason = reason;
    this.state = this.data ? 'stopped' : 'idle'; this.allowed = false;
  }
  /** Revoke is destructive only for this lab's volatile session, never DriveSense. */
  clear() { this.stop('revoked'); this.data = null; this.priorDepth.clear(); this.size = 0; this.state = 'idle'; this.lastError = null; }
  snapshot(): Recording | null { return this.data ? parseRecording(this.data) : null; }
  get count() { return this.data?.frames.length ?? 0; }
}

/** Deterministic replay clock: binary seek, no queue and no use of import time. */
export class ReplayCursor {
  index = 0;
  constructor(readonly recording: Recording) { this.recording = parseRecording(recording); }
  get durationMs() { const f = this.recording.frames; return f.length ? f.at(-1)!.rgb.capturedAtMs - f[0].rgb.capturedAtMs : 0; }
  seek(elapsedMs: number) {
    if (!Number.isFinite(elapsedMs)) throw Error('Thời gian replay không hợp lệ.');
    const frames = this.recording.frames;
    if (!frames.length) { this.index = 0; return null; }
    const t = frames[0].rgb.capturedAtMs + Math.max(0, Math.min(this.durationMs, elapsedMs));
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (frames[m].rgb.capturedAtMs <= t) lo = m; else hi = m - 1; }
    this.index = lo; return frames[lo];
  }
}

/** Ownership guard also disposes a stream arriving after stop/permission cancellation. */
export class CameraLease {
  private generation = 0;
  private stream: MediaStream | null = null;
  async acquire(request: () => Promise<MediaStream>): Promise<MediaStream | null> {
    this.stop(); const generation = this.generation;
    const stream = await request();
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return null; }
    this.stream = stream; return stream;
  }
  stop() { this.generation++; this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
}
