import assert from 'node:assert/strict';
import test from 'node:test';
import { AirGestureController, AirInkDocument } from '../../src/airsketch-ink';
import { AirSketchMetrics } from '../../src/airsketch-metrics';
import type { HandLandmark } from '../../src/airsketch-types';

function hand(pose: 'pinch' | 'hover' | 'two' | 'open'): HandLandmark[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.7, z: 0 }));
  points[0] = { x: 0.5, y: 0.82, z: 0 };
  points[5] = { x: 0.42, y: 0.62, z: 0 };
  points[17] = { x: 0.62, y: 0.63, z: 0 };
  for (const [pip, tip, x] of [[6, 8, 0.42], [10, 12, 0.49], [14, 16, 0.56], [18, 20, 0.63]] as const) {
    points[pip] = { x, y: 0.49, z: 0 };
    points[tip] = { x, y: 0.72, z: 0 };
  }
  const extended = pose === 'open' ? [8, 12, 16, 20] : pose === 'two' ? [8, 12] : [8];
  for (const tip of extended) points[tip] = { ...points[tip], y: 0.25 };
  points[4] = pose === 'pinch' ? { x: 0.425, y: 0.255, z: 0 } : { x: 0.28, y: 0.52, z: 0 };
  return points;
}

test('pinch dùng hysteresis để hạ/nhấc bút và mirror con trỏ', () => {
  const controller = new AirGestureController();
  const down = controller.update(hand('pinch'), 100)!;
  assert.equal(down.penDown, true);
  assert.equal(down.gesture, 'draw');
  assert.ok(down.cursor.x > 0.5, 'raw x=0.42 phải mirror sang bên phải');
  const up = controller.update(hand('hover'), 120)!;
  assert.equal(up.penDown, false);
  assert.equal(up.gesture, 'hover');
});

test('giữ hai ngón chỉ undo một lần, bàn tay mở giữ lâu mới clear', () => {
  const controller = new AirGestureController();
  assert.equal(controller.update(hand('two'), 0)!.command, null);
  assert.equal(controller.update(hand('two'), 649)!.command, null);
  assert.equal(controller.update(hand('two'), 650)!.command, 'undo');
  assert.equal(controller.update(hand('two'), 900)!.command, null);
  controller.update(hand('hover'), 1_000);
  assert.equal(controller.update(hand('open'), 1_100)!.command, null);
  assert.equal(controller.update(hand('open'), 2_150)!.command, 'clear');
});

test('tài liệu nét vẽ bỏ tap rỗng, hỗ trợ undo và clear', () => {
  const ink = new AirInkDocument();
  ink.begin({ x: 0.1, y: 0.1, t: 0 });
  ink.end();
  assert.equal(ink.strokeCount(), 0);
  ink.begin({ x: 0.1, y: 0.1, t: 1 });
  ink.move({ x: 0.2, y: 0.2, t: 2 });
  ink.end();
  assert.equal(ink.strokeCount(), 1);
  assert.ok(ink.pointCount() > 2, 'đoạn dài được nội suy để render mượt');
  ink.undo();
  assert.equal(ink.strokeCount(), 0);
  ink.begin({ x: 0.2, y: 0.2, t: 3 });
  ink.move({ x: 0.3, y: 0.3, t: 4 });
  ink.clear();
  assert.equal(ink.pointCount(), 0);
});

test('benchmark báo p50/p95 định lượng và readiness', () => {
  const metrics = new AirSketchMetrics();
  [10, 20, 30, 40].forEach((value) => metrics.addHand(value));
  [20, 30, 40, 50].forEach((value) => metrics.addPipeline(value));
  [80, 120].forEach((value) => metrics.addClassify(value));
  const snapshot = metrics.snapshot(2, 30, { hand: true, classifier: true });
  assert.equal(snapshot.ready.hand, true);
  assert.equal(snapshot.ready.classifier, true);
  assert.equal(snapshot.hand.p50, 20);
  assert.equal(snapshot.hand.p95, 40);
  assert.equal(snapshot.pipeline.samples, 4);
  assert.equal(snapshot.pipeline.p50, 30);
  assert.equal(snapshot.pipeline.p95, 50);
  assert.equal(snapshot.classify.p95, 120);
});
