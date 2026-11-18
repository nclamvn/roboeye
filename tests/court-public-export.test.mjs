import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deriveClipEvidence, exportCourtPublic, inventoryDirectory, MEDIA_ALLOWLIST, ORIGINAL_PUBLIC_SOURCE,
  originalPublicationAuthorization, preparePublicData, readAllowlistedFile, rejectPrivateContent, sha256, SOURCE_ROOT } from '../scripts/export-court-public.mjs';

const cache = resolve(SOURCE_ROOT, '.court-cache');
let prepared;
const publicData = () => prepared ??= preparePublicData();
let preparedOriginal;
const publicOriginalData = () => preparedOriginal ??= preparePublicData({ includeUserOriginal: true });

test('privacy denylist refuses private source, absolute paths and credential markers', () => {
  for (const text of ['/Users/person/private.mov', 'file:///private/movie.mp4', '1794900295688-hidden.mp4',
    '767842eec2a34d478f8d4a5f3680c18f6eac889147f81fa332f7a02730542474',
    '{"apiKey":"secret"}', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'https://user:password@example.com/file']) assert.throws(() => rejectPrivateContent(text));
  assert.equal(rejectPrivateContent('https://data.mendeley.com/datasets/75m8vz7jr2/2'), 'https://data.mendeley.com/datasets/75m8vz7jr2/2');
});

test('file guard rejects source mutation, traversal and symlink escape', async () => {
  await mkdir(cache, { recursive: true }); const directory = await mkdtemp(resolve(cache, 'court-export-guard-'));
  try {
    await writeFile(resolve(directory, 'source.json'), '{}');
    assert.equal((await readAllowlistedFile(directory, 'source.json', sha256(Buffer.from('{}')))).toString(), '{}');
    await assert.rejects(readAllowlistedFile(directory, 'source.json', '0'.repeat(64)), /SHA mismatch/);
    await assert.rejects(readAllowlistedFile(directory, '../not-allowed'), /escapes/);
    await symlink(resolve(directory, 'source.json'), resolve(directory, 'alias.json'));
    await assert.rejects(readAllowlistedFile(directory, 'alias.json'), /Symlink/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('independent Euclidean score counts wrong-visible as FP and FN, unknown is never TN', () => {
  const clip = { id: 'test', width: 100, height: 80, frameCount: 3 };
  const labels = [{ index: 0, status: 'visible', point: [10, 10] }, { index: 1, status: 'unknown', point: null }, { index: 2, status: 'absent', point: null }];
  const session = { frames: [{ status: 'observed', ball: { x: 50, y: 50 } }, { status: 'observed', ball: { x: 5, y: 5 } }, { status: 'missing', ball: null }] };
  const result = deriveClipEvidence(clip, labels, session, session);
  assert.deepEqual(result.counts.classical, { tp: 0, fn: 1, fp: 1 });
  assert.equal(result.counts.unknown, 1); assert.equal(result.counts.verifiedAbsent, 1);
  assert.equal(result.cases.length, 1); assert.equal(result.cases[0].category, 'both-miss');
  assert.equal('tn' in result.counts.classical, false);
});

test('8px matching uses native distance at inclusive boundary, not coordinate rounding', () => {
  const clip = { id: 'test', width: 100, height: 80, frameCount: 1 };
  const labels = [{ index: 0, status: 'visible', point: [10, 10] }];
  const session = x => ({ frames: [{ status: 'observed', ball: { x, y: 10 } }] });
  const result = deriveClipEvidence(clip, labels, session(18), session(18.001));
  assert.deepEqual(result.counts.classical, { tp: 1, fn: 0, fp: 0 });
  assert.deepEqual(result.counts.specialist, { tp: 0, fn: 1, fp: 1 });
  assert.equal(result.cases[0].category, 'regressed');
});

test('frozen real data exports all269 labels,35 cases and all3 regressions', async () => {
  const { manifest, files } = await publicData();
  assert.deepEqual(manifest.summary, { visible: 35, unknown: 234, verifiedAbsent: 0,
    classical: { tp: 19, fn: 16, fp: 0 }, specialist: { tp: 28, fn: 7, fp: 0 },
    paired: { bothCorrect: 16, recovered: 12, regressed: 3, bothMiss: 4 } });
  assert.equal(manifest.falseAlarmRateOnAbsentFrames, null);
  let labels = 0, cases = 0, regression = 0, referenceHashes = 0;
  for (const clip of manifest.clips) {
    const evidence = JSON.parse(files.get(`demo/evidence/${clip.id}.json`));
    labels += evidence.labels.length; cases += evidence.cases.length;
    regression += evidence.cases.filter(item => item.category === 'regressed').length;
    referenceHashes += evidence.labels.filter(item => item.annotationImageSha256).length;
    assert.equal(evidence.sourceSha256, clip.sourceSha256);
  }
  assert.equal(labels, 269); assert.equal(cases, 35); assert.equal(regression, 3); assert.equal(referenceHashes, 36);
});

test('all6 public sessions preserve raw source frame observations exactly', async () => {
  const { files } = await publicData();
  for (const allowed of MEDIA_ALLOWLIST) for (const [arm, key] of [['A', 'classical'], ['B', 'specialist']]) {
    const rawBytes = await readFile(resolve(SOURCE_ROOT, `docs/evidence/court-m2/arms/${arm}/${allowed.id}.json`));
    const raw = JSON.parse(rawBytes);
    const exported = JSON.parse(files.get(`demo/sessions/${key}/${allowed.id}.json`));
    assert.equal(sha256(files.get(`demo/sessions/${key}/${allowed.id}.json`)), sha256(rawBytes));
    assert.deepEqual(exported.frames, raw.frames); assert.deepEqual(exported.source, raw.source);
    assert.deepEqual(exported.method, raw.method); assert.equal(exported.decision.status, 'insufficient-evidence');
    rejectPrivateContent(exported);
  }
});

test('three original licensed videos remain byte-identical, attribution and model licenses included', async () => {
  const { files, manifest } = await publicData();
  for (const allowed of MEDIA_ALLOWLIST) assert.equal(sha256(files.get(`demo/videos/${allowed.id}.mp4`)), allowed.sha256);
  assert.match(files.get('demo/attribution.txt').toString(), /CC BY 4.0/);
  assert.match(files.get('demo/model-license.txt').toString(), /MIT License/);
  assert.match(manifest.annotationProvenance, /không có nghiệm thu nhãn bởi con người/);
});

test('generated inventory hashes every file, no screenshot/model/private files; unexpected existing file refused', async () => {
  await mkdir(cache, { recursive: true }); const directory = await mkdtemp(resolve(cache, 'court-export-stage-'));
  try {
    const receipt = await exportCourtPublic({ output: directory });
    const actual = await inventoryDirectory(directory);
    assert.deepEqual(actual, receipt.files);
    assert.equal(receipt.fileCount, actual.length); assert.ok(receipt.totalBytes > 12_000_000 && receipt.totalBytes < 15_000_000);
    for (const file of receipt.files) assert.equal(sha256(await readFile(resolve(directory, file.path))), file.sha256);
    assert.match(await readFile(resolve(directory, 'index.html'), 'utf8'), /name="court-data" content="\.\/demo\/manifest.json"/);
    assert.ok(receipt.files.some(file => file.path === 'contact.mjs'));
    assert.equal(sha256(await readFile(resolve(directory, 'contact.mjs'))), sha256(await readFile(resolve(SOURCE_ROOT, 'tools/court/contact.mjs'))));
    await writeFile(resolve(directory, 'private-note.txt'), 'not allowlisted');
    await assert.rejects(exportCourtPublic({ output: directory }), /Unexpected existing output file/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('export refuses non-scoped output root without modifying it', async () => {
  await assert.rejects(exportCourtPublic({ output: SOURCE_ROOT }), /Output must be isolated/);
});

test('export refuses symlink output root instead of writing through it', async () => {
  await mkdir(cache, { recursive: true }); const directory = await mkdtemp(resolve(cache, 'court-export-link-'));
  try {
    await mkdir(resolve(directory, 'target'));
    await symlink(resolve(directory, 'target'), resolve(directory, 'alias'));
    await assert.rejects(exportCourtPublic({ output: resolve(directory, 'alias') }), /Symlink output/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('original authority permits only exact newly authorized SHA, never paths/basename/credentials', () => {
  const authority = originalPublicationAuthorization();
  assert.throws(() => rejectPrivateContent(ORIGINAL_PUBLIC_SOURCE.sha256));
  assert.equal(rejectPrivateContent(ORIGINAL_PUBLIC_SOURCE.sha256, 'authorized metadata', authority), ORIGINAL_PUBLIC_SOURCE.sha256);
  for (const text of ['/Users/person/source.mp4', '1794900295688_hidden.mp4', '{"accessToken":"bad"}']) assert.throws(() => rejectPrivateContent(text, 'authorized metadata', authority));
  assert.throws(() => rejectPrivateContent('safe text', 'bad authority', { ...authority, sourceSha256: 'b'.repeat(64) }), /authority/);
  assert.throws(() => rejectPrivateContent('safe text', 'bad authority', { ...authority, authorized: false }), /authority/);
});

test('string/truthy values cannot silently grant original publication opt-in', async () => {
  await assert.rejects(preparePublicData({ includeUserOriginal: 'false' }), /explicit boolean/);
  await assert.rejects(preparePublicData({ includeUserOriginal: 1 }), /explicit boolean/);
});

test('legacy remains three tennis sources; opt-in adds original default with isolated benchmark scope', async () => {
  const legacy = await publicData(); const opted = await publicOriginalData();
  assert.equal(legacy.manifest.schemaVersion, 'roboeye-court-public-v1'); assert.equal(legacy.manifest.clips.length, 3);
  assert.equal(legacy.files.has('demo/videos/pickleball-original.mp4'), false);
  assert.equal(opted.manifest.schemaVersion, 'roboeye-court-public-v2'); assert.equal(opted.manifest.clips.length, 4);
  assert.equal(opted.manifest.defaultClip, 'pickleball-original');
  assert.equal(opted.manifest.clips[0].role, 'user-original');
  assert.deepEqual(opted.manifest.benchmarkSummary, legacy.manifest.summary);
  assert.equal(opted.manifest.summary.unknown, 571); assert.equal(opted.manifest.summary.visible, 35);
  assert.ok(opted.manifest.clips.slice(1).every(clip => clip.role === 'benchmark'));
  assert.deepEqual(opted.manifest.publicationAuthorization, originalPublicationAuthorization());
  assert.notEqual(opted.manifest.clips[0].license.id, 'CC-BY-4.0');
  assert.equal(sha256(opted.files.get('demo/videos/pickleball-original.mp4')), ORIGINAL_PUBLIC_SOURCE.sha256);
});

test('authorized cached original A/B changes source display name only, all337 gaps preserved', async () => {
  const { files, manifest } = await publicOriginalData();
  for (const arm of ['classical', 'specialist']) {
    const rawBytes = await readFile(resolve(SOURCE_ROOT, ORIGINAL_PUBLIC_SOURCE[arm].file));
    assert.equal(sha256(rawBytes), ORIGINAL_PUBLIC_SOURCE[arm].sha256);
    const raw = JSON.parse(rawBytes); const publishedBytes = files.get(`demo/sessions/${arm}/pickleball-original.json`);
    const published = JSON.parse(publishedBytes);
    assert.equal(published.source.name, 'pickleball-original.mp4');
    assert.equal(published.frames.length, 337);
    assert.equal(manifest.clips[0].sessionSha256[arm], sha256(publishedBytes));
    assert.equal(manifest.clips[0].inputCachedSessionSha256[arm], ORIGINAL_PUBLIC_SOURCE[arm].sha256);
    published.source.name = raw.source.name;
    assert.deepEqual(published, raw);
  }
});

test('original has no invented reference point or inherited tennis cases/statistics', async () => {
  const { files } = await publicOriginalData(); const evidence = JSON.parse(files.get('demo/evidence/pickleball-original.json'));
  assert.equal(evidence.labels.length, 337); assert.equal(evidence.cases.length, 0);
  assert.ok(evidence.labels.every((label, frame) => label.frame === frame && label.status === 'unknown' && label.point === null));
  assert.equal(evidence.summary.visible, 0); assert.equal(evidence.summary.unknown, 337);
  assert.deepEqual(evidence.summary.classical, { tp: 0, fn: 0, fp: 0 });
  assert.deepEqual(evidence.summary.specialist, { tp: 0, fn: 0, fp: 0 });
  assert.equal(evidence.falseAlarmRateOnAbsentFrames, null);
});

test('opt-in inventory allows four pinned videos, default inventory still refuses original metadata/media', async () => {
  await mkdir(cache, { recursive: true }); const directory = await mkdtemp(resolve(cache, 'court-export-original-'));
  try {
    const receipt = await exportCourtPublic({ output: directory, includeUserOriginal: true });
    const files = await inventoryDirectory(directory, { publicationAuthorization: originalPublicationAuthorization() });
    assert.deepEqual(files, receipt.files); assert.equal(files.filter(file => file.path.endsWith('.mp4')).length, 4);
    assert.ok(receipt.totalBytes < 18_000_000);
    await assert.rejects(inventoryDirectory(directory));
    const textFiles = files.filter(file => !file.path.endsWith('.mp4'));
    for (const file of textFiles) rejectPrivateContent(await readFile(resolve(directory, file.path), 'utf8'), file.path, originalPublicationAuthorization());
    await assert.rejects(exportCourtPublic({ output: directory }), /Unexpected existing output file/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
