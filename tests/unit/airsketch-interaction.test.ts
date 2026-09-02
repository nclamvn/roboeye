import assert from 'node:assert/strict';
import test from 'node:test';
import { AIRSKETCH_CONFIG } from '../../src/airsketch-config';
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

function openPinchHand(x: number): HandLandmark[] {
  const points = hand(x, 'open');
  points[4] = { x: x + 0.01, y: 0.255, z: 0 };
  return points;
}

test('static clutch: pinch draws, open palm held enters manipulation, pinch grabs', () => {
  const controller = new AirInteractionController();
  const hover = controller.update(hand(0.3, 'index'), 0);
  assert.equal(hover?.penDown, false);
  const drawing = controller.update(hand(0.31, 'pinch'), 40);
  assert.equal(drawing?.penDown, true);
  assert.equal(drawing?.mode, 'drawing');
  const waiting = controller.update(hand(0.31, 'open'), 80);
  assert.equal(waiting?.mode, 'idle');
  assert.equal(waiting?.penDown, false);
  assert.equal(waiting?.manipulationProgress, 0);
  const manipulating = controller.update(hand(0.31, 'open'), 430);
  assert.equal(manipulating?.mode, 'manipulating');
  const grabbing = controller.update(hand(0.31, 'pinch'), 470);
  assert.equal(grabbing?.justGrabbed, true);
  assert.equal(grabbing?.mode, 'grabbing');
  const released = controller.update(hand(0.31, 'index'), 510);
  assert.equal(released?.justReleased, true);
  assert.equal(released?.mode, 'manipulating');
});

test('từ nắm tay/idle vẫn xòe tay để cầm rồi đặt object đã vẽ', () => {
  const controller = new AirInteractionController();
  const idle = controller.update(hand(0.31, 'fist'), 0);
  const waiting = controller.update(hand(0.31, 'open'), 40);
  const manipulating = controller.update(hand(0.31, 'open'), 390);
  const grabbing = controller.update(hand(0.31, 'pinch'), 430);
  const placed = controller.update(hand(0.31, 'index'), 470);
  assert.equal(idle?.mode, 'idle');
  assert.equal(waiting?.mode, 'idle');
  assert.equal(manipulating?.mode, 'manipulating');
  assert.equal(manipulating?.penDown, false);
  assert.equal(grabbing?.justGrabbed, true);
  assert.equal(grabbing?.mode, 'grabbing');
  assert.equal(placed?.justReleased, true);
  assert.equal(placed?.mode, 'manipulating');
});

test('pinch giữ nguyên điểm điều khiển ở đầu ngón trỏ và nắm được khi bàn tay vẫn mở', () => {
  const controller = new AirInteractionController();
  const hover = controller.update(hand(0.34, 'index'), 0)!;
  const draw = controller.update(hand(0.34, 'pinch'), 40)!;
  assert.ok(Math.abs(hover.cursor.x - draw.cursor.x) < 0.001, 'pinch không làm bút nhảy sang ngón cái');
  controller.reset();
  controller.update(hand(0.34, 'open'), 0);
  const ready = controller.update(hand(0.34, 'open'), 350)!;
  const grabbing = controller.update(openPinchHand(0.34), 390)!;
  assert.equal(ready.mode, 'manipulating');
  assert.equal(grabbing.mode, 'grabbing');
  assert.equal(grabbing.justGrabbed, true, 'chụm hai ngón vẫn cầm được khi các ngón còn lại mở');
});

test('đang vẽ chỉ nhấc bút khi nhả pinch, không đứt nét vì pose các ngón khác chớp sai', () => {
  const controller = new AirInteractionController();
  const started = controller.update(hand(0.34, 'pinch'), 0)!;
  // MediaPipe can transiently classify the three folded fingers as extended
  // while thumb and index remain physically pinched.
  const noisyOpenPinch = controller.update(openPinchHand(0.35), 40)!;
  const continued = controller.update(hand(0.38, 'pinch'), 80)!;
  const released = controller.update(hand(0.38, 'index'), 120)!;
  assert.equal(started.mode, 'drawing');
  assert.equal(noisyOpenPinch.mode, 'drawing');
  assert.equal(noisyOpenPinch.penDown, true);
  assert.equal(continued.mode, 'drawing');
  assert.equal(released.mode, 'idle');
  assert.equal(released.penDown, false);
});

test('mất landmark ngắn được giữ nhưng mất quá cửa sổ liên tục thì nhả an toàn', () => {
  const controller = new AirInteractionController();
  controller.update(hand(0.34, 'pinch'), 1_000);
  assert.equal(controller.shouldReleaseAfterMissing(1_180), false);
  assert.equal(controller.shouldReleaseAfterMissing(1_240), true);
});

test('open-palm dwell resets when the hand changes pose', () => {
  const controller = new AirInteractionController();
  controller.update(hand(0.30, 'open'), 0);
  const interrupted = controller.update(hand(0.30, 'index'), 200);
  const restarted = controller.update(hand(0.30, 'open'), 260);
  const ready = controller.update(hand(0.30, 'open'), 610);
  assert.equal(interrupted?.manipulationProgress, 0);
  assert.equal(restarted?.manipulationProgress, 0);
  assert.equal(ready?.mode, 'manipulating');
});

test('nắm tay hạ bút; index hover không vẽ, pinch mới bắt đầu nét mới', () => {
  const controller = new AirInteractionController();
  const pinchIdle = controller.update(hand(0.30, 'pinch'), 0);
  assert.equal(pinchIdle?.penDown, true, 'pinch là clutch duy nhất để bật bút');
  const drawing = controller.update(hand(0.31, 'pinch'), 100);
  assert.equal(drawing?.penDown, true);
  const fist = controller.update(hand(0.31, 'fist'), 140);
  assert.equal(fist?.fist, true);
  assert.equal(fist?.penDown, false);
  assert.equal(fist?.mode, 'idle');
  const pointAgain = controller.update(hand(0.31, 'index'), 180);
  assert.equal(pointAgain?.penDown, false, 'giơ trỏ chỉ định vị, không tự vẽ');
  const drawAgain = controller.update(hand(0.31, 'pinch'), 220);
  assert.equal(drawAgain?.penDown, true, 'chụm lại bắt đầu nét mới');
});

test('pinch hysteresis giữ nét ổn định và adaptive filter triệt jitter mà vẫn bám chuyển động nhanh', () => {
  const controller = new AirInteractionController();
  controller.update(hand(0.30, 'open'), 0);
  controller.update(hand(0.30, 'open'), 350);
  const started = controller.update(hand(0.30, 'pinch'), 390);
  const heldNearThreshold = controller.update(setPinchRatio(hand(0.31, 'pinch'), 0.45), 430);
  const released = controller.update(setPinchRatio(hand(0.31, 'pinch'), 0.56), 470);
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

test('bù timestamp worker làm con trỏ đuổi kịp khung hình trễ nhưng không vượt biên', () => {
  const controller = new AirInteractionController();
  const first = controller.update(hand(0.30, 'index'), 0, 0)!;
  const delayed = controller.update(hand(0.40, 'index'), 40, 95)!;
  // Camera mirror means moving hand x=0.30 → 0.40 moves cursor 0.70 → 0.60.
  // The stable 1€ point intentionally trails the raw 0.60 sample. Prediction
  // must move the visible point ahead of that stable control anchor in the
  // same direction, while remaining bounded and inside the stage.
  assert.ok(delayed.cursor.x < delayed.grabCursor.x, `cursor=${delayed.cursor.x}, stable=${delayed.grabCursor.x}`);
  assert.ok(delayed.grabCursor.x - delayed.cursor.x <= AIRSKETCH_CONFIG.tracking.cursorMaxPrediction + 0.000001);
  assert.ok(delayed.cursor.x >= 0 && delayed.cursor.x <= 1);
  assert.equal(first.cursor.t, 0);
  assert.equal(delayed.cursor.t, 95, 'render timestamp is the worker reply time');
});

test('có thể vẽ và đặt nhiều object liên tiếp bằng clutch, không cần double-flick', () => {
  const controller = new AirInteractionController();
  const ink = new AirInkDocument();
  const feed = (x: number, pose: 'index' | 'pinch' | 'fist', at: number) => {
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
    feed(x, 'pinch', start + 80);
    feed(x + 0.04, 'pinch', start + 120);
    feed(x + 0.10, 'pinch', start + 160);
    return feed(x + 0.10, 'index', start + 200);
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
  assert.equal(scene.beginGrab({ x: 0.3, y: 0.35 }, { x: 0.27, y: 0.33 }, 0.2)?.id, object.id);
  // The next stable movement sample is the same anchor; selection by the
  // visible predicted cursor must not make the object teleport backwards.
  scene.moveGrab({ x: 0.27, y: 0.33 }, 0.2);
  const anchored = scene.snapshot()[0];
  assert.ok(Math.abs(anchored.x - object.x) < 0.0001 && Math.abs(anchored.y - object.y) < 0.0001);
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

test('pinch bắt đầu trên object được nâng trực tiếp thành grab rồi trả về idle', () => {
  const controller = new AirInteractionController();
  const pinch = controller.update(hand(0.34, 'pinch'), 0)!;
  assert.equal(pinch.mode, 'drawing');
  assert.equal(pinch.justPinched, true);
  assert.equal(controller.promotePinchToGrab(), true);
  assert.equal(controller.currentMode(), 'grabbing');
  const placed = controller.update(hand(0.34, 'index'), 40)!;
  assert.equal(placed.justReleased, true);
  assert.equal(placed.mode, 'idle');
});
