// BEV occupancy + tầng hành động: obstacle alert và robot ảo chạy A* trên grid.
// update() chạy mỗi depth frame (bin điểm, EMA, hysteresis, replan A*).
// compose() chạy mỗi render frame (ghép layer, di chuyển robot, vẽ path).
// Monochrome theo HIVE: trạng thái truyền bằng hình, nét đứt và chữ, không màu.

import { astar, COST_FREE, COST_UNKNOWN, COST_BLOCKED } from './astar';

export interface UnprojectParams {
  tanH: number; // tan(FOV ngang / 2)
  aspect: number; // width/height của ảnh
  invNear: number; // 1/zNear
  invFar: number; // 1/zFar
  signX: number; // -1 khi mirror
}

export interface BevStatus {
  nearest: number | null; // khoảng cách vật cản gần nhất trong FOV, đơn vị tương đối
  alert: boolean; // nearest < ngưỡng NEAR_ALERT
  pathSteps: number | null; // số bước A*, null khi không có đường
  hasGoal: boolean;
  route: 'idle' | 'blocked' | 'arrived' | 'moving';
}

const N = 96; // số ô mỗi cạnh
const RANGE = 6.4; // đơn vị tương đối, z từ 0..RANGE, x từ -RANGE/2..RANGE/2
const CELL = RANGE / N;
const EMA_ALPHA = 0.35;
const ON_T = 0.55;
const OFF_T = 0.35;
const COUNT_T = 3;
const BAND_LO = 0.18;
const BAND_HI = 2.0;

const NEAR_ALERT = 1.15; // đơn vị tương đối, dưới ngưỡng này báo vật cản gần
const ROBOT_SPEED = 1.5; // đơn vị tương đối / giây

const CANVAS = 480;
const PX = CANVAS / N;

export class BevBuilder {
  readonly canvas: HTMLCanvasElement;
  onStatus: ((s: BevStatus) => void) | null = null;

  private ctx: CanvasRenderingContext2D;
  private gridLayer: HTMLCanvasElement;
  private gridCtx: CanvasRenderingContext2D;

  private ema = new Float32Array(N * N);
  private state = new Uint8Array(N * N); // 0 free, 1 occupied
  private counts = new Uint16Array(N * N);
  private cost = new Uint8Array(N * N).fill(COST_UNKNOWN);
  private ySample: number[] = [];

  private tanH = Math.tan((60 * Math.PI) / 360);
  private updates = 0;
  private nearest: number | null = null;

  // Robot ảo: vị trí float theo toạ độ ô, xuất phát tại camera
  private robot = { ci: N / 2, cj: 0.6 };
  private goal: { ci: number; cj: number } | null = null;
  private path: Array<[number, number]> | null = null;
  private waypoint = 1; // index waypoint kế tiếp trên path

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS;
    this.canvas.height = CANVAS;
    this.gridLayer = document.createElement('canvas');
    this.gridLayer.width = CANVAS;
    this.gridLayer.height = CANVAS;
    const ctx = this.canvas.getContext('2d');
    const gtx = this.gridLayer.getContext('2d');
    if (!ctx || !gtx) throw new Error('Không tạo được 2D context cho BEV');
    this.ctx = ctx;
    this.gridCtx = gtx;
    this.drawGridLayer();
    this.compose(0);
  }

  /** Người dùng click lên plane BEV: u 0..1 trái→phải, vTop 0..1 trên→dưới. */
  setGoalFromUv(u: number, vTop: number) {
    const ci = Math.min(N - 1, Math.max(0, Math.floor(u * N)));
    const cj = Math.min(N - 1, Math.max(0, Math.floor((1 - vTop) * N)));
    this.goal = { ci, cj };
    this.replan();
  }

  /** Cập nhật grid từ depth map mới. Gọi mỗi depth frame. */
  update(depth: Uint8Array, w: number, h: number, p: UnprojectParams) {
    this.counts.fill(0);
    this.ySample.length = 0;
    this.tanH = p.tanH;
    this.updates++;

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
        this.ySample.push((0.5 - v) * 2 * tanV * z);
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

    // EMA + hysteresis, đồng thời tính vật cản gần nhất trong FOV
    this.nearest = null;
    for (let cj = 0; cj < N; cj++) {
      for (let ci = 0; ci < N; ci++) {
        const i = cj * N + ci;
        const occ = this.counts[i] >= COUNT_T ? 1 : 0;
        this.ema[i] = this.ema[i] * (1 - EMA_ALPHA) + occ * EMA_ALPHA;
        if (this.state[i] === 0 && this.ema[i] > ON_T) this.state[i] = 1;
        else if (this.state[i] === 1 && this.ema[i] < OFF_T) this.state[i] = 0;
        if (this.state[i] === 1) {
          const wx = (ci + 0.5) * CELL - RANGE / 2;
          const wz = (cj + 0.5) * CELL;
          if (Math.abs(wx) <= wz * tanH) {
            const dist = Math.hypot(wx, wz);
            if (this.nearest == null || dist < this.nearest) this.nearest = dist;
          }
        }
      }
    }

    this.buildCostMap();
    if (!this.goal && this.updates > 6) this.pickDefaultGoal();
    this.replan();
    this.drawGridLayer();
    this.emitStatus();
  }

  /** Ghép layer + di chuyển robot. Gọi mỗi render frame với dt giây. */
  compose(dtSec: number) {
    this.moveRobot(dtSec);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS, CANVAS);
    ctx.drawImage(this.gridLayer, 0, 0);
    this.drawWedge(ctx);
    this.drawPath(ctx);
    this.drawGoal(ctx);
    this.drawRobot(ctx);
  }

  // ── nội bộ ─────────────────────────────────────────────

  private buildCostMap() {
    // occupied inflate 1 ô thành blocked; ngoài FOV là unknown (đi được, phạt nhẹ)
    for (let cj = 0; cj < N; cj++) {
      for (let ci = 0; ci < N; ci++) {
        const wx = (ci + 0.5) * CELL - RANGE / 2;
        const wz = (cj + 0.5) * CELL;
        const inFov = wz > 0.05 && Math.abs(wx) <= wz * this.tanH;
        this.cost[cj * N + ci] = inFov ? COST_FREE : COST_UNKNOWN;
      }
    }
    for (let cj = 0; cj < N; cj++) {
      for (let ci = 0; ci < N; ci++) {
        if (this.state[cj * N + ci] !== 1) continue;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ni = ci + di;
            const nj = cj + dj;
            if (ni < 0 || ni >= N || nj < 0 || nj >= N) continue;
            this.cost[nj * N + ni] = COST_BLOCKED;
          }
        }
      }
    }
  }

  private pickDefaultGoal() {
    // đích mặc định: ô free trong FOV, xa camera, gần trục giữa
    for (let cj = Math.floor(N * 0.82); cj > N * 0.4; cj--) {
      for (let off = 0; off < N / 2; off++) {
        for (const s of off === 0 ? [0] : [-off, off]) {
          const ci = Math.floor(N / 2) + s;
          if (ci < 0 || ci >= N) continue;
          if (this.cost[cj * N + ci] === COST_FREE) {
            this.goal = { ci, cj };
            return;
          }
        }
      }
    }
  }

  private startCell(): [number, number] {
    let ci = Math.round(this.robot.ci);
    let cj = Math.round(this.robot.cj);
    ci = Math.min(N - 1, Math.max(0, ci));
    cj = Math.min(N - 1, Math.max(0, cj));
    if (this.cost[cj * N + ci] !== COST_BLOCKED) return [ci, cj];
    // robot bị vật cản đè lên ô (nhiễu depth): tìm ô tự do gần nhất trong bán kính 2
    for (let r = 1; r <= 2; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || ni >= N || nj < 0 || nj >= N) continue;
          if (this.cost[nj * N + ni] !== COST_BLOCKED) return [ni, nj];
        }
      }
    }
    return [ci, cj];
  }

  private replan() {
    if (!this.goal) {
      this.path = null;
      return;
    }
    this.path = astar(this.cost, N, this.startCell(), [this.goal.ci, this.goal.cj]);
    this.waypoint = this.path && this.path.length > 1 ? 1 : 0;
  }

  private moveRobot(dtSec: number) {
    if (!this.path || this.path.length < 2 || this.waypoint >= this.path.length) return;
    let budget = (ROBOT_SPEED / CELL) * dtSec; // quãng đường theo đơn vị ô
    while (budget > 0 && this.waypoint < this.path.length) {
      const [ti, tj] = this.path[this.waypoint];
      const dx = ti - this.robot.ci;
      const dz = tj - this.robot.cj;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-3) {
        this.waypoint++;
        continue;
      }
      const step = Math.min(dist, budget);
      this.robot.ci += (dx / dist) * step;
      this.robot.cj += (dz / dist) * step;
      budget -= step;
      if (step >= dist) this.waypoint++;
    }
  }

  private drawGridLayer() {
    const ctx = this.gridCtx;
    ctx.fillStyle = '#0b0b0a';
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    for (let cj = 0; cj < N; cj++) {
      for (let ci = 0; ci < N; ci++) {
        const wx = (ci + 0.5) * CELL - RANGE / 2;
        const wz = (cj + 0.5) * CELL;
        const inFov = wz > 0.05 && Math.abs(wx) <= wz * this.tanH;
        if (!inFov) continue;
        const sx = ci * PX;
        const sy = CANVAS - (cj + 1) * PX;
        ctx.fillStyle = this.state[cj * N + ci] === 1 ? '#f2f2ef' : '#161615';
        ctx.fillRect(sx, sy, Math.ceil(PX), Math.ceil(PX));
      }
    }
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
  }

  private drawWedge(ctx: CanvasRenderingContext2D) {
    const camX = CANVAS / 2;
    const camY = CANVAS - 2;
    const halfAngle = Math.atan(this.tanH);
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
    ctx.fillStyle = '#f2f2ef';
    ctx.beginPath();
    ctx.moveTo(camX, camY - 12);
    ctx.lineTo(camX - 7, camY);
    ctx.lineTo(camX + 7, camY);
    ctx.closePath();
    ctx.fill();
  }

  private cellToPx(ci: number, cj: number): [number, number] {
    return [(ci + 0.5) * PX, CANVAS - (cj + 0.5) * PX];
  }

  private drawPath(ctx: CanvasRenderingContext2D) {
    if (!this.path || this.path.length < 2) return;
    ctx.strokeStyle = '#f2f2ef';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const [rx, ry] = this.cellToPx(this.robot.ci, this.robot.cj);
    ctx.moveTo(rx, ry);
    for (let i = this.waypoint; i < this.path.length; i++) {
      const [px, py] = this.cellToPx(this.path[i][0], this.path[i][1]);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    // chấm waypoint thưa để đường có nhịp
    ctx.fillStyle = '#9a9a95';
    for (let i = this.waypoint; i < this.path.length; i += 6) {
      const [px, py] = this.cellToPx(this.path[i][0], this.path[i][1]);
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawGoal(ctx: CanvasRenderingContext2D) {
    if (!this.goal) return;
    const [gx, gy] = this.cellToPx(this.goal.ci, this.goal.cj);
    ctx.strokeStyle = '#f2f2ef';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(gx, gy, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(gx, gy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f2f2ef';
    ctx.fill();
  }

  private drawRobot(ctx: CanvasRenderingContext2D) {
    const [rx, ry] = this.cellToPx(this.robot.ci, this.robot.cj);
    // hướng nhìn theo waypoint kế
    let angle = -Math.PI / 2;
    if (this.path && this.waypoint < this.path.length) {
      const [ti, tj] = this.path[this.waypoint];
      angle = Math.atan2(-(tj - this.robot.cj), ti - this.robot.ci);
    }
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(-angle + Math.PI / 2);
    ctx.fillStyle = '#0b0b0a';
    ctx.strokeStyle = '#f2f2ef';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(-4, -5);
    ctx.lineTo(4, -5);
    ctx.closePath();
    ctx.fillStyle = '#f2f2ef';
    ctx.fill();
    ctx.restore();
  }

  private emitStatus() {
    if (!this.onStatus) return;
    const route = !this.goal
      ? 'idle'
      : !this.path
        ? 'blocked'
        : this.waypoint >= this.path.length
          ? 'arrived'
          : 'moving';
    this.onStatus({
      nearest: this.nearest,
      alert: this.nearest != null && this.nearest < NEAR_ALERT,
      pathSteps: this.path ? this.path.length : null,
      hasGoal: this.goal != null,
      route
    });
  }
}
