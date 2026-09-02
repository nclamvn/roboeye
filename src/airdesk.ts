// AirDesk: visible fingertip affordances and direct content manipulation.
// This deliberately stays separate from AirSketch's drawing grammar.
import { AIRSKETCH_CONFIG } from './airsketch-config';
import { RealtimePointFilter, RealtimeValueFilter } from './realtime-point-filter';
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
  // Predicted point follows the visible hand; controlPointer stays stable for
  // drag anchors so an object does not overshoot when motion changes direction.
  pointer: AirPoint;
  controlPointer: AirPoint;
  pinch: boolean;
  justPinched: boolean;
  justReleased: boolean;
  gesture: 'hover' | 'open' | 'pinch' | 'transform';
  transformPose: {
    center: AirPoint;
    pinchRatio: number;
    palmAngle: number;
    palmFacing: number;
  };
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

function normalizeAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export class AirDeskController {
  private pinchActive = false;
  private readonly pointerFilter = new RealtimePointFilter({
    minCutoff: AIRSKETCH_CONFIG.tracking.cursorMinCutoff,
    beta: AIRSKETCH_CONFIG.tracking.cursorBeta,
    derivativeCutoff: AIRSKETCH_CONFIG.tracking.cursorDerivativeCutoff,
    velocityAlpha: AIRSKETCH_CONFIG.tracking.cursorVelocityAlpha,
    maxPredictionMs: AIRSKETCH_CONFIG.tracking.cursorLatencyMaxMs,
    maxPredictionDistance: AIRSKETCH_CONFIG.tracking.cursorMaxPrediction
  });
  private readonly fingertipFilters = new Map<number, RealtimePointFilter>();
  private readonly palmAngleFilter = new RealtimeValueFilter({ minCutoff: 1.4, beta: 2.2 });
  private readonly palmFacingFilter = new RealtimeValueFilter({ minCutoff: 1.2, beta: 1.4 });
  private readonly pinchRatioFilter = new RealtimeValueFilter({ minCutoff: 1.8, beta: 2.8 });
  private rawPalmAngle: number | null = null;
  private unwrappedPalmAngle = 0;
  private transformActive = false;
  private transformReleaseFrames = 0;
  private spatialTransform: {
    center: AirPoint;
    pinchRatio: number;
    palmAngle: number;
    facingSign: number;
    base: AirDeskTransform;
    flipIntent: boolean;
    flipFrames: number;
    flipped: boolean;
  } | null = null;
  private tool: AirDeskTool = 'move';
  private transform: AirDeskTransform = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false };
  private drag: { point: AirPoint; transform: AirDeskTransform; kind: 'move' | 'scale' | 'rotate' } | null = null;
  private paths: AirPoint[][] = [];
  private activePath: AirPoint[] | null = null;
  private drawingRevision = 0;

  reset(): void {
    this.pinchActive = false;
    this.pointerFilter.reset();
    for (const filter of this.fingertipFilters.values()) filter.reset();
    this.palmAngleFilter.reset();
    this.palmFacingFilter.reset();
    this.pinchRatioFilter.reset();
    this.rawPalmAngle = null;
    this.unwrappedPalmAngle = 0;
    this.transformActive = false;
    this.transformReleaseFrames = 0;
    this.spatialTransform = null;
    this.drag = null;
    this.activePath = null;
  }

  hand(points: HandLandmark[], at: number, receivedAt = at): AirDeskHandSample | null {
    if (points.length < 21) return null;
    const span = Math.max(0.001, distance(points[5], points[17]));
    const ratio = distance(points[4], points[8]) / span;
    const extendedByTip = new Map<number, boolean>();
    FINGER_PAIRS.forEach(([tip, pip]) => extendedByTip.set(tip, isExtended(points, tip, pip)));
    const openPalm = [...extendedByTip.values()].filter(Boolean).length >= 4;
    const previous = this.pinchActive;
    if (this.transformActive && this.pinchActive) {
      // Do not overload thumb/index separation: it is the scale axis. Only a
      // fully open hand can release a held image, confirmed across frames.
      this.transformReleaseFrames = openPalm && ratio >= AIRSKETCH_CONFIG.airDesk.transformReleaseRatio
        ? this.transformReleaseFrames + 1
        : 0;
      if (this.transformReleaseFrames >= AIRSKETCH_CONFIG.airDesk.transformReleaseSamples) this.pinchActive = false;
    } else {
      this.pinchActive = this.pinchActive
        ? ratio < AIRSKETCH_CONFIG.tracking.pinchUpRatio
        : ratio <= AIRSKETCH_CONFIG.tracking.pinchDownRatio;
    }
    const filteredPointer = this.pointerFilter.update({ x: 1 - points[8].x, y: points[8].y }, at, receivedAt);
    let filteredThumb = this.fingertipFilters.get(4);
    if (!filteredThumb) {
      filteredThumb = new RealtimePointFilter({
        minCutoff: AIRSKETCH_CONFIG.tracking.cursorMinCutoff,
        beta: AIRSKETCH_CONFIG.tracking.cursorBeta,
        derivativeCutoff: AIRSKETCH_CONFIG.tracking.cursorDerivativeCutoff,
        velocityAlpha: AIRSKETCH_CONFIG.tracking.cursorVelocityAlpha,
        maxPredictionMs: AIRSKETCH_CONFIG.tracking.cursorLatencyMaxMs,
        maxPredictionDistance: AIRSKETCH_CONFIG.tracking.cursorMaxPrediction
      });
      this.fingertipFilters.set(4, filteredThumb);
    }
    const thumb = filteredThumb.update({ x: 1 - points[4].x, y: points[4].y }, at, receivedAt);
    const center: AirPoint = {
      // Bounded prediction compensates capture/inference age for direct
      // manipulation. The transform baseline still prevents pickup jumps.
      x: (filteredPointer.display.x + thumb.display.x) * 0.5,
      y: (filteredPointer.display.y + thumb.display.y) * 0.5,
      t: receivedAt
    };
    const rawAngle = Math.atan2(points[9].y - points[0].y, (1 - points[9].x) - (1 - points[0].x));
    if (this.rawPalmAngle == null) this.unwrappedPalmAngle = rawAngle;
    else this.unwrappedPalmAngle += normalizeAngle(rawAngle - this.rawPalmAngle);
    this.rawPalmAngle = rawAngle;
    const palmAngle = this.palmAngleFilter.update(this.unwrappedPalmAngle, at);
    const wristX = 1 - points[0].x;
    const indexX = 1 - points[5].x;
    const pinkyX = 1 - points[17].x;
    const facingArea = (indexX - wristX) * (points[17].y - points[0].y) -
      (points[5].y - points[0].y) * (pinkyX - wristX);
    const palmFacing = this.palmFacingFilter.update(facingArea / Math.max(0.0001, span * span), at);
    const filteredRatio = this.pinchRatioFilter.update(ratio, at);
    return {
      pointer: filteredPointer.display,
      controlPointer: filteredPointer.stable,
      pinch: this.pinchActive,
      justPinched: !previous && this.pinchActive,
      justReleased: previous && !this.pinchActive,
      gesture: this.transformActive && this.pinchActive ? 'transform'
        : this.pinchActive ? 'pinch'
          : openPalm ? 'open' : 'hover',
      transformPose: { center, pinchRatio: filteredRatio, palmAngle, palmFacing },
      fingertips: TIP_INDICES.map((index) => {
        if (index === 8) {
          return { point: filteredPointer.display, extended: extendedByTip.get(index) ?? false, index };
        }
        let filter = this.fingertipFilters.get(index);
        if (!filter) {
          filter = new RealtimePointFilter({
            minCutoff: AIRSKETCH_CONFIG.tracking.cursorMinCutoff,
            beta: AIRSKETCH_CONFIG.tracking.cursorBeta,
            derivativeCutoff: AIRSKETCH_CONFIG.tracking.cursorDerivativeCutoff,
            velocityAlpha: AIRSKETCH_CONFIG.tracking.cursorVelocityAlpha,
            maxPredictionMs: AIRSKETCH_CONFIG.tracking.cursorLatencyMaxMs,
            maxPredictionDistance: AIRSKETCH_CONFIG.tracking.cursorMaxPrediction
          });
          this.fingertipFilters.set(index, filter);
        }
        return {
          point: index === 4 ? thumb.display : filter.update({ x: 1 - points[index].x, y: points[index].y }, at, receivedAt).display,
          // Thumb does not have the same PIP geometry; it remains a dot.
          extended: extendedByTip.get(index) ?? false,
          index
        };
      })
    };
  }

  getTool(): AirDeskTool { return this.tool; }
  getTransform(): AirDeskTransform { return { ...this.transform }; }
  getPaths(): AirPoint[][] { return this.paths.map((path) => path.map((point) => ({ ...point }))); }
  getRenderablePaths(): readonly (readonly AirPoint[])[] { return this.paths; }
  getDrawingRevision(): number { return this.drawingRevision; }
  isSpatialTransforming(): boolean { return this.transformActive; }

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

  beginSpatialTransform(sample: AirDeskHandSample): void {
    const facing = Math.abs(sample.transformPose.palmFacing) >= AIRSKETCH_CONFIG.airDesk.flipFacingMin
      ? Math.sign(sample.transformPose.palmFacing)
      : 1;
    this.transformActive = true;
    this.transformReleaseFrames = 0;
    this.spatialTransform = {
      center: { ...sample.transformPose.center },
      pinchRatio: Math.max(0.01, sample.transformPose.pinchRatio),
      palmAngle: sample.transformPose.palmAngle,
      facingSign: facing || 1,
      base: this.getTransform(),
      flipIntent: false,
      flipFrames: 0,
      flipped: false
    };
  }

  moveSpatialTransform(sample: AirDeskHandSample): void {
    const gesture = this.spatialTransform;
    if (!gesture || !this.transformActive) return;
    const dx = sample.transformPose.center.x - gesture.center.x;
    const dy = sample.transformPose.center.y - gesture.center.y;
    this.transform.x = clamp(gesture.base.x + dx, -AIRSKETCH_CONFIG.airDesk.maxTranslation, AIRSKETCH_CONFIG.airDesk.maxTranslation);
    this.transform.y = clamp(gesture.base.y + dy, -AIRSKETCH_CONFIG.airDesk.maxTranslation, AIRSKETCH_CONFIG.airDesk.maxTranslation);
    const scaleFactor = (sample.transformPose.pinchRatio + AIRSKETCH_CONFIG.airDesk.scaleBias) /
      (gesture.pinchRatio + AIRSKETCH_CONFIG.airDesk.scaleBias);
    this.transform.scale = clamp(
      gesture.base.scale * scaleFactor,
      AIRSKETCH_CONFIG.airDesk.minScale,
      AIRSKETCH_CONFIG.airDesk.maxScale
    );
    this.transform.rotation = gesture.base.rotation + normalizeAngle(sample.transformPose.palmAngle - gesture.palmAngle) * 180 / Math.PI;

    if (Math.abs(sample.transformPose.palmFacing) >= AIRSKETCH_CONFIG.airDesk.flipFacingMin) {
      const wantsFlip = Math.sign(sample.transformPose.palmFacing) !== gesture.facingSign;
      if (wantsFlip === gesture.flipIntent) gesture.flipFrames++;
      else {
        gesture.flipIntent = wantsFlip;
        gesture.flipFrames = 1;
      }
      if (gesture.flipFrames >= AIRSKETCH_CONFIG.airDesk.flipConfirmSamples) gesture.flipped = wantsFlip;
    }
    this.transform.flipX = gesture.base.flipX !== gesture.flipped;
  }

  move(pointer: AirPoint): void {
    if (!this.drag) return;
    const dx = pointer.x - this.drag.point.x;
    const dy = pointer.y - this.drag.point.y;
    if (this.drag.kind === 'move') {
      this.transform.x = clamp(this.drag.transform.x + dx, -AIRSKETCH_CONFIG.airDesk.maxTranslation, AIRSKETCH_CONFIG.airDesk.maxTranslation);
      this.transform.y = clamp(this.drag.transform.y + dy, -AIRSKETCH_CONFIG.airDesk.maxTranslation, AIRSKETCH_CONFIG.airDesk.maxTranslation);
    } else if (this.drag.kind === 'scale') {
      this.transform.scale = clamp(this.drag.transform.scale + (dx - dy) * 1.4, AIRSKETCH_CONFIG.airDesk.minScale, AIRSKETCH_CONFIG.airDesk.maxScale);
    } else {
      this.transform.rotation = this.drag.transform.rotation + dx * 220;
    }
  }

  beginDrawing(pointer: AirPoint): void {
    this.activePath = [{ ...pointer }];
    this.paths.push(this.activePath);
    this.drawingRevision++;
  }

  draw(pointer: AirPoint): void {
    if (!this.activePath) return;
    const last = this.activePath[this.activePath.length - 1];
    if (Math.hypot(pointer.x - last.x, pointer.y - last.y) >= 0.003) {
      this.activePath.push({ ...pointer });
      this.drawingRevision++;
    }
  }

  end(): void {
    this.drag = null;
    this.activePath = null;
    this.transformActive = false;
    this.transformReleaseFrames = 0;
    this.spatialTransform = null;
  }
}
