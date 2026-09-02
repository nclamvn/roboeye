// T16 real-model smoke in two isolated phases:
// 1) pinned QuickDraw + pinned Hand Landmarker both cold-load; QuickDraw infers.
// 2) real Hand Landmarker receives camera frames while unrelated workers are mocked.
import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';
import { startPreview, stopPreview, waitForPreview } from './helpers/preview-server.mjs';

const PORT = 4185;
const ROOT = new URL('..', import.meta.url).pathname;
const HAND_P95_MAX_MS = Number(process.env.AIRSKETCH_HAND_P95_MAX_MS ?? 80);
const CAPTURE_P95_MAX_MS = Number(process.env.AIRSKETCH_CAPTURE_P95_MAX_MS ?? 30);
const PIPELINE_P95_MAX_MS = Number(process.env.AIRSKETCH_PIPELINE_P95_MAX_MS ?? 160);
if (!Number.isFinite(HAND_P95_MAX_MS) || HAND_P95_MAX_MS <= 0) {
  throw new Error(`AIRSKETCH_HAND_P95_MAX_MS không hợp lệ: ${process.env.AIRSKETCH_HAND_P95_MAX_MS}`);
}
if (!Number.isFinite(CAPTURE_P95_MAX_MS) || CAPTURE_P95_MAX_MS <= 0) {
  throw new Error(`AIRSKETCH_CAPTURE_P95_MAX_MS không hợp lệ: ${process.env.AIRSKETCH_CAPTURE_P95_MAX_MS}`);
}
if (!Number.isFinite(PIPELINE_P95_MAX_MS) || PIPELINE_P95_MAX_MS <= 0) {
  throw new Error(`AIRSKETCH_PIPELINE_P95_MAX_MS không hợp lệ: ${process.env.AIRSKETCH_PIPELINE_P95_MAX_MS}`);
}
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

async function officialHouseBitmap() {
  const response = await fetch('https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap/house.npy', {
    headers: { Range: 'bytes=0-65535' }
  });
  if (!response.ok && response.status !== 206) throw new Error(`Không tải được house.npy: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const version = bytes[6];
  const headerLength = version === 1
    ? new DataView(bytes.buffer, bytes.byteOffset + 8, 2).getUint16(0, true)
    : new DataView(bytes.buffer, bytes.byteOffset + 8, 4).getUint32(0, true);
  const offset = (version === 1 ? 10 : 12) + headerLength;
  return bytes.slice(offset, offset + 784);
}

try {
  await waitForPreview(server);
  const executablePath = await resolveBrowserExecutable();
  browser = await chromium.launch(browserLaunchOptions(executablePath));

  // Phase 1: no Worker override. This proves both pinned runtimes load together
  // exactly as production does, and the real QuickDraw classifier returns top-5.
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
  const housePixels = await officialHouseBitmap();
  const predictions = await modelPage.evaluate(async (values) => {
    const rgba = new Uint8Array(28 * 28 * 4);
    for (let i = 0; i < values.length; i++) {
      rgba[i * 4] = values[i]; rgba[i * 4 + 1] = values[i]; rgba[i * 4 + 2] = values[i]; rgba[i * 4 + 3] = 255;
    }
    return window.__roboeyeAirSketchBenchmark?.classifyImage(rgba, 28, 28);
  }, Array.from(housePixels));
  const classifySnapshot = await modelPage.evaluate(() => window.__roboeyeAirSketchBenchmark?.snapshot());
  const labels = predictions?.map((prediction) => prediction.label) ?? [];
  if ((classifySnapshot?.classify.samples ?? 0) < 1 || classifySnapshot?.classify.p95 == null) {
    throw new Error(`QuickDraw inference không chạy: ${JSON.stringify(classifySnapshot)}`);
  }
  if (labels.length !== 5 || labels.some((label) => !label.trim())) throw new Error(`Top-5 không hợp lệ: ${JSON.stringify(labels)}`);
  if (labels[0] !== 'house') throw new Error(`Model thật không nhận đúng house top-1: ${JSON.stringify(labels)}`);
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
  if (!handSnapshot?.ready.hand || handSnapshot.hand.p95 == null || handSnapshot.capture.p95 == null || handSnapshot.pipeline.p95 == null) {
    throw new Error(`Hand inference hoặc toàn tuyến không chạy: ${JSON.stringify(handSnapshot)}`);
  }
  if (handSnapshot.hand.p95 >= HAND_P95_MAX_MS) {
    throw new Error(`Hand p95 vượt ${HAND_P95_MAX_MS} ms: ${JSON.stringify(handSnapshot.hand)}`);
  }
  if (handSnapshot.capture.p95 >= CAPTURE_P95_MAX_MS) {
    throw new Error(`Capture p95 vượt ${CAPTURE_P95_MAX_MS} ms: ${JSON.stringify(handSnapshot.capture)}`);
  }
  if (handSnapshot.pipeline.p95 >= PIPELINE_P95_MAX_MS) {
    throw new Error(`Pipeline p95 vượt ${PIPELINE_P95_MAX_MS} ms: ${JSON.stringify(handSnapshot.pipeline)}`);
  }
  const fatalHandErrors = handErrors.filter((message) => !message.includes('Created TensorFlow Lite XNNPACK delegate'));
  if (fatalHandErrors.length) throw new Error(`Hand page console errors: ${fatalHandErrors.slice(0, 3).join(' | ')}`);
  await handPage.close();

  console.log('[airsketch-model-smoke] PASS', JSON.stringify({
    quickDraw: { labels, latency: classifySnapshot.classify },
    hand: handSnapshot.hand,
    capture: handSnapshot.capture,
    pipeline: handSnapshot.pipeline,
    budgetsMs: { handP95: HAND_P95_MAX_MS, captureP95: CAPTURE_P95_MAX_MS, pipelineP95: PIPELINE_P95_MAX_MS }
  }));
} finally {
  await browser?.close();
  await stopPreview(server);
}
