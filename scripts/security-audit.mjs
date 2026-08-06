import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAudit, hasNativeBundleExposure, hasSourceSharpExposure } from './security-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACCEPTED_PATH = join(ROOT, 'security', 'accepted-risks.json');
const DIST_PATH = join(ROOT, 'dist');
const accepted = JSON.parse(readFileSync(ACCEPTED_PATH, 'utf8'));
const riskById = new Map(accepted.risks.map((risk) => [risk.id, risk]));

function fail(message) {
  console.error(`[security] FAIL: ${message}`);
  process.exitCode = 1;
}

function filesUnder(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const auditRun = spawnSync(npmCommand, ['audit', '--json'], { cwd: ROOT, encoding: 'utf8' });
let audit;
try {
  audit = JSON.parse(auditRun.stdout);
} catch {
  fail(`không đọc được npm audit JSON${auditRun.stderr ? `: ${auditRun.stderr.trim()}` : ''}`);
  process.exit();
}

const vulnerabilities = audit.vulnerabilities ?? {};
const today = new Date().toISOString().slice(0, 10);
const policy = evaluateAudit(vulnerabilities, accepted.risks, today);
for (const violation of policy.violations) fail(violation);
const unexpected = policy.unexpected;
if (unexpected.length) fail(`high/critical advisory ngoài allowlist: ${unexpected.join(', ')}`);

const transformersPackage = JSON.parse(readFileSync(join(ROOT, 'node_modules', '@huggingface', 'transformers', 'package.json'), 'utf8'));
const webEntry = transformersPackage.exports?.default?.default;
if (typeof webEntry !== 'string' || !webEntry.includes('transformers.web')) {
  fail('Transformers.js không còn khai báo conditional browser export như đã review');
}

const sourceFiles = filesUnder(join(ROOT, 'src')).filter((path) => /\.(?:ts|js|mjs|cjs)$/.test(path));
const sourceExposure = sourceFiles.filter((path) => hasSourceSharpExposure(readFileSync(path, 'utf8')));
if (sourceExposure.length) fail(`application source import sharp: ${sourceExposure.join(', ')}`);

let bundleExposure = [];
try {
  const bundleFiles = filesUnder(DIST_PATH).filter((path) => /\.(?:js|mjs|cjs)$/.test(path));
  bundleExposure = bundleFiles.filter((path) => hasNativeBundleExposure(readFileSync(path, 'utf8')));
} catch {
  fail('thiếu dist/; chạy npm run build trước security:audit');
}
if (bundleExposure.length) fail(`sharp/libvips signal trong browser bundle: ${bundleExposure.join(', ')}`);

if (process.exitCode) process.exit();

const counts = audit.metadata?.vulnerabilities ?? {};
console.log(`[security] npm audit: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high`);
if (policy.observedAccepted.length) {
  for (const id of policy.observedAccepted) {
    const risk = riskById.get(id);
    console.log(`[security] ACCEPTED-RISK ${id} (${risk.package}) · review trước ${risk.reviewBy}`);
  }
} else {
  console.log('[security] không còn advisory high/critical thuộc accepted-risk');
}
console.log(`[security] browser export: ${webEntry}`);
console.log('[security] source/bundle sharp exposure: 0');
console.log('[security] PASS');
