// T18 scene layer: completed strokes become movable 2.5D objects.
import { AIRSKETCH_CONFIG } from './airsketch-config';
import { drawAirStrokes } from './airsketch-ink';
import type { AirPoint, AirStroke } from './airsketch-types';

export interface AirSketchObject {
  id: number;
  stroke: AirStroke;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  selected: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class AirSketchScene {
  private objects: AirSketchObject[] = [];
  private nextId = 1;
  private grabbed: { object: AirSketchObject; dx: number; dy: number; baseScale: number; baseSpan: number } | null = null;

  addStroke(stroke: AirStroke): AirSketchObject | null {
    if (stroke.points.length < 2) return null;
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    const width = Math.max(0.015, maxX - minX);
    const height = Math.max(0.015, maxY - minY);
    const object: AirSketchObject = {
      id: this.nextId++,
      stroke: { points: stroke.points.map((point) => ({
        x: (point.x - minX) / width,
        y: (point.y - minY) / height,
        t: point.t
      })) },
      x: minX + width * 0.5,
      y: minY + height * 0.5,
      width,
      height,
      scale: 1,
      selected: false
    };
    this.objects.push(object);
    return object;
  }

  undo(): void {
    this.release();
    this.objects.pop();
  }

  clear(): void {
    this.release();
    this.objects = [];
  }

  snapshot(): AirSketchObject[] {
    return this.objects.map((object) => ({ ...object, stroke: { points: object.stroke.points.map((point) => ({ ...point })) } }));
  }

  hitTest(point: Pick<AirPoint, 'x' | 'y'>): AirSketchObject | null {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const object = this.objects[i];
      // A hand cursor cannot be placed with pixel-perfect precision. Keep a
      // bounded pickup halo, especially for short strokes and small symbols.
      const halfW = Math.max(AIRSKETCH_CONFIG.tracking.grabHitPadding, object.width * object.scale * 0.58);
      const halfH = Math.max(AIRSKETCH_CONFIG.tracking.grabHitPadding, object.height * object.scale * 0.58);
      if (Math.abs(point.x - object.x) <= halfW && Math.abs(point.y - object.y) <= halfH) return object;
    }
    return null;
  }

  beginGrab(
    hitPoint: Pick<AirPoint, 'x' | 'y'>,
    anchorPoint: Pick<AirPoint, 'x' | 'y'>,
    palmSpan: number
  ): AirSketchObject | null {
    // The user targets what is visibly rendered (latency-compensated cursor),
    // but movement must be anchored to the stable coordinate. Mixing those
    // responsibilities either misses the visible object or jumps it on the
    // first movement sample.
    const object = this.hitTest(hitPoint);
    if (!object) return null;
    for (const item of this.objects) item.selected = item === object;
    this.grabbed = { object, dx: object.x - anchorPoint.x, dy: object.y - anchorPoint.y, baseScale: object.scale, baseSpan: Math.max(0.001, palmSpan) };
    return object;
  }

  moveGrab(point: Pick<AirPoint, 'x' | 'y'>, palmSpan: number): void {
    if (!this.grabbed) return;
    const { object, dx, dy, baseScale, baseSpan } = this.grabbed;
    object.x = clamp(point.x + dx, 0, 1);
    object.y = clamp(point.y + dy, 0, 1);
    object.scale = clamp(baseScale * palmSpan / baseSpan, AIRSKETCH_CONFIG.tracking.objectMinScale, AIRSKETCH_CONFIG.tracking.objectMaxScale);
  }

  release(): void { this.grabbed = null; }

  render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number): void {
    for (const object of this.objects) {
      const objectWidth = object.width * object.scale;
      const objectHeight = object.height * object.scale;
      const mapped: AirStroke = {
        points: object.stroke.points.map((point) => ({
          x: object.x - objectWidth * 0.5 + point.x * objectWidth,
          y: object.y - objectHeight * 0.5 + point.y * objectHeight,
          t: point.t
        }))
      };
      const shadow = object.selected ? 'rgba(255, 213, 145, 0.78)' : 'rgba(255, 255, 255, 0.55)';
      drawAirStrokes(ctx, [mapped], width, height, {
        color: object.selected ? '#ffe0a8' : '#ffffff',
        width: Math.max(3.2, width * 0.0042 * Math.sqrt(object.scale)),
        shadow
      });
      if (object.selected) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 224, 168, 0.48)';
        ctx.lineWidth = Math.max(1, width * 0.0012);
        ctx.setLineDash([6, 5]);
        ctx.strokeRect((object.x - objectWidth * 0.58) * width, (object.y - objectHeight * 0.58) * height, objectWidth * 1.16 * width, objectHeight * 1.16 * height);
        ctx.restore();
      }
    }
  }
}
