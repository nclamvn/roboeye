// Fast browser contract test for detection UI and worker wiring.
// Workers are deterministic mocks: this test does NOT prove model quality,
// model compatibility, backend support or inference latency.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';

const PORT = 4181;
const BASE = `http://localhost:${PORT}`;
const ROOT = new URL('..', import.meta.url).pathname;

function log(...args) {
  console.log('[detect-e2e:mock]', ...args);
}

function waitForPreview(server) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite preview không lên sau 20s')), 20_000);
    const onData = (data) => {
      if (String(data).includes('localhost')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`vite preview thoát sớm, code ${code}`));
    });
  });
}

const failures = [];
const check = (name, condition, extra = '') => {
  if (condition) log('PASS·', name);
  else {
    failures.push(`${name}${extra ? ` · ${extra}` : ''}`);
    log('FAIL·', name, extra);
  }
};

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'pipe'
});

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

  await page.addInitScript(() => {
    window.__allowMockDetection = false;

    class MockWorker {
      constructor(url) {
        this.kind = String(url).includes('detect-worker') ? 'detection' : 'depth';
        this.onmessage = null;
        this.onerror = null;
        this.terminated = false;
        this.engine = 'rtdetr';
      }

      emit(data, delay = 0) {
        setTimeout(() => {
          if (!this.terminated) this.onmessage?.({ data });
        }, delay);
      }

      postMessage(message) {
        if (this.terminated) return;
        if (this.kind === 'depth') {
          if (message.type === 'init') {
            this.emit({ type: 'ready', device: 'wasm', dtype: 'q8' });
          } else if (message.type === 'frame') {
            const depth = new Uint8Array(message.width * message.height);
            for (let i = 0; i < depth.length; i++) depth[i] = i % 256;
            this.emit({
              type: 'depth',
              depth: depth.buffer,
              width: message.width,
              height: message.height,
              inferMs: 8
            });
          }
          return;
        }

        if (message.type === 'init') {
          this.engine = message.engine;
          this.emit({ type: 'loading', engine: this.engine });
          this.emit({ type: 'ready', engine: this.engine, device: 'wasm' }, 5);
        } else if (message.type === 'engine') {
          this.engine = message.engine;
          this.emit({ type: 'loading', engine: this.engine });
          this.emit({ type: 'ready', engine: this.engine, device: 'wasm' }, 5);
        } else if (message.type === 'frame') {
          if (!window.__allowMockDetection) {
            this.emit({ type: 'error', stage: 'infer', message: 'fixture infer error' });
          } else {
            this.emit({
              type: 'det',
              detMs: 12,
              boxes: [
                { label: 'person', score: 0.97, x0: 0.10, y0: 0.12, x1: 0.42, y1: 0.88 },
                { label: 'chair', score: 0.86, x0: 0.55, y0: 0.35, x1: 0.91, y1: 0.90 }
              ]
            });
          }
        }
      }

      terminate() {
        this.terminated = true;
      }

      addEventListener(type, callback) {
        if (type === 'message') this.onmessage = callback;
        if (type === 'error') this.onerror = callback;
      }

      removeEventListener(type, callback) {
        if (type === 'message' && this.onmessage === callback) this.onmessage = null;
        if (type === 'error' && this.onerror === callback) this.onerror = null;
      }
    }

    window.Worker = MockWorker;
  });

  await page.goto(`${BASE}/?webgl=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#badge-render')?.textContent?.includes('RENDER · WEB'));
  check('detection là opt-in', !(await page.isChecked('#detect-toggle')));
  check('label tools ẩn trước opt-in', await page.isHidden('#label-tools'));

  await page.click('#start-btn');
  await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('hidden'), null, { timeout: 30_000 });
  check('mock depth mở được luồng camera/UI', await page.locator('#boot').evaluate((element) => element.classList.contains('hidden')));

  await page.check('#detect-toggle');
  await page.waitForFunction(() => document.querySelector('#obj-status')?.textContent?.includes('lỗi frame'));
  check('infer error phục hồi về trạng thái sẵn sàng', (await page.textContent('#obj-status'))?.includes('lỗi frame'));

  await page.evaluate(() => { window.__allowMockDetection = true; });
  await page.waitForFunction(() => document.querySelectorAll('.obj-row').length === 2);
  check('hiển thị hai detection cố định', (await page.locator('.obj-row').count()) === 2);
  check('overlay có hai bounding box', (await page.locator('#det-overlay > rect:not(.det-label-bg)').count()) === 2);

  await page.selectOption('#engine-select', 'owlvit');
  await page.waitForFunction(() => !document.querySelector('#query-ctl')?.hidden);
  await page.waitForFunction(() => document.querySelector('#obj-status')?.textContent?.includes('OWL-ViT'));
  check('chuyển engine bật query control', await page.isVisible('#query-ctl'));
  check('worker contract nhận engine OWL-ViT', (await page.textContent('#obj-status'))?.includes('OWL-ViT'));

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
    !error.includes('favicon') &&
    !error.includes('404')
  );
  check('không có lỗi console ngoài lỗi phục hồi chủ đích', fatal.length === 0, fatal.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`Exception: ${error instanceof Error ? error.message : String(error)}`);
  log('EXCEPTION', error);
} finally {
  await browser?.close();
  server.kill();
}

log('──────────────────────────────');
if (failures.length) {
  log(`KẾT QUẢ: ${failures.length} FAIL`);
  failures.forEach((failure) => log(' -', failure));
  process.exit(1);
}
log('KẾT QUẢ: TẤT CẢ PASS (mock contract, không phải model quality)');
