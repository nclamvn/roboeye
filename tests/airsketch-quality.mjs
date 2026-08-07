// T17 quality benchmark against the first recognized examples in the official
// Google Quick, Draw! simplified dataset. This exercises the production worker,
// rasterizer and pinned model end-to-end instead of accepting any non-empty label.
import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';
import { startPreview, stopPreview, waitForPreview } from './helpers/preview-server.mjs';

const PORT = 4186;
const ROOT = new URL('..', import.meta.url).pathname;
const SAMPLES_PER_CLASS = Number(process.env.AIRSKETCH_SAMPLES_PER_CLASS ?? 2);
const TOP1_MIN = Number(process.env.AIRSKETCH_TOP1_MIN ?? 0.75);
const TOP3_MIN = Number(process.env.AIRSKETCH_TOP3_MIN ?? 0.90);
const SOURCE = process.env.AIRSKETCH_SOURCE ?? 'vector';
const CATEGORIES = (process.env.AIRSKETCH_CATEGORIES
  ?? 'ambulance,campfire,firetruck,flashlight,helicopter,hospital,house,ladder,tent,tree')
  .split(',').map((value) => value.trim()).filter(Boolean);
const server = startPreview(ROOT, PORT);
let browser;

async function officialSamples(category) {
  const url = `https://storage.googleapis.com/quickdraw_dataset/full/simplified/${encodeURIComponent(category)}.ndjson`;
  const response = await fetch(url, { headers: { Range: 'bytes=0-262143' } });
  if (!response.ok && response.status !== 206) throw new Error(`Không tải được ${category}: HTTP ${response.status}`);
  const body = await response.text();
  const rows = body.endsWith('\n') ? body.trim().split('\n') : body.split('\n').slice(0, -1);
  return rows.map((row) => JSON.parse(row)).filter((item) => item.recognized).slice(0, SAMPLES_PER_CLASS);
}

async function officialBitmaps(category) {
  const url = `https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap/${encodeURIComponent(category)}.npy`;
  const response = await fetch(url, { headers: { Range: 'bytes=0-262143' } });
  if (!response.ok && response.status !== 206) throw new Error(`Không tải được bitmap ${category}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const version = bytes[6];
  const headerLength = version === 1
    ? new DataView(bytes.buffer, bytes.byteOffset + 8, 2).getUint16(0, true)
    : new DataView(bytes.buffer, bytes.byteOffset + 8, 4).getUint32(0, true);
  const offset = (version === 1 ? 10 : 12) + headerLength;
  return Array.from({ length: SAMPLES_PER_CLASS }, (_, index) => bytes.slice(offset + index * 784, offset + (index + 1) * 784));
}

async function classifyBitmap(page, pixels) {
  return page.evaluate(async (values) => {
    const rgba = new Uint8Array(28 * 28 * 4);
    for (let i = 0; i < values.length; i++) {
      rgba[i * 4] = values[i];
      rgba[i * 4 + 1] = values[i];
      rgba[i * 4 + 2] = values[i];
      rgba[i * 4 + 3] = 255;
    }
    return window.__roboeyeAirSketchBenchmark?.classifyImage(rgba, 28, 28);
  }, Array.from(pixels));
}

async function drawSample(page, drawing) {
  await page.click('#air-clear-btn');
  const canvas = await page.locator('#airsketch-overlay').boundingBox();
  if (!canvas) throw new Error('Không tìm thấy canvas AirSketch');
  for (const [xs, ys] of drawing) {
    await page.mouse.move(canvas.x + (xs[0] / 255) * canvas.width, canvas.y + (ys[0] / 255) * canvas.height);
    await page.mouse.down();
    for (let i = 1; i < xs.length; i++) {
      await page.mouse.move(canvas.x + (xs[i] / 255) * canvas.width, canvas.y + (ys[i] / 255) * canvas.height);
    }
    await page.mouse.up();
  }
  // Multi-stroke samples can briefly classify an early partial drawing; wait
  // past the production idle window so assertions observe the final revision.
  await page.waitForTimeout(1_200);
  await page.waitForFunction(
    () => document.querySelectorAll('#air-predictions button').length >= 3,
    undefined,
    { timeout: 30_000 }
  );
  return page.locator('#air-predictions button').evaluateAll((buttons) => buttons.map((button) => button.dataset.label));
}

try {
  await waitForPreview(server);
  browser = await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://localhost:${PORT}/?webgl=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('#boot')?.classList.add('hidden');
    document.querySelector('#airsketch-btn')?.click();
  });
  await page.waitForFunction(() => window.__roboeyeAirSketchBenchmark?.snapshot().ready.classifier === true, undefined, { timeout: 300_000 });

  const cases = [];
  for (const category of CATEGORIES) {
    const samples = SOURCE === 'bitmap' ? await officialBitmaps(category) : await officialSamples(category);
    if (samples.length !== SAMPLES_PER_CLASS) throw new Error(`${category}: chỉ có ${samples.length} mẫu`);
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      const labels = SOURCE === 'bitmap'
        ? (await classifyBitmap(page, sample)).map((prediction) => prediction.label)
        : await drawSample(page, sample.drawing);
      cases.push({ category, sample: SOURCE === 'bitmap' ? index : sample.key_id, labels, top1: labels[0] === category, top3: labels.slice(0, 3).includes(category) });
    }
  }
  const top1 = cases.filter((item) => item.top1).length / cases.length;
  const top3 = cases.filter((item) => item.top3).length / cases.length;
  console.log('[airsketch-quality]', JSON.stringify({ source: SOURCE, samples: cases.length, top1, top3, thresholds: { top1: TOP1_MIN, top3: TOP3_MIN }, cases }));
  if (top1 < TOP1_MIN || top3 < TOP3_MIN) {
    throw new Error(`Chất lượng chưa đạt: top1=${top1.toFixed(3)}, top3=${top3.toFixed(3)}`);
  }
} finally {
  await browser?.close();
  await stopPreview(server);
}
