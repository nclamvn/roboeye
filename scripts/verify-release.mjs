import { createHash } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const offline = process.argv.includes('--offline');
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const required = [
  'index.html',
  'drive.html',
  'assist.html',
  'manifest.webmanifest',
  'icons/roboeye.svg',
  '_headers',
  'workers/air-hand-worker.js',
  'mediapipe/vision_bundle.js',
  'mediapipe/wasm/vision_wasm_internal.wasm',
  'sw.js',
  'release.json'
];

for (const file of required) await access(join(DIST, file));

const retired = ['media.html', 'media', 'models/airsketch', 'tflite', 'workers/air-classifier-worker.js'];
for (const path of retired) {
  const exists = await access(join(DIST, path)).then(() => true, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  });
  if (exists) throw new Error(`Retired asset leaked into release: ${path}`);
}
console.log('[release] PASS retired assets absent');

const [html, sw, headers, releaseText] = await Promise.all([
  readFile(join(DIST, 'index.html'), 'utf8'),
  readFile(join(DIST, 'sw.js'), 'utf8'),
  readFile(join(DIST, '_headers'), 'utf8'),
  readFile(join(DIST, 'release.json'), 'utf8')
]);
const release = JSON.parse(releaseText);

const checks = [
  ['release version', release.version === pkg.version],
  ['service worker version', sw.includes(`roboeye-app-'+VERSION`) && sw.includes(pkg.version)],
  ['CSP in HTML', html.includes('Content-Security-Policy') && html.includes("worker-src 'self' blob:")],
  ['permissions header', headers.includes('camera=(self)') && headers.includes('microphone=()')],
  ['versioned JS assets', /assets\/index-[A-Za-z0-9_-]+\.js/.test(html)]
];

const { model: hand } = JSON.parse(await readFile(join(ROOT, 'tests', 'fixtures', 'hand-tracking.manifest.json'), 'utf8'));
const handBytes = await readFile(join(DIST, 'models', 'hand', hand.path));
checks.push(['pinned hand model', handBytes.length === hand.bytes && createHash('sha256').update(handBytes).digest('hex') === hand.sha256]);

if (offline) {
  await access(join(DIST, 'offline.json'));
  const manifest = JSON.parse(await readFile(join(ROOT, 'tests', 'fixtures', 'depth-q8.manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    const path = join(DIST, 'models', manifest.repository, file.path);
    const info = await stat(path);
    checks.push([`offline ${file.path}`, info.size === file.bytes]);
  }
  checks.push(['offline release flag', release.offlineDepth === true]);
  checks.push(['offline hand tracking flag', release.offlineHandTracking === true]);
}

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`[release] ${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) throw new Error(`Release verification failed: ${failed.map(([name]) => name).join(', ')}`);
console.log(`[release] PASS RoboEye v${pkg.version}${offline ? ' offline-depth' : ''}`);
