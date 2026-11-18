import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { createCourtServer, hashFile, parseByteRange, prepareCourtSession, sha256, validateSession } from '../scripts/court-server-core.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const cache = resolve(root, '.court-cache');
const sourceSha = 'a'.repeat(64);
function fixture() {
  return { schemaVersion: 'roboeye-court-session-v1', source: { name: 'clip.mp4', sha256: sourceSha, width: 100, height: 80, fps: 25, frameCount: 1, durationSeconds: .04 },
    method: { id: 'test-fixture', kind: 'classical-cv', description: 'structural fixture, not inference', version: '1', limitations: ['not real video'] },
    frames: [{ index: 0, timeSeconds: 0, status: 'missing', ball: null, candidates: [], reason: 'no observation' }], lineSuggestions: [],
    summary: { observedFrames: 0, ambiguousFrames: 0, missingFrames: 1, analysisMs: 0 }, decision: { status: 'insufficient-evidence', reason: 'fixture' } };
}
test('byte ranges: full, suffix, open and clamp', () => {
  assert.equal(parseByteRange(undefined, 100), null);
  assert.deepEqual(parseByteRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseByteRange('bytes=95-', 100), { start: 95, end: 99 });
  assert.deepEqual(parseByteRange('bytes=-5', 100), { start: 95, end: 99 });
  assert.deepEqual(parseByteRange('bytes=1-999', 100), { start: 1, end: 99 });
  for (const bad of ['bytes=', 'bytes=2-1', 'bytes=100-', 'bytes=-0', 'bytes=0-1,4-5', 'items=0-1', 'bytes=999999999999999999999-']) assert.throws(() => parseByteRange(bad, 100));
});
test('session rejects mismatched source, held ball, forged verdict and summary', () => {
  const good = fixture(); assert.equal(validateSession(good, sourceSha), good);
  assert.throws(() => validateSession(good, 'b'.repeat(64)));
  for (const change of [s => s.decision.status = 'in', s => s.frames[0].ball = { x: 2 }, s => s.summary.observedFrames = 1,
    s => s.frames[0].timeSeconds = 8, s => s.frames[0].timeSeconds = .04,
    s => s.source.durationSeconds = .08, s => s.source.durationSeconds = 301,
    s => s.lineSuggestions.push({ id: 'bad', a: [0, 0], b: [1, 1], provenance: 'image-hough', confirmed: true })]) {
    const s = fixture(); change(s); assert.throws(() => validateSession(s, sourceSha));
  }
});

function rawGet(port, path, headers = {}, method = 'GET') {
  return new Promise((accept, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => accept({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end();
  });
}
test('allowlisted loopback server: ranges, methods, host, traversal and changed source', async () => {
  await mkdir(cache, { recursive: true }); const temp = await mkdtemp(resolve(cache, 'server-test-'));
  let server;
  try {
    const videoPath = resolve(temp, 'clip.mp4'); await writeFile(videoPath, Buffer.from('0123456789'));
    const stats = await stat(videoPath); const session = fixture(); session.source.sha256 = await hashFile(videoPath);
    server = createCourtServer({ root, videoPath, session, videoIdentity: stats }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port;
    assert.equal(server.address().address, '127.0.0.1');
    const range = await rawGet(port, '/api/video', { Range: 'bytes=2-5' }); assert.equal(range.status, 206); assert.equal(range.body.toString(), '2345'); assert.equal(range.headers['content-range'], 'bytes 2-5/10');
    const suffix = await rawGet(port, '/api/video', { Range: 'bytes=-3' }); assert.equal(suffix.body.toString(), '789');
    const head = await rawGet(port, '/api/video', {}, 'HEAD'); assert.equal(head.body.length, 0); assert.equal(head.headers['content-length'], '10');
    assert.equal((await rawGet(port, '/api/video', { Range: 'bytes=10-' })).status, 416);
    assert.equal((await rawGet(port, '/api/session')).status, 200);
    const contactModule = await rawGet(port, '/contact.mjs');
    assert.equal(contactModule.status, 200); assert.match(contactModule.headers['content-type'], /javascript/);
    assert.match(contactModule.body.toString(), /court-five-observation-turn-v1/);
    assert.equal((await rawGet(port, '/api/session', {}, 'POST')).status, 405);
    assert.equal((await rawGet(port, '/api/session', { Host: 'evil.invalid' })).status, 403);
    assert.equal((await rawGet(port, '/api/session', { Origin: 'https://evil.invalid' })).status, 403);
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/package.json', '/api/video/../../package.json', '/api/video%2f..']) assert.equal((await rawGet(port, path)).status, 404);
    const health = await rawGet(port, '/api/health'); assert.equal(JSON.parse(health.body).localOnly, true); assert.equal(health.headers['cache-control'], 'no-store'); assert.match(health.headers['permissions-policy'], /camera=\(\)/);
    await writeFile(videoPath, 'changed'); assert.equal((await rawGet(port, '/api/video')).status, 409);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(temp, { recursive: true, force: true });
  }
});

test('explicit cache requires matching source, analyzer and receipt bytes', async () => {
  await mkdir(cache, { recursive: true }); const temp = await mkdtemp(resolve(cache, 'cache-test-'));
  try {
    const videoPath = resolve(temp, 'clip.mp4'), analyzerPath = resolve(temp, 'analyzer.py'), analysisPath = resolve(temp, 'session.json');
    await writeFile(videoPath, 'video'); await writeFile(analyzerPath, '# test, never executed');
    const session = fixture(); session.source.sha256 = await hashFile(videoPath); const bytes = Buffer.from(JSON.stringify(session)); await writeFile(analysisPath, bytes);
    const options = { videoPath, analyzerPath, analysisPath, cacheRoot: temp, pythonPath: 'must-not-run' };
    await assert.rejects(prepareCourtSession(options), /receipt/);
    const receipt = { schemaVersion: 'roboeye-court-cache-v1', sourceSha256: session.source.sha256, analyzerSha256: await hashFile(analyzerPath), analysisSha256: sha256(bytes) };
    await writeFile(`${analysisPath}.receipt.json`, JSON.stringify(receipt));
    assert.equal((await prepareCourtSession(options)).cacheUsed, true);
    await writeFile(analysisPath, `${await readFile(analysisPath, 'utf8')} `);
    await assert.rejects(prepareCourtSession(options), /receipt/);
    await writeFile(analysisPath, bytes); await writeFile(analyzerPath, '# changed');
    await assert.rejects(prepareCourtSession(options), /receipt/);
    await writeFile(analyzerPath, '# test, never executed'); await writeFile(videoPath, 'video changed');
    await assert.rejects(prepareCourtSession(options), /receipt/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

const model = () => ({ id: 'structural-fixture-not-inference', artifactSha256: 'b'.repeat(64), sourceUrl: 'https://example.com/test-only-model',
  license: 'MIT', revision: 'test-fixture', configSha256: 'c'.repeat(64), preprocessId: 'test-input' });
test('learned metadata cannot be relabelled as classical or swapped under an expected artifact', () => {
  const learned = fixture(); learned.method.kind = 'learned-ball';
  assert.throws(() => validateSession(learned, sourceSha));
  learned.method.model = model(); assert.equal(validateSession(learned, sourceSha, model()), learned);
  assert.throws(() => validateSession(learned, sourceSha, { ...model(), artifactSha256: 'f'.repeat(64) }));
  learned.method.kind = 'classical-cv'; assert.throws(() => validateSession(learned, sourceSha));
});

test('two-arm server exposes only prepared same-source methods and rejects unavailable arms', async () => {
  await mkdir(cache, { recursive: true }); const temp = await mkdtemp(resolve(cache, 'ab-server-test-'));
  let server;
  try {
    const videoPath = resolve(temp, 'clip.mp4'); await writeFile(videoPath, 'structural-video-bytes');
    const classical = fixture(); classical.source.sha256 = await hashFile(videoPath);
    const specialist = structuredClone(classical); specialist.method = { ...specialist.method, id: 'specialist-test', kind: 'learned-ball', model: model() };
    server = createCourtServer({ root, videoPath, sessions: { classical, specialist }, videoIdentity: await stat(videoPath) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port;
    const catalogue = JSON.parse((await rawGet(port, '/api/methods')).body);
    assert.equal(catalogue.defaultDetector, 'classical'); assert.deepEqual(catalogue.methods.map(item => item.key), ['classical', 'specialist']);
    assert.equal(JSON.parse((await rawGet(port, '/api/session?detector=specialist')).body).method.model.artifactSha256, model().artifactSha256);
    assert.equal(JSON.parse((await rawGet(port, '/api/session')).body).method.kind, 'classical-cv');
    assert.equal((await rawGet(port, '/api/session?detector=unknown')).status, 400);
    const wrong = structuredClone(specialist); wrong.source.fps = 20; wrong.source.durationSeconds = .05;
    assert.throws(() => createCourtServer({ root, videoPath, sessions: { classical, specialist: wrong }, videoIdentity: {} }), /timeline/);
    assert.throws(() => createCourtServer({ root, videoPath, session: classical, defaultDetector: 'specialist', videoIdentity: {} }), /chưa được chuẩn bị/);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(temp, { recursive: true, force: true });
  }
});

test('specialist cache binds actual weight bytes, helper and adapter, never classical cache', async () => {
  await mkdir(cache, { recursive: true }); const temp = await mkdtemp(resolve(cache, 'model-cache-test-'));
  try {
    const videoPath = resolve(temp, 'clip.mp4'), weightsPath = resolve(temp, 'weights.bin'), helper = resolve(temp, 'helper.py');
    const analyzerPath = resolve(temp, 'structural-fixture.mjs');
    await writeFile(videoPath, 'fixture-video'); await writeFile(weightsPath, 'fixture-weight-not-a-model'); await writeFile(helper, '# test helper');
    const metadata = { ...model(), artifactSha256: await hashFile(weightsPath) };
    const output = fixture(); output.source.sha256 = await hashFile(videoPath); output.method.kind = 'learned-ball'; output.method.model = metadata;
    // This stub only exercises process/cache wiring; it is explicitly not a model run.
    await writeFile(analyzerPath, `import{writeFileSync}from'node:fs';writeFileSync(process.argv[process.argv.indexOf('--output')+1],JSON.stringify(${JSON.stringify(output)}));`);
    const options = { videoPath, pythonPath: process.execPath, analyzerPath, cacheRoot: temp, detector: 'specialist', weightsPath,
      modelMetadata: metadata, dependencyPaths: [helper], device: 'cpu' };
    const first = await prepareCourtSession(options); assert.equal(first.cacheUsed, false); assert.match(first.analysisPath, /specialist/);
    const receipt = JSON.parse(await readFile(`${first.analysisPath}.receipt.json`, 'utf8'));
    assert.equal(receipt.schemaVersion, 'roboeye-court-cache-v2'); assert.equal(receipt.model.artifactSha256, metadata.artifactSha256);
    assert.equal((await prepareCourtSession(options)).cacheUsed, true);
    await writeFile(helper, '# changed helper');
    await assert.rejects(prepareCourtSession({ ...options, analysisPath: first.analysisPath }), /receipt/);
    await writeFile(helper, '# test helper'); await writeFile(analyzerPath, `${await readFile(analyzerPath, 'utf8')}\n// changed adapter`);
    await assert.rejects(prepareCourtSession({ ...options, analysisPath: first.analysisPath }), /receipt/);
    await writeFile(weightsPath, 'modified weights'); await assert.rejects(prepareCourtSession(options), /artifact SHA/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
