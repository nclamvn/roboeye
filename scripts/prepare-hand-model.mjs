// Stage the pinned MediaPipe Hand Landmarker used by RoboHand.
import { createHash } from 'node:crypto';
import { readFile, mkdir, rename, unlink, statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('tests/fixtures/hand-tracking.manifest.json',root),'utf8'));
const entry = manifest.model;
const target = new URL('public/models/hand/hand_landmarker.task',root);
const valid = bytes => bytes.byteLength === entry.bytes && createHash('sha256').update(bytes).digest('hex') === entry.sha256;
let existing = false;
try { existing = valid(await readFile(target)); } catch {}
if (existing) { console.log('[hand-model] PASS existing pinned hand model verified'); process.exit(0); }
if (process.argv.includes('--verify-only')) throw new Error('Pinned hand model missing or invalid. Run npm run assets:hand.');
const disk = await statfs(fileURLToPath(root));
if (disk.bavail * disk.bsize < 10 * 1024 ** 3) throw new Error('Less than 10 GiB free. Model staging stopped.');
const response = await fetch(entry.url, { signal: AbortSignal.timeout(90_000) });
if (!response.ok) throw new Error(`Hand model HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (!valid(bytes)) throw new Error('Pinned hand checksum/size mismatch.');
await mkdir(new URL('public/models/hand/',root),{recursive:true});
const part = new URL(`${target.href}.part`);
try {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(part,bytes,{flag:'wx'}); await rename(part,target);
} finally { await unlink(part).catch(()=>{}); }
console.log(`[hand-model] PASS ${entry.bytes} bytes, SHA-256 ${entry.sha256}`);
