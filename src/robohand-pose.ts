import type { HandLandmark } from './airsketch-types';
import { createHandTask } from './robohand-retarget';
import {
  ROBOT_HAND_SEGMENTS,
  ROBOT_PALM_DIRECTIONS,
  type Quaternion,
  type RobotHandFrame,
  type RobotHandPose,
  type RobotHandedness,
  type Vec3
} from './robohand-types';

const EPSILON = 1e-6;

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Vec3, amount: number): Vec3 {
  return { x: a.x * amount, y: a.y * amount, z: a.z * amount };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: Vec3): Vec3 | null {
  const magnitude = length(a);
  return Number.isFinite(magnitude) && magnitude > EPSILON ? scale(a, 1 / magnitude) : null;
}

function finiteLandmarks(points: HandLandmark[] | null | undefined): points is HandLandmark[] {
  return points?.length === 21 && points.every((point) =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
}

function quaternionFromBasis(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quaternion {
  // Matrix columns are the hand-local axes expressed in camera world space.
  const m00 = xAxis.x, m01 = yAxis.x, m02 = zAxis.x;
  const m10 = xAxis.y, m11 = yAxis.y, m12 = zAxis.y;
  const m20 = xAxis.z, m21 = yAxis.z, m22 = zAxis.z;
  const trace = m00 + m11 + m22;
  let x = 0, y = 0, z = 0, w = 1;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const magnitude = Math.hypot(x, y, z, w) || 1;
  return { x: x / magnitude, y: y / magnitude, z: z / magnitude, w: w / magnitude };
}

function canonicalHandedness(value: string | null | undefined): RobotHandedness {
  const normalized = value?.toLowerCase();
  if (normalized === 'left') return 'Left';
  if (normalized === 'right') return 'Right';
  return 'Unknown';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Convert one MediaPipe result into a fixed-proportion robot-hand pose.
 *
 * The x axis always runs anatomically from pinky MCP to index MCP. This makes
 * the thumb side canonical for both left and right hands. The y axis follows
 * wrist to middle MCP; z completes a right-handed palm basis.
 */
export function solveRobotHandPose(frame: RobotHandFrame): RobotHandPose | null {
  if (!finiteLandmarks(frame.landmarks) || !finiteLandmarks(frame.worldLandmarks)) return null;
  // MediaPipe camera coordinates use +y downward. The RGB plane is also
  // mirrored for selfie interaction, so convert to Three's +y-up display
  // space before deriving the palm basis.
  const world = frame.worldLandmarks.map((point) => ({ x: -point.x, y: -point.y, z: point.z }));
  const xAxis = normalize(sub(world[5], world[17]));
  const palmForward = sub(world[9], world[0]);
  if (!xAxis) return null;
  const yAxis = normalize(sub(palmForward, scale(xAxis, dot(palmForward, xAxis))));
  if (!yAxis) return null;
  const zAxis = normalize(cross(xAxis, yAxis));
  if (!zAxis) return null;

  const projectDirection = (parent: number, child: number): Vec3 | null => {
    const direction = normalize(sub(world[child], world[parent]));
    if (!direction) return null;
    return normalize({
      x: dot(direction, xAxis),
      y: dot(direction, yAxis),
      z: dot(direction, zAxis)
    });
  };

  const directions: Vec3[] = [];
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const segment of ROBOT_HAND_SEGMENTS) {
    // A rigid robot palm cannot change its finger sockets with the user's
    // palm proportions, cupping or landmark noise. Retarget only articulation.
    const direction = segment.section === 0
      ? normalize(ROBOT_PALM_DIRECTIONS[segment.finger])
      : projectDirection(segment.parent, segment.child);
    if (!direction) return null;
    directions.push(direction);
    points[segment.child] = add(points[segment.parent], scale(direction, segment.length));
  }

  // Weak-perspective fit across both palm axes. A foreshortened axis contributes
  // little weight, so turning edge-on does not masquerade as moving farther away.
  const aspect = frame.imageAspectRatio && Number.isFinite(frame.imageAspectRatio) && frame.imageAspectRatio > 0
    ? frame.imageAspectRatio : 1;
  const palmWidth3D = length(sub(world[5], world[17]));
  let numerator = 0, denominator = 0;
  for (const [a, b] of [[5, 17], [0, 9], [0, 5], [0, 17]]) {
    const delta = sub(world[b], world[a]);
    const expected = Math.hypot(delta.x, delta.y) / palmWidth3D * .18;
    const observed = Math.hypot(frame.landmarks[b].x - frame.landmarks[a].x,
      (frame.landmarks[b].y - frame.landmarks[a].y) / aspect);
    numerator += expected * observed;
    denominator += expected * expected;
  }
  if (denominator < EPSILON) return null;
  const rootScale = clamp(numerator / denominator, 0.68, 1.55);
  const wrist = frame.landmarks[0];
  const receivedAt = frame.receivedAt ?? frame.capturedAt;
  return {
    handTask: createHandTask(world.map(p => {
      const v = sub(p, world[0]);
      return { x: dot(v,xAxis), y: dot(v,yAxis), z: dot(v,zAxis) };
    }), points),
    points,
    directions,
    rootPosition: {
      x: clamp((0.5 - wrist.x) * 3.2, -1.25, 1.25),
      y: clamp((0.58 - wrist.y) * 2.2, -0.9, 0.9),
      z: clamp(-wrist.z * 2.2, -0.45, 0.45)
    },
    rootOrientation: quaternionFromBasis(xAxis, yAxis, zAxis),
    rootScale,
    handedness: canonicalHandedness(frame.handedness),
    handednessScore: clamp(frame.handednessScore ?? 0, 0, 1),
    capturedAt: frame.capturedAt,
    receivedAt
  };
}
