import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_SCHEMA, INCONCLUSIVE, imageRect, imagePoint, frameIndex, frameAtTime,
  trailAtFrame, segmentDistance, nearLineReviews, validateSession, exportReview,
  validateReview, reviewKey, formatTime, validateMethods, sameSource, staticAssetUrl,
  validatePublicManifest, validateEvidence, referenceAtFrame, pairedCategory, presentationFrameIndex, canReuseDecodedFrame } from '../tools/court/core.mjs';

const source = { name: 'court.mp4', sha256: 'a'.repeat(64), width: 854, height: 480, fps: 25, frameCount: 5, durationSeconds: .2 };
const ball = (x = 20, y = 30) => ({ x, y, radius: 3, confidence: .8, box: [x - 3, y - 3, 6, 6] });
function session() {
  return { schemaVersion: SESSION_SCHEMA, source: { ...source },
    method: { id: 'cv-baseline', kind: 'classical-cv', version: '1', description: 'Colour and motion', limitations: ['Not a referee'] },
    frames: Array.from({ length: 5 }, (_, index) => ({ index, timeSeconds: index / 25, status: index === 2 ? 'missing' : 'observed',
      ball: index === 2 ? null : ball(20 + index, 30), candidates: index === 2 ? [] : [ball(20 + index, 30)], reason: 'fixture' })),
    lineSuggestions: [{ id: 'line-1', a: [0, 35], b: [200, 35], provenance: 'image-hough', confirmed: false }],
    summary: { observedFrames: 4, ambiguousFrames: 0, missingFrames: 1, analysisMs: 2 },
    decision: { status: INCONCLUSIVE, reason: 'Missing ground-contact evidence' } };
}

test('object-contain rect maps image only, rejects letterbox', () => {
  const rect = imageRect(1000, 1000, 854, 480);
  assert.equal(rect.x, 0); assert.ok(rect.y > 200);
  assert.equal(imagePoint(500, 20, rect), null);
  const point = imagePoint(500, 500, rect);
  assert.ok(Math.abs(point[0] - 427) < 1e-8); assert.ok(Math.abs(point[1] - 240) < 1e-8);
  assert.equal(imageRect(0, 100, 854, 480), null);
});
test('frame lookup uses current frame only, no nearest future or stale sample', () => {
  const s = session(); assert.equal(frameIndex(0, source), 0);
  assert.equal(frameAtTime(s, .08).status, 'missing'); assert.equal(frameAtTime(s, .119).index, 2);
  assert.equal(frameAtTime(s, .12).index, 3); assert.equal(frameAtTime(s, .2), null); assert.equal(frameAtTime(s, -.1), null);
  s.frames[1].index = 8; assert.equal(frameAtTime(s, .04), null);
});
test('trail terminates at gap and never interpolates over it', () => {
  const s = session(); assert.deepEqual(trailAtFrame(s.frames, 4), [[23, 30], [24, 30]]);
  assert.deepEqual(trailAtFrame(s.frames, 2), []); assert.deepEqual(trailAtFrame(s.frames, 1), [[20, 30], [21, 30]]);
});
test('segment proximity is clamped, handles zero-length segment', () => {
  assert.equal(segmentDistance([15, 2], [0, 0], [10, 0]), Math.hypot(5, 2));
  assert.equal(segmentDistance([3, 4], [0, 0], [0, 0]), 5);
});
test('near-line events are image-proximity only with inconclusive decisions', () => {
  const s = session(), reviews = nearLineReviews(s, s.lineSuggestions);
  assert.equal(reviews.length, 1); assert.equal(reviews[0].kind, 'image-proximity');
  assert.equal(reviews[0].decision, INCONCLUSIVE); assert.equal(reviews[0].confirmedLine, false);
  assert.deepEqual(nearLineReviews(s, []), []); assert.deepEqual(nearLineReviews(s, s.lineSuggestions, 1), []);
});
test('valid complete observation contract accepted', () => assert.equal(validateSession(session()).frames.length, 5));
test('missing ball cannot retain stale observation; wrong counts/timestamps rejected', () => {
  const s = session(); s.frames[2].ball = ball(); assert.throws(() => validateSession(s), /mất dấu/);
  const t = session(); t.frames[1].timeSeconds = .4; assert.throws(() => validateSession(t), /Timestamp/);
  const u = session(); u.summary.observedFrames = 0; assert.throws(() => validateSession(u), /Thống kê/);
});
test('session cannot smuggle a call or auto-confirmed line', () => {
  const s = session(); s.decision.status = 'out'; assert.throws(() => validateSession(s), /In\/Out/);
  const t = session(); t.lineSuggestions[0].confirmed = true; assert.throws(() => validateSession(t), /bản nháp/);
});
test('invalid out-of-image data rejected', () => {
  const s = session(); s.frames[0].ball.x = 900; assert.throws(() => validateSession(s), /Vị trí/);
  const t = session(); t.frames[0].ball.box = [850, 0, 50, 6]; assert.throws(() => validateSession(t), /ngoài ảnh/);
});
test('review export/source-bound import keeps annotations and human provenance', () => {
  const s = session(), bookmark = { id: 'mark-1', frame: 3, kind: 'human-bookmark' };
  const result = exportReview(s, s.lineSuggestions, [bookmark]);
  assert.equal(result.decision.status, INCONCLUSIVE); assert.equal(result.bookmarks[0].timeSeconds, .12);
  assert.equal(validateReview(result, source).lines.length, 1);
  assert.notEqual(reviewKey(source), reviewKey({ ...source, sha256: 'b'.repeat(64) }));
  assert.throws(() => validateReview(result, { ...source, sha256: 'b'.repeat(64) }), /không thuộc/);
});
test('tampered, oversized or duplicate review data rejected before use', () => {
  const s = session(), result = exportReview(s, s.lineSuggestions, []);
  result.decision.status = 'in'; assert.throws(() => validateReview(result, source), /In\/Out/);
  const duplicate = exportReview(s, s.lineSuggestions, []); duplicate.lines.push(duplicate.lines[0]);
  assert.throws(() => validateReview(duplicate, source), /trùng/);
  const huge = exportReview(s, s.lineSuggestions, []); huge.bookmarks = new Array(501).fill({});
  assert.throws(() => validateReview(huge, source), /giới hạn/);
});
test('format clock preserves zero and precise frame time', () => {
  assert.equal(formatTime(0, true), '0:00.00'); assert.equal(formatTime(13.48, true), '0:13.48');
  assert.equal(formatTime(NaN), '0:00');
});
test('learned sessions require model provenance and valid weight/config hashes', () => {
  const s = session(); s.method.kind = 'learned-ball';
  assert.throws(() => validateSession(s), /checksum/);
  s.method.model = { id: 'fixture-not-real-inference', artifactSha256: 'b'.repeat(64), sourceUrl: 'https://example.com/model', license: 'MIT', revision: 'fixed', configSha256: 'c'.repeat(64), preprocessId: 'test-input' };
  assert.equal(validateSession(s).method.kind, 'learned-ball');
  s.method.kind = 'classical-cv'; assert.throws(() => validateSession(s), /model học/);
});
test('A/B catalogue rejects different sources, wrong arm names and fake model labels', () => {
  const methods = { schemaVersion: 'roboeye-court-methods-v1', sourceSha256: source.sha256, defaultDetector: 'classical',
    methods: [{ key: 'classical', id: 'cv-baseline', kind: 'classical-cv', description: 'test fixture', model: null }] };
  assert.equal(validateMethods(methods, source), methods);
  assert.equal(sameSource(source, { ...source }), true); assert.equal(sameSource(source, { ...source, fps: 24 }), false);
  assert.throws(() => validateMethods(methods, { ...source, sha256: 'f'.repeat(64) }), /khớp nguồn/);
  methods.methods[0].kind = 'learned-ball'; assert.throws(() => validateMethods(methods, source), /khớp phương pháp/);
});
test('static asset URLs support a hosting subpath but never escape the release', () => {
  const manifest = 'https://example.test/court/demo/manifest.json';
  assert.equal(staticAssetUrl('videos/OCT01.mp4', manifest), 'https://example.test/court/demo/videos/OCT01.mp4');
  for (const path of ['/private.mp4', '../secret.json', 'https://evil.test/a', '//evil.test/a', 'videos/../../secret.json', 'sessions/a.json?changed=1']) assert.throws(() => staticAssetUrl(path, manifest));
});
test('public manifest preserves paired totals rather than advertising an aggregate accuracy', () => {
  const value = { schemaVersion: 'roboeye-court-public-v1', defaultClip: 'one',
    clips: ['one', 'two', 'three'].map(id => ({ id, title: id, sourceSha256: source.sha256, video: `${id}.mp4`, sessions: { classical: `${id}-a.json`, specialist: `${id}-b.json` }, evidence: `${id}-labels.json` })),
    summary: { visible: 2, unknown: 3, verifiedAbsent: 0, classical: { tp: 1, fn: 1, fp: 0 }, specialist: { tp: 2, fn: 0, fp: 0 }, paired: { bothCorrect: 1, recovered: 1, regressed: 0, bothMiss: 0 } } };
  assert.equal(validatePublicManifest(value, 'https://example.test/demo/manifest.json'), value);
  value.summary.paired.regressed = 1; assert.throws(() => validatePublicManifest(value, 'https://example.test/demo/manifest.json'), /không khớp/);
});
function evidence() {
  return { schemaVersion: 'roboeye-court-evidence-v1', sourceSha256: source.sha256, matchingRadiusPixels: 8,
    labels: Array.from({ length: 5 }, (_, frame) => ({ frame, status: [1, 3].includes(frame) ? 'visible' : 'unknown', point: [1, 3].includes(frame) ? [20 + frame, 30] : null })),
    cases: [{ id: 'visible-1', frame: 1, category: 'both-correct' }, { id: 'visible-3', frame: 3, category: 'both-correct' }] };
}
test('visual references exist only at exact labelled frames, never interpolate unknowns', () => {
  const e = evidence(); validateEvidence(e, source, { classical: session(), specialist: session() });
  assert.deepEqual(referenceAtFrame(e, 1), [21, 30]); assert.equal(referenceAtFrame(e, 2), null);
  assert.equal(referenceAtFrame(e, 1.5), null); assert.equal(referenceAtFrame(e, 5), null);
  e.labels[2].point = [22, 30]; assert.throws(() => validateEvidence(e, source), /chưa rõ/);
});
test('case classifications and complete reference coverage are verified against frozen A/B points', () => {
  const a = session(), b = session(), e = evidence(); b.frames[3].status = 'missing'; b.frames[3].ball = null;
  assert.equal(pairedCategory(a.frames[3], b.frames[3], [23, 30]), 'regressed');
  assert.throws(() => validateEvidence(e, source, { classical: a, specialist: b }), /đóng băng/);
  e.cases[1].category = 'regressed'; assert.equal(validateEvidence(e, source, { classical: a, specialist: b }), e);
  e.cases.pop(); assert.throws(() => validateEvidence(e, source), /tất cả/);
});
test('rVFC presentation mapping covers all 269 fractional-60fps PTS rounded to microseconds', () => {
  const s = { fps: 60000 / 1001, frameCount: 269, durationSeconds: 269 / (60000 / 1001) };
  let floorAliases = 0;
  for (let index = 0; index < s.frameCount; index++) {
    const roundedPts = Math.round(index / s.fps * 1e6) / 1e6;
    if (frameIndex(roundedPts, s) !== index) floorAliases++;
    assert.equal(presentationFrameIndex(roundedPts, s), index, `presentation ${index}`);
  }
  assert.ok(floorAliases > 0, 'this fixture reproduces the original floor alias, not only exact integer timestamps');
});
test('presentation tolerance is at most a microsecond, never a fraction-of-frame time correction', () => {
  const s = { fps: 60000 / 1001, frameCount: 269, durationSeconds: 269 / (60000 / 1001) };
  assert.equal(presentationFrameIndex(10 / s.fps - .000001, s), 10);
  for (const shift of [.000002, .0001, .003, -.003]) assert.equal(presentationFrameIndex(10 / s.fps + shift, s), null);
  assert.equal(frameIndex(10 / s.fps - .003, s), 9, 'arbitrary seek time retains its floor contract');
  assert.equal(presentationFrameIndex(s.durationSeconds, s), null);
});
test('idempotent seeks require actual paused decoded pixels, matching source and native/presented frame', () => {
  const s = { ...source, frameCount: 82, fps: 60000 / 1001, durationSeconds: 82 / (60000 / 1001) };
  const valid = { ready: true, paused: true, seeking: false, nativeSeeking: false, readyState: 4, timingQualified: true,
    presentedIndex: 81, displayedIndex: 81, displayedSourceSha: s.sha256, nativeTime: 1.353 };
  assert.equal(canReuseDecodedFrame(81, s, valid), true);
  for (const changed of [{ presentedIndex: 80 }, { displayedIndex: 80 }, { displayedSourceSha: 'b'.repeat(64) }, { ready: false }, { paused: false },
    { nativeSeeking: true }, { seeking: true }, { readyState: 1 }, { timingQualified: false }, { nativeTime: 0 }]) {
    assert.equal(canReuseDecodedFrame(81, s, { ...valid, ...changed }), false, JSON.stringify(changed));
  }
  assert.equal(canReuseDecodedFrame(null, s, valid), false);
});

function publicV2() {
  const benchmarkSummary = { visible: 35, unknown: 234, verifiedAbsent: 0, classical: { tp: 19, fn: 16, fp: 0 },
    specialist: { tp: 28, fn: 7, fp: 0 }, paired: { bothCorrect: 16, recovered: 12, regressed: 3, bothMiss: 4 } };
  const clip = (id, role, sha) => ({ id, role, title: id, sourceSha256: sha, video: `videos/${id}.mp4`,
    sessions: { classical: `sessions/${id}-a.json`, specialist: `sessions/${id}-b.json` }, evidence: `evidence/${id}.json` });
  return { schemaVersion: 'roboeye-court-public-v2', defaultClip: 'pickleball-original',
    clips: [{ ...clip('pickleball-original', 'user-original', 'd'.repeat(64)), frameCount: 337 },
      ...['tennist-01', 'tennist-02', 'tennist-03'].map(id => clip(id, 'benchmark', 'a'.repeat(64)))],
    publicationAuthorization: { kind: 'explicit-user-publication', authorized: true, sourceSha256: 'd'.repeat(64), scope: 'public-original-video' },
    benchmarkSummary, summary: { ...structuredClone(benchmarkSummary), unknown: 571 } };
}
test('v2 requires the exact original role/default and publication authority bound to its source SHA', () => {
  const url = 'https://example.test/demo/manifest.json';
  assert.equal(validatePublicManifest(publicV2(), url).clips.length, 4);
  for (const mutate of [v => v.publicationAuthorization.sourceSha256 = 'f'.repeat(64), v => v.publicationAuthorization.authorized = false,
    v => v.publicationAuthorization.scope = 'private-review', v => v.defaultClip = 'tennist-01', v => v.clips[0].role = 'benchmark',
    v => v.clips[1].id = 'arbitrary-extra-media', v => v.clips.push(v.clips[0])]) {
    const value = publicV2(); mutate(value); assert.throws(() => validatePublicManifest(value, url));
  }
});
test('v2 keeps original unknown frames out of the tennis score and v1 cannot opt in an original', () => {
  const url = 'https://example.test/demo/manifest.json', value = publicV2();
  value.benchmarkSummary.unknown = 571;
  assert.throws(() => validatePublicManifest(value, url), /gộp video gốc/);
  const legacy = publicV2(); legacy.schemaVersion = 'roboeye-court-public-v1'; legacy.clips.pop(); legacy.summary = structuredClone(legacy.benchmarkSummary);
  assert.throws(() => validatePublicManifest(legacy, url), /V2/);
});
