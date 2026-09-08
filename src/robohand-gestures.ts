import type { HandLandmark } from './airsketch-types';

export type RobotHandGesture = 'OPEN' | 'FIST' | 'POINT' | 'PINCH' | 'V SIGN' | 'OK' | 'FREE POSE';

function distance(a: HandLandmark, b: HandLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function extended(points: HandLandmark[], tip: number, pip: number): boolean {
  return distance(points[tip], points[0]) > distance(points[pip], points[0]) * 1.12;
}

export function classifyRobotHandGesture(points: HandLandmark[]): RobotHandGesture {
  if (points.length !== 21) return 'FREE POSE';
  const palmSpan = Math.max(.001, distance(points[5], points[17]));
  const pinch = distance(points[4], points[8]) / palmSpan < .34;
  const fingers = [
    extended(points, 8, 6),
    extended(points, 12, 10),
    extended(points, 16, 14),
    extended(points, 20, 18)
  ];
  const count = fingers.filter(Boolean).length;
  if (pinch && fingers[1] && fingers[2] && fingers[3]) return 'OK';
  if (pinch) return 'PINCH';
  if (fingers[0] && fingers[1] && !fingers[2] && !fingers[3]) return 'V SIGN';
  if (fingers[0] && !fingers[1] && !fingers[2] && !fingers[3]) return 'POINT';
  if (count >= 4) return 'OPEN';
  if (count === 0) return 'FIST';
  return 'FREE POSE';
}

export class RobotHandGestureStabilizer {
  private stable: RobotHandGesture = 'FREE POSE';
  private candidate: RobotHandGesture = 'FREE POSE';
  private samples = 0;

  update(next: RobotHandGesture): RobotHandGesture {
    if (next === this.stable) {
      this.candidate = next;
      this.samples = 0;
      return this.stable;
    }
    if (next !== this.candidate) {
      this.candidate = next;
      this.samples = 1;
    } else {
      this.samples++;
    }
    if (this.samples >= 2) {
      this.stable = next;
      this.samples = 0;
    }
    return this.stable;
  }

  reset(): void {
    this.stable = 'FREE POSE';
    this.candidate = 'FREE POSE';
    this.samples = 0;
  }
}

