// AirDesk: visible fingertip affordances and direct content manipulation.
// This deliberately stays separate from AirSketch's drawing grammar.
import { AIRSKETCH_CONFIG } from './airsketch-config';
import type { AirPoint, HandLandmark } from './airsketch-types';

export type AirDeskTool = 'move' | 'draw';
export type AirDeskAction = 'rotate-left' | 'rotate-right' | 'flip-x' | 'flip-y' | 'reset-image' | 'toggle-draw';

export interface AirDeskTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

export interface AirDeskHandSample {
  pointer: AirPoint;
  pinch: boolean;
  justPinched: boolean;
  justReleased: boolean;
  fingertips: Array<{ point: AirPoint; extended: boolean; index: number }>;
}

const TIP_INDICES = [4, 8, 12, 16, 20] as const;
const FINGER_PAIRS = [[8, 6], [12, 10], [16, 14], [20, 18]] as const;

function distance(a: Pick<HandLandmark, 'x' | 'y'>, b: Pick<HandLandmark, 'x' | 'y'>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isExtended(points: HandLandmark[], tip: number, pip: number): boolean {
  return distance(points[tip], points[0]) > distance(points[pip], points[0]) * 1.13;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class AirDeskController {
  private pinchActive = false;
  private tool: AirDeskTool = 'move';
  private transform: AirDeskTransform = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false };
  private drag: { point: AirPoint; transform: AirDeskTransform; kind: 'move' | 'scale' | 'rotate' } | null = null;
  private paths: AirPoint[][] = [];
  private activePath: AirPoint[] | null = null;

  reset(): void {
    this.pinchActive = false;
    this.drag = null;
    this.activePath = null;
  }

  hand(points: HandLandmark[], at: number): AirDeskHandSample | null {
    if (points.length < 21) return null;
    const span = Math.max(0.001, distance(points[5], points[17]));
    const ratio = distance(points[4], points[8]) / span;
    const previous = this.pinchActive;
    this.pinchActive = this.pinchActive
      ? ratio < AIRSKETCH_CONFIG.tracking.pinchUpRatio
      : ratio <= AIRSKETCH_CONFIG.tracking.pinchDownRatio;
    const pointer = { x: 1 - points[8].x, y: points[8].y, t: at };
    const extendedByTip = new Map<number, boolean>();
    FINGER_PAIRS.forEach(([tip, pip]) => extendedByTip.set(tip, isExtended(points, tip, pip)));
    return {
      pointer,
      pinch: this.pinchActive,
      justPinched: !previous && this.pinchActive,
      justReleased: previous && !this.pinchActive,
      fingertips: TIP_INDICES.map((index) => ({
        point: { x: 1 - points[index].x, y: points[index].y, t: at },
        // Thumb does not have the same PIP geometry; it remains a dot.
        extended: extendedByTip.get(index) ?? false,
        index
      }))
    };
  }

  getTool(): AirDeskTool { return this.tool; }
  getTransform(): AirDeskTransform { return { ...this.transform }; }
  getPaths(): AirPoint[][] { return this.paths.map((path) => path.map((point) => ({ ...point }))); }

  perform(action: AirDeskAction): void {
    if (action === 'rotate-left') this.transform.rotation -= 15;
    else if (action === 'rotate-right') this.transform.rotation += 15;
    else if (action === 'flip-x') this.transform.flipX = !this.transform.flipX;
    else if (action === 'flip-y') this.transform.flipY = !this.transform.flipY;
    else if (action === 'reset-image') this.transform = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false };
    else this.tool = this.tool === 'move' ? 'draw' : 'move';
  }

  begin(pointer: AirPoint, kind: 'move' | 'scale' | 'rotate'): void {
    this.drag = { point: { ...pointer }, transform: this.getTransform(), kind };
  }

  move(pointer: AirPoint): void {
    if (!this.drag) return;
    const dx = pointer.x - this.drag.point.x;
    const dy = pointer.y - this.drag.point.y;
    if (this.drag.kind === 'move') {
      this.transform.x = clamp(this.drag.transform.x + dx, -0.38, 0.38);
      this.transform.y = clamp(this.drag.transform.y + dy, -0.34, 0.34);
    } else if (this.drag.kind === 'scale') {
      this.transform.scale = clamp(this.drag.transform.scale + (dx - dy) * 1.4, 0.55, 1.9);
    } else {
      this.transform.rotation = this.drag.transform.rotation + dx * 220;
    }
  }

  beginDrawing(pointer: AirPoint): void {
    this.activePath = [{ ...pointer }];
    this.paths.push(this.activePath);
  }

  draw(pointer: AirPoint): void {
    if (!this.activePath) return;
    const last = this.activePath[this.activePath.length - 1];
    if (Math.hypot(pointer.x - last.x, pointer.y - last.y) >= 0.003) this.activePath.push({ ...pointer });
  }

  end(): void {
    this.drag = null;
    this.activePath = null;
  }
}
