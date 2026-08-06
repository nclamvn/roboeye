import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectionIoU,
  overlapOverSmaller,
  postprocessDetections,
  RTDETR_POSTPROCESS
} from '../../src/detection-postprocess';
import { createOwlPromptPlan, OWL_QUERY_PRESETS } from '../../src/detection-presets';
import type { DetBox } from '../../src/detection-types';

const person: DetBox = { label: 'person', score: 0.95, x0: 0.1, y0: 0.1, x1: 0.6, y1: 0.9 };

test('class-aware NMS removes overlapping duplicate but keeps another class', () => {
  const duplicate = { ...person, score: 0.8, x0: 0.12, y0: 0.12, x1: 0.58, y1: 0.88 };
  const chair = { ...duplicate, label: 'chair', score: 0.7 };
  const result = postprocessDetections([duplicate, chair, person], RTDETR_POSTPROCESS);
  assert.deepEqual(result.map((box) => box.label), ['person', 'chair']);
  assert.ok(detectionIoU(person, duplicate) > RTDETR_POSTPROCESS.nmsIouThreshold);
});

test('containment suppression removes a small same-class box inside a larger detection', () => {
  const contained = { ...person, score: 0.7, x0: 0.2, y0: 0.3, x1: 0.3, y1: 0.5 };
  assert.equal(overlapOverSmaller(person, contained), 1);
  assert.deepEqual(postprocessDetections([person, contained], RTDETR_POSTPROCESS), [person]);
});

test('post-processing clamps coordinates, rejects invalid boxes and enforces cap', () => {
  const invalid = { ...person, score: Number.NaN };
  const clamped = { ...person, label: ' dog ', x0: -1, y1: 2 };
  const result = postprocessDetections([invalid, clamped], { ...RTDETR_POSTPROCESS, maxDetections: 1 });
  assert.deepEqual(result, [{ ...clamped, label: 'dog', x0: 0, y1: 1 }]);
});

test('OWL prompt plan deduplicates labels, adds natural prompt template and caps queries', () => {
  const plan = createOwlPromptPlan([' Person ', 'person', 'apple', 'bus', 'dog'], 3);
  assert.deepEqual(plan.labels, ['person', 'apple', 'bus']);
  assert.deepEqual(plan.prompts, ['a photo of a person', 'a photo of an apple', 'a photo of a bus']);
  assert.equal(plan.labelByPrompt.get('a photo of an apple'), 'apple');
  assert.deepEqual(OWL_QUERY_PRESETS.mobility.queries, ['person', 'car', 'bus', 'bicycle', 'motorcycle']);
});
