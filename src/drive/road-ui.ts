import { ROAD_MODEL, ROAD_MAX_AGE_MS, roadSampleVisible, type RoadSample } from './road-runtime';
import type { RoadVectorization } from './road-vectorizer';
import { LaneHud, LANE_HUD_POLICY } from './road-hud';
import {laneIconPosition} from './road-layout';

type State = 'off' | 'loading' | 'ready' | 'error';
interface Pending { id: number; generation: number; timeMs: number; sentAt: number }

/** Independent visualization only. No access to vehicle/range/risk state. */
export class RoadUI {
  enabled = false;
  showSurface = false;
  debug = false;
  private hud = new LaneHud();
  private worker: Worker | null = null;
  private state: State = 'off';
  private message = '';
  private generation = 0;
  private sequence = 0;
  private pending: Pending | null = null;
  private sample: RoadSample | null = null;
  private started = 0;
  private sentAt = -Infinity;
  private lastMediaTime = -Infinity;
  private count = 0;
  private expired = 0;
  private lastUpdate = -Infinity;
  private layoutKey = '';
  private capture = document.createElement('canvas');
  private captureCtx = this.capture.getContext('2d', { willReadFrequently: true })!;
  private mask = document.createElement('canvas');
  private maskCtx = this.mask.getContext('2d')!;
  private history: Array<{ timeMs: number; latencyMs: number; inferenceMs: number; vectorMs: number; lines: number }> = [];

  constructor(private video: HTMLVideoElement, private chip: HTMLElement, private detail: HTMLElement, private retry: HTMLButtonElement) {
    this.capture.width = ROAD_MODEL.width; this.capture.height = ROAD_MODEL.height;
    this.mask.width = ROAD_MODEL.width / 4; this.mask.height = ROAD_MODEL.height / 4;
    video.addEventListener('seeking', () => this.invalidate());
    video.addEventListener('emptied', () => this.invalidate());
    retry.onclick = () => this.restart();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.disposeWorker(); this.invalidate();
    this.state = 'off'; this.message = '';
    this.chip.hidden = !enabled;
    if (enabled) this.restart();
    else this.detail.textContent = 'Bật Làn để thử trên video hoặc camera. Không cần chờ phân tích xe.';
    this.retry.hidden = true;
  }

  // Keep user's toggle preference, but destroy all geometry from the old source.
  resetSource() {
    this.invalidate(); this.count = 0; this.expired = 0; this.history = [];
    this.chip.dataset.frames='0';
  }

  invalidate() {
    this.hud.reset();this.chip.dataset.lane='unknown';
    this.chip.dataset.lines='0';
    this.generation++; this.sample = null; this.lastMediaTime = -Infinity;
    this.maskCtx.clearRect(0, 0, this.mask.width, this.mask.height);
    // Do not free an in-flight slot until its reply; no unbounded worker queue.
  }

  stop() { this.disposeWorker(); this.resetSource(); this.state = 'off'; }
  position(x:number,y:number,w:number,h:number,chromeBottom:number) {
    const p=laneIconPosition(x,y,w,h,chromeBottom),key=`${p.left},${p.top},${p.size}`;
    if(key===this.layoutKey)return;
    this.layoutKey=key;
    this.chip.style.setProperty('--lane-x',`${p.left}px`);
    this.chip.style.setProperty('--lane-y',`${p.top}px`);
    this.chip.style.setProperty('--lane-size',`${p.size}px`);
  }
  private disposeWorker() { this.worker?.terminate(); this.worker = null; this.pending = null; }
  private fail(message: string) {
    this.disposeWorker(); this.invalidate(); this.state = 'error'; this.message = message;
    this.retry.hidden = false;
  }

  private restart() {
    this.disposeWorker(); this.invalidate(); this.retry.hidden = true;
    if (!import.meta.env.DEV) { this.fail('Bản thử làn hiện chỉ có trên UI local; model chưa được phát hành.'); return; }
    this.state = 'loading'; this.started = performance.now();
    const worker = this.worker = new Worker(new URL('../worker/drive-road-worker.ts', import.meta.url), { type: 'module' });
    worker.onerror = event => { if (this.worker === worker) this.fail(event.message || 'Không khởi động được model làn.'); };
    worker.onmessage = ({ data: m }) => {
      if (this.worker !== worker) return;
      if (m.type === 'error') { this.fail(m.message); return; }
      if (m.type === 'ready') { this.state = 'ready'; return; }
      if (m.type !== 'result' || !this.pending || m.id !== this.pending.id) return;
      const request = this.pending; this.pending = null;
      if (request.generation !== this.generation) return;
      const vector = m.vector as RoadVectorization;
      this.sample = { timeMs: request.timeMs, generation: request.generation, latencyMs: performance.now() - request.sentAt, vector };
      this.hud.observe(this.sample,this.video.currentTime*1000,this.generation);
      this.count++;
      if (!roadSampleVisible(this.sample, this.video.currentTime * 1000, this.generation)) this.expired++;
      this.history.push({ timeMs: request.timeMs, latencyMs: this.sample.latencyMs, inferenceMs:m.inferenceMs, vectorMs:m.vectorMs, lines: vector.lines.length });
      if (this.history.length > 600) this.history.shift();
      this.maskCtx.putImageData(new ImageData(new Uint8ClampedArray(m.mask), this.mask.width, this.mask.height), 0, 0);
    };
    worker.postMessage({ type: 'init' });
  }

  tick(now: number, source: 'none' | 'file' | 'camera' | 'demo', suspended: boolean) {
    if (!this.enabled) return;
    if (this.state === 'off' && (source === 'file' || source === 'camera')) this.restart();
    if (this.state === 'loading' && now - this.started > 60000) this.fail('Tải làn quá 60 giây. Thử lại.');
    if (this.pending && now - this.pending.sentAt > 15000) this.fail('Xử lý làn quá 15 giây. Đã bỏ kết quả cũ; Thử lại.');
    const usable = (source === 'file' || source === 'camera') && !suspended && !document.hidden;
    if(!usable)this.hud.reset();
    const lane=this.hud.view(this.sample,this.video.currentTime*1000,this.generation);
    if(this.chip.dataset.lane!==lane)this.chip.dataset.lane=lane;
    if (usable && this.state === 'ready' && !this.pending && !this.video.seeking && this.video.readyState >= 2
        && now - this.sentAt >= 160 && this.video.currentTime !== this.lastMediaTime) {
      try {
        this.captureCtx.drawImage(this.video, 0, 0, this.capture.width, this.capture.height);
        const rgba = this.captureCtx.getImageData(0, 0, this.capture.width, this.capture.height).data;
        this.lastMediaTime = this.video.currentTime; this.sentAt = now;
        this.pending = { id: ++this.sequence, generation: this.generation, timeMs: this.video.currentTime * 1000, sentAt: now };
        this.worker!.postMessage({ type: 'frame', id: this.sequence, rgba: rgba.buffer }, [rgba.buffer]);
      } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
    }
    if (now - this.lastUpdate < 200) return;
    this.lastUpdate = now;
    const visible = usable && roadSampleVisible(this.sample, this.video.currentTime * 1000, this.generation);
    const lines = visible ? this.sample!.vector.lines.length : 0;
    const summary = this.state === 'error' ? 'Làn · lỗi tải/xử lý' : this.state === 'loading' ? 'Làn · đang tải model'
      : source === 'none' ? 'Làn · mở video hoặc camera' : source === 'demo' ? 'Làn · cần video thật'
      : suspended ? 'Làn · chờ phân tích xe' : visible ? `Làn · ${lines}/2 biên có bằng chứng`
      : this.sample ? 'Làn · trễ khung, tạm dừng để soi' : 'Làn · đang đọc khung hình';
    const label=lane==='tracking'?'Làn: bám vạch ổn định · thử nghiệm':lane==='left'?'Làn: tiến gần biên trái · thử nghiệm':lane==='right'?'Làn: tiến gần biên phải · thử nghiệm':this.state==='error'?'Làn: lỗi model · mở Phân tích để thử lại':'Làn: chưa đủ dữ liệu';
    if(this.chip.getAttribute('aria-label')!==label){this.chip.setAttribute('aria-label',label);this.chip.title=label;}
    this.chip.dataset.state = this.state;
    this.chip.dataset.lines = String(lines);
    this.chip.dataset.frames = String(this.count);
    const latency = this.sample ? `${Math.round(this.sample.latencyMs)} ms/khung` : '—';
    this.detail.textContent = this.state === 'error' ? this.message
      : `${label}. ${summary}. WASM · ${latency} · ${this.count} khung. Cần ≥3 khung trong ≥700 ms; xanh không có nghĩa là an toàn. Bật lớp kiểm tra để xem vạch/mặt đường.`;
  }

  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, suspended: boolean) {
    if (!this.enabled || suspended || this.video.seeking || !roadSampleVisible(this.sample, this.video.currentTime * 1000, this.generation)) return;
    const lane=this.hud.view(this.sample,this.video.currentTime*1000,this.generation);
    if(!this.debug&&lane!=='left'&&lane!=='right')return;
    ctx.save();
    if (this.debug&&this.showSurface) { ctx.imageSmoothingEnabled = false; ctx.drawImage(this.mask, x, y, w, h); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
    for (const line of this.sample!.vector.lines) {
      if (line.class !== 'lane-marking' || line.points.length < 2) continue;
      if(!this.debug&&line.role!==`ego-${lane}`)continue;
      ctx.beginPath();
      line.points.forEach((p, i) => { if (i === 0) ctx.moveTo(x + p.x * w, y + p.y * h); else ctx.lineTo(x + p.x * w, y + p.y * h); });
      ctx.strokeStyle = 'rgba(9,24,34,.8)'; ctx.lineWidth = 6; ctx.stroke();
      ctx.strokeStyle = !this.debug?'#f3bb53':line.role === 'ego-left' ? '#66dcff' : '#bd9aff'; ctx.lineWidth = this.debug?3:4; ctx.stroke();
    }
    ctx.restore();
  }

  report() {
    return { schemaVersion: 2, feature: 'TIP-50R-D5-quiet-hud-experiment', hudPolicy:LANE_HUD_POLICY, hudState:this.hud.view(this.sample,this.video.currentTime*1000,this.generation), debug:this.debug, model: ROAD_MODEL, backend: 'wasm',
      mode: 'latest-frame-single-flight', maxMediaAgeMs: ROAD_MAX_AGE_MS, processed: this.count, expired: this.expired,
      playbackRate:this.video.playbackRate, samples: this.history, latest: this.sample, limitation: 'Research visualization, not ground truth, metric distance or lane departure warning.' };
  }
}
