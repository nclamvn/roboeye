import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDraftRoadAnnotations,
  parseRoadAnnotationSet,
  parseRoadAnnotationTask,
  roadAnnotationsToTruthFrames,
  validateRoadAnnotationsAgainstTask,
} from '../../src/drive/road-annotations';

const taskHash = 'b'.repeat(64);
const imageHash = 'c'.repeat(64);
const taskFixture = () => ({
  schemaVersion: 1,
  taskId: 'test1-road-v1',
  clipId: 'test1',
  split: 'test',
  width: 1280,
  height: 720,
  sourceSha256: 'a'.repeat(64),
  rights: { basis: 'owned', reference: 'local owner-provided test footage' },
  scenarioTags: ['day', 'highway'],
  predictionBlind: true,
  frames: [{ timeMs: 1000, imageFile: 'raw-01.png', imageSha256: imageHash }],
});

test('blind task creates a hash-bound draft with the exact raw frames', () => {
  const task = parseRoadAnnotationTask(taskFixture());
  const draft = createDraftRoadAnnotations(task, taskHash);
  validateRoadAnnotationsAgainstTask(task, taskHash, parseRoadAnnotationSet(draft));
  assert.equal(draft.status, 'draft');
  assert.equal(draft.revision, 0);
  assert.equal(draft.frames[0].imageSha256, imageHash);
  assert.deepEqual(draft.frames[0].lines, []);
});

test('closed schemas reject prediction leakage, unsafe image paths and physical-boundary roles', () => {
  const leaked = taskFixture() as Record<string, unknown>;
  leaked.predictionFrames = [];
  assert.throws(() => parseRoadAnnotationTask(leaked), /trường không được phép/);

  const unsafe = taskFixture();
  unsafe.frames[0].imageFile = '../raw.png';
  assert.throws(() => parseRoadAnnotationTask(unsafe), /tên PNG không hợp lệ/);

  const task = parseRoadAnnotationTask(taskFixture());
  const annotation = createDraftRoadAnnotations(task, taskHash);
  const leakedAnnotation = structuredClone(annotation) as unknown as Record<string, unknown>;
  leakedAnnotation.predictions = [];
  assert.throws(() => parseRoadAnnotationSet(leakedAnnotation), /trường không được phép/);
  annotation.frames[0].lines.push({ id: 'curb', class: 'curb', role: 'adjacent', points: [{ x: .1, y: .8 }, { x: .3, y: .5 }] });
  assert.throws(() => parseRoadAnnotationSet(annotation), /biên vật lý/);
});

test('task/image hash mismatch and self-review fail closed', () => {
  const task = parseRoadAnnotationTask(taskFixture());
  const wrongTaskHash = createDraftRoadAnnotations(task, 'd'.repeat(64));
  assert.throws(() => validateRoadAnnotationsAgainstTask(task, taskHash, wrongTaskHash), /task đã thay đổi/);
  const wrongImage = createDraftRoadAnnotations(task, taskHash);
  wrongImage.frames[0].imageSha256 = 'e'.repeat(64);
  assert.throws(() => validateRoadAnnotationsAgainstTask(task, taskHash, wrongImage), /không khớp ảnh thô/);

  const selfReviewed = createDraftRoadAnnotations(task, taskHash) as unknown as Record<string, unknown>;
  selfReviewed.status = 'reviewed';
  selfReviewed.review = { decision: 'accepted', reviewedBy: 'local-annotator', reviewedAt: '2026-09-17T04:00:00.000Z', note: 'checked' };
  assert.throws(() => parseRoadAnnotationSet(selfReviewed), /phải khác annotatedBy/);
});

test('annotation revision is bounded and legacy draft migrates to revision zero', () => {
  const task = parseRoadAnnotationTask(taskFixture());
  const legacy = createDraftRoadAnnotations(task, taskHash) as unknown as Record<string, unknown>;
  delete legacy.revision;
  assert.equal(parseRoadAnnotationSet(legacy).revision, 0);
  legacy.revision = -1;
  assert.throws(() => parseRoadAnnotationSet(legacy), /revision/);
});

test('only independently reviewed annotations can become benchmark truth', () => {
  const task = parseRoadAnnotationTask(taskFixture());
  const draft = createDraftRoadAnnotations(task, taskHash);
  draft.frames[0].lines.push({
    id: 'ego-left', class: 'lane-marking', role: 'ego-left', points: [{ x: .1, y: .9 }, { x: .4, y: .5 }],
  });
  draft.frames[0].areas.push({
    id: 'road', class: 'drivable', points: [{ x: .1, y: 1 }, { x: .4, y: .5 }, { x: .6, y: .5 }, { x: .9, y: 1 }],
  });
  assert.throws(() => roadAnnotationsToTruthFrames(draft), /Chỉ nhãn đã review/);
  const reviewed = parseRoadAnnotationSet({
    ...draft,
    status: 'reviewed',
    review: { decision: 'accepted', reviewedBy: 'local-reviewer', reviewedAt: '2026-09-17T04:00:00.000Z', note: 'raw-frame geometry checked' },
  });
  const truth = roadAnnotationsToTruthFrames(reviewed);
  assert.equal(truth.length, 1);
  assert.equal(truth[0].lines[0].role, 'ego-left');
  assert.equal(truth[0].areas[0].class, 'drivable');
});
