import { RealtimeValueFilter } from './realtime-point-filter';
import { classifyRobotHandGesture, RobotHandGestureStabilizer, type RobotHandGesture } from './robohand-gestures';
import { ROBOT_HAND_SEGMENTS, type Quaternion, type RobotHandPose, type Vec3 } from './robohand-types';
import type { HandLandmark } from './airsketch-types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalized(value: Vec3, fallback: Vec3): Vec3 {
  const magnitude = Math.hypot(value.x, value.y, value.z);
  return magnitude > 1e-6 && Number.isFinite(magnitude)
    ? { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude }
    : { ...fallback };
}

function quaternionDot(a: Quaternion, b: Quaternion): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

function quaternionSlerp(a: Quaternion, b: Quaternion, amount: number): Quaternion {
  let target = b;
  let cosine = quaternionDot(a, b);
  if (cosine < 0) {
    cosine = -cosine;
    target = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (cosine > .9995) {
    const result = {
      x: a.x + (target.x - a.x) * amount,
      y: a.y + (target.y - a.y) * amount,
      z: a.z + (target.z - a.z) * amount,
      w: a.w + (target.w - a.w) * amount
    };
    const magnitude = Math.hypot(result.x, result.y, result.z, result.w) || 1;
    return { x: result.x / magnitude, y: result.y / magnitude, z: result.z / magnitude, w: result.w / magnitude };
  }
  const angle = Math.acos(clamp(cosine, -1, 1));
  const sine = Math.sin(angle);
  const fromWeight = Math.sin((1 - amount) * angle) / sine;
  const toWeight = Math.sin(amount * angle) / sine;
  return {
    x: a.x * fromWeight + target.x * toWeight,
    y: a.y * fromWeight + target.y * toWeight,
    z: a.z * fromWeight + target.z * toWeight,
    w: a.w * fromWeight + target.w * toWeight
  };
}

class DirectionFilter {
  private readonly x = new RealtimeValueFilter({ minCutoff: 2.15, beta: 8.5, derivativeCutoff: 1.2 });
  private readonly y = new RealtimeValueFilter({ minCutoff: 2.15, beta: 8.5, derivativeCutoff: 1.2 });
  private readonly z = new RealtimeValueFilter({ minCutoff: 2.15, beta: 8.5, derivativeCutoff: 1.2 });

  update(value: Vec3, at: number): Vec3 {
    return normalized({
      x: this.x.update(value.x, at),
      y: this.y.update(value.y, at),
      z: this.z.update(value.z, at)
    }, value);
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.z.reset();
  }
}

class RootPositionFilter {
  private readonly x = new RealtimeValueFilter({ minCutoff: 2, beta: 3.6, derivativeCutoff: 1.1 });
  private readonly y = new RealtimeValueFilter({ minCutoff: 2, beta: 3.6, derivativeCutoff: 1.1 });
  private readonly z = new RealtimeValueFilter({ minCutoff: 1.7, beta: 2.4, derivativeCutoff: 1.1 });
  private previous: (Vec3 & { t: number }) | null = null;
  private velocity: Vec3 = { x: 0, y: 0, z: 0 };

  update(value: Vec3, capturedAt: number, visibleAt: number): Vec3 {
    const stable = {
      x: this.x.update(value.x, capturedAt),
      y: this.y.update(value.y, capturedAt),
      z: this.z.update(value.z, capturedAt)
    };
    if (this.previous) {
      const elapsed = Math.max(8, capturedAt - this.previous.t);
      const measured = {
        x: (stable.x - this.previous.x) / elapsed,
        y: (stable.y - this.previous.y) / elapsed,
        z: (stable.z - this.previous.z) / elapsed
      };
      this.velocity.x += (measured.x - this.velocity.x) * .62;
      this.velocity.y += (measured.y - this.velocity.y) * .62;
      this.velocity.z += (measured.z - this.velocity.z) * .62;
    }
    this.previous = { ...stable, t: capturedAt };
    const horizon = clamp(visibleAt - capturedAt, 0, 35);
    let prediction = {
      x: this.velocity.x * horizon,
      y: this.velocity.y * horizon,
      z: this.velocity.z * horizon
    };
    const magnitude = Math.hypot(prediction.x, prediction.y, prediction.z);
    if (magnitude > .12) prediction = {
      x: prediction.x * .12 / magnitude,
      y: prediction.y * .12 / magnitude,
      z: prediction.z * .12 / magnitude
    };
    return { x: stable.x + prediction.x, y: stable.y + prediction.y, z: stable.z + prediction.z };
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.z.reset();
    this.previous = null;
    this.velocity = { x: 0, y: 0, z: 0 };
  }
}

export class RobotHandPoseFilter {
  private readonly directionFilters = ROBOT_HAND_SEGMENTS.map(() => new DirectionFilter());
  private readonly rootPosition = new RootPositionFilter();
  private readonly rootScale = new RealtimeValueFilter({ minCutoff: 1.6, beta: 2.8 });
  private orientation: Quaternion | null = null;
  private orientationAt = -Infinity;
  private handedness: RobotHandPose['handedness'] = 'Unknown';
  private handednessCandidate: RobotHandPose['handedness'] = 'Unknown';
  private handednessSamples = 0;

  update(pose: RobotHandPose, visibleAt = pose.receivedAt): RobotHandPose {
    const directions = pose.directions.map((direction, index) => this.directionFilters[index].update(direction, pose.capturedAt));
    const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    ROBOT_HAND_SEGMENTS.forEach((segment, index) => {
      const parent = points[segment.parent];
      const direction = directions[index];
      points[segment.child] = {
        x: parent.x + direction.x * segment.length,
        y: parent.y + direction.y * segment.length,
        z: parent.z + direction.z * segment.length
      };
    });

    const rootPosition = this.rootPosition.update(pose.rootPosition, pose.capturedAt, visibleAt);
    const elapsed = clamp((pose.capturedAt - this.orientationAt) / 1_000, 1 / 240, .1);
    if (!this.orientation) this.orientation = { ...pose.rootOrientation };
    else {
      const cosine = Math.abs(quaternionDot(this.orientation, pose.rootOrientation));
      const angularSpeed = 2 * Math.acos(clamp(cosine, -1, 1)) / elapsed;
      const cutoff = 2 + angularSpeed * .34;
      const tau = 1 / (2 * Math.PI * cutoff);
      this.orientation = quaternionSlerp(this.orientation, pose.rootOrientation, 1 / (1 + tau / elapsed));
    }
    this.orientationAt = pose.capturedAt;

    if (pose.handedness !== 'Unknown' && pose.handedness !== this.handedness) {
      if (pose.handedness !== this.handednessCandidate) {
        this.handednessCandidate = pose.handedness;
        this.handednessSamples = 1;
      } else if (++this.handednessSamples >= 3 || this.handedness === 'Unknown') {
        this.handedness = pose.handedness;
        this.handednessSamples = 0;
      }
    } else {
      this.handednessCandidate = this.handedness;
      this.handednessSamples = 0;
    }

    return {
      ...pose,
      points,
      directions,
      rootPosition,
      rootOrientation: { ...this.orientation },
      rootScale: this.rootScale.update(pose.rootScale, pose.capturedAt),
      handedness: this.handedness,
      receivedAt: visibleAt
    };
  }

  reset(): void {
    this.directionFilters.forEach((filter) => filter.reset());
    this.rootPosition.reset();
    this.rootScale.reset();
    this.orientation = null;
    this.orientationAt = -Infinity;
    this.handedness = 'Unknown';
    this.handednessCandidate = 'Unknown';
    this.handednessSamples = 0;
  }
}

export interface RobotHandRealtimeResult {
  pose: RobotHandPose | null;
  gesture: RobotHandGesture | 'HOLD' | 'REST';
  state: 'live' | 'hold' | 'rest';
}

export class RobotHandRealtimeController {
  private readonly filter = new RobotHandPoseFilter();
  private readonly gestures = new RobotHandGestureStabilizer();
  private lastPose: RobotHandPose | null = null;
  private lastSeenAt = -Infinity;

  constructor(private readonly lossGraceMs = 220) {}

  update(pose: RobotHandPose, landmarks: HandLandmark[], now: number): RobotHandRealtimeResult {
    this.lastPose = this.filter.update(pose, now);
    this.lastSeenAt = now;
    return {
      pose: this.lastPose,
      gesture: this.gestures.update(classifyRobotHandGesture(landmarks)),
      state: 'live'
    };
  }

  missing(now: number): RobotHandRealtimeResult {
    if (this.lastPose && now - this.lastSeenAt <= this.lossGraceMs) {
      return { pose: this.lastPose, gesture: 'HOLD', state: 'hold' };
    }
    return { pose: null, gesture: 'REST', state: 'rest' };
  }

  reset(): void {
    this.filter.reset();
    this.gestures.reset();
    this.lastPose = null;
    this.lastSeenAt = -Infinity;
  }
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

export interface RobotHandMetricSnapshot {
  pipeline: { samples: number; p50: number | null; p95: number | null };
  render: { samples: number; p50: number | null; p95: number | null };
  droppedVideoFrames: number;
}

export class RobotHandMetrics {
  private pipeline: number[] = [];
  private render: number[] = [];
  private dropped = 0;

  private add(target: number[], value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    target.push(value);
    if (target.length > 360) target.splice(0, target.length - 360);
  }

  addPipeline(value: number): void { this.add(this.pipeline, value); }
  addRender(value: number): void { this.add(this.render, value); }
  addDroppedVideoFrames(value: number): void { this.dropped += Math.max(0, Math.floor(value)); }

  snapshot(): RobotHandMetricSnapshot {
    return {
      pipeline: { samples: this.pipeline.length, p50: percentile(this.pipeline, .5), p95: percentile(this.pipeline, .95) },
      render: { samples: this.render.length, p50: percentile(this.render, .5), p95: percentile(this.render, .95) },
      droppedVideoFrames: this.dropped
    };
  }

  reset(): void {
    this.pipeline = [];
    this.render = [];
    this.dropped = 0;
  }
}
