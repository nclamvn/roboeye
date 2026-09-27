import type { RobotFingerCurls, RobotHandPose, Vec3 } from './robohand-types';

export type SharpaHandedness = 'Left' | 'Right';
export type SharpaJointTargets = Record<string, number>;

type JointLimit = readonly [number, number];

/** Mechanical limits published in Sharpa's Wave URDF (radians). */
export const SHARPA_JOINT_LIMITS: Readonly<Record<string, JointLimit>> = {
  thumb_CMC_FE: [-0.1745, 1.9199],
  thumb_CMC_AA: [-0.3491, 0.3491],
  thumb_MCP_FE: [-0.5236, 1.3963],
  thumb_MCP_AA: [-0.3491, 0.3491],
  thumb_IP: [0, 1.7453],
  index_MCP_FE: [-0.17453293, 1.5708],
  index_MCP_AA: [-0.3491, 0.3491],
  index_PIP: [0, 1.7453],
  index_DIP: [0, 1.3963],
  middle_MCP_FE: [-0.17453293, 1.5708],
  middle_MCP_AA: [-0.3491, 0.3491],
  middle_PIP: [0, 1.7453],
  middle_DIP: [0, 1.3963],
  ring_MCP_FE: [-0.17453293, 1.5708],
  ring_MCP_AA: [-0.3491, 0.3491],
  ring_PIP: [0, 1.7453],
  ring_DIP: [0, 1.3963],
  pinky_CMC: [0, 0.2618],
  pinky_MCP_FE: [-0.17453293, 1.5708],
  pinky_MCP_AA: [-0.3491, 0.3491],
  pinky_PIP: [0, 1.7453],
  pinky_DIP: [0, 1.3963]
};

const FINGERS = [
  { name: 'index', base: 5, curl: 1, neutralYaw: .05 },
  { name: 'middle', base: 9, curl: 2, neutralYaw: 0 },
  { name: 'ring', base: 13, curl: 3, neutralYaw: -.04 },
  { name: 'pinky', base: 17, curl: 4, neutralYaw: -.11 }
] as const;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (value: Vec3) => Math.hypot(value.x, value.y, value.z);
const unit = (value: Vec3): Vec3 => {
  const magnitude = length(value);
  return magnitude > 1e-8
    ? { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude }
    : { x: 0, y: 1, z: 0 };
};
const angle = (a: Vec3, b: Vec3) => Math.acos(clamp(dot(a, b), -1, 1));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function setTarget(targets: SharpaJointTargets, side: string, joint: string, value: number): void {
  const limit = SHARPA_JOINT_LIMITS[joint];
  if (!limit || !Number.isFinite(value)) return;
  targets[`${side}_${joint}`] = clamp(value, limit[0], limit[1]);
}

function curls(pose: RobotHandPose): RobotFingerCurls {
  return pose.fingerCurls ?? [0, 0, 0, 0, 0];
}

/**
 * Converts the canonical 21-point hand into Wave's independent joint space.
 *
 * The mapping is intentionally mechanical rather than cosmetic: every result
 * is clamped to the manufacturer's URDF limit, PIP/DIP flex only forward, and
 * distal flexion follows the proximal joint when a fingertip is briefly hidden.
 */
export function computeSharpaJointTargets(
  pose: RobotHandPose,
  handedness: SharpaHandedness = pose.handedness === 'Left' ? 'Left' : 'Right'
): SharpaJointTargets {
  const targets: SharpaJointTargets = {};
  const side = handedness.toLowerCase();
  const measuredCurls = curls(pose);

  for (const finger of FINGERS) {
    const d1 = unit(sub(pose.points[finger.base + 1], pose.points[finger.base]));
    const d2 = unit(sub(pose.points[finger.base + 2], pose.points[finger.base + 1]));
    const d3 = unit(sub(pose.points[finger.base + 3], pose.points[finger.base + 2]));
    const evidence = clamp(measuredCurls[finger.curl], 0, 1);
    const closed = smoothstep(.42, .92, evidence);
    const measuredMcp = Math.atan2(-d1.z, Math.hypot(d1.x, d1.y));
    const measuredPip = angle(d1, d2);
    const measuredDip = angle(d2, d3);
    const pip = Math.max(measuredPip, closed * 1.18);
    // Human DIP normally follows PIP. This coupling keeps the mechanical hand
    // compact when the camera loses the distal landmark during a fist.
    const dip = Math.max(measuredDip, pip * (.58 + .12 * closed), closed * .76);
    const yaw = Math.atan2(d1.x, d1.y) - finger.neutralYaw;

    setTarget(targets, side, `${finger.name}_MCP_FE`, Math.max(measuredMcp, closed * .72));
    setTarget(targets, side, `${finger.name}_MCP_AA`, yaw);
    setTarget(targets, side, `${finger.name}_PIP`, pip);
    setTarget(targets, side, `${finger.name}_DIP`, dip);
    if (finger.name === 'pinky') setTarget(targets, side, 'pinky_CMC', closed * .21);
  }

  const thumb1 = unit(sub(pose.points[2], pose.points[1]));
  const thumb2 = unit(sub(pose.points[3], pose.points[2]));
  const thumb3 = unit(sub(pose.points[4], pose.points[3]));
  const thumbEvidence = clamp(measuredCurls[0], 0, 1);
  const thumbClosed = smoothstep(.32, .88, thumbEvidence);
  const thumbYaw = Math.atan2(thumb1.x, thumb1.y) - .95;
  const thumbElevation = Math.atan2(-thumb1.z, Math.hypot(thumb1.x, thumb1.y));
  const thumbMcp = angle(thumb1, thumb2);
  const thumbIp = angle(thumb2, thumb3);
  const indexContact = pose.handTask?.contacts.find(contact =>
    (contact.a === 0 && contact.b === 1) || (contact.a === 1 && contact.b === 0));
  const opposition = Math.max(thumbClosed, indexContact?.weight ?? 0);

  setTarget(targets, side, 'thumb_CMC_FE', Math.max(thumbElevation, opposition * 1.18));
  setTarget(targets, side, 'thumb_CMC_AA', thumbYaw * .55 - opposition * .08);
  setTarget(targets, side, 'thumb_MCP_FE', Math.max(thumbMcp, opposition * .82));
  setTarget(targets, side, 'thumb_MCP_AA', clamp(-thumb1.z * .38, -.24, .24));
  setTarget(targets, side, 'thumb_IP', Math.max(thumbIp, opposition * 1.02));

  return targets;
}

export function targetsWithinSharpaLimits(targets: SharpaJointTargets): boolean {
  return Object.entries(targets).every(([name, value]) => {
    const suffix = name.replace(/^(left|right)_/, '');
    const limit = SHARPA_JOINT_LIMITS[suffix];
    return Boolean(limit) && Number.isFinite(value) && value >= limit[0] - 1e-9 && value <= limit[1] + 1e-9;
  });
}
