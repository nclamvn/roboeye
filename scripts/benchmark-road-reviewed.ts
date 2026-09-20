import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from '../tests/helpers/browser.mjs';
import {
  parseRoadAnnotationSet,
  parseRoadAnnotationTask,
  roadAnnotationsToTruthFrames,
  validateRoadAnnotationsAgainstTask,
} from '../src/drive/road-annotations';
import { evaluateRoadBenchmarkCorpus, parseRoadBenchmarkCorpus, type RoadBenchmarkCorpus } from '../src/drive/road-benchmark';
import { vectorizeRoadMaskV1, vectorizeRoadMaskV2 } from '../src/drive/road-vectorizer';

function args(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] == null) throw Error(`Tham số không hợp lệ: ${argv[index] ?? ''}`);
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function mime(path: string): string {
  return ({ '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.png': 'image/png' } as Record<string, string>)[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

const options = args(process.argv.slice(2));
if (!options.model || !options['task-dirs'] || !options.out) {
  throw Error('Cách dùng: npm run benchmark:road-reviewed -- --model model.onnx --task-dirs task1,task2 --out output-dir');
}
const root = resolve(new URL('..', import.meta.url).pathname);
const ortDist = resolve(root, 'node_modules/onnxruntime-web/dist');
const modelPath = resolve(options.model);
const taskDirs = options['task-dirs'].split(',').map(path => resolve(path));
const outputDir = resolve(options.out);
const vectorizerVersion = options.vectorizer ?? 'v2';
if (vectorizerVersion !== 'v1' && vectorizerVersion !== 'v2') throw Error('--vectorizer chỉ chấp nhận v1 hoặc v2');
const vectorize = vectorizerVersion === 'v1' ? vectorizeRoadMaskV1 : vectorizeRoadMaskV2;
await mkdir(outputDir, { recursive: true });
const modelBytes = await readFile(modelPath);
const modelSha256 = sha256(modelBytes);
const tasks = await Promise.all(taskDirs.map(async taskDir => {
  const taskBytes = await readFile(resolve(taskDir, 'task.json'));
  const annotationBytes = await readFile(resolve(taskDir, 'annotations.json'));
  const task = parseRoadAnnotationTask(JSON.parse(taskBytes.toString('utf8')));
  const annotations = parseRoadAnnotationSet(JSON.parse(annotationBytes.toString('utf8')));
  validateRoadAnnotationsAgainstTask(task, sha256(taskBytes), annotations);
  const truthFrames = roadAnnotationsToTruthFrames(annotations);
  return { taskDir, taskBytes, annotationBytes, task, annotations, truthFrames };
}));

const port = 46000 + Math.floor(Math.random() * 1000);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block;width:896px;height:512px}</style><canvas id="frame" width="896" height="512"></canvas>');
      return;
    }
    let bytes: Uint8Array;
    let path: string;
    if (url.pathname === '/model.onnx') { bytes = modelBytes; path = modelPath; }
    else if (url.pathname.startsWith('/ort/')) { path = resolve(ortDist, basename(url.pathname)); bytes = await readFile(path); }
    else {
      const match = /^\/frame\/(\d+)\/(\d+)$/.exec(url.pathname);
      if (!match) { response.writeHead(404).end(); return; }
      const task = tasks[Number(match[1])];
      const frame = task?.task.frames[Number(match[2])];
      if (!task || !frame) { response.writeHead(404).end(); return; }
      path = resolve(task.taskDir, frame.imageFile);
      if (!path.startsWith(`${task.taskDir}/`)) throw Error('Frame path ra ngoài task directory');
      bytes = await readFile(path);
      if (sha256(bytes) !== frame.imageSha256) throw Error('Frame hash thay đổi trong khi benchmark');
    }
    response.writeHead(200, { 'Content-Type': mime(path), 'Cache-Control': 'no-store' });
    response.end(bytes);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(error));
  }
});
await new Promise<void>((resolveListen, reject) => server.listen(port, '127.0.0.1', resolveListen).once('error', reject));

let browser;
try {
  browser = await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
  const page = await browser.newPage({ viewport: { width: 896, height: 512 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const ort = await import('/ort/ort.all.min.mjs');
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create('/model.onnx', { executionProviders: ['wasm'] });
    (window as unknown as { __roadBenchmark: unknown }).__roadBenchmark = { ort, session };
  });
  const clips: RoadBenchmarkCorpus['clips'] = [];
  const diagnostics: unknown[] = [];
  for (const [taskIndex, item] of tasks.entries()) {
    const predictionFrames = [];
    for (const [frameIndex, frame] of item.task.frames.entries()) {
      const inference = await page.evaluate(async ({ taskIndex, frameIndex }) => {
        const { ort, session } = (window as unknown as { __roadBenchmark: { ort: typeof import('onnxruntime-web'); session: import('onnxruntime-web').InferenceSession } }).__roadBenchmark;
        const image = new Image();
        image.src = `/frame/${taskIndex}/${frameIndex}`;
        await image.decode();
        const canvas = document.querySelector('canvas')!;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0, 896, 512);
        const pixels = 896 * 512;
        const rgba = context.getImageData(0, 0, 896, 512).data;
        const input = new Float32Array(pixels * 3);
        for (let pixel = 0; pixel < pixels; pixel += 1) {
          input[pixel] = rgba[pixel * 4 + 2];
          input[pixels + pixel] = rgba[pixel * 4 + 1];
          input[pixels * 2 + pixel] = rgba[pixel * 4];
        }
        const startedAt = performance.now();
        const outputMap = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 512, 896]) });
        const inferenceMs = performance.now() - startedAt;
        const output = outputMap[session.outputNames[0]].data as Float32Array;
        const labels = new Uint8Array(pixels);
        for (let pixel = 0; pixel < pixels; pixel += 1) {
          let label = 0, score = Number(output[pixel]);
          for (let channel = 1; channel < 4; channel += 1) {
            const candidate = Number(output[channel * pixels + pixel]);
            if (candidate > score) { score = candidate; label = channel; }
          }
          labels[pixel] = label;
        }
        let binary = '';
        for (let start = 0; start < labels.length; start += 0x8000) binary += String.fromCharCode(...labels.subarray(start, start + 0x8000));
        return { inferenceMs, labelsBase64: btoa(binary) };
      }, { taskIndex, frameIndex });
      const labels = new Uint8Array(Buffer.from(inference.labelsBase64, 'base64'));
      const vector = vectorize(labels, 896, 512);
      predictionFrames.push({
        timeMs: frame.timeMs,
        inferenceMs: inference.inferenceMs,
        evidenceAgeMs: inference.inferenceMs,
        lines: vector.lines,
        areas: vector.areas,
      });
      diagnostics.push({ clipId: item.task.clipId, timeMs: frame.timeMs, inferenceMs: inference.inferenceMs, ...vector.diagnostics,
        lines: vector.lines.map(line => ({ class: line.class, role: line.role, points: line.points.length })), areas: vector.areas.map(area => area.points.length) });
      await page.evaluate(({ labelsBase64, vector }) => {
        const canvas = document.querySelector('canvas')!;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const binary = atob(labelsBase64);
        for (let pixel = 0; pixel < binary.length; pixel += 1) {
          const label = binary.charCodeAt(pixel);
          if (!label) continue;
          const colour = label === 1 ? [30, 220, 120] : label === 2 ? [255, 70, 70] : [35, 220, 255];
          const offset = pixel * 4, alpha = label === 1 ? .22 : .58;
          for (let channel = 0; channel < 3; channel += 1) imageData.data[offset + channel] = Math.round(imageData.data[offset + channel] * (1 - alpha) + colour[channel] * alpha);
        }
        context.putImageData(imageData, 0, 0);
        context.lineWidth = 4;
        for (const line of vector.lines) {
          context.beginPath(); context.strokeStyle = line.role === 'ego-left' ? '#3de6ff' : '#d59bff';
          line.points.forEach((point, index) => index ? context.lineTo(point.x * canvas.width, point.y * canvas.height) : context.moveTo(point.x * canvas.width, point.y * canvas.height));
          context.stroke();
        }
      }, { labelsBase64: inference.labelsBase64, vector });
      await page.locator('canvas').screenshot({ path: resolve(outputDir, `${item.task.clipId}-${String(frameIndex + 1).padStart(2, '0')}-prediction.png`) });
    }
    clips.push({
      clipId: item.task.clipId,
      split: item.task.split,
      width: item.task.width,
      height: item.task.height,
      sourceSha256: item.task.sourceSha256,
      rights: item.task.rights,
      scenarioTags: item.task.scenarioTags,
      truthFrames: item.truthFrames,
      predictionFrames,
    });
  }
  const corpus = parseRoadBenchmarkCorpus({
    schemaVersion: 1,
    corpusId: vectorizerVersion === 'v1' ? 'tip50r-d2-reviewed-rescore-v2' : 'tip50r-d3-posthoc-local-v1',
    modelId: `openvino-road-segmentation-adas-0001:${modelSha256}`,
    clips,
  });
  const metrics = evaluateRoadBenchmarkCorpus(corpus);
  const report = {
    schemaVersion: 1,
    evidenceClass: 'human-reviewed-ai-prelabels-local-research-only',
    model: { file: basename(modelPath), sha256: modelSha256 },
    tasks: tasks.map(item => ({ taskId: item.task.taskId, taskSha256: sha256(item.taskBytes), annotationSha256: sha256(item.annotationBytes),
      annotationRevision: item.annotations.revision, reviewedBy: item.annotations.review?.reviewedBy, sourceSha256: item.task.sourceSha256 })),
    preprocessing: { input: [1, 3, 512, 896], colour: 'BGR', range: '0..255', resize: 'direct-896x512' },
    vectorizer: {
      version: vectorizerVersion === 'v1' ? 1 : 2,
      truthBlind: true,
      evidenceClass: vectorizerVersion === 'v1' ? 'frozen-d2-baseline-rescore' : 'post-hoc-development-diagnostic',
      note: vectorizerVersion === 'v1'
        ? 'Frozen D2 row-local baseline.'
        : 'D3 continuity-aware path association; Test1/Test2 were already observed and cannot be a new held-out result.',
    },
    diagnostics,
    metrics,
    limitations: [
      'Ground truth began as AI pre-labels and received human acceptance; it is not an independently hand-drawn expert corpus.',
      'Only eight local frames from two clips; no field-safety or commercial-quality claim.',
      'Model training-data commercial terms remain unresolved.',
    ],
  };
  await writeFile(resolve(outputDir, 'corpus.json'), `${JSON.stringify(corpus, null, 2)}\n`, { flag: 'wx' });
  await writeFile(resolve(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close();
  await new Promise<void>(resolveClose => server.close(() => resolveClose()));
}
