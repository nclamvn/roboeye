// T16 real-model smoke in two isolated phases:
// 1) pinned QuickDraw + pinned Hand Landmarker both cold-load; QuickDraw infers.
// 2) real Hand Landmarker receives camera frames while unrelated workers are mocked.
import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';
import { startPreview, stopPreview, waitForPreview } from './helpers/preview-server.mjs';

const PORT = 4185;
const ROOT = new URL('..', import.meta.url).pathname;
const server = startPreview(ROOT, PORT);
let browser;

async function waitForModels(page, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => window.__roboeyeAirSketchBenchmark?.snapshot());
    if (snapshot?.ready.hand && snapshot.ready.classifier) return snapshot;
    await page.waitForTimeout(1_000);
  }
  const state = await page.evaluate(() => ({
    snapshot: window.__roboeyeAirSketchBenchmark?.snapshot(),
    status: document.querySelector('#air-status')?.textContent
  }));
  throw new Error(`Model load timeout: ${JSON.stringify(state)}`);
}

async function drawHouse(page) {
  const canvas = await page.locator('#airsketch-overlay').boundingBox();
  if (!canvas) throw new Error('Không tìm thấy canvas AirSketch');
  const path = [[0.30, 0.70], [0.30, 0.38], [0.50, 0.22], [0.70, 0.38], [0.70, 0.70], [0.30, 0.70], [0.50, 0.70], [0.50, 0.52], [0.60, 0.52]];
  await page.mouse.move(canvas.x + path[0][0] * canvas.width, canvas.y + path[0][1] * canvas.height);
  await page.mouse.down();
  for (const [x, y] of path.slice(1)) {
    await page.mouse.move(canvas.x + x * canvas.width, canvas.y + y * canvas.height, { steps: 4 });
  }
  await page.mouse.up();
}

try {
  await waitForPreview(server);
  const executablePath = await resolveBrowserExecutable();
  browser = await chromium.launch(browserLaunchOptions(executablePath));

  // Phase 1: no Worker override. This proves both pinned runtimes load together
  // exactly as production does, and the real QuickDraw classifier returns top-3.
  const modelPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const modelErrors = [];
  modelPage.on('pageerror', (error) => modelErrors.push(String(error)));
  modelPage.on('console', (message) => { if (message.type() === 'error') modelErrors.push(message.text()); });
  await modelPage.goto(`http://localhost:${PORT}/?webgl=1`, { waitUntil: 'domcontentloaded' });
  await modelPage.evaluate(() => {
    document.querySelector('#boot')?.classList.add('hidden');
    document.querySelector('#airsketch-btn')?.click();
  });
  await waitForModels(modelPage);
  await drawHouse(modelPage);
  await modelPage.waitForFunction(
    () => document.querySelectorAll('#air-predictions button').length === 3,
    undefined,
    { timeout: 120_000 }
  );
  const classifySnapshot = await modelPage.evaluate(() => window.__roboeyeAirSketchBenchmark?.snapshot());
  const labels = await modelPage.locator('#air-predictions button span').allTextContents();
  if ((classifySnapshot?.classify.samples ?? 0) < 1 || classifySnapshot?.classify.p95 == null) {
    throw new Error(`QuickDraw inference không chạy: ${JSON.stringify(classifySnapshot)}`);
  }
  if (labels.length !== 3 || labels.some((label) => !label.trim())) throw new Error(`Top-3 không hợp lệ: ${JSON.stringify(labels)}`);
  if (modelErrors.length) throw new Error(`Model page console errors: ${modelErrors.slice(0, 3).join(' | ')}`);
  await modelPage.close();

  // Phase 2: mock only depth/classifier so the real classic MediaPipe worker can
  // be measured against a live fake camera without loading unrelated runtimes.
  const handPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await handPage.addInitScript(() => {
    const NativeWorker = window.Worker;
    class MockWorker {
      constructor(kind) { this.kind = kind; this.onmessage = null; this.onerror = null; this.terminated = false; }
      emit(data) { setTimeout(() => { if (!this.terminated) this.onmessage?.({ data }); }, 0); }
      postMessage(message) {
        if (this.terminated) return;
        if (this.kind === 'classifier' && message.type === 'init') this.emit({ type: 'ready', device: 'wasm' });
        if (this.kind === 'depth' && message.type === 'init') this.emit({ type: 'ready', device: 'wasm', dtype: 'q8' });
        if (this.kind === 'depth' && message.type === 'frame') {
          const depth = new Uint8Array(message.width * message.height).fill(128);
          this.emit({ type: 'depth', depth: depth.buffer, width: message.width, height: message.height, inferMs: 5 });
        }
      }
      terminate() { this.terminated = true; }
    }
    window.Worker = class WorkerRouter {
      constructor(url, options) {
        const value = String(url);
        if (value.includes('depth-worker')) return new MockWorker('depth');
        if (value.includes('air-classifier-worker')) return new MockWorker('classifier');
        return new NativeWorker(url, options);
      }
    };
  });
  const handErrors = [];
  handPage.on('pageerror', (error) => handErrors.push(String(error)));
  handPage.on('console', (message) => { if (message.type() === 'error') handErrors.push(message.text()); });
  await handPage.goto(`http://localhost:${PORT}/?webgl=1`, { waitUntil: 'domcontentloaded' });
  await handPage.click('#start-btn');
  await handPage.waitForFunction(() => document.querySelector('#boot')?.classList.contains('hidden'));
  await handPage.click('#airsketch-btn');
  await handPage.waitForFunction(
    () => (window.__roboeyeAirSketchBenchmark?.snapshot().hand.samples ?? 0) >= 8,
    undefined,
    { timeout: 120_000 }
  );
  const handSnapshot = await handPage.evaluate(() => window.__roboeyeAirSketchBenchmark?.snapshot());
  if (!handSnapshot?.ready.hand || handSnapshot.hand.p95 == null) throw new Error(`Hand inference không chạy: ${JSON.stringify(handSnapshot)}`);
  if (handSnapshot.hand.p95 >= 80) throw new Error(`Hand p95 vượt 80 ms: ${JSON.stringify(handSnapshot.hand)}`);
  const fatalHandErrors = handErrors.filter((message) => !message.includes('Created TensorFlow Lite XNNPACK delegate'));
  if (fatalHandErrors.length) throw new Error(`Hand page console errors: ${fatalHandErrors.slice(0, 3).join(' | ')}`);
  await handPage.close();

  console.log('[airsketch-model-smoke] PASS', JSON.stringify({
    quickDraw: { labels, latency: classifySnapshot.classify },
    hand: handSnapshot.hand
  }));
} finally {
  await browser?.close();
  await stopPreview(server);
}
