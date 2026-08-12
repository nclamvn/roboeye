import { AIRSKETCH_CONFIG } from './airsketch-config';
import type { AirGesture, AirHandSample, AirPoint, AirStroke, HandLandmark } from './airsketch-types';

// Hand landmarks now arrive at 30 fps with latency compensation. Retain more
// deliberate low-speed points and interpolate less distance per segment so a
// circle/heart does not turn into a few angular chords.
const MIN_POINT_DISTANCE = 0.0015;
const MAX_SEGMENT_LENGTH = 0.014;

function distance(a: Pick<HandLandmark, 'x' | 'y'>, b: Pick<HandLandmark, 'x' | 'y'>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fingerExtended(points: HandLandmark[], tip: number, pip: number): boolean {
  return distance(points[tip], points[0]) > distance(points[pip], points[0]) * 1.13;
}

export class AirGestureController {
  private penDown = false;
  private smoothed: AirPoint | null = null;
  private holdGesture: AirGesture | null = null;
  private holdStartedAt = 0;
  private commandLocked = false;

  reset(): void {
    this.penDown = false;
    this.smoothed = null;
    this.holdGesture = null;
    this.holdStartedAt = 0;
    this.commandLocked = false;
  }

  release(): boolean {
    const wasDown = this.penDown;
    this.penDown = false;
    this.holdGesture = null;
    this.commandLocked = false;
    return wasDown;
  }

  update(points: HandLandmark[], now: number): AirHandSample | null {
    if (points.length < 21) return null;
    const palm = Math.max(0.001, distance(points[5], points[17]));
    const pinchRatio = distance(points[4], points[8]) / palm;
    const index = fingerExtended(points, 8, 6);
    const middle = fingerExtended(points, 12, 10);
    const ring = fingerExtended(points, 16, 14);
    const pinky = fingerExtended(points, 20, 18);
    const openPalm = index && middle && ring && pinky;
    const undoPose = index && middle && !ring && !pinky && pinchRatio > AIRSKETCH_CONFIG.tracking.pinchUpRatio;

    let gesture: AirGesture = 'hover';
    if (openPalm) gesture = 'clear-hold';
    else if (undoPose) gesture = 'undo-hold';
    else {
      if (this.penDown) this.penDown = pinchRatio < AIRSKETCH_CONFIG.tracking.pinchUpRatio;
      else this.penDown = pinchRatio <= AIRSKETCH_CONFIG.tracking.pinchDownRatio;
      if (this.penDown) gesture = 'draw';
    }

    const raw = { x: 1 - points[8].x, y: points[8].y, t: now };
    if (!this.smoothed) this.smoothed = raw;
    else {
      const speed = distance(raw, this.smoothed) / Math.max(1, now - this.smoothed.t);
      const alpha = Math.min(0.72, Math.max(0.18, 0.18 + speed * 55));
      this.smoothed = {
        x: this.smoothed.x + (raw.x - this.smoothed.x) * alpha,
        y: this.smoothed.y + (raw.y - this.smoothed.y) * alpha,
        t: now
      };
    }

    let holdProgress = 0;
    let command: 'undo' | 'clear' | null = null;
    if (gesture === 'undo-hold' || gesture === 'clear-hold') {
      if (this.holdGesture !== gesture) {
        this.holdGesture = gesture;
        this.holdStartedAt = now;
        this.commandLocked = false;
      }
      const duration = gesture === 'undo-hold'
        ? AIRSKETCH_CONFIG.tracking.undoHoldMs
        : AIRSKETCH_CONFIG.tracking.clearHoldMs;
      holdProgress = Math.min(1, (now - this.holdStartedAt) / duration);
      if (holdProgress >= 1 && !this.commandLocked) {
        command = gesture === 'undo-hold' ? 'undo' : 'clear';
        this.commandLocked = true;
      }
      this.penDown = false;
    } else {
      this.holdGesture = null;
      this.commandLocked = false;
    }

    return { cursor: this.smoothed, penDown: this.penDown, gesture, holdProgress, command };
  }
}

export class AirInkDocument {
  private strokes: AirStroke[] = [];
  private current: AirStroke | null = null;
  revision = 0;

  begin(point: AirPoint): void {
    if (this.current) return;
    this.current = { points: [point] };
    this.strokes.push(this.current);
    this.revision++;
  }

  move(point: AirPoint): void {
    if (!this.current) return;
    const previous = this.current.points.at(-1);
    if (!previous) return;
    const length = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (length < MIN_POINT_DISTANCE) return;
    // Hand tracking is typically 24 FPS. Split long frame-to-frame jumps so
    // the quadratic renderer receives a stable curve instead of sparse kinks.
    const segments = Math.ceil(length / MAX_SEGMENT_LENGTH);
    for (let segment = 1; segment <= segments; segment++) {
      const ratio = segment / segments;
      this.current.points.push({
        x: previous.x + (point.x - previous.x) * ratio,
        y: previous.y + (point.y - previous.y) * ratio,
        t: previous.t + (point.t - previous.t) * ratio
      });
    }
    this.revision++;
  }

  end(): void {
    if (!this.current) return;
    if (this.current.points.length < 2) this.strokes.pop();
    this.current = null;
    this.revision++;
  }

  undo(): void {
    this.end();
    if (this.strokes.pop()) this.revision++;
  }

  clear(): void {
    this.current = null;
    if (this.strokes.length) {
      this.strokes = [];
      this.revision++;
    }
  }

  isDrawing(): boolean { return this.current != null; }
  hasInk(): boolean { return this.strokes.some((stroke) => stroke.points.length >= 2); }
  pointCount(): number { return this.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0); }
  strokeCount(): number { return this.strokes.filter((stroke) => stroke.points.length >= 2).length; }
  snapshot(): AirStroke[] { return this.strokes.map((stroke) => ({ points: stroke.points.map((point) => ({ ...point })) })); }
  currentSnapshot(): AirStroke[] {
    return this.current ? [{ points: this.current.points.map((point) => ({ ...point })) }] : [];
  }
}

export function drawAirStrokes(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  strokes: AirStroke[],
  width: number,
  height: number,
  style: { color: string; width: number; shadow?: string }
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.shadowColor = style.shadow ?? 'transparent';
  ctx.shadowBlur = style.shadow ? style.width * 1.2 : 0;
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
    for (let i = 1; i < stroke.points.length; i++) {
      const prev = stroke.points[i - 1];
      const point = stroke.points[i];
      const mx = (prev.x + point.x) * 0.5 * width;
      const my = (prev.y + point.y) * 0.5 * height;
      ctx.quadraticCurveTo(prev.x * width, prev.y * height, mx, my);
    }
    const last = stroke.points.at(-1)!;
    ctx.lineTo(last.x * width, last.y * height);
    ctx.stroke();
  }
  ctx.restore();
}

export function rasterizeAirStrokes(strokes: AirStroke[], size = AIRSKETCH_CONFIG.recognition.rasterSize): ImageData | null {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (points.length < AIRSKETCH_CONFIG.recognition.minPoints) return null;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  const spanX = Math.max(0.01, maxX - minX);
  const spanY = Math.max(0.01, maxY - minY);
  const scale = AIRSKETCH_CONFIG.recognition.contentSize / Math.max(spanX, spanY);
  const offsetX = (size - spanX * scale) / 2 - minX * scale;
  const offsetY = (size - spanY * scale) / 2 - minY * scale;
  const normalized = strokes.map((stroke) => ({
    points: stroke.points.map((point) => ({ x: (point.x * scale + offsetX) / size, y: (point.y * scale + offsetY) / size, t: point.t }))
  }));
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  // QuickDraw's official renderer uses a 16 px line on a padded 304 px
  // coordinate space, equivalent to ~1.47 px on the 28×28 bitmap.
  drawAirStrokes(ctx, normalized, size, size, { color: '#ffffff', width: size * (16 / 304) });
  return ctx.getImageData(0, 0, size, size);
}
