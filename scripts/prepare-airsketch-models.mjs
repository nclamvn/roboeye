import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(ROOT, 'tests', 'fixtures', 'airsketch.manifest.json'), 'utf8'));
const cache = process.env.ROBOEYE_AIRSKETCH_MODEL_CACHE
  ? resolve(process.env.ROBOEYE_AIRSKETCH_MODEL_CACHE)
  : join(ROOT, 'tests', '.airsketch-model-cache');
const verifyOnly = process.argv.includes('--verify-only');

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function verify(path, entry) {
  try {
    return (await stat(path)).size === entry.bytes && (await sha256(path)) === entry.sha256;
  } catch {
    return false;
  }
}

async function download(entry, target) {
  const part = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  await unlink(part).catch(() => {});
  try {
    const response = await fetch(entry.url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} khi tải ${entry.path}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part, { flags: 'wx' }));
    if (!(await verify(part, entry))) throw new Error(`checksum/size không khớp: ${entry.path}`);
    await unlink(target).catch(() => {});
    await rename(part, target);
  } catch (error) {
    await unlink(part).catch(() => {});
    throw error;
  }
}

let downloaded = 0;
for (const entry of manifest.files) {
  const target = join(cache, entry.path);
  if (await verify(target, entry)) {
    console.log(`[airsketch-fixture] OK ${entry.path}`);
    continue;
  }
  if (verifyOnly) throw new Error(`[airsketch-fixture] INVALID ${entry.path}`);
  await download(entry, target);
  downloaded++;
  console.log(`[airsketch-fixture] VERIFIED ${entry.path}`);
}
console.log(`[airsketch-fixture] PASS downloaded=${downloaded}`);
