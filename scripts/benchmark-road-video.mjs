import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from '../tests/helpers/browser.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ORT_DIST = resolve(ROOT, 'node_modules/onnxruntime-web/dist');
function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] == null) throw new Error(`Tham số không hợp lệ: ${argv[index] ?? ''}`);
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}
function mime(path) {
  return ({ '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.mp4': 'video/mp4' })[extname(path).toLowerCase()] ?? 'application/octet-stream';
}
function nearest(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}
const options = args(process.argv.slice(2));
if (!options.model || !options.video || !options.out) throw new Error('Cách dùng: npm run benchmark:road-video -- --model model.onnx --video clip.mp4 --out output-dir [--times 5,15,30]');
const modelPath = resolve(options.model);
const videoPath = resolve(options.video);
const outputDir = resolve(options.out);
const requestedTimes = (options.times ?? '5,15,30').split(',').map(Number);
if (!requestedTimes.length || requestedTimes.some(value => !Number.isFinite(value) || value < 0)) throw new Error('--times không hợp lệ');
await mkdir(outputDir);
const modelBytes = await readFile(modelPath);
const videoBytes = await readFile(videoPath);
const videoInfo = await stat(videoPath);
const port = 44000 + Math.floor(Math.random() * 1000);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block;width:896px;height:512px}</style><canvas id="frame" width="896" height="512"></canvas>');
      return;
    }
    if (url.pathname === '/video') {
      const range = request.headers.range;
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) { response.writeHead(416).end(); return; }
        const start = Number(match[1]);
        const end = match[2] ? Math.min(Number(match[2]), videoBytes.length - 1) : videoBytes.length - 1;
        response.writeHead(206, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${videoBytes.length}`, 'Content-Length': end - start + 1 });
        response.end(videoBytes.subarray(start, end + 1));
      } else {
        response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': videoBytes.length, 'Accept-Ranges': 'bytes' });
        response.end(videoBytes);
      }
      return;
    }
    let bytes;
    let path;
    if (url.pathname === '/model.onnx') { bytes = modelBytes; path = modelPath; }
    else if (url.pathname.startsWith('/ort/')) { path = resolve(ORT_DIST, basename(url.pathname)); bytes = await readFile(path); }
    else { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': mime(path), 'Cache-Control': 'no-store' });
    response.end(bytes);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(error));
  }
});
await new Promise((resolveListen, reject) => server.listen(port, '127.0.0.1', resolveListen).once('error', reject));

let browser;
try {
  browser = await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
  const page = await browser.newPage({ viewport: { width: 896, height: 512 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  const metadata = await page.evaluate(async () => {
    const ort = await import('/ort/ort.all.min.mjs');
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create('/model.onnx', { executionProviders: ['wasm'] });
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = '/video';
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('video metadata failed')); });
    window.__roadLab = { ort, session, video };
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
  });
  const times = requestedTimes.map(value => Math.min(value, Math.max(0, metadata.duration - 0.05)));
  const samples = [];
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    const sample = await page.evaluate(async ({ time }) => {
      const { ort, session, video } = window.__roadLab;
      video.currentTime = time;
      await new Promise((resolve, reject) => { video.onseeked = resolve; video.onerror = () => reject(new Error('video seek failed')); });
      const canvas = document.querySelector('#frame');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(video, 0, 0, 896, 512);
      const image = context.getImageData(0, 0, 896, 512);
      const pixels = 896 * 512;
      const input = new Float32Array(pixels * 3);
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        input[pixel] = image.data[pixel * 4 + 2];
        input[pixels + pixel] = image.data[pixel * 4 + 1];
        input[pixels * 2 + pixel] = image.data[pixel * 4];
      }
      const startedAt = performance.now();
      const inference = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 512, 896]) });
      const inferenceMs = performance.now() - startedAt;
      const output = inference[session.outputNames[0]].data;
      const counts = [0, 0, 0, 0];
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        let label = 0; let score = Number(output[pixel]);
        for (let channel = 1; channel < 4; channel += 1) {
          const candidate = Number(output[channel * pixels + pixel]);
          if (candidate > score) { score = candidate; label = channel; }
        }
        counts[label] += 1;
        if (label === 0) continue;
        const offset = pixel * 4;
        const colour = label === 1 ? [30, 220, 120, 72] : label === 2 ? [255, 70, 70, 185] : [35, 220, 255, 210];
        const alpha = colour[3] / 255;
        image.data[offset] = Math.round(image.data[offset] * (1 - alpha) + colour[0] * alpha);
        image.data[offset + 1] = Math.round(image.data[offset + 1] * (1 - alpha) + colour[1] * alpha);
        image.data[offset + 2] = Math.round(image.data[offset + 2] * (1 - alpha) + colour[2] * alpha);
      }
      context.putImageData(image, 0, 0);
      return { time, inferenceMs, classShare: { background: counts[0] / pixels, road: counts[1] / pixels, curb: counts[2] / pixels, mark: counts[3] / pixels } };
    }, { time });
    const image = `frame-${String(index + 1).padStart(2, '0')}-${time.toFixed(2).replace('.', '_')}s.png`;
    await page.locator('#frame').screenshot({ path: resolve(outputDir, image) });
    samples.push({ ...sample, image });
  }
  const latencies = samples.map(sample => sample.inferenceMs);
  const report = {
    schemaVersion: 1,
    artifactSha256: createHash('sha256').update(modelBytes).digest('hex'),
    source: { name: basename(videoPath), bytes: videoInfo.size, sha256: createHash('sha256').update(videoBytes).digest('hex'), ...metadata },
    preprocessing: { input: [1, 3, 512, 896], colour: 'BGR', range: '0..255', resize: 'direct-896x512' },
    provider: 'wasm', samples,
    latency: { count: latencies.length, p50Ms: nearest(latencies, 0.5), p95Ms: nearest(latencies, 0.95) },
    limitations: ['No human ground truth', 'Direct resize only', 'Research artifact; not commercial or safety evidence'],
  };
  await writeFile(resolve(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
