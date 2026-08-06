// Product-release contract: onboarding, local diagnostics, responsive layout
// and service-worker offline shell. Worker mocks do not prove model quality.

import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';
import { installMockWorkers } from './helpers/mock-workers.mjs';
import { startPreview, stopPreview, waitForPreview } from './helpers/preview-server.mjs';

const PORT = 4182;
const BASE = `http://localhost:${PORT}`;
const ROOT = new URL('..', import.meta.url).pathname;
const failures = [];

function log(...args) { console.log('[release-e2e:mock]', ...args); }
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
  const executablePath = await resolveBrowserExecutable();
  log('browser:', executablePath);
  browser = await chromium.launch(browserLaunchOptions(executablePath));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(installMockWorkers);
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()} · ${request.failure()?.errorText ?? 'failed'}`));
  await page.goto(`${BASE}/?webgl=1&demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#badge-render')?.textContent?.includes('RENDER · WEB'));
  check('UI hiển thị version 1.2.0', (await page.textContent('#app-version')) === 'v1.2.0');
  check('boot rail có bốn tầng thật', (await page.locator('.perception-rail li').count()) === 4);
  check('demo mode đánh dấu CTA khuyến nghị', (await page.getAttribute('#demo-start-btn', 'class'))?.includes('recommended'));
  if (process.env.ROBOEYE_RELEASE_SHOT) {
    await page.screenshot({ path: process.env.ROBOEYE_RELEASE_SHOT, fullPage: true });
  }

  await page.evaluate(() => { window.__failMockDepthLoadOnce = true; });
  await page.click('#demo-start-btn');
  await page.waitForFunction(() => document.querySelector('#boot-error')?.textContent?.includes('fixture depth load error'));
  check('lỗi tải depth hiện hướng dẫn và cho retry', !(await page.isDisabled('#demo-start-btn')));
  await page.click('#demo-start-btn');
  await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('hidden'));
  await page.waitForFunction(() => !document.querySelector('#tour')?.hidden);
  const expectedModes = ['rgb', 'depth', 'cloud', 'bev'];
  for (let i = 0; i < expectedModes.length; i++) {
    const active = await page.getAttribute(`.mode-btn[data-mode="${expectedModes[i]}"]`, 'class');
    check(`tour bước ${i + 1} mở ${expectedModes[i]}`, active?.includes('active'));
    if (expectedModes[i] === 'bev') {
      const bevTelemetry = await page.evaluate(() => {
        const status = document.querySelector('#bev-status');
        return {
          visible: status instanceof HTMLElement && !status.hidden,
          inSidebar: status?.parentElement?.id === 'sidebar',
          fontSize: status ? Number.parseFloat(getComputedStyle(status).fontSize) : 99
        };
      });
      check('telemetry A* nằm ngoài canvas trong sidebar', bevTelemetry.visible && bevTelemetry.inSidebar);
      check('telemetry A* dùng cỡ chữ nhỏ', bevTelemetry.fontSize <= 9, `${bevTelemetry.fontSize}px`);
    }
    await page.click('#tour-next');
  }
  check('tour hoàn tất và đóng', await page.isHidden('#tour'));

  const diagnosticDownload = page.waitForEvent('download');
  await page.click('#diagnostics-btn');
  const download = await diagnosticDownload;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const diagnostic = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  check('diagnostics ghi localOnly và version', diagnostic.localOnly === true && diagnostic.app?.version === '1.2.0');
  check('diagnostics có sự kiện tour/runtime', diagnostic.events?.length > 3);

  for (const viewport of [
    { width: 375, height: 667, label: 'mobile' },
    { width: 768, height: 1024, label: 'tablet' },
    { width: 1440, height: 900, label: 'desktop' }
  ]) {
    await page.setViewportSize(viewport);
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check(`${viewport.label} không tràn ngang`, noOverflow);
  }
  await page.setViewportSize({ width: 375, height: 667 });
  check('mobile có nút mở điều khiển', await page.isVisible('#mobile-controls-btn'));
  await page.click('#mobile-controls-btn');
  check('mobile mở được controls', await page.isVisible('#sidebar-controls'));

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker.controller != null);
  const cachedAssets = await page.evaluate(async () => {
    const cache = await caches.open('roboeye-app-1.2.0');
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  check('service worker đã cache JS/CSS app shell', cachedAssets.some((path) => /\/assets\/index-.*\.js$/.test(path)) && cachedAssets.some((path) => /\/assets\/index-.*\.css$/.test(path)), cachedAssets.slice(-5).join(', '));
  await stopPreview(server);
  const cachedFetchWorks = await page.evaluate(async () => {
    const script = [...document.scripts].find((item) => item.src.includes('/assets/index-'))?.src;
    if (!script) return false;
    try { return (await fetch(script)).ok; } catch { return false; }
  });
  check('service worker phục vụ asset khi mất mạng', cachedFetchWorks);
  const offlinePage = await context.newPage();
  offlinePage.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  offlinePage.on('requestfailed', (request) => failedRequests.push(`${request.url()} · ${request.failure()?.errorText ?? 'failed'}`));
  await offlinePage.goto(`${BASE}/?webgl=1&demo=1`, { waitUntil: 'domcontentloaded' });
  const offlineState = await offlinePage.evaluate(() => ({
    version: document.querySelector('#app-version')?.textContent,
    controller: navigator.serviceWorker.controller?.scriptURL ?? null
  }));
  check('app shell mở được trong tab mới khi offline', offlineState.version === 'v1.2.0', JSON.stringify(offlineState));
  await offlinePage.close();

  const fatal = consoleErrors.filter((error) =>
    !error.includes('[roboeye] fixture depth load error') &&
    !error.includes('favicon') &&
    !error.includes('404')
  );
  check('không có lỗi console nghiêm trọng', fatal.length === 0, [...fatal.slice(0, 2), ...failedRequests.slice(0, 2)].join(' | '));
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
log('KẾT QUẢ: TẤT CẢ PASS (release contract, không phải model quality)');
