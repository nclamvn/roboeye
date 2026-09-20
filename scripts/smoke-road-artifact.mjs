import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from '../tests/helpers/browser.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ORT_DIST = resolve(ROOT, 'node_modules/onnxruntime-web/dist');
const ORT_VERSION = JSON.parse(await readFile(resolve(ROOT, 'node_modules/onnxruntime-web/package.json'), 'utf8')).version;

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith('--') || argv[index + 1] == null) throw new Error(`Tham số không hợp lệ: ${key ?? ''}`);
    result[key.slice(2)] = argv[index + 1];
  }
  return result;
}

function contentType(path) {
  return ({ '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' })[extname(path)] ?? 'application/octet-stream';
}

const options = args(process.argv.slice(2));
if (!options.model || !options.inventory || !options.out || !options.shape) {
  throw new Error('Cách dùng: npm run smoke:road-artifact -- --model model.onnx --inventory operators.json --shape 1,3,512,896 --out runtime-proof.json');
}
const modelPath = resolve(options.model);
const inventoryPath = resolve(options.inventory);
const outputPath = resolve(options.out);
const shape = options.shape.split(',').map(Number);
if (shape.length < 2 || shape.length > 5 || shape.some(value => !Number.isInteger(value) || value <= 0)) throw new Error('--shape không hợp lệ');
const runs = Number(options.runs ?? 8);
const warmup = Number(options.warmup ?? 2);
if (!Number.isInteger(runs) || runs < 3 || runs > 100 || !Number.isInteger(warmup) || warmup < 1 || warmup > 20) throw new Error('runs/warmup ngoài giới hạn');
const modelBytes = await readFile(modelPath);
const inventoryBytes = await readFile(inventoryPath);
const artifactSha256 = createHash('sha256').update(modelBytes).digest('hex');
const operatorInventorySha256 = createHash('sha256').update(inventoryBytes).digest('hex');
const port = 43000 + Math.floor(Math.random() * 1000);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    let bytes;
    let file = '';
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><meta charset="utf-8"><title>Road artifact smoke</title>');
      return;
    } else if (url.pathname === '/model.onnx') {
      bytes = modelBytes;
      file = modelPath;
    } else if (url.pathname.startsWith('/ort/')) {
      const requested = basename(url.pathname);
      file = resolve(ORT_DIST, requested);
      if (!file.startsWith(`${ORT_DIST}/`)) throw new Error('unsafe path');
      bytes = await readFile(file);
    } else {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
    response.end(bytes);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(error));
  }
});
await new Promise((resolveListen, reject) => server.listen(port, '127.0.0.1', resolveListen).once('error', reject));

let browser;
try {
  browser = await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  const results = await page.evaluate(async ({ shape, runs, warmup, ortVersion }) => {
    const ort = await import('/ort/ort.all.min.mjs');
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.wasm.numThreads = 1;
    const providers = ['webgpu', 'wasm'];
    const output = [];
    for (const provider of providers) {
      let session;
      try {
        const coldStartAt = performance.now();
        session = await ort.InferenceSession.create('/model.onnx', { executionProviders: [provider] });
        const coldStartMs = performance.now() - coldStartAt;
        const inputName = session.inputNames[0];
        const data = new Float32Array(shape.reduce((total, value) => total * value, 1));
        const tensor = new ort.Tensor('float32', data, shape);
        for (let index = 0; index < warmup; index += 1) await session.run({ [inputName]: tensor });
        const timings = [];
        for (let index = 0; index < runs; index += 1) {
          const startedAt = performance.now();
          const inference = await session.run({ [inputName]: tensor });
          timings.push(performance.now() - startedAt);
          const first = inference[session.outputNames[0]];
          if (!first || !first.data.length || !Number.isFinite(Number(first.data[0]))) throw new Error('output tensor không hữu hạn');
        }
        output.push({
          provider, status: 'passed', coldStartMs,
          inferenceP50Ms: timings.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(timings.length * 0.5) - 1)],
          inferenceP95Ms: timings.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(timings.length * 0.95) - 1)],
          peakMemoryMb: null, error: null,
        });
      } catch (error) {
        output.push({ provider, status: 'failed', coldStartMs: null, inferenceP50Ms: null, inferenceP95Ms: null, peakMemoryMb: null, error: String(error) });
      } finally {
        await session?.release();
      }
    }
    return { results: output, userAgent: navigator.userAgent, ortVersion };
  }, { shape, runs, warmup, ortVersion: ORT_VERSION });
  const proof = {
    schemaVersion: 1,
    artifactSha256,
    operatorInventorySha256,
    testedAt: new Date().toISOString(),
    environment: {
      os: process.platform,
      arch: process.arch,
      hardware: options.hardware ?? 'local-browser-host',
      browser: results.userAgent,
      ortVersion: results.ortVersion,
    },
    results: results.results,
  };
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output: outputPath, model: basename(modelPath), ...proof }, null, 2));
  if (!proof.results.some(result => result.status === 'passed')) process.exitCode = 2;
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
