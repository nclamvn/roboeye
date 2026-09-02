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

function handLandmarks(x, pose) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.7, z: 0 }));
  points[0] = { x: 0.5, y: 0.82, z: 0 };
  points[5] = { x: 0.42, y: 0.62, z: 0 };
  points[17] = { x: 0.62, y: 0.63, z: 0 };
  for (const [pip, tip, fingerX] of [[6, 8, x], [10, 12, 0.49], [14, 16, 0.56], [18, 20, 0.63]]) {
    points[pip] = { x: fingerX, y: 0.49, z: 0 };
    points[tip] = { x: fingerX, y: pose === 'open' || pose === 'open-pinch' ? 0.25 : 0.72, z: 0 };
  }
  if (pose === 'index' || pose === 'pinch' || pose === 'open-pinch') points[8] = { x, y: 0.25, z: 0 };
  points[4] = pose === 'pinch' || pose === 'open-pinch' ? { x: x + 0.01, y: 0.255, z: 0 }
    : pose === 'fist' ? { x: 0.1, y: 0.7, z: 0 }
      : { x: 0.28, y: 0.52, z: 0 };
  return points;
}

function airDeskTransformLandmarks({ x, y, ratio, angle, flipped = false, open = false }) {
  const points = handLandmarks(x, 'pinch');
  const span = Math.hypot(points[5].x - points[17].x, points[5].y - points[17].y);
  points[8] = { x, y, z: 0 };
  points[4] = { x: x + span * ratio, y, z: 0 };
  for (const tip of [12, 16, 20]) points[tip] = { ...points[tip], y: open ? y : 0.72 };
  if (open) {
    // Translate the synthetic palm with the pointer. Extension is measured
    // relative to the wrist, so a bottom-stage open hand cannot keep the
    // fixture's original top-stage wrist/pip coordinates.
    points[0] = { ...points[0], y: y + 0.28 };
    points[5] = { ...points[5], y: y + 0.18 };
    points[17] = { ...points[17], y: y + 0.18 };
    for (const pip of [6, 10, 14, 18]) points[pip] = { ...points[pip], y: y + 0.14 };
  }
  const radius = 0.14;
  points[9] = {
    x: points[0].x - Math.cos(angle) * radius,
    y: points[0].y + Math.sin(angle) * radius,
    z: 0
  };
  if (flipped) {
    const indexX = points[5].x;
    points[5] = { ...points[5], x: points[17].x };
    points[17] = { ...points[17], x: indexX };
  }
  return points;
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

  // Regression contract T23: a fist is safe transport; a thumb-index pinch
  // is the static draw clutch through worker → controller → AirInkDocument.
  await page.evaluate((frames) => { window.__mockAirHandFrames.push(...frames); }, [
    handLandmarks(0.30, 'fist'),
    handLandmarks(0.30, 'index'), handLandmarks(0.30, 'pinch'), handLandmarks(0.36, 'pinch'),
    // A real tracker can momentarily report the other fingers as open while
    // thumb/index stay pinched. This must remain one continuous stroke.
    handLandmarks(0.42, 'open-pinch'), handLandmarks(0.48, 'pinch'), handLandmarks(0.48, 'index')
  ]);
  await page.waitForFunction(() => {
    const snapshot = window.__roboeyeAirSketchBenchmark?.snapshot();
    return Boolean(snapshot && snapshot.strokes === 1 && snapshot.points >= 3);
  });
  const handStrokeVisible = await page.evaluate(() => {
    const canvas = document.querySelector('#airsketch-overlay');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return false;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) return true;
    return false;
  });
  check('pinch liên tục không bị pose các ngón khác chớp sai làm đứt nét', handStrokeVisible);
  await page.evaluate((frames) => { window.__mockAirHandFrames.push(...frames); }, [
    handLandmarks(0.40, 'open'), handLandmarks(0.40, 'open'), handLandmarks(0.40, 'open'),
    handLandmarks(0.40, 'open'), handLandmarks(0.40, 'open'), handLandmarks(0.40, 'open'),
    handLandmarks(0.40, 'open'), handLandmarks(0.40, 'open'), handLandmarks(0.40, 'open'),
    handLandmarks(0.40, 'open'), handLandmarks(0.40, 'open'), handLandmarks(0.40, 'open'),
    // Natural two-finger grab: the remaining fingers stay open. This
    // regresses the former !openPalm guard that made the visible gesture
    // impossible to activate.
    handLandmarks(0.40, 'open-pinch'),
    handLandmarks(0.37, 'open-pinch'),
    handLandmarks(0.37, 'index')
  ]);
  await page.waitForFunction(() => (window.__roboeyeAirSketchBenchmark?.snapshot().objects ?? 0) >= 1);
  check('object đã đặt có thể xòe tay, pinch để cầm và thả để đặt lại',
    (await page.evaluate(() => window.__roboeyeAirSketchBenchmark?.snapshot().objects)) === 1);
  check('pipeline hand đo toàn tuyến capture → worker → UI',
    (await page.evaluate(() => window.__roboeyeAirSketchBenchmark?.snapshot().pipeline.samples ?? 0)) > 0);
  // The renderer keeps updating the camera while this sidecar button is used.
  // Invoke the native control directly so a test is not coupled to an unrelated
  // transient overlay hit-test in a resource-constrained CI browser.
  await page.locator('#air-clear-btn').evaluate((button) => button.click());
  await page.waitForFunction(() => window.__roboeyeAirSketchBenchmark?.snapshot().strokes === 0);

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
  check('classifier nhận raster QuickDraw chuẩn 28×28 RGBA', classify?.width === 28 && classify?.height === 28 && classify?.bytes === 28 * 28 * 4, JSON.stringify(classify));
  check('top-3 dự đoán được hiển thị', await page.locator('#air-predictions button').count() === 3);
  if (process.env.ROBOEYE_AIRSKETCH_SHOT) {
    await page.screenshot({ path: process.env.ROBOEYE_AIRSKETCH_SHOT, fullPage: true });
  }

  await page.click('#air-predictions button:first-child');
  check('dự đoán ghép được vào câu AAC', (await page.textContent('#air-phrase')) === 'ngôi nhà');
  await page.click('#air-speak-btn');
  check('TTS đọc đúng câu đã ghép', (await page.evaluate(() => window.__spokenAirText)) === 'ngôi nhà');
  await page.locator('#air-clear-btn').evaluate((button) => button.click());
  check('vẽ lại xóa toàn bộ stroke/point', await page.evaluate(() => {
    const value = window.__roboeyeAirSketchBenchmark?.snapshot();
    return value?.strokes === 0 && value.points === 0;
  }));

  // T30: AirDesk is deliberately a separate hand workspace. It exposes every
  // fingertip and leaves AirSketch's canvas/state machine out of the path.
  await page.click('#air-close-btn');
  await page.click('#airdesk-btn');
  await page.evaluate((frames) => { window.__mockAirHandFrames.push(...frames); }, [handLandmarks(0.35, 'open')]);
  await page.waitForFunction(() => document.querySelectorAll('.airdesk-finger').length === 5);
  check('AirDesk hiện đủ năm điểm đầu ngón, ngón duỗi có halo vàng', await page.evaluate(() =>
    document.querySelectorAll('.airdesk-finger').length === 5 && document.querySelectorAll('.airdesk-finger.extended').length >= 4
  ));
  const imageTarget = await page.evaluate(() => {
    const stage = document.querySelector('#stage')?.getBoundingClientRect();
    const image = document.querySelector('#airdesk-image')?.getBoundingClientRect();
    if (!stage || !image) return null;
    return {
      x: 1 - ((image.left + image.width / 2 - stage.left) / stage.width),
      y: (image.top + image.height / 2 - stage.top) / stage.height
    };
  });
  if (!imageTarget) throw new Error('Không tìm thấy vùng ảnh AirDesk');
  // Let the adaptive pointer settle over the image before closing the clutch.
  await page.evaluate((frames) => { window.__mockAirHandFrames.push(...frames); },
    Array.from({ length: 20 }, () => airDeskTransformLandmarks({
      x: imageTarget.x, y: imageTarget.y, ratio: 1.2, angle: -Math.PI / 2
    }))
  );
  await page.waitForFunction(() => {
    const pointer = document.querySelector('.airdesk-finger[data-finger="8"]')?.getBoundingClientRect();
    const image = document.querySelector('#airdesk-image')?.getBoundingClientRect();
    if (!pointer || !image) return false;
    const x = pointer.left + pointer.width / 2;
    const y = pointer.top + pointer.height / 2;
    return x >= image.left && x <= image.right && y >= image.top && y <= image.bottom;
  });
  await page.evaluate((frame) => { window.__mockAirHandFrames.push(frame); }, airDeskTransformLandmarks({
    x: imageTarget.x, y: imageTarget.y, ratio: 0.25, angle: -Math.PI / 2
  }));
  await page.waitForFunction(() => document.querySelector('#airdesk-gesture-mode')?.textContent === 'BIẾN ĐỔI 2 NGÓN');
  const destinationX = Math.max(0.08, imageTarget.x - 0.52);
  const transformFrames = [];
  for (let frame = 1; frame <= 10; frame++) {
    transformFrames.push(airDeskTransformLandmarks({
      x: imageTarget.x + (destinationX - imageTarget.x) * frame / 10,
      y: imageTarget.y,
      ratio: 0.25 + 0.55 * frame / 10,
      angle: -Math.PI / 2 + Math.PI * 0.62 * frame / 10
    }));
  }
  for (let frame = 0; frame < 10; frame++) {
    transformFrames.push(airDeskTransformLandmarks({
      x: destinationX, y: imageTarget.y, ratio: 0.80, angle: Math.PI * 0.12, flipped: true
    }));
  }
  await page.evaluate((frames) => { window.__mockAirHandFrames.push(...frames); }, transformFrames);
  await page.waitForFunction(() => document.querySelector('#airdesk-image')?.dataset.transformFlipX === 'true');
  const spatialGesture = await page.evaluate(() => {
    const image = document.querySelector('#airdesk-image');
    return {
      x: Number(image?.dataset.transformX),
      scale: Number(image?.dataset.transformScale),
      rotation: Number(image?.dataset.transformRotation),
      flip: image?.dataset.transformFlipX,
      held: image?.classList.contains('gesture-held')
    };
  });
  check('hai ngón kéo ảnh theo biên độ lớn trên toàn stage', spatialGesture.x > 0.38, JSON.stringify(spatialGesture));
  check('khoảng cách hai ngón zoom liên tục mà không làm rơi ảnh', spatialGesture.scale > 1.65 && spatialGesture.held, JSON.stringify(spatialGesture));
  check('góc bàn tay xoay ảnh và đổi mặt lật ảnh', spatialGesture.rotation > 50 && spatialGesture.flip === 'true', JSON.stringify(spatialGesture));
  await page.evaluate((frames) => { window.__mockAirHandFrames.push(...frames); }, Array.from({ length: 4 }, () =>
    airDeskTransformLandmarks({ x: destinationX, y: imageTarget.y, ratio: 0.9, angle: Math.PI * 0.12, flipped: true, open: true })
  ));
  await page.waitForFunction(() => !document.querySelector('#airdesk-image')?.classList.contains('gesture-held'));
  check('xòe cả bàn tay có xác nhận mới đặt ảnh', await page.textContent('#airdesk-status') === 'Đã đặt · chụm trên ảnh để cầm lại.');
  await page.click('[data-airdesk-action="reset-image"]');
  await page.click('[data-airdesk-action="rotate-right"]');
  check('AirDesk có canvas ảnh để xoay/lật/vẽ độc lập', await page.evaluate(() => {
    const image = document.querySelector('#airdesk-image');
    return !document.querySelector('#airdesk')?.hasAttribute('hidden') && image?.getAttribute('style')?.includes('--image-rotation: 15deg');
  }));
  await page.click('[data-airdesk-text-action="spell"]');
  check('AirDesk có đề xuất sửa chính tả trong editor nội bộ', await page.textContent('#airdesk-editor')?.then((text) => text?.includes('tập kết') ?? false));
  await page.click('#airdesk-close-btn');
  await page.click('#airsketch-btn');

  const heart = [[0.50, 0.18], [0.38, 0.08], [0.23, 0.08], [0.10, 0.20], [0.10, 0.38],
    [0.22, 0.62], [0.50, 0.92], [0.78, 0.62], [0.90, 0.38], [0.90, 0.20],
    [0.77, 0.08], [0.68, 0.12], [0.62, 0.08], [0.50, 0.18]];
  await page.mouse.move(canvas.x + heart[0][0] * canvas.width, canvas.y + heart[0][1] * canvas.height);
  await page.mouse.down();
  for (const [x, y] of heart.slice(1)) {
    await page.mouse.move(canvas.x + x * canvas.width, canvas.y + y * canvas.height, { steps: 3 });
  }
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#air-guess')?.textContent === 'trái tim');
  check('geometry fallback nâng trái tim lên đầu dù model không có lớp heart', await page.textContent('#air-guess') === 'trái tim');
  await page.locator('#air-clear-btn').evaluate((button) => button.click());

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
