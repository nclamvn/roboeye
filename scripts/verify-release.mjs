import { access, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const offline = process.argv.includes('--offline');
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const required = [
  'index.html',
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

if (offline) {
  await access(join(DIST, 'offline.json'));
  const manifest = JSON.parse(await readFile(join(ROOT, 'tests', 'fixtures', 'depth-q8.manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    const path = join(DIST, 'models', manifest.repository, file.path);
    const info = await stat(path);
    checks.push([`offline ${file.path}`, info.size === file.bytes]);
  }
  checks.push(['offline release flag', release.offlineDepth === true]);
}

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`[release] ${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) throw new Error(`Release verification failed: ${failed.map(([name]) => name).join(', ')}`);
console.log(`[release] PASS RoboEye v${pkg.version}${offline ? ' offline-depth' : ''}`);
