import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateDetectionQuality,
  boxIoU,
  evaluateDetections,
  summarizeLatency,
  type DetectionMetricBox
} from '../../src/detection-metrics';

const target: DetectionMetricBox = { label: 'person', x0: 0, y0: 0, x1: 1, y1: 1 };

test('boxIoU computes overlap and handles disjoint boxes', () => {
  assert.equal(boxIoU(target, target), 1);
  assert.equal(boxIoU(target, { ...target, x0: 0.5, x1: 1.5 }), 1 / 3);
  assert.equal(boxIoU(target, { ...target, x0: 2, x1: 3 }), 0);
});

test('quality matching is class-aware, score-ordered and one-to-one', () => {
  const result = evaluateDetections([
    { ...target, score: 0.9 },
    { ...target, score: 0.8 },
    { ...target, label: 'dog', score: 0.7 }
  ], [target]);

  assert.equal(result.truePositive, 1);
  assert.equal(result.falsePositive, 2);
  assert.equal(result.falseNegative, 0);
  assert.equal(result.precision, 1 / 3);
  assert.equal(result.recall, 1);
  assert.equal(result.f1, 0.5);
  assert.deepEqual(result.matches.map((match) => match.predictionIndex), [0]);
});

test('quality aggregation uses micro-averaged TP, FP and FN', () => {
  const hit = evaluateDetections([{ ...target, score: 1 }], [target]);
  const miss = evaluateDetections([], [target]);
  const result = aggregateDetectionQuality([hit, miss]);
  assert.deepEqual(
    { tp: result.truePositive, fp: result.falsePositive, fn: result.falseNegative },
    { tp: 1, fp: 0, fn: 1 }
  );
  assert.equal(result.precision, 1);
  assert.equal(result.recall, 0.5);
  assert.ok(Math.abs(result.f1 - 2 / 3) < 1e-12);
});

test('latency summary uses nearest-rank p50/p95 and rejects invalid input', () => {
  assert.deepEqual(summarizeLatency([5, 1, 3, 2, 4]), {
    count: 5,
    min: 1,
    mean: 3,
    p50: 3,
    p95: 5,
    max: 5
  });
  assert.throws(() => summarizeLatency([]), /ít nhất một/);
  assert.throws(() => summarizeLatency([1, Number.NaN]), /hữu hạn/);
});
