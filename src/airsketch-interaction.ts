// T18: deliberate hand interaction state machine.
// Drawing is armed by a double flick, so ordinary hand movement cannot
// accidentally paint over the camera feed.
import { AIRSKETCH_CONFIG } from './airsketch-config';
import type { AirPoint, HandLandmark } from './airsketch-types';

export type AirInteractionMode = 'idle' | 'armed' | 'drawing' | 'manipulating' | 'grabbing';

export interface AirInteractionSample {
  cursor: AirPoint;
  mode: AirInteractionMode;
  penDown: boolean;
  openPalm: boolean;
  pinch: boolean;
  palmSpan: number;
  justArmed: boolean;
  justGrabbed: boolean;
  justReleased: boolean;
  fist: boolean;
  flickCount: number;
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
  private previous: { point: AirPoint; at: number } | null = null;
  private smoothedCursor: AirPoint | null = null;
  private smoothedPalmSpan: number | null = null;
  private pinchActive = false;
  private flickCount = 0;
  private lastFlickAt = -Infinity;
  private flickStartedAt = -Infinity;
  private flickTravel = 0;
  private flickCooldownUntil = 0;
  private grabPinch = false;

  reset(): void {
    this.mode = 'idle';
    this.previous = null;
    this.smoothedCursor = null;
    this.smoothedPalmSpan = null;
    this.pinchActive = false;
    this.flickCount = 0;
    this.lastFlickAt = -Infinity;
    this.flickStartedAt = -Infinity;
    this.flickTravel = 0;
    this.flickCooldownUntil = 0;
    this.grabPinch = false;
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
    let justArmed = false;
    let justGrabbed = false;
    let justReleased = false;

    const modeBeforeUpdate = this.mode;
    const pointer = pointerPose(points);

    if (this.previous && pointer && this.mode === 'idle') {
      const dt = now - this.previous.at;
      const step = distance(rawCursor, this.previous.point);
      if (dt <= 0 || dt > AIRSKETCH_CONFIG.tracking.calibrationFlickMaxMs) {
        this.flickStartedAt = now;
        this.flickTravel = 0;
      } else {
        if (!Number.isFinite(this.flickStartedAt) || now - this.flickStartedAt > AIRSKETCH_CONFIG.tracking.calibrationFlickMaxMs) {
          this.flickStartedAt = this.previous.at;
          this.flickTravel = 0;
        }
        this.flickTravel += step;
      }
      const flickReady = this.flickTravel >= AIRSKETCH_CONFIG.tracking.calibrationFlickDistance;
      if (flickReady && now >= this.flickCooldownUntil) {
        if (now - this.lastFlickAt > AIRSKETCH_CONFIG.tracking.doubleFlickGapMs) this.flickCount = 0;
        this.flickCount++;
        this.lastFlickAt = now;
        this.flickCooldownUntil = now + AIRSKETCH_CONFIG.tracking.calibrationFlickDebounceMs;
        this.flickStartedAt = now;
        this.flickTravel = 0;
        if (this.flickCount >= 2) {
          this.mode = 'armed';
          this.flickCount = 0;
          justArmed = true;
        }
      }
    } else if (!pointer) {
      this.flickStartedAt = -Infinity;
      this.flickTravel = 0;
    }

    // A placed object must remain reachable after the user has returned to
    // the safe fist/idle pose. Open palm is the explicit entry to the grab
    // workspace and deliberately does not arm the pen.
    if (this.mode === 'idle' && openPalm) {
      this.mode = 'manipulating';
      this.flickCount = 0;
    }

    if (this.mode === 'armed' || this.mode === 'drawing') {
      if (fist) this.mode = 'idle';
      else if (openPalm) this.mode = 'manipulating';
      else if (this.mode === 'armed' && !justArmed && pointer) this.mode = 'drawing';
      else if (this.mode === 'drawing' && !pointer) this.mode = 'armed';
    } else if (this.mode === 'manipulating' || this.mode === 'grabbing') {
      if (fist) {
        if (this.grabPinch) justReleased = true;
        this.mode = 'idle';
      } else if (pinch && !this.grabPinch) {
        this.mode = 'grabbing';
        justGrabbed = true;
      } else if (!pinch && this.grabPinch) {
        this.mode = 'manipulating';
        justReleased = true;
      }
    }

    const startedDrawing = this.mode === 'drawing' && modeBeforeUpdate !== 'drawing';
    const cursor = this.smoothCursor(rawCursor, startedDrawing);
    this.grabPinch = pinch;
    // Re-extending the index after a fist begins a fresh gesture; it must not
    // be counted as the first activation flick.
    this.previous = fist ? null : { point: rawCursor, at: now };
    return {
      cursor,
      mode: this.mode,
      penDown: this.mode === 'drawing' && !justArmed,
      openPalm,
      pinch,
      palmSpan,
      justArmed,
      justGrabbed,
      justReleased,
      fist,
      flickCount: this.flickCount
    };
  }
}
