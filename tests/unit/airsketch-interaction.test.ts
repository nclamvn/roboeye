import assert from 'node:assert/strict';
import test from 'node:test';
import { AirInteractionController } from '../../src/airsketch-interaction';
import { AirInkDocument } from '../../src/airsketch-ink';
import { AirSketchScene } from '../../src/airsketch-scene';
import type { AirStroke, HandLandmark } from '../../src/airsketch-types';

function hand(x: number, pose: 'index' | 'open' | 'pinch' | 'fist'): HandLandmark[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.7, z: 0 }));
  points[0] = { x: 0.5, y: 0.82, z: 0 };
  points[5] = { x: 0.42, y: 0.62, z: 0 };
  points[17] = { x: 0.62, y: 0.63, z: 0 };
  for (const [pip, tip, fx] of [[6, 8, x], [10, 12, 0.49], [14, 16, 0.56], [18, 20, 0.63]] as const) {
    points[pip] = { x: fx, y: 0.49, z: 0 };
    points[tip] = { x: fx, y: pose === 'open' ? 0.25 : 0.72, z: 0 };
  }
  if (pose === 'index' || pose === 'pinch') points[8] = { x, y: 0.25, z: 0 };
  points[4] = pose === 'pinch' ? { x: x + 0.01, y: 0.255, z: 0 }
    : pose === 'fist' ? { x: 0.1, y: 0.7, z: 0 }
      : { x: 0.28, y: 0.52, z: 0 };
  return points;
}

function setPinchRatio(points: HandLandmark[], ratio: number): HandLandmark[] {
  const palmSpan = Math.hypot(points[5].x - points[17].x, points[5].y - points[17].y);
  points[4] = { x: points[8].x + palmSpan * ratio, y: points[8].y, z: 0 };
  return points;
}

test('double flick arm, index draw, open palm manipulate, pinch grab', () => {
  const controller = new AirInteractionController();
  controller.update(hand(0.3, 'index'), 0);
  controller.update(hand(0.18, 'index'), 100);
  const armed = controller.update(hand(0.3, 'index'), 260);
  assert.equal(armed?.justArmed, true);
  assert.equal(armed?.mode, 'armed');
  const drawing = controller.update(hand(0.31, 'index'), 300);
  assert.equal(drawing?.penDown, true);
  assert.equal(drawing?.mode, 'drawing');
  const manipulating = controller.update(hand(0.31, 'open'), 340);
  assert.equal(manipulating?.mode, 'manipulating');
  const grabbing = controller.update(hand(0.31, 'pinch'), 380);
  assert.equal(grabbing?.justGrabbed, true);
  assert.equal(grabbing?.mode, 'grabbing');
  const released = controller.update(hand(0.31, 'open'), 420);
  assert.equal(released?.justReleased, true);
  assert.equal(released?.mode, 'manipulating');
});

test('từ nắm tay/idle vẫn xòe tay để cầm rồi đặt object đã vẽ', () => {
  const controller = new AirInteractionController();
  const idle = controller.update(hand(0.31, 'fist'), 0);
  const manipulating = controller.update(hand(0.31, 'open'), 40);
  const grabbing = controller.update(hand(0.31, 'pinch'), 80);
  const placed = controller.update(hand(0.31, 'open'), 120);
  assert.equal(idle?.mode, 'idle');
  assert.equal(manipulating?.mode, 'manipulating');
  assert.equal(manipulating?.penDown, false);
  assert.equal(grabbing?.justGrabbed, true);
  assert.equal(grabbing?.mode, 'grabbing');
  assert.equal(placed?.justReleased, true);
  assert.equal(placed?.mode, 'manipulating');
});

test('tích lũy chuyển động giữa các frame 24 fps để không bỏ lỡ flick thật', () => {
  const controller = new AirInteractionController();
  controller.update(hand(0.30, 'index'), 0);
  controller.update(hand(0.27, 'index'), 42);
  controller.update(hand(0.24, 'index'), 84);
  controller.update(hand(0.21, 'index'), 126);
  controller.update(hand(0.24, 'index'), 168);
  controller.update(hand(0.27, 'index'), 210);
  const armed = controller.update(hand(0.30, 'index'), 252);
  assert.equal(armed?.justArmed, true);
});

test('nắm tay hạ bút, hủy pinch và bắt buộc double-flick trước nét mới', () => {
  const controller = new AirInteractionController();
  const pinchIdle = controller.update(hand(0.30, 'pinch'), 0);
  assert.equal(pinchIdle?.penDown, false, 'pinch không còn tự bật bút');
  controller.update(hand(0.30, 'index'), 100);
  controller.update(hand(0.18, 'index'), 200);
  controller.update(hand(0.30, 'index'), 360);
  const drawing = controller.update(hand(0.31, 'index'), 400);
  assert.equal(drawing?.penDown, true);
  const fist = controller.update(hand(0.31, 'fist'), 440);
  assert.equal(fist?.fist, true);
  assert.equal(fist?.penDown, false);
  assert.equal(fist?.mode, 'idle');
  const pointAgain = controller.update(hand(0.31, 'index'), 480);
  assert.equal(pointAgain?.penDown, false, 'giơ trỏ lại chưa được vẽ nếu chưa flick');
});

test('pinch hysteresis giữ nét ổn định và adaptive filter triệt jitter mà vẫn bám chuyển động nhanh', () => {
  const controller = new AirInteractionController();
  controller.update(hand(0.30, 'index'), 0);
  controller.update(hand(0.18, 'index'), 100);
  controller.update(hand(0.30, 'index'), 260);
  controller.update(hand(0.30, 'index'), 300);
  controller.update(hand(0.30, 'open'), 340);
  const started = controller.update(hand(0.30, 'pinch'), 380);
  const heldNearThreshold = controller.update(setPinchRatio(hand(0.31, 'pinch'), 0.45), 420);
  const released = controller.update(setPinchRatio(hand(0.31, 'pinch'), 0.56), 460);
  assert.equal(started?.mode, 'grabbing');
  assert.equal(heldNearThreshold?.mode, 'grabbing');
  assert.equal(released?.mode, 'manipulating');
  assert.equal(released?.justReleased, true);

  controller.reset();
  const first = controller.update(hand(0.30, 'index'), 0)!;
  const jitter = controller.update(hand(0.31, 'index'), 40)!;
  const rapid = controller.update(hand(0.55, 'index'), 80)!;
  assert.ok(Math.abs(jitter.cursor.x - first.cursor.x) < 0.006, 'lọc giảm rung 0,01 đơn vị');
  assert.ok(Math.abs(rapid.cursor.x - jitter.cursor.x) > 0.12, 'vẫn bám thao tác nhanh');
});

test('có thể vẽ và đặt nhiều object liên tiếp, mỗi lần phải qua nắm tay rồi arm lại', () => {
  const controller = new AirInteractionController();
  const ink = new AirInkDocument();
  const feed = (x: number, pose: 'index' | 'fist', at: number) => {
    const sample = controller.update(hand(x, pose), at)!;
    if (sample.penDown) {
      if (!ink.isDrawing()) ink.begin(sample.cursor);
      else ink.move(sample.cursor);
    } else ink.end();
    return sample;
  };
  const drawRound = (start: number, x: number) => {
    feed(x, 'fist', start);
    feed(x, 'index', start + 40);
    feed(x - 0.12, 'index', start + 140);
    feed(x, 'index', start + 300);
    feed(x + 0.02, 'index', start + 340);
    feed(x + 0.10, 'index', start + 380);
    return feed(x + 0.10, 'fist', start + 420);
  };
  assert.equal(drawRound(0, 0.30).mode, 'idle');
  assert.equal(drawRound(600, 0.45).mode, 'idle');
  assert.equal(ink.strokeCount(), 2);
  assert.ok(ink.pointCount() >= 4);
});

test('scene hit-test, move and depth scale preserve the completed stroke', () => {
  const scene = new AirSketchScene();
  const stroke: AirStroke = { points: [
    { x: 0.2, y: 0.2, t: 0 },
    { x: 0.4, y: 0.5, t: 1 }
  ] };
  const object = scene.addStroke(stroke)!;
  assert.ok(object);
  assert.equal(scene.hitTest({ x: 0.3, y: 0.35 })?.id, object.id);
  assert.equal(scene.beginGrab({ x: 0.3, y: 0.35 }, 0.2)?.id, object.id);
  scene.moveGrab({ x: 0.7, y: 0.65 }, 0.4);
  const moved = scene.snapshot()[0];
  assert.ok(moved.x > 0.6 && moved.y > 0.5);
  assert.ok(moved.scale > 1.9 && moved.scale < 2.1);
  scene.release();
});

test('scene có pickup halo cho hình nhỏ nhưng vẫn giới hạn', () => {
  const scene = new AirSketchScene();
  scene.addStroke({ points: [
    { x: 0.50, y: 0.50, t: 0 },
    { x: 0.51, y: 0.51, t: 1 }
  ] });
  assert.ok(scene.hitTest({ x: 0.54, y: 0.505 }), 'bắt được hình nhỏ trong halo');
  assert.equal(scene.hitTest({ x: 0.60, y: 0.505 }), null, 'không mở rộng hit area vô hạn');
});
