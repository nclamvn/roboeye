// Smoke test E2E: chạy RoboEye trong Chromium headless với fake webcam.
// Trong container không có GPU thật nên đây kiểm chứng đường fallback (WebGL2 + WASM)
// đúng như mục 9 PRD yêu cầu "tắt WebGPU vẫn sống". Fps thật trên M1 đo ở nghiệm thu M1.
//
// Chạy: npm run build && node tests/smoke.mjs

import { chromium } from 'playwright-core';
import { mkdirSync, cpSync, existsSync } from 'node:fs';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';
import { startPreview, stopPreview, waitForPreview } from './helpers/preview-server.mjs';

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL('./shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

function log(...args) {
  console.log('[smoke]', ...args);
}

// 0. Serve fixture đã được presmoke tải và kiểm SHA-256 từ manifest.
//    Người dùng thật vẫn tải từ HF Hub như mặc định.
const cacheDir = new URL('./.model-cache/', import.meta.url).pathname;
const modelDir = new URL('../dist/models/onnx-community/depth-anything-v2-small/', import.meta.url).pathname;
if (!existsSync(cacheDir)) {
  console.error('Thiếu tests/.model-cache — chạy npm run fixtures:prepare trước');
  process.exit(1);
}
cpSync(cacheDir, modelDir, { recursive: true });
log('đã copy model q8 local vào dist/models');

// 1. Serve dist
const server = startPreview(new URL('..', import.meta.url).pathname, PORT);
await waitForPreview(server);
log('vite preview đang chạy ở', BASE);

const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) log('PASS·', name);
  else {
    log('FAIL·', name, extra);
    failures.push(`${name} ${extra}`);
  }
};

let browser;
try {
  // 2. Chromium với fake webcam
  const executablePath = await resolveBrowserExecutable();
  log('browser:', executablePath);
  browser = await chromium.launch(browserLaunchOptions(executablePath));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // Container không có GPU thật và Chromium bản cũ thiếu API WebGPU mới của three r185,
  // nên test làn fallback: render WebGL2 + inference WASM (đúng yêu cầu M4 của PRD).
  await page.goto(`${BASE}/?webgl=1&wasm=1&localmodels=1`, { waitUntil: 'domcontentloaded' });

  // 3. Boot: renderer khởi tạo, badge render có giá trị thật
  await page.waitForFunction(
    () => document.querySelector('#badge-render')?.textContent?.includes('RENDER · WEB'),
    null, { timeout: 30000 }
  );
  const renderBadge = await page.textContent('#badge-render');
  log('badge render:', renderBadge);
  check('R8 badge render hiển thị backend thật', /WEBGPU|WEBGL2/.test(renderBadge ?? ''));

  await page.screenshot({ path: `${OUT}00-boot.png` });

  // 4. Mở camera → model tải về → depth frame đầu tiên (tải model lần đầu có thể lâu)
  await page.click('#start-btn');
  await page.waitForFunction(() => {
    const s = document.querySelector('#boot-status')?.textContent ?? '';
    const err = document.querySelector('#boot-error');
    return s.includes('model') || s.includes('Model') || (err && !err.hidden);
  }, null, { timeout: 30000 });
  log('boot status:', await page.textContent('#boot-status'));

  await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('hidden'), null, {
    timeout: 300000
  });
  log('depth frame đầu tiên đã về, boot overlay ẩn');

  const inferBadge = await page.textContent('#badge-infer');
  log('badge infer:', inferBadge);
  check('R2+R8 worker inference chạy, badge infer thật', /WEBGPU|WASM/.test(inferBadge ?? ''));

  // 5. Bốn chế độ, phím 1 2 3 4 (R3)
  const modes = [
    ['2', 'depth', '01-depth.png'],
    ['3', 'cloud', '02-cloud.png'],
    ['4', 'bev', '03-bev.png'],
    ['1', 'rgb', '04-rgb.png']
  ];
  for (const [key, mode, shot] of modes) {
    await page.keyboard.press(key);
    await page.waitForTimeout(1500);
    const active = await page.getAttribute(`.mode-btn[data-mode="${mode}"]`, 'class');
    check(`R3 phím ${key} → chế độ ${mode}`, (active ?? '').includes('active'));
    await page.screenshot({ path: `${OUT}${shot}` });
  }

  // 6. Canvas thực sự vẽ gì đó (không phải màn đen tuyền) ở chế độ depth.
  // Không đọc pixel trực tiếp từ WebGL canvas được (preserveDrawingBuffer=false)
  // nên chụp vùng viewport và đo entropy qua kích thước PNG: màn đơn sắc nén còn
  // vài KB, depth map thật thì hàng chục KB.
  await page.keyboard.press('2');
  await page.waitForTimeout(2500);
  const clip = await page.evaluate(() => {
    const r = document.getElementById('viewport').getBoundingClientRect();
    return { x: r.x + 8, y: r.y + 8, width: r.width - 16, height: r.height - 16 };
  });
  const shotBuf = await page.screenshot({ clip });
  log('depth viewport PNG size:', shotBuf.length, 'bytes');
  check('Depth mode vẽ nội dung thật lên canvas', shotBuf.length > 25000, `png ${shotBuf.length} bytes`);

  // 7. Fps hiển thị số thật (R7, R8)
  const fpsInfer = await page.textContent('#fps-infer');
  const fpsRender = await page.textContent('#fps-render');
  log('fps infer:', fpsInfer, '· fps render:', fpsRender);
  check('R7 fps inference là số', /^\d+(\.\d+)?$/.test((fpsInfer ?? '').trim()));
  check('R7 fps render là số', /^\d+(\.\d+)?$/.test((fpsRender ?? '').trim()));

  // 8. Freeze (R6)
  await page.keyboard.press('3');
  await page.waitForTimeout(800);
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  const frozenVisible = await page.isVisible('#frozen-tag');
  check('R6 freeze bật tag FROZEN', frozenVisible);
  await page.screenshot({ path: `${OUT}05-frozen.png` });
  await page.keyboard.press('f');

  // 8b. TIP-05/06: alert chip tồn tại, click đặt đích trên BEV không gây lỗi
  await page.keyboard.press('4');
  await page.waitForTimeout(1200);
  const chipExists = (await page.locator('#alert-chip').count()) === 1;
  check('TIP-05 alert chip có trong DOM', chipExists);
  const vp = await page.evaluate(() => {
    const r = document.getElementById('viewport').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.3 };
  });
  await page.mouse.click(vp.x, vp.y);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}07-bev-goal.png` });
  log('TIP-06 đã click đặt đích trên BEV, chụp 07-bev-goal.png');

  // 9. Panel giải thích (R9)
  await page.keyboard.press('?');
  await page.waitForTimeout(400);
  const panelOpen = await page.getAttribute('#panel', 'class');
  check('R9 panel mở bằng phím ?', (panelOpen ?? '').includes('open'));
  const panelText = await page.textContent('#panel');
  check('R9 panel có nội dung tiếng Việt 4 tầng', ['Depth', 'Point Cloud', 'BEV', 'pinhole'].every((k) => panelText?.includes(k)));
  await page.screenshot({ path: `${OUT}06-panel.png` });

  // 10. Console không có lỗi nghiêm trọng lặp lại
  const fatal = consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('404'));
  log('console errors:', fatal.length ? fatal.slice(0, 5) : 'không');
  check('Không có lỗi console nghiêm trọng', fatal.length === 0, fatal.slice(0, 3).join(' | '));
} catch (e) {
  failures.push(`Exception: ${e.message}`);
  log('EXCEPTION', e);
} finally {
  await browser?.close();
  await stopPreview(server);
}

log('──────────────────────────────');
if (failures.length) {
  log(`KẾT QUẢ: ${failures.length} FAIL`);
  for (const f of failures) log(' -', f);
  process.exit(1);
} else {
  log('KẾT QUẢ: TẤT CẢ PASS');
}
