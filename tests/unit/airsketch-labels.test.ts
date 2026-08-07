import assert from 'node:assert/strict';
import test from 'node:test';
import { assessSketchConfidence } from '../../src/airsketch-confidence';
import { hasVietnameseSketchLabel, localizeSketchLabel, QUICKDRAW_VI_LABELS } from '../../src/airsketch-labels';
import { detectHeartSketch, mergeSpecialSketchPrediction } from '../../src/airsketch-shapes';

test('phủ đủ 345 nhãn QuickDraw bằng tiếng Việt', () => {
  assert.equal(Object.keys(QUICKDRAW_VI_LABELS).length, 345);
  for (const label of ['The Eiffel Tower', 'aircraft carrier', 'firetruck', 'hospital', 'house', 'zigzag']) {
    assert.equal(hasVietnameseSketchLabel(label), true, label);
    assert.notEqual(localizeSketchLabel(label), 'vật thể chưa có tên tiếng Việt');
  }
});

test('nhãn lạ không âm thầm rơi về tiếng Anh', () => {
  assert.equal(localizeSketchLabel('unknown future class'), 'vật thể chưa có tên tiếng Việt');
});

test('nhận diện trái tim khi model 345 lớp không có heart', () => {
  const points = [
    [0.50, 0.18], [0.38, 0.08], [0.23, 0.08], [0.10, 0.20], [0.10, 0.38],
    [0.22, 0.62], [0.50, 0.92], [0.78, 0.62], [0.90, 0.38], [0.90, 0.20],
    [0.77, 0.08], [0.68, 0.12], [0.62, 0.08], [0.50, 0.18]
  ].map(([x, y], index) => ({ x, y, t: index }));
  const score = detectHeartSketch([{ points }]);
  assert.ok(score != null && score >= 0.86);
  assert.equal(localizeSketchLabel('heart'), 'trái tim');
  assert.equal(mergeSpecialSketchPrediction([{ label: 'tooth', score: 0.17 }], { label: 'heart', score: score ?? 0 })[0].label, 'heart');
});

test('confidence yêu cầu cả xác suất và khoảng cách top-2', () => {
  assert.equal(assessSketchConfidence([{ label: 'house', score: 0.91 }, { label: 'barn', score: 0.05 }]), 'confident');
  assert.equal(assessSketchConfidence([{ label: 'house', score: 0.34 }, { label: 'barn', score: 0.25 }]), 'possible');
  assert.equal(assessSketchConfidence([{ label: 'house', score: 0.34 }, { label: 'barn', score: 0.32 }]), 'uncertain');
});
