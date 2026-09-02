import type { AirPoint } from './airsketch-types';

export interface RealtimePointFilterOptions {
  minCutoff: number;
  beta: number;
  derivativeCutoff: number;
  velocityAlpha: number;
  maxPredictionMs: number;
  maxPredictionDistance: number;
}

export interface FilteredPoint {
  stable: AirPoint;
  display: AirPoint;
  velocity: { x: number; y: number };
}

const DEFAULT_OPTIONS: RealtimePointFilterOptions = {
  minCutoff: 1.8,
  beta: 2.4,
  derivativeCutoff: 1,
  velocityAlpha: 0.58,
  maxPredictionMs: 35,
  maxPredictionDistance: 0.035
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothingAlpha(elapsedSeconds: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(0.001, cutoff));
  return 1 / (1 + tau / Math.max(1 / 240, elapsedSeconds));
}

class OneEuroScalar {
  private raw: number | null = null;
  private filtered: number | null = null;
  private derivative = 0;
  private timestamp = -Infinity;

  constructor(private readonly options: RealtimePointFilterOptions) {}

  reset(): void {
    this.raw = null;
    this.filtered = null;
    this.derivative = 0;
    this.timestamp = -Infinity;
  }

  update(value: number, timestamp: number): number {
    if (this.raw == null || this.filtered == null || !Number.isFinite(this.timestamp)) {
      this.raw = value;
      this.filtered = value;
      this.timestamp = timestamp;
      return value;
    }
    const elapsed = clamp((timestamp - this.timestamp) / 1_000, 1 / 240, 0.1);
    const rawDerivative = (value - this.raw) / elapsed;
    const derivativeAlpha = smoothingAlpha(elapsed, this.options.derivativeCutoff);
    this.derivative += (rawDerivative - this.derivative) * derivativeAlpha;
    const cutoff = this.options.minCutoff + this.options.beta * Math.abs(this.derivative);
    const valueAlpha = smoothingAlpha(elapsed, cutoff);
    this.filtered += (value - this.filtered) * valueAlpha;
    this.raw = value;
    this.timestamp = timestamp;
    return this.filtered;
  }
}

/** Timestamp-aware scalar variant for gesture geometry such as angle/facing. */
export class RealtimeValueFilter {
  private readonly scalar: OneEuroScalar;

  constructor(options: Partial<RealtimePointFilterOptions> = {}) {
    this.scalar = new OneEuroScalar({ ...DEFAULT_OPTIONS, ...options });
  }

  reset(): void { this.scalar.reset(); }
  update(value: number, timestamp: number): number { return this.scalar.update(value, timestamp); }
}

/**
 * Timestamp-aware 1€ filtering plus bounded motion prediction.
 *
 * `stable` is used for hit-testing/drag anchors. `display` compensates only the
 * measured capture-to-reply age and is used for cursor/ink feedback. Keeping
 * both coordinates prevents a responsive cursor from making grabbed objects
 * overshoot or jump.
 */
export class RealtimePointFilter {
  private readonly options: RealtimePointFilterOptions;
  private readonly x: OneEuroScalar;
  private readonly y: OneEuroScalar;
  private previousStable: AirPoint | null = null;
  private velocity = { x: 0, y: 0 };

  constructor(options: Partial<RealtimePointFilterOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.x = new OneEuroScalar(this.options);
    this.y = new OneEuroScalar(this.options);
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.previousStable = null;
    this.velocity = { x: 0, y: 0 };
  }

  update(raw: Pick<AirPoint, 'x' | 'y'>, capturedAt: number, receivedAt = capturedAt): FilteredPoint {
    const stable: AirPoint = {
      x: this.x.update(raw.x, capturedAt),
      y: this.y.update(raw.y, capturedAt),
      t: capturedAt
    };
    if (this.previousStable) {
      const elapsed = Math.max(8, capturedAt - this.previousStable.t);
      const measured = {
        x: (stable.x - this.previousStable.x) / elapsed,
        y: (stable.y - this.previousStable.y) / elapsed
      };
      this.velocity.x += (measured.x - this.velocity.x) * this.options.velocityAlpha;
      this.velocity.y += (measured.y - this.velocity.y) * this.options.velocityAlpha;
    }
    this.previousStable = { ...stable };
    const horizon = Math.min(this.options.maxPredictionMs, Math.max(0, receivedAt - capturedAt));
    const dx = clamp(this.velocity.x * horizon, -this.options.maxPredictionDistance, this.options.maxPredictionDistance);
    const dy = clamp(this.velocity.y * horizon, -this.options.maxPredictionDistance, this.options.maxPredictionDistance);
    return {
      stable,
      display: {
        x: clamp(stable.x + dx, 0, 1),
        y: clamp(stable.y + dy, 0, 1),
        t: receivedAt
      },
      velocity: { ...this.velocity }
    };
  }
}
