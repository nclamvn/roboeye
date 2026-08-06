import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'tests', 'fixtures', 'detection-benchmark.manifest.json');
const CACHE_PATH = process.env.ROBOEYE_DETECTION_BENCHMARK_CACHE
  ? resolve(process.env.ROBOEYE_DETECTION_BENCHMARK_CACHE)
  : join(ROOT, 'tests', '.detection-benchmark-cache');
const STAGE_PATH = join(ROOT, 'dist', 'benchmark-fixtures');
const verifyOnly = process.argv.includes('--verify-only');
const shouldStage = process.argv.includes('--stage');
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
  const part = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  await unlink(part).catch(() => {});
  try {
    const response = await fetch(entry.url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} khi tải ${entry.id}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part, { flags: 'wx' }));
    if (!(await verify(part, entry))) throw new Error(`checksum/size không khớp sau khi tải ${entry.id}`);
    await unlink(target).catch(() => {});
    await rename(part, target);
  } catch (error) {
    await unlink(part).catch(() => {});
    throw error;
  }
}

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.cases) || manifest.cases.length === 0) {
  throw new Error('Detection benchmark manifest không hợp lệ');
}

let downloaded = 0;
for (const entry of manifest.cases) {
  if (basename(entry.file) !== entry.file) throw new Error(`Tên fixture không an toàn: ${entry.file}`);
  const target = join(CACHE_PATH, entry.file);
  if (await verify(target, entry)) {
    console.log(`[detection-fixture] OK ${entry.id} · ${entry.sha256.slice(0, 12)}`);
  } else {
    if (verifyOnly) throw new Error(`[detection-fixture] INVALID ${entry.id}`);
    console.log(`[detection-fixture] DOWNLOAD ${entry.id} (${entry.bytes} bytes)`);
    await download(entry, target);
    downloaded++;
    console.log(`[detection-fixture] VERIFIED ${entry.id}`);
  }

  if (shouldStage) {
    await mkdir(STAGE_PATH, { recursive: true });
    await copyFile(target, join(STAGE_PATH, entry.file));
  }
}

console.log(
  `[detection-fixture] PASS ${manifest.corpus} · downloaded=${downloaded}${shouldStage ? ' · staged=dist/benchmark-fixtures' : ''}`
);
