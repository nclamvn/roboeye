import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateRoadBenchmarkCorpus, parseRoadBenchmarkCorpus } from '../../src/drive/road-benchmark';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/road-structure-synthetic.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(fixture);

test('road scorer counts lane/boundary misses, false positives, stale evidence and corridor completeness', () => {
  const report = evaluateRoadBenchmarkCorpus(parseRoadBenchmarkCorpus(copy()));
  assert.equal(report.evidence, 'synthetic-algorithm-test-only');
  assert.equal(report.aggregate.truthLines, 6);
  assert.equal(report.aggregate.predictedLines, 6);
  assert.equal(report.aggregate.matchedLines, 5);
  assert.equal(report.aggregate.precision, 5 / 6);
  assert.equal(report.aggregate.recall, 5 / 6);
  assert.equal(report.aggregate.f1, 5 / 6);
  assert.equal(report.aggregate.egoCorridorRecall, .5);
  assert.equal(report.aggregate.byClass.median.recall, 1);
  assert.equal(report.aggregate.staleFrameRate, .5);
  assert.equal(report.aggregate.inferenceP95Ms, 18);
  assert.equal(report.aggregate.drivableMeanIou, 1);
});

test('road corpus rejects hidden bytes, invalid geometry, duplicate IDs, missing rights and split leakage', () => {
  const hidden = copy(); hidden.clips[0].videoBase64 = 'private';
  assert.throws(() => parseRoadBenchmarkCorpus(hidden), /trường không được phép/);
  const geometry = copy(); geometry.clips[0].truthFrames[0].lines[0].points[0].x = 1.2;
  assert.throws(() => parseRoadBenchmarkCorpus(geometry), /số ngoài giới hạn/);
  const duplicate = copy(); duplicate.clips[0].truthFrames[0].lines[1].id = duplicate.clips[0].truthFrames[0].lines[0].id;
  assert.throws(() => parseRoadBenchmarkCorpus(duplicate), /ID line\/area trùng/);
  const rights = copy(); delete rights.clips[0].rights;
  assert.throws(() => parseRoadBenchmarkCorpus(rights), /cần object/);
  const leakage = copy(); const second = structuredClone(leakage.clips[0]); second.clipId = 'second'; second.split = 'train'; leakage.clips.push(second);
  assert.throws(() => parseRoadBenchmarkCorpus(leakage), /hai split/);
});

test('unmatched frame and mixed synthetic/physical corpus fail honestly', () => {
  const raw = copy(); raw.clips[0].predictionFrames[0].timeMs = 500; raw.clips[0].predictionFrames[1].timeMs = 600;
  const report = evaluateRoadBenchmarkCorpus(parseRoadBenchmarkCorpus(raw));
  assert.ok(report.aggregate.recall! < 5 / 6);
  const mixed = copy(); const second = structuredClone(mixed.clips[0]); second.clipId = 'physical'; second.sourceSha256 = 'b'.repeat(64); second.rights = { basis: 'owned', reference: 'owner release' }; mixed.clips.push(second);
  assert.throws(() => parseRoadBenchmarkCorpus(mixed), /Không trộn synthetic/);
});

test('polyline matching is invariant to sampling density and point order', () => {
  const raw = copy(), clip = raw.clips[0];
  const truth = { id: 'truth', class: 'lane-marking', role: 'ego-left', points: [{ x: .2, y: 1 }, { x: .5, y: .5 }] };
  const prediction = {
    id: 'prediction', class: 'lane-marking', role: 'ego-left',
    points: Array.from({ length: 21 }, (_, index) => ({ x: .5 - .3 * index / 20, y: .5 + .5 * index / 20 })),
  };
  clip.truthFrames = [{ timeMs: 100, lines: [truth], areas: [] }];
  clip.predictionFrames = [{ timeMs: 100, inferenceMs: 10, evidenceAgeMs: 10, lines: [prediction], areas: [] }];
  const report = evaluateRoadBenchmarkCorpus(parseRoadBenchmarkCorpus(raw));
  assert.equal(report.aggregate.matchedLines, 1);
  assert.ok((report.aggregate.meanLineDistancePx ?? Infinity) < 1e-9);
  assert.ok((report.aggregate.temporalLateralJitterPx ?? Infinity) < 1e-9);
});
