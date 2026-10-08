import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

// Read-only HTTP checks against a known build. Large models are hashed as streams,
// not persisted or held in memory. This does not validate physical phone inference.
const base = new URL(process.argv[2] ?? 'https://roboeye-drivesense.vercel.app');
assert.equal(base.protocol, 'https:');
const build = resolve('.vercel/output/static');
const expected = JSON.parse(await readFile(join(build, 'release.json'), 'utf8'));
const checks = [], failures = [];
const out = resolve(process.env.ROBOEYE_HTTPS_EVIDENCE_DIR ?? 'docs/evidence/tip61');
const reportPath = join(out,'https-deploy-verification.json');
async function localDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function verifyFile(path) {
  const local = join(build, path.replace(/^\//, ''));
  const url = new URL(path, base);
  url.searchParams.set('verify', expected.buildFingerprint);
  const response = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(180000)});
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; hash.update(chunk); }
  const sha256 = hash.digest('hex');
  assert.equal(bytes, (await stat(local)).size, `${path}: size`);
  assert.equal(sha256, await localDigest(local), `${path}: digest`);
  if (/\.onnx$|\.wasm$/.test(path)) assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/html/);
  const check = {path, status: response.status, bytes, sha256, contentType: response.headers.get('content-type')};
  checks.push(check);
  console.log(`PASS ${path} ${bytes} bytes SHA256 ${sha256}`);
  return response.headers;
}
try {
  const releaseUrl = new URL('/release.json', base);
  releaseUrl.searchParams.set('verify', expected.buildFingerprint);
  const response = await fetch(releaseUrl, {cache: 'no-store', signal: AbortSignal.timeout(30000)});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected, 'canonical production release matches prebuilt output');
  checks.push({path: '/release.json', status: 200, identity: expected});
  const headers = await verifyFile('/drive.html');
  const csp = headers.get('content-security-policy') ?? '';
  const permissions = headers.get('permissions-policy') ?? '';
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(permissions, /camera=\(self\)/);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  checks.push({check: 'security-headers', csp, permissions, xFrameOptions: headers.get('x-frame-options')});
  const html = await readFile(join(build, 'drive.html'), 'utf8');
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m => m[1]))];
  assert.ok(assets.some(path => /drive-.*\.js$/.test(path)), 'hashed drive entry present');
  const paths = [...assets,
    '/ort/ort-wasm-simd-threaded.jsep.mjs', '/ort/ort-wasm-simd-threaded.jsep.wasm',
    '/models/drive-metric/da2-outdoor-392x224.onnx',
    '/models/drive-metric/da2-outdoor-224x392.onnx',
    '/models/drive-detector/rtdetr-r18-640-webgpu.onnx',
    '/models/onnx-community/rtdetr_v2_r18vd-ONNX/onnx/model_quantized.onnx',
    '/models/onnx-community/rtdetr_v2_r18vd-ONNX/config.json',
    '/models/onnx-community/rtdetr_v2_r18vd-ONNX/preprocessor_config.json'];
  const entryPath = assets.find(path => /drive-.*\.js$/.test(path));
  const entry = await readFile(join(build, entryPath.slice(1)), 'utf8');
  assert.ok(entry.includes(expected.sourceFingerprint), 'executed entry embeds exact source fingerprint');
  const workers = [...new Set([...entry.matchAll(/"(\/assets\/(?:drive-range-worker|drive-detect-worker|detect-worker)-[^"/]+\.js)"/g)].map(m => m[1]))];
  assert.ok(workers.some(path => path.includes('drive-range-worker')), 'depth worker referenced');
  assert.ok(workers.some(path => path.includes('drive-detect-worker')), 'WebGPU detector referenced');
  assert.ok(workers.some(path => /\/detect-worker-/.test(path)), 'WASM detector referenced');
  paths.push(...workers);
  // Bound concurrent network/memory pressure, including the two large float models.
  let next = 0;
  await Promise.all(Array.from({length: 3}, async () => {
    while (next < paths.length) {
      const path = paths[next++];
      try { await verifyFile(path); }
      catch (error) { failures.push({path, message: error.message}); console.error(`FAIL ${path}: ${error.message}`); }
    }
  }));
} catch (error) { failures.push({message: error.message}); }
await mkdir(out, {recursive: true});
await writeFile(reportPath, JSON.stringify({verifiedAt: new Date().toISOString(), base: base.origin,
  scope: 'Public canonical HTTPS/static assets, exact bytes/fingerprints and security headers. Not physical iPhone acceptance.',
  pass: failures.length === 0, release: expected, checks, failures}, null, 2) + '\n');
assert.equal(failures.length, 0, JSON.stringify(failures));
console.log(`PASS live HTTPS ${checks.length} checks; evidence ${reportPath}`);
