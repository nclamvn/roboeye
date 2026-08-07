// T23: deliberate static-clutch interaction state machine.
// Pinching the thumb and index finger is the only way to put ink down. This
// removes timing-sensitive flick recognition from the critical drawing path.
import { AIRSKETCH_CONFIG } from './airsketch-config';
import type { AirPoint, HandLandmark } from './airsketch-types';

export type AirInteractionMode = 'idle' | 'drawing' | 'manipulating' | 'grabbing';

export interface AirInteractionSample {
  cursor: AirPoint;
  mode: AirInteractionMode;
  penDown: boolean;
  openPalm: boolean;
  pinch: boolean;
  palmSpan: number;
  justGrabbed: boolean;
  justReleased: boolean;
  fist: boolean;
  manipulationProgress: number;
}

function distance(a: Pick<HandLandmark, 'x' | 'y'>, b: Pick<HandLandmark, 'x' | 'y'>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function extended(points: HandLandmark[], tip: number, pip: number): boolean {
  return distance(points[tip], points[0]) > distance(points[pip], points[0]) * 1.13;
}

function pointerPose(points: HandLandmark[]): boolean {
  const index = extended(points, 8, 6);
  const folded = [
    !extended(points, 12, 10),
    !extended(points, 16, 14),
    !extended(points, 20, 18)
  ].filter(Boolean).length;
  // Camera perspective often makes one folded finger look partially extended.
  // Require two folded fingers instead of all three, while keeping open-palm
  // (all four extended) reserved for manipulation.
  return index && folded >= 2;
}

export class AirInteractionController {
  private mode: AirInteractionMode = 'idle';
  private smoothedCursor: AirPoint | null = null;
  private smoothedPalmSpan: number | null = null;
  private pinchActive = false;
  private openPalmStartedAt: number | null = null;

  reset(): void {
    this.mode = 'idle';
    this.smoothedCursor = null;
    this.smoothedPalmSpan = null;
    this.pinchActive = false;
    this.openPalmStartedAt = null;
  }

  release(): void { this.reset(); }
  currentMode(): AirInteractionMode { return this.mode; }

  private smoothCursor(raw: AirPoint, reset = false): AirPoint {
    if (reset || !this.smoothedCursor) {
      this.smoothedCursor = raw;
      return raw;
    }
    const previous = this.smoothedCursor;
    const elapsed = Math.max(8, raw.t - previous.t);
    const velocity = distance(raw, previous) * 1_000 / elapsed;
    const alpha = Math.min(
      AIRSKETCH_CONFIG.tracking.cursorMaxAlpha,
      Math.max(AIRSKETCH_CONFIG.tracking.cursorMinAlpha,
        AIRSKETCH_CONFIG.tracking.cursorMinAlpha + velocity * AIRSKETCH_CONFIG.tracking.cursorVelocityGain)
    );
    this.smoothedCursor = {
      x: previous.x + (raw.x - previous.x) * alpha,
      y: previous.y + (raw.y - previous.y) * alpha,
      t: raw.t
    };
    return this.smoothedCursor;
  }

  private smoothPalmSpan(raw: number): number {
    if (this.smoothedPalmSpan == null) {
      this.smoothedPalmSpan = raw;
      return raw;
    }
    const relativeChange = Math.abs(raw - this.smoothedPalmSpan) / Math.max(0.001, this.smoothedPalmSpan);
    const alpha = Math.min(
      AIRSKETCH_CONFIG.tracking.palmSpanMaxAlpha,
      Math.max(AIRSKETCH_CONFIG.tracking.palmSpanMinAlpha,
        AIRSKETCH_CONFIG.tracking.palmSpanMinAlpha + relativeChange * AIRSKETCH_CONFIG.tracking.palmSpanDeltaGain)
    );
    this.smoothedPalmSpan += (raw - this.smoothedPalmSpan) * alpha;
    return this.smoothedPalmSpan;
  }

  update(points: HandLandmark[], now: number): AirInteractionSample | null {
    if (points.length < 21) return null;
    const rawPalmSpan = Math.max(0.001, distance(points[5], points[17]));
    const index = extended(points, 8, 6);
    const middle = extended(points, 12, 10);
    const ring = extended(points, 16, 14);
    const pinky = extended(points, 20, 18);
    const fist = !index && !middle && !ring && !pinky;
    const pinchRatio = distance(points[4], points[8]) / rawPalmSpan;
    // Hysteresis keeps a grab stable when a real hand trembles near the
    // threshold: engage at the lower threshold and release at the higher one.
    // A fist is an explicit safety pose and always cancels a held pinch.
    if (fist) this.pinchActive = false;
    else if (this.pinchActive) this.pinchActive = pinchRatio < AIRSKETCH_CONFIG.tracking.pinchUpRatio;
    else this.pinchActive = pinchRatio <= AIRSKETCH_CONFIG.tracking.pinchDownRatio;
    const pinch = this.pinchActive;
    const palmSpan = this.smoothPalmSpan(rawPalmSpan);
    const openPalm = index && middle && ring && pinky;
    const indexPoint = { x: 1 - points[8].x, y: points[8].y, t: now };
    const rawCursor = pinch
      ? { x: 1 - (points[4].x + points[8].x) * 0.5, y: (points[4].y + points[8].y) * 0.5, t: now }
      : indexPoint;
    let justGrabbed = false;
    let justReleased = false;
    const modeBeforeUpdate = this.mode;
    const pointer = pointerPose(points);

    // An open palm is intentionally a slow gesture: it must be held long
    // enough to be distinguishable from a momentary hand pose while drawing.
    if (openPalm) {
      if (this.openPalmStartedAt == null) this.openPalmStartedAt = now;
    } else {
      this.openPalmStartedAt = null;
    }
    const manipulationProgress = this.openPalmStartedAt == null
      ? 0
      : Math.min(1, Math.max(0, (now - this.openPalmStartedAt) / AIRSKETCH_CONFIG.tracking.manipulationHoldMs));

    if (fist) {
      if (this.mode === 'grabbing') justReleased = true;
      this.mode = 'idle';
      this.openPalmStartedAt = null;
    } else if (this.mode === 'idle') {
      if (openPalm && manipulationProgress >= 1) {
        this.mode = 'manipulating';
      } else if (!openPalm && pointer && pinch) {
        // Static clutch: point to aim, then pinch to put the pen down.
        this.mode = 'drawing';
      }
    } else if (this.mode === 'drawing') {
      if (openPalm) {
        // Lift the pen immediately; holding the palm then enters the object
        // workspace without an additional, ambiguous activation gesture.
        this.mode = manipulationProgress >= 1 ? 'manipulating' : 'idle';
      } else if (!pointer || !pinch) {
        this.mode = 'idle';
      }
    } else if (this.mode === 'manipulating') {
      if (pinch && !openPalm) {
        this.mode = 'grabbing';
        justGrabbed = true;
      }
    } else if (this.mode === 'grabbing' && !pinch) {
      this.mode = 'manipulating';
      justReleased = true;
    }

    const startedDrawing = this.mode === 'drawing' && modeBeforeUpdate !== 'drawing';
    const cursor = this.smoothCursor(rawCursor, startedDrawing);
    return {
      cursor,
      mode: this.mode,
      penDown: this.mode === 'drawing',
      openPalm,
      pinch,
      palmSpan,
      justGrabbed,
      justReleased,
      fist,
      manipulationProgress
    };
  }
}
