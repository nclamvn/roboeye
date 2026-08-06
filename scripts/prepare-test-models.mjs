import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'tests', 'fixtures', 'depth-q8.manifest.json');
const CACHE_PATH = process.env.ROBOEYE_MODEL_CACHE
  ? resolve(process.env.ROBOEYE_MODEL_CACHE)
  : join(ROOT, 'tests', '.model-cache');
const verifyOnly = process.argv.includes('--verify-only');
const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function verify(path, expected) {
  try {
    const info = await stat(path);
    if (info.size !== expected.bytes) return false;
    return (await sha256(path)) === expected.sha256;
  } catch {
    return false;
  }
}

async function download(entry, target) {
  const encodedPath = entry.path.split('/').map(encodeURIComponent).join('/');
  const url = `https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${encodedPath}`;
  const part = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  await unlink(part).catch(() => {});
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} khi tải ${entry.path}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part, { flags: 'wx' }));
    if (!(await verify(part, entry))) {
      throw new Error(`checksum/size không khớp sau khi tải ${entry.path}`);
    }
    await unlink(target).catch(() => {});
    await rename(part, target);
  } catch (error) {
    await unlink(part).catch(() => {});
    throw error;
  }
}

let downloaded = 0;
for (const entry of manifest.files) {
  const target = join(CACHE_PATH, entry.path);
  if (await verify(target, entry)) {
    console.log(`[fixture] OK ${entry.path}`);
    continue;
  }
  if (verifyOnly) throw new Error(`[fixture] INVALID ${entry.path}`);
  console.log(`[fixture] DOWNLOAD ${entry.path} (${entry.bytes} bytes)`);
  await download(entry, target);
  downloaded++;
  console.log(`[fixture] VERIFIED ${entry.path}`);
}

console.log(`[fixture] PASS ${manifest.repository}@${manifest.revision} · downloaded=${downloaded}`);
