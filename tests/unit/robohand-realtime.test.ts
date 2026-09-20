import assert from 'node:assert/strict';
import test from 'node:test';
import type { HandLandmark } from '../../src/airsketch-types';
import { classifyRobotHandGesture, RobotHandGestureStabilizer } from '../../src/robohand-gestures';
import { RobotHandMetrics, RobotHandPoseFilter, RobotHandRealtimeController } from '../../src/robohand-realtime';
import { solveRobotHandPose } from '../../src/robohand-pose';
import { ROBOT_HAND_SEGMENTS } from '../../src/robohand-types';

function hand(pose: 'open' | 'fist' | 'point' | 'v' | 'pinch' | 'ok' = 'open'): HandLandmark[] {
  const points = Array.from({ length: 21 }, () => ({ x: .5, y: .72, z: 0 }));
  points[0] = { x: .5, y: .84, z: 0 };
  points[5] = { x: .40, y: .62, z: 0 };
  points[9] = { x: .49, y: .58, z: 0 };
  points[13] = { x: .57, y: .62, z: 0 };
  points[17] = { x: .66, y: .66, z: 0 };
  const specs = [[6, 8, .40], [10, 12, .49], [14, 16, .57], [18, 20, .66]] as const;
  for (const [pip, tip, x] of specs) {
    points[pip] = { x, y: .49, z: 0 };
    const extended = pose === 'open' || pose === 'ok' || (pose === 'pinch' && tip === 8) ||
      (pose === 'point' && tip === 8) || (pose === 'v' && (tip === 8 || tip === 12));
    points[tip] = { x, y: extended ? .22 : .75, z: 0 };
  }
  points[1] = { x: .42, y: .70, z: 0 };
  points[2] = { x: .34, y: .61, z: 0 };
  points[3] = { x: .28, y: .51, z: 0 };
  points[4] = pose === 'pinch' || pose === 'ok'
    ? { x: points[8].x + .008, y: points[8].y + .004, z: 0 }
    : { x: .20, y: .42, z: 0 };
  return points;
}

function world(points: HandLandmark[]): HandLandmark[] {
  return points.map((point) => ({ x: (point.x - .5) * .2, y: (point.y - .84) * .2, z: point.z * .2 }));
}

function solved(points: HandLandmark[], at: number) {
  const pose = solveRobotHandPose({
    landmarks: points,
    worldLandmarks: world(points),
    handedness: 'Right',
    handednessScore: .99,
    capturedAt: at,
    receivedAt: at + 20
  });
  assert.ok(pose);
  // These tests isolate the original direction filter. Their schematic DIP
  // positions are not an anatomical IK fixture. Full task-space filtering is
  // exercised with independent articulated fixtures in robohand-precision.test.
  return { ...pose, handTask: undefined };
}

test('adaptive pose filter suppresses stationary direction jitter while preserving fixed lengths', () => {
  const filter = new RobotHandPoseFilter();
  const raw: number[] = [];
  const stable: number[] = [];
  for (let frame = 0; frame < 30; frame++) {
    const points = hand('open');
    points[8].x += frame % 2 ? .018 : -.018;
    const pose = solved(points, frame * 16);
    raw.push(pose.directions[7].x);
    const filtered = filter.update(pose, frame * 16 + 20);
    stable.push(filtered.directions[7].x);
    for (let index = 0; index < ROBOT_HAND_SEGMENTS.length; index++) {
      const segment = ROBOT_HAND_SEGMENTS[index];
      const a = filtered.points[segment.parent];
      const b = filtered.points[segment.child];
      assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) - segment.length) < 1e-8);
    }
  }
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  assert.ok(spread(stable.slice(10)) < spread(raw.slice(10)) * .45);
});

test('adaptive pose filter follows an intentional fast finger movement', () => {
  const filter = new RobotHandPoseFilter();
  let baseline = solved(hand('open'), 0);
  for (let frame = 0; frame < 16; frame++) baseline = filter.update(solved(hand('open'), frame * 16), frame * 16 + 18);
  const movedPoints = hand('open');
  movedPoints[8].x += .18;
  const rawMoved = solved(movedPoints, 16 * 16);
  const filtered = filter.update(rawMoved, 16 * 16 + 32);
  const rawDelta = Math.abs(rawMoved.directions[7].x - baseline.directions[7].x);
  const filteredDelta = Math.abs(filtered.directions[7].x - baseline.directions[7].x);
  assert.ok(filteredDelta >= rawDelta * .65, `${filteredDelta}/${rawDelta}`);
});

test('gesture labels cover demo poses and ignore a single-frame label glitch', () => {
  assert.equal(classifyRobotHandGesture(hand('open')), 'OPEN');
  assert.equal(classifyRobotHandGesture(hand('fist')), 'FIST');
  assert.equal(classifyRobotHandGesture(hand('point')), 'POINT');
  assert.equal(classifyRobotHandGesture(hand('v')), 'V SIGN');
  assert.equal(classifyRobotHandGesture(hand('pinch')), 'PINCH');
  assert.equal(classifyRobotHandGesture(hand('ok')), 'OK');
  const stable = new RobotHandGestureStabilizer();
  assert.equal(stable.update('OPEN'), 'FREE POSE');
  assert.equal(stable.update('OPEN'), 'OPEN');
  assert.equal(stable.update('FIST'), 'OPEN');
  assert.equal(stable.update('OPEN'), 'OPEN');
});

test('realtime controller holds a short tracking miss and releases after 220 ms', () => {
  const controller = new RobotHandRealtimeController(220);
  const points = hand('open');
  const live = controller.update(solved(points, 100), points, 120);
  assert.equal(live.state, 'live');
  assert.equal(controller.missing(339).state, 'hold');
  const released = controller.missing(341);
  assert.equal(released.state, 'rest');
  assert.equal(released.pose, null);
});

test('metrics report bounded nearest-rank p50/p95 snapshots', () => {
  const metrics = new RobotHandMetrics();
  for (let value = 1; value <= 100; value++) {
    metrics.addPipeline(value);
    metrics.addRender(value / 5);
  }
  metrics.addDroppedVideoFrames(2.9);
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.pipeline.p50, 50);
  assert.equal(snapshot.pipeline.p95, 95);
  assert.equal(snapshot.render.p95, 19);
  assert.equal(snapshot.droppedVideoFrames, 2);
});
