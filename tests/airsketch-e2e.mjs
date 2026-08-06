// T16 browser contract: reserved sidecar, pointer fallback, classifier result,
// phrase composition and responsive layout. Workers are deterministic mocks.
import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';
import { installMockWorkers } from './helpers/mock-workers.mjs';
import { startPreview, stopPreview, waitForPreview } from './helpers/preview-server.mjs';

const PORT = 4184;
const ROOT = new URL('..', import.meta.url).pathname;
const failures = [];
const server = startPreview(ROOT, PORT);
let browser;

function check(name, condition, extra = '') {
  console.log(`[airsketch-e2e:mock] ${condition ? 'PASS' : 'FAIL'} · ${name}${extra ? ` · ${extra}` : ''}`);
  if (!condition) failures.push(`${name}${extra ? ` · ${extra}` : ''}`);
}

try {
  await waitForPreview(server);
  const executablePath = await resolveBrowserExecutable();
  browser = await chromium.launch(browserLaunchOptions(executablePath));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(installMockWorkers);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      value: { cancel() {}, speak(value) { window.__spokenAirText = value.text; } }
    });
  });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://localhost:${PORT}/?webgl=1`, { waitUntil: 'domcontentloaded' });
  await page.click('#start-btn');
  await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('hidden'));

  const before = await page.locator('#stage').boundingBox();
  await page.click('#airsketch-btn');
  await page.waitForFunction(() => window.__roboeyeAirSketchBenchmark?.snapshot().ready.classifier === true);
  const after = await page.locator('#stage').boundingBox();
  check('sidecar dành chỗ riêng, không phủ camera', Boolean(before && after && after.width < before.width - 250));
  check('AirSketch ép về RGB để nét khớp camera', (await page.getAttribute('.mode-btn[data-mode="rgb"]', 'class'))?.includes('active'));
  check('canvas pointer fallback được bật', (await page.getAttribute('#airsketch-overlay', 'class'))?.includes('active'));

  const canvas = await page.locator('#airsketch-overlay').boundingBox();
  if (!canvas) throw new Error('Không tìm thấy canvas AirSketch');
  const path = [[0.25, 0.72], [0.25, 0.38], [0.50, 0.20], [0.75, 0.38], [0.75, 0.72], [0.25, 0.72], [0.50, 0.72], [0.50, 0.50], [0.62, 0.50]];
  await page.mouse.move(canvas.x + path[0][0] * canvas.width, canvas.y + path[0][1] * canvas.height);
  await page.mouse.down();
  for (const [x, y] of path.slice(1)) {
    await page.mouse.move(canvas.x + x * canvas.width, canvas.y + y * canvas.height, { steps: 3 });
  }
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#air-guess')?.textContent === 'ngôi nhà');
  const classify = await page.evaluate(() => window.__lastAirClassify);
  check('classifier nhận raster chuẩn 224×224 RGBA', classify?.width === 224 && classify?.height === 224 && classify?.bytes === 224 * 224 * 4, JSON.stringify(classify));
  check('top-3 dự đoán được hiển thị', await page.locator('#air-predictions button').count() === 3);
  if (process.env.ROBOEYE_AIRSKETCH_SHOT) {
    await page.screenshot({ path: process.env.ROBOEYE_AIRSKETCH_SHOT, fullPage: true });
  }

  await page.click('#air-predictions button:first-child');
  check('dự đoán ghép được vào câu AAC', (await page.textContent('#air-phrase')) === 'ngôi nhà');
  await page.click('#air-speak-btn');
  check('TTS đọc đúng câu đã ghép', (await page.evaluate(() => window.__spokenAirText)) === 'ngôi nhà');
  await page.click('#air-clear-btn');
  check('vẽ lại xóa toàn bộ stroke/point', await page.evaluate(() => {
    const value = window.__roboeyeAirSketchBenchmark?.snapshot();
    return value?.strokes === 0 && value.points === 0;
  }));

  await page.setViewportSize({ width: 375, height: 667 });
  const mobile = await page.evaluate(() => {
    const stage = document.querySelector('#stage')?.getBoundingClientRect();
    const dock = document.querySelector('#airsketch-dock')?.getBoundingClientRect();
    return {
      noOverflow: document.documentElement.scrollWidth <= innerWidth,
      dockBelow: Boolean(stage && dock && dock.top >= stage.bottom - 1)
    };
  });
  check('mobile sidecar xuống dưới và không tràn ngang', mobile.noOverflow && mobile.dockBelow, JSON.stringify(mobile));
  check('không có console error', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  console.error('[airsketch-e2e:mock] EXCEPTION', error);
} finally {
  await browser?.close();
  await stopPreview(server);
}

if (failures.length) {
  failures.forEach((failure) => console.error('[airsketch-e2e:mock] -', failure));
  process.exit(1);
}
console.log('[airsketch-e2e:mock] KẾT QUẢ: TẤT CẢ PASS');
