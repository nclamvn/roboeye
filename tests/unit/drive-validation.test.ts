import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateValidationCorpus, parseValidationCorpus } from '../../src/drive/validation';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/drive-validation-synthetic.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(fixture);

test('independent object IDs, misses, roadside FP, range coverage and ID switches score deterministically', () => {
  const corpus = parseValidationCorpus(copy());
  const report = evaluateValidationCorpus(corpus);
  assert.equal(report.evidence, 'synthetic-algorithm-test-only');
  assert.equal(report.bySplit.test.journeys, 1);
  assert.equal(report.aggregate.truthObjects, 4);
  assert.equal(report.aggregate.predictions, 4);
  assert.equal(report.aggregate.matched, 3);
  assert.equal(report.aggregate.falseNegatives, 1);
  assert.equal(report.aggregate.falsePositives, 1);
  assert.equal(report.aggregate.precision, .75);
  assert.equal(report.aggregate.recall, .75);
  assert.equal(report.aggregate.rangeCoverage, .5);
  assert.equal(report.aggregate.rangeAbstentions, 1);
  assert.equal(report.aggregate.maeM, 1);
  assert.equal(report.aggregate.biasM, 0);
  assert.equal(report.aggregate.p95AbsoluteErrorM, 1);
  assert.equal(report.aggregate.idSwitches, 1);
  assert.equal(report.aggregate.requestToResultP95Ms, 80);
  assert.equal(report.aggregate.rangeBins['5to30m'].truth, 3);
  assert.equal(report.aggregate.rangeBins['30to70m'].measured, 0);
});

test('incompatible distance definitions never enter metre errors', () => {
  const raw = copy();
  raw.journeys[0].predictionFrames[0].objects[0].distanceKind = 'learned_optical_axis_z_m';
  const metrics = evaluateValidationCorpus(parseValidationCorpus(raw)).aggregate;
  assert.equal(metrics.rangeMatched, 1);
  assert.equal(metrics.rangeCoverage, .25);
  assert.equal(metrics.distanceKindMismatches, 1);
  assert.equal(metrics.maeM, 1);
});

test('all unknown predictions leave quality null, not fabricated zero error', () => {
  const raw = copy();
  for (const frame of raw.journeys[0].predictionFrames) for (const object of frame.objects) {
    object.distanceM = null; object.distanceKind = null;
  }
  const metrics = evaluateValidationCorpus(parseValidationCorpus(raw)).aggregate;
  assert.equal(metrics.rangeCoverage, 0);
  assert.equal(metrics.maeM, null);
  assert.equal(metrics.p95AbsoluteErrorM, null);
});

test('missing/late observations are false negatives and unmatched predictions are false positives', () => {
  const raw = copy();
  raw.journeys[0].predictionFrames[0].timeMs = 100;
  const metrics = evaluateValidationCorpus(parseValidationCorpus(raw)).aggregate;
  assert.equal(metrics.matched, 2);
  assert.equal(metrics.falseNegatives, 2);
  assert.equal(metrics.falsePositives, 2);
});

test('corpus rejects duplicate journeys, cross-split source leakage and missing rights', () => {
  const duplicate = copy(); duplicate.journeys.push(structuredClone(duplicate.journeys[0]));
  assert.throws(() => parseValidationCorpus(duplicate), /journeyId trùng/);
  const leakage = copy();
  const cloned = structuredClone(leakage.journeys[0]); cloned.journeyId = 'second'; cloned.split = 'train';
  leakage.journeys.push(cloned);
  assert.throws(() => parseValidationCorpus(leakage), /hai split/);
  const rights = copy(); delete rights.journeys[0].rights;
  assert.throws(() => parseValidationCorpus(rights), /rights/);
});

test('corpus rejects invalid boxes, non-finite numbers, IDs and hidden video bytes', () => {
  const badBox = copy(); badBox.journeys[0].truthFrames[0].objects[0].bbox.x1 = 1.1;
  assert.throws(() => parseValidationCorpus(badBox), /x1/);
  const nan = copy(); nan.journeys[0].truthFrames[0].objects[0].distanceM = NaN;
  assert.throws(() => parseValidationCorpus(nan), /distanceM/);
  const duplicate = copy(); duplicate.journeys[0].truthFrames[1].objects[1].objectId = 'real-car-A';
  assert.throws(() => parseValidationCorpus(duplicate), /ID trùng/);
  const video = copy(); video.journeys[0].videoBase64 = 'private';
  assert.throws(() => parseValidationCorpus(video), /trường không được phép/);
});
