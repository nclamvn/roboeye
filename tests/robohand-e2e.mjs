// RoboHand worker-to-DOM/render contract. Deterministic workers prove wiring,
// state and telemetry; real-model latency remains covered by hand smoke.
import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';
import { installMockWorkers } from './helpers/mock-workers.mjs';
import { startPreview, stopPreview, waitForPreview } from './helpers/preview-server.mjs';

const PORT = 4186;
const ROOT = new URL('..', import.meta.url).pathname;
const failures = [];
const server = startPreview(ROOT, PORT);
let browser;

function check(name, condition, extra = '') {
  console.log(`[robohand-e2e:mock] ${condition ? 'PASS' : 'FAIL'} · ${name}${extra ? ` · ${extra}` : ''}`);
  if (!condition) failures.push(`${name}${extra ? ` · ${extra}` : ''}`);
}

function openHand(offsetX = 0) {
  const points = Array.from({ length: 21 }, () => ({ x: .5 + offsetX, y: .72, z: 0 }));
  points[0] = { x: .5 + offsetX, y: .84, z: 0 };
  points[1] = { x: .42 + offsetX, y: .70, z: 0 };
  points[2] = { x: .34 + offsetX, y: .61, z: 0 };
  points[3] = { x: .28 + offsetX, y: .51, z: 0 };
  points[4] = { x: .20 + offsetX, y: .42, z: 0 };
  for (const [mcp, pip, dip, tip, x] of [
    [5, 6, 7, 8, .40], [9, 10, 11, 12, .49], [13, 14, 15, 16, .57], [17, 18, 19, 20, .66]
  ]) {
    points[mcp] = { x: x + offsetX, y: mcp === 9 ? .58 : mcp === 17 ? .66 : .62, z: 0 };
    points[pip] = { x: x + offsetX, y: .49, z: 0 };
    points[dip] = { x: x + offsetX, y: .34, z: 0 };
    points[tip] = { x: x + offsetX, y: .22, z: 0 };
  }
  return points;
}

try {
  await waitForPreview(server);
  const executablePath = await resolveBrowserExecutable();
  browser = await chromium.launch(browserLaunchOptions(executablePath));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(installMockWorkers);
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://localhost:${PORT}/?webgl=1`, { waitUntil: 'domcontentloaded' });
  await page.click('#start-btn');
  await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('hidden'));
  await page.click('.mode-btn[data-mode="robohand"]');
  await page.waitForFunction(() => window.__roboeyeRoboHand?.active() === true);

  check('mode 5 mở RoboHand và dùng WebGL2 fallback',
    await page.isVisible('#robohand-hud') && (await page.textContent('#badge-render'))?.includes('WEBGL2'));
  check('proof camera nằm trong HUD, video dùng cùng local stream', await page.evaluate(() => {
    const video = document.querySelector('#robohand-video');
    return video instanceof HTMLVideoElement && video.srcObject instanceof MediaStream && video.readyState >= 2;
  }));

  await page.evaluate((frames) => window.__mockAirHandFrames.push(...frames), [
    openHand(), openHand(.01), openHand(.02), openHand(.03), openHand(.04)
  ]);
  await page.waitForFunction(() => document.querySelector('#robohand-pose')?.textContent === 'OPEN');
  const tracked = await page.evaluate(() => ({
    hand: document.querySelector('#robohand-handedness')?.textContent,
    pose: document.querySelector('#robohand-pose')?.textContent,
    latency: document.querySelector('#robohand-latency')?.textContent,
    canvasWidth: document.querySelector('#robohand-landmarks')?.width,
    metrics: window.__roboeyeRoboHand?.snapshot()
  }));
  check('worker → solver → rig giữ đúng handedness và gesture', tracked.hand === 'RIGHT' && tracked.pose === 'OPEN', JSON.stringify(tracked));
  check('PiP đã vẽ skeleton 21 điểm', tracked.canvasWidth > 1);
  check('camera-to-render và cadence có sample p50/p95',
    tracked.metrics?.pipeline.samples > 0 && tracked.metrics.pipeline.p95 != null &&
    tracked.metrics?.render.samples > 0 && tracked.metrics.render.p95 != null,
    JSON.stringify(tracked.metrics));
  check('HUD công khai latency hiện tại', /\d+ ms/.test(tracked.latency ?? ''), tracked.latency);

  await page.evaluate(() => window.__mockAirHandFrames.push(null));
  await page.waitForFunction(() => document.querySelector('#robohand-pose')?.textContent === 'HOLD');
  check('mất tracking ngắn giữ pose thay vì snap', (await page.textContent('#robohand-pose')) === 'HOLD');

  await page.setViewportSize({ width: 375, height: 667 });
  check('RoboHand mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('camera proof view còn nhìn được trên mobile', await page.isVisible('#robohand-video'));

  await page.click('.mode-btn[data-mode="rgb"]');
  check('rời mode dừng controller và ẩn HUD',
    await page.isHidden('#robohand-hud') && !(await page.evaluate(() => window.__roboeyeRoboHand?.active())));

  if (process.env.ROBOEYE_ROBOHAND_SHOT) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('.mode-btn[data-mode="robohand"]');
    await page.evaluate((frames) => window.__mockAirHandFrames.push(...frames), [openHand(), openHand(), openHand()]);
    await page.waitForFunction(() => document.querySelector('#robohand-pose')?.textContent === 'OPEN');
    await page.screenshot({ path: process.env.ROBOEYE_ROBOHAND_SHOT, fullPage: true });
  }

  check('không có lỗi runtime nghiêm trọng', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`Exception: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser?.close();
  await stopPreview(server);
}

if (failures.length) {
  console.error(`[robohand-e2e:mock] ${failures.length} FAIL`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log('[robohand-e2e:mock] TẤT CẢ PASS');

