// T23: deliberate static-clutch interaction state machine.
// Pinching the thumb and index finger is the only way to put ink down. This
// removes timing-sensitive flick recognition from the critical drawing path.
import { AIRSKETCH_CONFIG } from './airsketch-config';
import type { AirPoint, HandLandmark } from './airsketch-types';

export type AirInteractionMode = 'idle' | 'drawing' | 'manipulating' | 'grabbing';

export interface AirInteractionSample {
  // Predicted display/ink position. This is deliberately the index fingertip
  // in every state, including when the thumb pinches it.
  cursor: AirPoint;
  // Stable, non-predicted position for hit-testing and moving an object.
  // Prediction makes ink feel responsive but makes a grasp overshoot small
  // objects, so object manipulation must use this separate coordinate.
  grabCursor: AirPoint;
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
  private previousRawCursor: AirPoint | null = null;
  private cursorVelocity = { x: 0, y: 0 };
  private smoothedPalmSpan: number | null = null;
  private pinchActive = false;
  private openPalmStartedAt: number | null = null;
  private lastObservedAt = -Infinity;

  reset(): void {
    this.mode = 'idle';
    this.smoothedCursor = null;
    this.previousRawCursor = null;
    this.cursorVelocity = { x: 0, y: 0 };
    this.smoothedPalmSpan = null;
    this.pinchActive = false;
    this.openPalmStartedAt = null;
    this.lastObservedAt = -Infinity;
  }

  release(): void { this.reset(); }
  currentMode(): AirInteractionMode { return this.mode; }

  // Kept here (rather than as an ad-hoc main-thread timestamp comparison) so
  // the continuity contract is deterministic and regression-testable.
  shouldReleaseAfterMissing(receivedAt: number): boolean {
    return receivedAt - this.lastObservedAt >= AIRSKETCH_CONFIG.tracking.lostHandGraceMs;
  }

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

  private compensateCursor(raw: AirPoint, capturedAt: number, receivedAt: number): AirPoint {
    const previous = this.previousRawCursor;
    if (previous) {
      const elapsed = Math.max(8, capturedAt - previous.t);
      const measuredVelocity = {
        x: (raw.x - previous.x) / elapsed,
        y: (raw.y - previous.y) / elapsed
      };
      // Velocity EMA limits a single jittery landmark from launching the pen.
      this.cursorVelocity = {
        x: this.cursorVelocity.x + (measuredVelocity.x - this.cursorVelocity.x) * 0.62,
        y: this.cursorVelocity.y + (measuredVelocity.y - this.cursorVelocity.y) * 0.62
      };
    }
    this.previousRawCursor = { ...raw, t: capturedAt };
    const latency = Math.min(
      AIRSKETCH_CONFIG.tracking.cursorLatencyMaxMs,
      Math.max(0, receivedAt - capturedAt)
    );
    const maxShift = AIRSKETCH_CONFIG.tracking.cursorMaxPrediction;
    const dx = Math.max(-maxShift, Math.min(maxShift, this.cursorVelocity.x * latency));
    const dy = Math.max(-maxShift, Math.min(maxShift, this.cursorVelocity.y * latency));
    return {
      x: Math.min(1, Math.max(0, raw.x + dx)),
      y: Math.min(1, Math.max(0, raw.y + dy)),
      t: receivedAt
    };
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

  update(points: HandLandmark[], capturedAt: number, receivedAt = capturedAt): AirInteractionSample | null {
    if (points.length < 21) return null;
    this.lastObservedAt = receivedAt;
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
    // Do not swap from the index tip to the thumb-index midpoint on pinch.
    // That old switch moved the pen by half the finger gap at the moment the
    // user started drawing and also made a target impossible to grab reliably.
    const rawCursor = { x: 1 - points[8].x, y: points[8].y, t: capturedAt };
    let justGrabbed = false;
    let justReleased = false;
    const modeBeforeUpdate = this.mode;
    const pointer = pointerPose(points);

    // An open palm is intentionally a slow gesture.  While a pen pinch is
    // already down, do not arm manipulation: landmark jitter can make folded
    // fingers look extended for a sample and used to sever the active stroke.
    const canArmManipulation = this.mode !== 'drawing' || !pinch;
    if (openPalm && canArmManipulation) {
      if (this.openPalmStartedAt == null) this.openPalmStartedAt = receivedAt;
    } else {
      this.openPalmStartedAt = null;
    }
    const manipulationProgress = this.openPalmStartedAt == null
      ? 0
      : Math.min(1, Math.max(0, (receivedAt - this.openPalmStartedAt) / AIRSKETCH_CONFIG.tracking.manipulationHoldMs));

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
      // Pointer-pose classification is needed only to enter drawing. Once
      // clutched, the physical pinch is the durable pen contract. Requiring
      // three other fingers to remain folded made ordinary pose jitter split
      // strokes even though thumb and index were still touching.
      if (!pinch) {
        this.mode = 'idle';
      }
    } else if (this.mode === 'manipulating') {
      // Once a deliberate open-palm dwell has entered manipulation, an open
      // hand may keep its other fingers extended while thumb and index pinch.
      // Requiring those fingers to fold made the advertised two-finger grab
      // silently fail for a natural hand pose.
      if (pinch) {
        this.mode = 'grabbing';
        justGrabbed = true;
      }
    } else if (this.mode === 'grabbing' && !pinch) {
      this.mode = 'manipulating';
      justReleased = true;
    }

    const startedDrawing = this.mode === 'drawing' && modeBeforeUpdate !== 'drawing';
    const grabCursor = this.smoothCursor(rawCursor, startedDrawing);
    const cursor = this.compensateCursor(grabCursor, capturedAt, receivedAt);
    return {
      cursor,
      grabCursor,
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
