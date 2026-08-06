// Fast browser contract test for detection UI and worker wiring.
// Workers are deterministic mocks: this test does NOT prove model quality,
// model compatibility, backend support or inference latency.

import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';
import { installMockWorkers } from './helpers/mock-workers.mjs';
import { startPreview, stopPreview, waitForPreview } from './helpers/preview-server.mjs';

const PORT = 4181;
const BASE = `http://localhost:${PORT}`;
const ROOT = new URL('..', import.meta.url).pathname;

function log(...args) {
  console.log('[detect-e2e:mock]', ...args);
}

const failures = [];
const check = (name, condition, extra = '') => {
  if (condition) log('PASS·', name);
  else {
    failures.push(`${name}${extra ? ` · ${extra}` : ''}`);
    log('FAIL·', name, extra);
  }
};

const server = startPreview(ROOT, PORT);

let browser;
try {
  await waitForPreview(server);
  const executablePath = await resolveBrowserExecutable();
  log('browser:', executablePath);
  browser = await chromium.launch(browserLaunchOptions(executablePath));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await page.addInitScript(installMockWorkers);

  await page.goto(`${BASE}/?webgl=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#badge-render')?.textContent?.includes('RENDER · WEB'));
  check('detection là opt-in', !(await page.isChecked('#detect-toggle')));
  check('label tools ẩn trước opt-in', await page.isHidden('#label-tools'));

  await page.evaluate(() => { window.__failMockDetectionLoadOnce = true; });
  await page.click('#start-btn');
  await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('hidden'), null, { timeout: 30_000 });
  check('mock depth mở được luồng camera/UI', await page.locator('#boot').evaluate((element) => element.classList.contains('hidden')));

  await page.check('#detect-toggle');
  await page.waitForFunction(() => window.__detectionInitCount >= 2);
  check('lỗi tải model tự retry bằng worker WASM sạch', await page.evaluate(() => window.__detectionInitCount === 2));
  check('detection mặc định ép WASM ổn định', await page.evaluate(() => window.__lastDetectionInit?.forceWasm === true));
  await page.waitForFunction(() => document.querySelector('#obj-status')?.textContent?.includes('lỗi frame'));
  check('infer error phục hồi về trạng thái sẵn sàng', (await page.textContent('#obj-status'))?.includes('lỗi frame'));

  await page.evaluate(() => { window.__allowMockDetection = true; });
  await page.waitForFunction(() => document.querySelectorAll('.obj-row').length === 2);
  check('hiển thị hai detection cố định', (await page.locator('.obj-row').count()) === 2);
  check('overlay có hai bounding box', (await page.locator('#det-overlay > rect:not(.det-label-bg)').count()) === 2);
  check('detection giữ nguồn 384 px độc lập với depth WASM 140 px', await page.evaluate(() => window.__lastDetectionFrame?.width === 384));
  const panelCenterDelta = await page.evaluate(() => {
    const panel = document.querySelector('#obj-panel')?.getBoundingClientRect();
    const viewport = document.querySelector('#viewport')?.getBoundingClientRect();
    if (!panel || !viewport) return Number.POSITIVE_INFINITY;
    return Math.abs(panel.y + panel.height / 2 - (viewport.y + viewport.height / 2));
  });
  check('panel vật thể căn giữa theo trục Y', panelCenterDelta < 1, `lệch ${panelCenterDelta.toFixed(2)} px`);

  await page.selectOption('#engine-select', 'owlvit');
  await page.waitForFunction(() => !document.querySelector('#query-ctl')?.hidden);
  await page.waitForFunction(() => document.querySelector('#obj-status')?.textContent?.includes('OWL-ViT'));
  check('chuyển engine bật query control', await page.isVisible('#query-ctl'));
  check('worker contract nhận engine OWL-ViT', (await page.textContent('#obj-status'))?.includes('OWL-ViT'));
  await page.selectOption('#query-preset', 'mobility');
  await page.waitForFunction(() => window.__lastDetectionQueries?.includes('bus'));
  check('preset mobility cấp query canonical cho worker', await page.evaluate(() =>
    JSON.stringify(window.__lastDetectionQueries) === JSON.stringify(['person', 'car', 'bus', 'bicycle', 'motorcycle'])
  ));
  check('preset đồng bộ lại ô query', (await page.inputValue('#query-input')) === 'person, car, bus, bicycle, motorcycle');
  await page.fill('#query-input', 'dog, person');
  check('sửa query tay chuyển preset sang tuỳ chỉnh', (await page.inputValue('#query-preset')) === 'custom');

  await page.waitForFunction(() => document.querySelectorAll('.obj-row').length === 2);
  await page.click('#freeze-btn');
  await page.waitForFunction(() => !document.querySelector('#frozen-tag')?.hidden);
  await page.locator('.obj-row .obj-name').first().dblclick();
  const relabel = page.locator('.obj-name-input');
  await relabel.fill('operator');
  await relabel.press('Enter');
  await page.locator('.obj-row .obj-del').nth(1).click();
  check('relabel và delete giữ một annotation', (await page.locator('.obj-row').count()) === 1);
  check('annotation đã đổi nhãn', (await page.locator('.obj-name').first().textContent()) === 'operator');

  const downloadPromise = page.waitForEvent('download');
  await page.click('#exp-coco');
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const coco = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  check('COCO export có một annotation', coco.annotations?.length === 1);
  check('COCO export giữ nhãn operator', coco.categories?.some((category) => category.name === 'operator'));

  const fatal = consoleErrors.filter((error) =>
    !error.includes('[roboeye-detect] fixture infer error') &&
    !error.includes('[roboeye-detect] fixture detection load error') &&
    !error.includes('favicon') &&
    !error.includes('404')
  );
  check('không có lỗi console ngoài lỗi phục hồi chủ đích', fatal.length === 0, fatal.slice(0, 3).join(' | '));
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
log('KẾT QUẢ: TẤT CẢ PASS (mock contract, không phải model quality)');
