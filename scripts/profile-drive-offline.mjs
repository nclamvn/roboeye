import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {access, mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {basename, extname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright-core';
import {browserLaunchOptions, resolveBrowserExecutable} from '../tests/helpers/browser.mjs';
import {startDev, stopPreview, waitForPreview} from '../tests/helpers/preview-server.mjs';

const presets = new Set(['quality', 'balanced', 'fast']);
const videoPath = process.env.DRIVE_VIDEO;
const preset = process.env.DRIVE_PRESET ?? 'balanced';
const timeoutMs = Number(process.env.DRIVE_TIMEOUT_MS ?? 7_200_000);
const port = Number(process.env.DRIVE_PORT ?? 4196);
const root = new URL('..', import.meta.url).pathname;
const outputDir = process.env.DRIVE_OUTPUT_DIR ?? join(tmpdir(), 'roboeye-drive-offline-profile');

if (!videoPath) throw Error('Cần DRIVE_VIDEO=/đường/dẫn/video.mp4.');
if (!presets.has(preset)) throw Error('DRIVE_PRESET chỉ nhận quality, balanced hoặc fast.');
if (!Number.isFinite(timeoutMs) || timeoutMs < 60_000) throw Error('DRIVE_TIMEOUT_MS phải từ 60000 trở lên.');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('DRIVE_PORT không hợp lệ.');
await access(videoPath);
await mkdir(outputDir, {recursive: true});

const stem = basename(videoPath, extname(videoPath)).replace(/[^a-z0-9_-]+/gi, '-');
const reportPath = join(outputDir, `${stem}-${preset}-report.json`);
const summaryPath = join(outputDir, `${stem}-${preset}-summary.json`);
const screenshotPath = join(outputDir, `${stem}-${preset}.png`);
const configuredBase = process.env.DRIVE_BASE;
const server = configuredBase ? null : startDev(root, port);
if (server) await waitForPreview(server);
const base = configuredBase ?? `http://127.0.0.1:${port}`;
const browser = await chromium.launch(await browserLaunchOptions(await resolveBrowserExecutable()));

function sha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('error', reject).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
  });
}

try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto(`${base}/drive.html?v=offline-profile-${preset}`, {waitUntil: 'domcontentloaded'});
  await page.locator('#analysis-preset').evaluate((select, value) => {
    select.value = value;
    select.dispatchEvent(new Event('change', {bubbles: true}));
  }, preset);
  await page.setInputFiles('#file', videoPath);
  await page.waitForFunction(() => {
    const title = document.querySelector('#job-title')?.textContent ?? '';
    return title === 'Đã phân tích xong' || title === 'Không xử lý được video';
  }, null, {timeout: timeoutMs});

  const state = await page.evaluate(() => ({
    title: document.querySelector('#job-title')?.textContent,
    detail: document.querySelector('#job-detail')?.textContent,
    analysis: document.querySelector('#analysis-status')?.textContent,
    status: document.querySelector('#status')?.textContent,
    detector: document.querySelector('#backend')?.textContent,
    metric: document.querySelector('#metric-backend')?.textContent,
    durationS: document.querySelector('video')?.duration,
    source: document.querySelector('#source-label')?.textContent
  }));
  assert.equal(state.title, 'Đã phân tích xong', JSON.stringify(state, null, 2));
  assert.deepEqual(pageErrors, []);
  await page.screenshot({path: screenshotPath, fullPage: true});
  await page.evaluate(() => { document.querySelector('#analysis-panel').open = true; });
  const downloadPromise = page.waitForEvent('download');
  await page.click('#report');
  const download = await downloadPromise;
  await download.saveAs(reportPath);

  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.version, 7);
  assert.equal(report.mode, 'analysed-replay');
  assert.equal(report.offlineAnalysis?.preset, preset);
  assert.equal(report.offlineAnalysis?.cacheHit, false);
  assert.ok(report.frameTiming?.count > 0);
  assert.ok(report.frameTiming?.analysisElapsedMs > 0);
  const [sourceStat, sourceSha256] = await Promise.all([stat(videoPath), sha256(videoPath)]);
  const summary = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    source: {name: basename(videoPath), bytes: sourceStat.size, sha256: sourceSha256},
    state,
    runtime: report.runtime,
    model: report.model,
    rangeModel: report.rangeModel,
    offlineAnalysis: report.offlineAnalysis,
    frameTiming: report.frameTiming,
    detection: {
      sampledFrames: report.samples.length,
      boxes: report.samples.reduce((sum, sample) => sum + sample.boxes.length, 0),
      depthSuccess: report.samples.filter(sample => sample.metricState === 'success').length,
      depthSkipped: report.samples.filter(sample => sample.metricState === 'skipped').length,
      depthFailed: report.samples.filter(sample => sample.metricState === 'failed').length
    },
    limitations: report.limits,
    artifacts: {reportPath, screenshotPath},
    pageErrors
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({...summary, artifacts: {...summary.artifacts, summaryPath}}, null, 2));
} finally {
  await browser.close();
  if (server) await stopPreview(server);
}
