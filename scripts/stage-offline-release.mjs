import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(ROOT, 'tests', '.model-cache');
const target = join(ROOT, 'dist', 'models', 'onnx-community', 'depth-anything-v2-small');
const manifest = JSON.parse(await readFile(join(ROOT, 'tests', 'fixtures', 'depth-q8.manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

for (const file of manifest.files) {
  const info = await stat(join(cache, file.path));
  if (info.size !== file.bytes) throw new Error(`Fixture source sai kích thước: ${file.path}`);
}

await mkdir(target, { recursive: true });
await cp(cache, target, { recursive: true });

const offline = {
  schemaVersion: 1,
  version: pkg.version,
  depth: {
    repository: manifest.repository,
    revision: manifest.revision,
    files: manifest.files
  },
  detectionModelsIncluded: false
};
await writeFile(join(ROOT, 'dist', 'offline.json'), `${JSON.stringify(offline, null, 2)}\n`);

const releasePath = join(ROOT, 'dist', 'release.json');
const release = JSON.parse(await readFile(releasePath, 'utf8'));
release.offlineDepth = true;
release.depthRevision = manifest.revision;
await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`);

console.log(`[offline] staged ${manifest.repository}@${manifest.revision} for RoboEye v${pkg.version}`);
