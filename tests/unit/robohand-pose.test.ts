import assert from 'node:assert/strict';
import test from 'node:test';
import type { HandLandmark } from '../../src/airsketch-types';
import { solveRobotHandPose } from '../../src/robohand-pose';
import { ROBOT_HAND_SEGMENTS, ROBOT_PALM_DIRECTIONS } from '../../src/robohand-types';

function openHand(mirror = false, scale = 1): HandLandmark[] {
  const raw: Array<[number, number, number]> = [
    [0, 0, 0],
    [0.28, 0.16, 0], [0.48, 0.35, 0], [0.65, 0.55, 0], [0.78, 0.72, 0],
    [0.32, 0.48, 0], [0.36, 0.86, 0], [0.38, 1.18, 0], [0.39, 1.46, 0],
    [0, 0.56, 0], [0, 1.02, 0], [0, 1.38, 0], [0, 1.68, 0],
    [-0.28, 0.49, 0], [-0.32, 0.91, 0], [-0.34, 1.24, 0], [-0.35, 1.51, 0],
    [-0.52, 0.36, 0], [-0.58, 0.70, 0], [-0.61, 0.96, 0], [-0.63, 1.17, 0]
  ];
  return raw.map(([x, y, z]) => ({ x: (mirror ? -x : x) * scale, y: y * scale, z: z * scale }));
}

function imageLandmarks(world: HandLandmark[], imageScale = 1): HandLandmark[] {
  return world.map((point) => ({
    x: 0.5 + point.x * 0.16 * imageScale,
    y: 0.82 - point.y * 0.16 * imageScale,
    z: point.z * 0.16 * imageScale
  }));
}

function solve(world: HandLandmark[], handedness: string, imageScale = 1) {
  return solveRobotHandPose({
    landmarks: imageLandmarks(world, imageScale),
    worldLandmarks: world,
    handedness,
    handednessScore: 0.98,
    capturedAt: 100,
    receivedAt: 140
  });
}

test('pose solver emits one finite fixed-length link for every MediaPipe hand segment', () => {
  const pose = solve(openHand(), 'Right');
  assert.ok(pose);
  assert.equal(pose.points.length, 21);
  assert.equal(pose.directions.length, 20);
  for (let index = 0; index < ROBOT_HAND_SEGMENTS.length; index++) {
    const segment = ROBOT_HAND_SEGMENTS[index];
    const parent = pose.points[segment.parent];
    const child = pose.points[segment.child];
    const actual = Math.hypot(child.x - parent.x, child.y - parent.y, child.z - parent.z);
    assert.ok(Math.abs(actual - segment.length) < 1e-9);
    assert.ok(Object.values(pose.directions[index]).every(Number.isFinite));
  }
  assert.equal(pose.handedness, 'Right');
  assert.equal(pose.capturedAt, 100);
  assert.equal(pose.receivedAt, 140);
});

test('source world scale cannot stretch the fixed robot skeleton', () => {
  const small = solve(openHand(false, 0.4), 'Right');
  const large = solve(openHand(false, 4), 'Right');
  assert.ok(small && large);
  for (let index = 0; index < small.points.length; index++) {
    assert.ok(Math.abs(small.points[index].x - large.points[index].x) < 1e-9);
    assert.ok(Math.abs(small.points[index].y - large.points[index].y) < 1e-9);
    assert.ok(Math.abs(small.points[index].z - large.points[index].z) < 1e-9);
  }
});

test('mirrored hands preserve canonical articulation and report handedness', () => {
  const right = solve(openHand(), 'Right');
  const left = solve(openHand(true), 'Left');
  assert.ok(right && left);
  assert.equal(left.handedness, 'Left');
  for (let index = 0; index < right.points.length; index++) {
    assert.ok(Math.abs(right.points[index].x - left.points[index].x) < 1e-9);
    assert.ok(Math.abs(right.points[index].y - left.points[index].y) < 1e-9);
    assert.ok(Math.abs(right.points[index].z - left.points[index].z) < 1e-9);
  }
});

test('solver rejects incomplete and degenerate palms without leaking NaN', () => {
  const world = openHand();
  assert.equal(solveRobotHandPose({
    landmarks: imageLandmarks(world).slice(0, 20), worldLandmarks: world,
    capturedAt: 0
  }), null);
  assert.equal(solve(Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })), 'Right'), null);
});

test('robot finger sockets remain registered to the palm across source proportions and cupping', () => {
  for (const width of [.55, 1, 1.6]) {
    const world = openHand().map(p => ({ ...p, x: p.x * width, z: Math.abs(p.x) * .18 }));
    const pose = solve(world, 'Right');
    assert.ok(pose);
    for (const segment of ROBOT_HAND_SEGMENTS.filter(s => s.section === 0)) {
      const d = ROBOT_PALM_DIRECTIONS[segment.finger];
      const norm = Math.hypot(d.x, d.y, d.z);
      const actual = pose.points[segment.child];
      assert.ok(Math.hypot(actual.x - d.x / norm * segment.length,
        actual.y - d.y / norm * segment.length, actual.z - d.z / norm * segment.length) < 1e-9);
    }
  }
});

test('depth scale compensates yaw/pitch foreshortening at both square and widescreen aspect ratios', () => {
  const scales: number[] = [];
  for (const aspect of [1, 16 / 9]) for (const yaw of [0, .5, 1, 1.48]) for (const pitch of [0, .6, 1]) {
    const world = openHand().map(p => {
      const x = p.x * Math.cos(yaw), z = -p.x * Math.sin(yaw);
      return { x, y: p.y * Math.cos(pitch) - z * Math.sin(pitch), z: p.y * Math.sin(pitch) + z * Math.cos(pitch) };
    });
    const landmarks = imageLandmarks(world, 1.4).map(p => ({ ...p, y: .82 + (p.y - .82) * aspect }));
    const pose = solveRobotHandPose({ landmarks, worldLandmarks: world, imageAspectRatio: aspect, capturedAt: 0 });
    assert.ok(pose);
    scales.push(pose.rootScale);
  }
  assert.ok(Math.max(...scales) - Math.min(...scales) < 1e-8, JSON.stringify(scales));
  const far = solve(openHand(), 'Right', 1.2), near = solve(openHand(), 'Right', 1.8);
  assert.ok(far && near);
  assert.ok(Math.abs(near.rootScale / far.rootScale - 1.5) < 1e-8, 'actual approach must still enlarge the robot');
});
