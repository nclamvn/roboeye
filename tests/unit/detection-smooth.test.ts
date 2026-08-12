import assert from 'node:assert/strict';
import test from 'node:test';
import { DetectionSmoother } from '../../src/detection-smooth';
import type { DetBox } from '../../src/detection-types';

const boxAt = (x0: number, label = 'person'): DetBox => ({ label, score: 0.9, x0, y0: 0.2, x1: x0 + 0.14, y1: 0.62 });

test('xác nhận liên tiếp trước khi hiển thị và giữ track đã xác nhận qua mất detection ngắn', () => {
  const tracker = new DetectionSmoother({ minHits: 2, maxMissed: 2 });
  tracker.observe([boxAt(0.1)], 0);
  assert.equal(tracker.advance(16).length, 0, 'một detection đơn lẻ chưa được vẽ');
  tracker.observe([boxAt(0.12)], 100);
  assert.equal(tracker.advance(16).length, 1, 'hai hit liên tiếp xác nhận track');
  tracker.observe([], 200);
  assert.equal(tracker.advance(16).length, 1, 'mất một nhịp vẫn giữ khung đã xác nhận');
  tracker.observe([], 300);
  tracker.observe([], 400);
  assert.equal(tracker.advance(16).length, 0, 'quá ngưỡng mất detection thì bỏ track');
});

test('dự báo vận tốc giữ khung theo vật di chuyển nhanh giữa các lần inference', () => {
  const tracker = new DetectionSmoother({ minHits: 2, centerGate: 0.26, maxCenterGate: 0.4 });
  tracker.observe([boxAt(0.08)], 0);
  // Không chồng IoU: tâm dịch 0.24 viewport trong 120 ms nhưng vẫn phải là cùng vật.
  tracker.observe([boxAt(0.32)], 120);
  const predicted = tracker.advance(80);
  assert.equal(predicted.length, 1, 'không tạo track mới khi vật di chuyển nhanh');
  assert.ok(predicted[0].x0 > 0.32, `khung có dự báo chuyển động, x0=${predicted[0].x0}`);
  tracker.observe([boxAt(0.5)], 240);
  const next = tracker.advance(40);
  assert.equal(next.length, 1);
  assert.ok(next[0].x0 > 0.48 && next[0].x0 < 0.66, `khung bám gần vị trí mới, x0=${next[0].x0}`);
});

test('bù độ trễ inference trước khi hiệu chỉnh khung đang hiển thị', () => {
  const tracker = new DetectionSmoother({ minHits: 1, correctionAlpha: 1, velocityAlpha: 1 });
  tracker.observe([boxAt(0.10)], 0, 0);
  tracker.observe([boxAt(0.30)], 100, 100);
  // The renderer keeps the last confirmed box moving while the worker infers.
  tracker.advance(80);
  // Kết quả thứ ba được chụp lúc 200 ms nhưng chỉ nhận về lúc 300 ms. Với vận
  // tốc đã học (0.002 viewport/ms), x0=0.50 phải được bù gần tới 0.70.
  tracker.observe([boxAt(0.50)], 200, 300);
  const result = tracker.advance(0);
  assert.equal(result.length, 1);
  assert.ok(result[0].x0 > 0.68 && result[0].x0 < 0.72, `khung chưa bù latency, x0=${result[0].x0}`);
});

test('một miss làm reset chuỗi xác nhận của track chưa xác nhận', () => {
  const tracker = new DetectionSmoother({ minHits: 2 });
  tracker.observe([boxAt(0.2)], 0);
  tracker.observe([], 100);
  tracker.observe([boxAt(0.2)], 200);
  assert.equal(tracker.advance(16).length, 0, 'hit sau miss không được cộng với hit cũ');
  tracker.observe([boxAt(0.21)], 300);
  assert.equal(tracker.advance(16).length, 1);
});
