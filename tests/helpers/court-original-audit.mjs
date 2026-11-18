import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join, resolve, relative, extname } from 'node:path';

export const ORIGINAL_SHA = '767842eec2a34d478f8d4a5f3680c18f6eac889147f81fa332f7a02730542474';
export const ORIGINAL_ID = 'pickleball-original';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const originalInputs = {
  classical: { sha: 'a1803cbbfa30e5f5180739a8819c5fe5cad4c941186aaefb2ff72cbfb182090f', path: `.court-cache/${ORIGINAL_SHA}/session.json`, observed: 85 },
  specialist: { sha: 'f49a19b09088d82a2b1ac2ea956f956cef059dce38d25455377a614ed2e9b07e', path: `.court-cache/${ORIGINAL_SHA}/specialist/46932bb5bc5d99a1c972a2e3fc72f4bad03635c369099889567f6e763574a0d4/session.json`, observed: 59 },
};
const tennisHashes = new Set(['82337e2c228455da4e431c8dd07672c3452018ab781603d9e0fe5d1b8c8e403b', '5654c81889eb979495112d52cb50cb064934d35c250196cbb4b7a3f80919f42d', '109c2a048f61d85f707255413efac3728cbff228e783bef825bac1c0d41799ff']);

/** Independent opt-in audit. One exact authorized source, not a general private-media exception. */
export async function auditOriginalPackage(root, dist) {
  const mainBytes = await readFile(join(dist, 'demo/manifest.json')), advertised = JSON.parse(mainBytes).eventEvidence;
  const derivativePins = new Map(); let eventEvidence = null;
  if (advertised) {
    assert.deepEqual(advertised, { path: './events/manifest.json', sha256: 'f973c0692dc9b44fda54a9351366003170735c75eb1cf0f2f5a94600a35d752b' });
    const bytes = await readFile(join(dist, 'demo/events/manifest.json')); assert.equal(digest(bytes), advertised.sha256); eventEvidence = JSON.parse(bytes);
    assert.equal(eventEvidence.source.sha256, ORIGINAL_SHA); assert.equal(eventEvidence.schemaVersion, 'roboeye-court-event-evidence-v1');
    assert.equal(eventEvidence.events.length, 2);
    for (const e of eventEvidence.events) for (const a of [e.still, ...e.context.filter(c => c.status === 'available').map(c => c.asset), e.clip]) {
      assert.match(a.path, /^(?:stills\/frame-\d{6}\.png|clips\/frames-\d{6}-\d{6}\.mp4)$/);
      derivativePins.set(`demo/events/${a.path}`, a);
    }
    assert.equal(derivativePins.size, 12);
  }
  const inventory = [];
  async function walk(dir) {
    for (const name of await readdir(dir)) {
      const file = join(dir, name), info = await lstat(file); assert.equal(info.isSymbolicLink(), false);
      if (info.isDirectory()) await walk(file);
      else {
        assert.ok(info.isFile()); const bytes = await readFile(file), path = relative(dist, file);
        assert.ok(['.html', '.css', '.mjs', '.json', '.txt', '.md', '.svg', '.mp4'].includes(extname(path)) || extname(path) === '.png' && derivativePins.has(path), path);
        if (path.endsWith('.mjs')) assert.ok(['app.mjs', 'core.mjs', 'contact.mjs'].includes(path), `Unexpected public JavaScript module: ${path}`);
        assert.doesNotMatch(path, /1794900295688|\.env|\.git(?:\/|$)|credential|\.onnx$|\.pt$|\.pth$|\.zip$|\.tar/i);
        const derivative = derivativePins.get(path);
        if (derivative) { assert.equal(digest(bytes), derivative.sha256); assert.equal(bytes.length, derivative.bytes); }
        if (extname(path) === '.mp4') assert.ok(tennisHashes.has(digest(bytes)) || digest(bytes) === ORIGINAL_SHA || derivative, 'Non-authorized media');
        else if (extname(path) === '.png') assert.ok(derivative);
        else assert.doesNotMatch(bytes.toString('utf8'), /1794900295688|\/Users\/|\/private\/var\/|file:\/\/|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bsk-[A-Za-z0-9_-]{24,}/);
        inventory.push({ path, bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  await walk(dist);
  assert.equal(inventory.filter(f => f.path.endsWith('.mp4')).length, eventEvidence ? 6 : 4);
  assert.equal(new Set(inventory.filter(f => f.path.endsWith('.mp4')).map(f => f.sha256)).size, eventEvidence ? 6 : 4);
  assert.ok(inventory.reduce((n, f) => n + f.bytes, 0) < 24 * 1024 * 1024);
  const load = async path => JSON.parse(await readFile(path, 'utf8'));
  const manifest = await load(join(dist, 'demo/manifest.json'));
  assert.equal(manifest.schemaVersion, 'roboeye-court-public-v2'); assert.equal(manifest.clips.length, 4);
  assert.equal(manifest.defaultClip, ORIGINAL_ID);
  assert.deepEqual(manifest.publicationAuthorization, { kind: 'explicit-user-publication', sourceSha256: ORIGINAL_SHA, scope: 'public-original-video', authorized: true });
  const benchmarkSummary = { visible: 35, unknown: 234, verifiedAbsent: 0,
    classical: { tp: 19, fn: 16, fp: 0 }, specialist: { tp: 28, fn: 7, fp: 0 },
    paired: { bothCorrect: 16, recovered: 12, regressed: 3, bothMiss: 4 } };
  assert.deepEqual(manifest.benchmarkSummary, benchmarkSummary);
  assert.deepEqual(manifest.summary, { ...benchmarkSummary, unknown: 571 });
  const asset = path => {
    const url = new URL(path, 'https://audit.invalid/demo/manifest.json');
    assert.equal(url.origin, 'https://audit.invalid'); assert.equal(url.search, ''); assert.equal(url.hash, '');
    const file = resolve(dist, `.${decodeURIComponent(url.pathname)}`); assert.ok(file.startsWith(`${dist}/`));
    assert.ok(inventory.some(f => f.path === relative(dist, file))); return file;
  };
  const original = manifest.clips.find(c => c.id === ORIGINAL_ID);
  assert.equal(original.role, 'user-original'); assert.equal(original.sourceSha256, ORIGINAL_SHA);
  assert.deepEqual(original.license, { id: 'user-authorized-publication', scope: 'public-original-video' });
  assert.deepEqual(original.publicationAuthorization, manifest.publicationAuthorization);
  assert.deepEqual([original.width, original.height, original.fps, original.frameCount, original.durationSeconds], [854, 480, 25, 337, 13.48]);
  assert.equal(digest(await readFile(asset(original.video))), ORIGINAL_SHA);
  const sessions = {};
  for (const arm of ['classical', 'specialist']) {
    const input = originalInputs[arm], rawBytes = await readFile(join(root, input.path)); assert.equal(digest(rawBytes), input.sha);
    assert.equal(original.inputCachedSessionSha256[arm], input.sha);
    const raw = JSON.parse(rawBytes), exportedBytes = await readFile(asset(original.sessions[arm])), exported = JSON.parse(exportedBytes);
    assert.equal(digest(exportedBytes), original.sessionSha256[arm]);
    assert.equal(exported.source.name, `${ORIGINAL_ID}.mp4`);
    assert.deepEqual(exported, { ...raw, source: { ...raw.source, name: `${ORIGINAL_ID}.mp4` } }, `${arm} must change display name ONLY`);
    assert.equal(exported.frames.length, 337); assert.equal(exported.summary.observedFrames, input.observed);
    assert.equal(exported.frames.filter(f => f.status === 'observed').length, input.observed);
    sessions[arm] = exported;
  }
  const evidence = await load(asset(original.evidence));
  assert.equal(evidence.schemaVersion, 'roboeye-court-evidence-v1'); assert.equal(evidence.sourceSha256, ORIGINAL_SHA);
  assert.equal(evidence.labels.length, 337); assert.equal(evidence.cases.length, 0);
  for (const [frame, label] of evidence.labels.entries()) { assert.equal(label.frame, frame); assert.equal(label.status, 'unknown'); assert.equal(label.point, null); }
  const benchmarkGold = await load(join(root, 'docs/evidence/court-m2/gold-sealed-r2.json'));
  const benchmarkCases = [];
  for (const clip of manifest.clips.filter(c => c.id !== ORIGINAL_ID)) {
    assert.equal(clip.role, 'benchmark'); assert.ok(tennisHashes.has(clip.sourceSha256));
    assert.equal(digest(await readFile(asset(clip.video))), clip.sourceSha256);
    const labels = await load(asset(clip.evidence)), frozenLabels = benchmarkGold.clips.find(c => c.id === clip.id).labels;
    assert.equal(labels.labels.length, frozenLabels.length);
    for (const [i, label] of labels.labels.entries()) assert.deepEqual({ frame: label.frame, status: label.status, point: label.point }, { frame: i, status: frozenLabels[i].status, point: frozenLabels[i].point });
    benchmarkCases.push(...labels.cases.map(c => ({ ...c, clipId: clip.id })));
    for (const arm of ['classical', 'specialist']) {
      const exportedBytes = await readFile(asset(clip.sessions[arm])); assert.equal(digest(exportedBytes), clip.sessionSha256[arm]);
      const frozen = await readFile(join(root, `docs/evidence/court-m2/arms/${arm === 'classical' ? 'A' : 'B'}/${clip.id}.json`));
      assert.equal(digest(exportedBytes), digest(frozen));
    }
  }
  assert.equal(benchmarkCases.length, 35);
  assert.deepEqual(benchmarkCases.filter(c => c.category === 'regressed').map(c => [c.clipId, c.frame]), [['tennist-01', 81], ['tennist-02', 84], ['tennist-03', 64]]);
  const release = await load(join(dist, 'release-inventory.json'));
  assert.deepEqual(release.files.map(f => f.path).sort(), inventory.filter(f => f.path !== 'release-inventory.json').map(f => f.path).sort());
  for (const file of release.files) assert.deepEqual(inventory.find(f => f.path === file.path), file);
  if (eventEvidence) {
    assert.deepEqual(eventEvidence.sessionSha256, original.inputCachedSessionSha256);
    for (const [path, asset] of derivativePins) assert.ok(inventory.some(f => f.path === path && f.sha256 === asset.sha256 && f.bytes === asset.bytes));
    assert.deepEqual(eventEvidence.events.map(e => [e.index, e.kind, e.clipWindow.startFrame, e.clipWindow.endFrame]), [[101, 'suspected-contact', 74, 128], [232, 'edge-loss-review', 203, 264]]);
  }
  return { manifest, original, sessions, evidence, inventory, benchmarkCases, eventEvidence };
}
