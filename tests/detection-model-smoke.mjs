// Live compatibility gate for the two production detection models.
// Unlike detection-e2e.mjs, this downloads and initializes real pinned models.

import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';
import { startPreview, stopPreview, waitForPreview } from './helpers/preview-server.mjs';

const PORT = 4183;
const BASE = `http://localhost:${PORT}`;
const ROOT = new URL('..', import.meta.url).pathname;
const failures = [];

function log(...args) { console.log('[detect-models:real]', ...args); }
function check(name, condition, extra = '') {
  if (condition) log('PASS·', name);
  else {
    failures.push(`${name}${extra ? ` · ${extra}` : ''}`);
    log('FAIL·', name, extra);
  }
}

const server = startPreview(ROOT, PORT);
let browser;
try {
  await waitForPreview(server);
  browser = await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()} · ${request.failure()?.errorText ?? 'failed'}`));

  await page.goto(`${BASE}/?webgl=1&detection-model-smoke=1`, { waitUntil: 'domcontentloaded' });
  await page.check('#detect-toggle');
  await page.waitForFunction(
    () => document.querySelector('#obj-status')?.textContent?.includes('RT-DETR · WASM'),
    null,
    { timeout: 180_000 }
  );
  check('RT-DETR pinned q8 khởi tạo bằng WASM', (await page.textContent('#obj-status'))?.includes('RT-DETR · WASM'));

  await page.click('#start-btn');
  await page.waitForFunction(
    () => /^\d+ vật · RT-DETR/.test(document.querySelector('#obj-status')?.textContent ?? ''),
    null,
    { timeout: 180_000 }
  );
  check('RT-DETR chạy inference thật trên fake camera', /^\d+ vật · RT-DETR/.test((await page.textContent('#obj-status')) ?? ''));

  await page.selectOption('#engine-select', 'owlvit');
  await page.waitForFunction(
    () => document.querySelector('#obj-status')?.textContent?.includes('OWL-ViT · WASM'),
    null,
    { timeout: 300_000 }
  );
  check('OWL-ViT pinned q8 khởi tạo bằng WASM', (await page.textContent('#obj-status'))?.includes('OWL-ViT · WASM'));
  await page.waitForFunction(
    () => /^\d+ vật · OWL-ViT/.test(document.querySelector('#obj-status')?.textContent ?? ''),
    null,
    { timeout: 240_000 }
  );
  check('OWL-ViT chạy inference thật trên fake camera', /^\d+ vật · OWL-ViT/.test((await page.textContent('#obj-status')) ?? ''));

  const fatal = consoleErrors.filter((error) =>
    !error.includes('favicon') &&
    !error.includes('404') &&
    !error.includes('VerifyEachNodeIsAssignedToAnEp') &&
    !error.includes('Rerunning with verbose output')
  );
  check('không có lỗi model/worker/request', fatal.length === 0 && failedRequests.length === 0, [...fatal, ...failedRequests].slice(0, 4).join(' | '));
} catch (error) {
  failures.push(`Exception: ${error instanceof Error ? error.message : String(error)}`);
  log('EXCEPTION', error);
} finally {
  await browser?.close();
  await stopPreview(server);
}

log('──────────────────────────────');
if (failures.length) {
  log(`KẾT QUẢ: ${failures.length} FAIL`);
  failures.forEach((failure) => log(' -', failure));
  process.exit(1);
}
log('KẾT QUẢ: TẤT CẢ PASS (real pinned model compatibility)');
