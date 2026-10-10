/** Repeatable TIP-64A QA; no project copies, all browser scratch removed. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const root = new URL('..', import.meta.url).pathname;
const output = join(root, 'docs/evidence/tip64a'), baseline = join(output, 'baseline');
const scratch = await mkdtemp(join(tmpdir(), 'codex-tmp-tip64a-20261010-qa-'));
await mkdir(baseline, { recursive: true });
const previous = await readFile(join(output, 'qa-summary.json'), 'utf8').catch(() => null);
if (previous) await writeFile(join(output, 'qa-summary-previous.json'), previous);
const runs = [];
async function run(name, args) {
  const started = Date.now();
  const code = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { cwd: root, env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch, ROBOEYE_QA_OUTPUT: baseline }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; p.stdout.on('data', b => { log += b; process.stdout.write(b); }); p.stderr.on('data', b => { log += b; process.stderr.write(b); });
    p.on('error', reject); p.on('exit', async code => { try { await writeFile(join(output, `${name}.log`), log); resolve(code); } catch (error) { reject(error); } });
  });
  runs.push({ name, exitCode: code, elapsedMs: Date.now() - started });
  if (code !== 0) throw Error(`${name} failed with exit ${code}`);
}
let pass = false;
try {
  // Baseline suite builds frozen source before its browser/model checks.
  await run('drive-partner', ['scripts/qa-drive-partner.mjs']);
  await run('assistive-browser', ['--import', 'tsx', 'tests/assistive-lab-e2e.mjs']);
  // Preserve only small result JSON, not synthetic videos or Chrome profiles.
  const receipts = join(baseline, 'receipts'); await mkdir(receipts, { recursive: true });
  for (const dir of await readdir(scratch, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith('roboeye-')) continue;
    for (const file of await readdir(join(scratch, dir.name))) {
      if (file.endsWith('.json')) { const bytes = await readFile(join(scratch, dir.name, file)); if (bytes.length < 512 * 1024) await writeFile(join(receipts, `${dir.name}-${file}`), bytes); }
    }
  }
  pass = true;
} finally {
  await rm(scratch, { recursive: true, force: true });
  const release = await readFile(join(root, 'dist/release.json'), 'utf8').then(JSON.parse).catch(() => null);
  await writeFile(join(output, 'qa-summary.json'), JSON.stringify({ pass, softwareOnly: true, physicalPhoneAcceptance: 'NOT TESTED', runs, release,
    scratchDirectoryRemoved: scratch, modelDownloadsAdded: false, nativeProvidersImplemented: false }, null, 2));
}
