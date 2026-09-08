import type { HandLandmark } from './airsketch-types';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type RobotHandedness = 'Left' | 'Right' | 'Unknown';

export interface RobotHandSegment {
  parent: number;
  child: number;
  finger: 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
  section: 0 | 1 | 2 | 3;
  length: number;
}

export interface RobotHandPose {
  /** Fixed-length hand-local landmark positions, wrist is always the origin. */
  points: Vec3[];
  /** Unit hand-local direction for every entry in ROBOT_HAND_SEGMENTS. */
  directions: Vec3[];
  rootPosition: Vec3;
  rootOrientation: Quaternion;
  rootScale: number;
  handedness: RobotHandedness;
  handednessScore: number;
  capturedAt: number;
  receivedAt: number;
}

export interface RobotHandFrame {
  landmarks: HandLandmark[];
  worldLandmarks: HandLandmark[];
  handedness?: string | null;
  handednessScore?: number;
  capturedAt: number;
  receivedAt?: number;
}

export const ROBOT_HAND_SEGMENTS: readonly RobotHandSegment[] = [
  { parent: 0, child: 1, finger: 'thumb', section: 0, length: 0.38 },
  { parent: 1, child: 2, finger: 'thumb', section: 1, length: 0.32 },
  { parent: 2, child: 3, finger: 'thumb', section: 2, length: 0.26 },
  { parent: 3, child: 4, finger: 'thumb', section: 3, length: 0.22 },
  { parent: 0, child: 5, finger: 'index', section: 0, length: 0.72 },
  { parent: 5, child: 6, finger: 'index', section: 1, length: 0.46 },
  { parent: 6, child: 7, finger: 'index', section: 2, length: 0.29 },
  { parent: 7, child: 8, finger: 'index', section: 3, length: 0.22 },
  { parent: 0, child: 9, finger: 'middle', section: 0, length: 0.78 },
  { parent: 9, child: 10, finger: 'middle', section: 1, length: 0.50 },
  { parent: 10, child: 11, finger: 'middle', section: 2, length: 0.32 },
  { parent: 11, child: 12, finger: 'middle', section: 3, length: 0.24 },
  { parent: 0, child: 13, finger: 'ring', section: 0, length: 0.73 },
  { parent: 13, child: 14, finger: 'ring', section: 1, length: 0.46 },
  { parent: 14, child: 15, finger: 'ring', section: 2, length: 0.30 },
  { parent: 15, child: 16, finger: 'ring', section: 3, length: 0.23 },
  { parent: 0, child: 17, finger: 'pinky', section: 0, length: 0.63 },
  { parent: 17, child: 18, finger: 'pinky', section: 1, length: 0.36 },
  { parent: 18, child: 19, finger: 'pinky', section: 2, length: 0.24 },
  { parent: 19, child: 20, finger: 'pinky', section: 3, length: 0.19 }
] as const;

