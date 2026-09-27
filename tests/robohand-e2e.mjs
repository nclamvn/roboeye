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

function handAtRoot(rootX, rootY, pinching = false) {
  const points = openHand();
  const wristX = .5 - rootX / 3.2;
  const wristY = .58 - rootY / 2.2;
  const dx = wristX - points[0].x, dy = wristY - points[0].y;
  for (const point of points) { point.x += dx; point.y += dy; }
  if (pinching) {
    const x = (points[4].x + points[8].x) / 2;
    const y = (points[4].y + points[8].y) / 2;
    points[4] = { x: x - .004, y, z: 0 };
    points[8] = { x: x + .004, y, z: 0 };
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
  check('RoboHand dựng MediaPipe graph với hai tay',
    await page.evaluate(() => window.__lastAirHandInit?.numHands === 2));
  check('RoboHand dùng profile continuity riêng mà không hạ confidence phát hiện ban đầu',
    await page.evaluate(() => {
      const profile=window.__lastAirHandInit?.confidence;
      return profile?.detection===.5&&profile?.presence===.42&&profile?.tracking===.35;
    }));
  check('proof camera nằm trong HUD, video dùng cùng local stream', await page.evaluate(() => {
    const video = document.querySelector('#robohand-video');
    return video instanceof HTMLVideoElement && video.srcObject instanceof MediaStream && video.readyState >= 2;
  }));

  await page.evaluate((frames) => window.__mockAirHandFrames.push(...frames), [
    openHand(), openHand(.01), openHand(.02), openHand(.03), openHand(.04)
  ]);
  await page.waitForFunction(() => document.querySelector('#robohand-pose')?.textContent === 'Một tay đang đồng bộ');
  const tracked = await page.evaluate(() => ({
    hand: document.querySelector('#robohand-handedness')?.textContent,
    pose: document.querySelector('#robohand-pose')?.textContent,
    latency: document.querySelector('#robohand-latency')?.textContent,
    canvasWidth: document.querySelector('#robohand-landmarks')?.width,
    metrics: window.__roboeyeRoboHand?.snapshot()
  }));
  check('worker → solver → rig giữ một tay độc lập', tracked.hand === '1 TAY' && tracked.pose === 'Một tay đang đồng bộ', JSON.stringify(tracked));
  check('PiP đã vẽ skeleton 21 điểm', tracked.canvasWidth > 1);
  check('camera-to-render và cadence có sample p50/p95',
    tracked.metrics?.pipeline.samples > 0 && tracked.metrics.pipeline.p95 != null &&
    tracked.metrics?.render.samples > 0 && tracked.metrics.render.p95 != null,
    JSON.stringify(tracked.metrics));
  check('HUD công khai latency hiện tại', /\d+ ms/.test(tracked.latency ?? ''), tracked.latency);

  await page.evaluate((frame) => window.__mockAirHandFrames.push(frame), {
    hands: [
      { landmarks: openHand(-.17), handedness: 'Left' },
      { landmarks: openHand(.17), handedness: 'Right' }
    ]
  });
  await page.waitForFunction(() => document.querySelector('#robohand-handedness')?.textContent === '2 TAY');
  check('hai bàn tay đi qua cùng một worker và hai controller độc lập',
    (await page.textContent('#robohand-pose')) === 'Hai tay đang đồng bộ');

  // Full interaction contract: acquire at the phone station, retain through
  // an ambiguous sample, then release only after a deliberate OPEN dwell.
  await page.evaluate((landmarks) => window.__mockAirHandFrames.push({hands:[{landmarks,handedness:'Left'}]}),
    handAtRoot(-1.05,-.18,false));
  await page.evaluate((landmarks) => window.__mockAirHandFrames.push({hands:[{landmarks,handedness:'Left'}]}),
    handAtRoot(-1.05,-.18,true));
  await page.waitForFunction(() => document.querySelector('#robohand-pose')?.textContent?.includes('Đã cầm điện thoại'));
  check('pinch acquires the phone at its palm station',true);
  if (process.env.ROBOEYE_ROBOHAND_GRIP_SHOT)
    await page.screenshot({path:process.env.ROBOEYE_ROBOHAND_GRIP_SHOT,fullPage:true});
  await page.evaluate((landmarks) => window.__mockAirHandFrames.push({hands:[{landmarks,handedness:'Left'}]}),
    handAtRoot(-.35,.18,false));
  await page.waitForTimeout(140);
  await page.evaluate((landmarks) => window.__mockAirHandFrames.push({hands:[{landmarks,handedness:'Left'}]}),
    handAtRoot(-.35,.18,false));
  await page.waitForFunction(() => document.querySelector('#robohand-pose')?.textContent?.includes('Đã thả điện thoại'));
  check('stable OPEN releases the phone into falling state',true);

  await page.evaluate(() => window.__mockAirHandFrames.push(null, null, null, null));
  await page.waitForFunction(() => document.querySelector('#robohand-handedness')?.textContent === '—');
  await page.waitForTimeout(750);
  await page.evaluate(() => window.__mockAirHandFrames.push(null));
  await page.waitForFunction(() => document.querySelector('#robohand-pose')?.textContent === 'Đưa tay vào camera');
  check('mất tracking trả studio về trạng thái an toàn',
    (await page.textContent('#robohand-pose')) === 'Đưa tay vào camera');

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
    await page.waitForFunction(() => document.querySelector('#robohand-pose')?.textContent === 'Một tay đang đồng bộ');
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
