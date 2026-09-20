import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from '../tests/helpers/browser.mjs';

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith('--') || argv[index + 1] == null) throw Error(`Tham số không hợp lệ: ${key ?? ''}`);
    parsed[key.slice(2)] = argv[index + 1];
  }
  return parsed;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function parseTimes(value) {
  const times = value.split(',').map(Number);
  if (!times.length || times.some(time => !Number.isFinite(time) || time < 0)) throw Error('--times phải là danh sách giây không âm');
  const unique = [...new Set(times)].sort((a, b) => a - b);
  if (unique.length !== times.length) throw Error('--times không được trùng');
  return unique;
}

function validateId(value, field) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value)) throw Error(`${field}: ID không hợp lệ`);
  return value;
}

const options = parseArgs(process.argv.slice(2));
for (const required of ['video', 'out', 'clip-id', 'task-id', 'times', 'rights-basis', 'rights-reference']) {
  if (!options[required]) throw Error(`Thiếu --${required}`);
}
const videoPath = resolve(options.video);
const outputDir = resolve(options.out);
const clipId = validateId(options['clip-id'], '--clip-id');
const taskId = validateId(options['task-id'], '--task-id');
const split = options.split ?? 'test';
if (!['train', 'validation', 'test'].includes(split)) throw Error('--split không hợp lệ');
const rightsBasis = options['rights-basis'];
if (!['owned', 'licensed', 'consented', 'synthetic'].includes(rightsBasis)) throw Error('--rights-basis không hợp lệ');
const scenarioTags = (options.tags ?? '').split(',').map(value => value.trim()).filter(Boolean);
if (new Set(scenarioTags).size !== scenarioTags.length) throw Error('--tags không được trùng');
const requestedSeconds = parseTimes(options.times);
const videoBytes = await readFile(videoPath);
const videoStat = await stat(videoPath);
await mkdir(outputDir);

const port = 45000 + Math.floor(Math.random() * 1000);
const server = createServer((request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block}</style><canvas id="frame"></canvas>');
      return;
    }
    if (url.pathname !== '/video') { response.writeHead(404).end(); return; }
    const range = request.headers.range;
    if (!range) {
      response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': videoBytes.length, 'Accept-Ranges': 'bytes' });
      response.end(videoBytes);
      return;
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) { response.writeHead(416).end(); return; }
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), videoBytes.length - 1) : videoBytes.length - 1;
    if (start > end || start >= videoBytes.length) { response.writeHead(416).end(); return; }
    response.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${videoBytes.length}`,
      'Content-Length': end - start + 1,
    });
    response.end(videoBytes.subarray(start, end + 1));
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(error));
  }
});
await new Promise((resolveListen, reject) => server.listen(port, '127.0.0.1', resolveListen).once('error', reject));

let browser;
try {
  browser = await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  const metadata = await page.evaluate(async () => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = '/video';
    await new Promise((resolveMetadata, reject) => {
      video.onloadedmetadata = resolveMetadata;
      video.onerror = () => reject(new Error('Không đọc được metadata video'));
    });
    window.__annotationVideo = video;
    const canvas = document.querySelector('#frame');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
  });
  await page.setViewportSize({ width: metadata.width, height: metadata.height });
  const frames = [];
  for (const [index, seconds] of requestedSeconds.entries()) {
    if (seconds >= metadata.duration) throw Error(`Timestamp ${seconds}s nằm ngoài video ${metadata.duration.toFixed(3)}s`);
    await page.evaluate(async time => {
      const video = window.__annotationVideo;
      video.currentTime = time;
      await new Promise((resolveSeek, reject) => {
        video.onseeked = resolveSeek;
        video.onerror = () => reject(new Error('Seek video thất bại'));
      });
      const canvas = document.querySelector('#frame');
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    }, seconds);
    const imageFile = `raw-${String(index + 1).padStart(2, '0')}-${seconds.toFixed(3).replace('.', '_')}s.png`;
    const imagePath = resolve(outputDir, imageFile);
    await page.locator('#frame').screenshot({ path: imagePath });
    frames.push({ timeMs: Math.round(seconds * 1000), imageFile, imageSha256: sha256(await readFile(imagePath)) });
  }
  const task = {
    schemaVersion: 1,
    taskId,
    clipId,
    split,
    width: metadata.width,
    height: metadata.height,
    sourceSha256: sha256(videoBytes),
    rights: { basis: rightsBasis, reference: options['rights-reference'] },
    scenarioTags,
    predictionBlind: true,
    frames,
  };
  const taskBytes = jsonBytes(task);
  const taskSha256 = sha256(taskBytes);
  const annotations = {
    schemaVersion: 1,
    revision: 0,
    taskId,
    taskSha256,
    status: 'draft',
    annotatedBy: 'local-annotator',
    review: null,
    frames: frames.map(frame => ({ timeMs: frame.timeMs, imageSha256: frame.imageSha256, lines: [], areas: [] })),
  };
  await writeFile(resolve(outputDir, 'task.json'), taskBytes, { flag: 'wx' });
  await writeFile(resolve(outputDir, 'annotations.json'), jsonBytes(annotations), { flag: 'wx' });
  const receipt = {
    schemaVersion: 1,
    taskId,
    taskSha256,
    source: { fileName: basename(videoPath), bytes: videoStat.size, sha256: task.sourceSha256, duration: metadata.duration },
    frameCount: frames.length,
    predictionBlind: true,
    note: 'Ảnh thô, không overlay và không prediction. Chỉ dùng local cho gán nhãn độc lập.',
  };
  await writeFile(resolve(outputDir, 'receipt.json'), jsonBytes(receipt), { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
