// BEV occupancy: ép point cloud xuống mặt sàn thành grid NxN.
// Chạy CPU mỗi khi có depth frame mới (5-15fps) nên chi phí không đáng kể.
// EMA + hysteresis để grid không nhấp nháy theo depth (rủi ro R3 trong PRD).

export interface UnprojectParams {
  tanH: number; // tan(FOV ngang / 2)
  aspect: number; // width/height của ảnh
  invNear: number; // 1/zNear
  invFar: number; // 1/zFar
  signX: number; // -1 khi mirror
}

const N = 96; // số ô mỗi cạnh
const RANGE = 6.4; // đơn vị tương đối, z từ 0..RANGE, x từ -RANGE/2..RANGE/2
const CELL = RANGE / N;
const EMA_ALPHA = 0.35;
const ON_T = 0.55; // hysteresis bật
const OFF_T = 0.35; // hysteresis tắt
const COUNT_T = 3; // số điểm tối thiểu trong band để ô tính là có vật
const BAND_LO = 0.18; // trên sàn bao nhiêu mới tính vật cản
const BAND_HI = 2.0; // dưới trần

const CANVAS = 480;
const PX = CANVAS / N;

export class BevBuilder {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ema = new Float32Array(N * N);
  private state = new Uint8Array(N * N); // 0 free, 1 occupied
  private counts = new Uint16Array(N * N);
  private ySample: number[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS;
    this.canvas.height = CANVAS;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được 2D context cho BEV');
    this.ctx = ctx;
    this.draw(0.5); // khung ban đầu
  }

  /** Cập nhật grid từ depth map mới rồi vẽ lại canvas. */
  update(depth: Uint8Array, w: number, h: number, p: UnprojectParams) {
    this.counts.fill(0);
    this.ySample.length = 0;

    // Bước sample để tổng số điểm quanh 50k
    const stride = Math.max(1, Math.round(Math.sqrt((w * h) / 50000)));
    const invNear = p.invNear;
    const invFar = p.invFar;
    const tanH = p.tanH;
    const tanV = p.tanH / p.aspect;

    // Pass 1: ước lượng sàn = percentile thấp của y
    let k = 0;
    for (let py = 0; py < h; py += stride * 3) {
      const v = (py + 0.5) / h;
      for (let px = 0; px < w; px += stride * 3) {
        const d = depth[py * w + px] / 255;
        const z = 1 / (invFar + (invNear - invFar) * d);
        if (z > RANGE) continue;
        const y = (0.5 - v) * 2 * tanV * z;
        this.ySample.push(y);
        k++;
      }
    }
    let floorY = -1.2;
    if (k > 30) {
      this.ySample.sort((a, b) => a - b);
      floorY = this.ySample[Math.floor(k * 0.05)];
    }

    // Pass 2: đếm điểm trong band vật cản cho từng ô
    for (let py = 0; py < h; py += stride) {
      const v = (py + 0.5) / h;
      for (let px = 0; px < w; px += stride) {
        const d = depth[py * w + px] / 255;
        const z = 1 / (invFar + (invNear - invFar) * d);
        if (z <= 0.01 || z >= RANGE) continue;
        const y = (0.5 - v) * 2 * tanV * z;
        if (y < floorY + BAND_LO || y > floorY + BAND_HI) continue;
        const x = (((px + 0.5) / w - 0.5) * 2 * tanH * z) * p.signX;
        const ci = Math.floor((x + RANGE / 2) / CELL);
        const cj = Math.floor(z / CELL);
        if (ci < 0 || ci >= N || cj < 0 || cj >= N) continue;
        this.counts[cj * N + ci]++;
      }
    }

    // EMA + hysteresis
    for (let i = 0; i < N * N; i++) {
      const occ = this.counts[i] >= COUNT_T ? 1 : 0;
      this.ema[i] = this.ema[i] * (1 - EMA_ALPHA) + occ * EMA_ALPHA;
      if (this.state[i] === 0 && this.ema[i] > ON_T) this.state[i] = 1;
      else if (this.state[i] === 1 && this.ema[i] < OFF_T) this.state[i] = 0;
    }

    this.draw(tanH);
  }

  /** Vẽ grid + quạt FOV + marker camera. Monochrome theo HIVE. */
  private draw(tanH: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0b0b0a';
    ctx.fillRect(0, 0, CANVAS, CANVAS);

    // Camera ở giữa cạnh dưới, z tăng dần lên trên
    const camX = CANVAS / 2;
    const camY = CANVAS - 2;
    const halfAngle = Math.atan(tanH);

    // Ô: unknown (ngoài quạt FOV) tối nhất, free tối, occupied sáng
    for (let cj = 0; cj < N; cj++) {
      for (let ci = 0; ci < N; ci++) {
        const wx = (ci + 0.5) * CELL - RANGE / 2;
        const wz = (cj + 0.5) * CELL;
        const inFov = wz > 0.05 && Math.abs(wx) <= wz * tanH;
        const sx = ci * PX;
        const sy = CANVAS - (cj + 1) * PX;
        if (!inFov) continue; // giữ màu nền cho unknown
        ctx.fillStyle = this.state[cj * N + ci] === 1 ? '#f2f2ef' : '#161615';
        ctx.fillRect(sx, sy, Math.ceil(PX), Math.ceil(PX));
      }
    }

    // Hairline grid mỗi 8 ô
    ctx.strokeStyle = '#1d1d1c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= N; i += 8) {
      ctx.moveTo(i * PX, 0);
      ctx.lineTo(i * PX, CANVAS);
      ctx.moveTo(0, i * PX);
      ctx.lineTo(CANVAS, i * PX);
    }
    ctx.stroke();

    // Quạt FOV: hai cạnh dashed + cung mờ
    const reach = CANVAS * 1.05;
    ctx.strokeStyle = '#6e6e69';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(camX, camY);
    ctx.lineTo(camX + Math.sin(-halfAngle) * reach, camY - Math.cos(-halfAngle) * reach);
    ctx.moveTo(camX, camY);
    ctx.lineTo(camX + Math.sin(halfAngle) * reach, camY - Math.cos(halfAngle) * reach);
    ctx.stroke();
    ctx.setLineDash([]);

    // Marker camera: tam giác nhỏ
    ctx.fillStyle = '#f2f2ef';
    ctx.beginPath();
    ctx.moveTo(camX, camY - 12);
    ctx.lineTo(camX - 7, camY);
    ctx.lineTo(camX + 7, camY);
    ctx.closePath();
    ctx.fill();
  }
}
