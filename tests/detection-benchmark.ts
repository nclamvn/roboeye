import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import {
  aggregateDetectionQuality,
  evaluateDetections,
  summarizeLatency,
  type DetectionMetricBox,
  type DetectionQuality
} from '../src/detection-metrics';
import { DETECTION_CONFIG } from '../src/detection-config';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';
import { startPreview, stopPreview, waitForPreview } from './helpers/preview-server.mjs';

type Engine = 'rtdetr' | 'owlvit';

interface PixelBox {
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface FixtureCase {
  id: string;
  file: string;
  width: number;
  height: number;
  queries: string[];
  labelAliases: Record<string, string>;
  groundTruth: PixelBox[];
}

interface Manifest {
  schemaVersion: number;
  corpus: string;
  purpose: string;
  inputWidth: number;
  iouThreshold: number;
  warmupRuns: number;
  measuredRuns: number;
  engines: Record<Engine, { model: string; revision: string; dtype: string; threshold: number }>;
  cases: FixtureCase[];
}

interface BrowserPrediction extends DetectionMetricBox {
  score: number;
}

interface BrowserInference {
  boxes: BrowserPrediction[];
  detMs: number;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4184;
const BASE_URL = `http://localhost:${PORT}/`;
const MANIFEST_PATH = join(ROOT, 'tests', 'fixtures', 'detection-benchmark.manifest.json');
const RESULT_PATH = join(ROOT, 'tests', '.benchmark-results', 'detection-benchmark-latest.json');
const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Manifest;

for (const engine of ['rtdetr', 'owlvit'] as const) {
  const expected = DETECTION_CONFIG[engine];
  const declared = manifest.engines[engine];
  if (
    declared.model !== expected.model ||
    declared.revision !== expected.revision ||
    declared.dtype !== expected.wasmDtype ||
    declared.threshold !== expected.threshold
  ) {
    throw new Error(`Manifest ${engine} không khớp cấu hình production`);
  }
}

function normalizeGroundTruth(fixture: FixtureCase): DetectionMetricBox[] {
  return fixture.groundTruth.map((box) => ({
    label: box.label.toLowerCase(),
    x0: box.x0 / fixture.width,
    y0: box.y0 / fixture.height,
    x1: box.x1 / fixture.width,
    y1: box.y1 / fixture.height
  }));
}

function normalizePredictions(predictions: BrowserPrediction[], aliases: Record<string, string>): BrowserPrediction[] {
  return predictions.map((box) => {
    const rawLabel = box.label.trim().toLowerCase();
    return { ...box, label: (aliases[box.label] ?? aliases[rawLabel] ?? rawLabel).toLowerCase() };
  });
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function compactQuality(quality: DetectionQuality) {
  return {
    truePositive: quality.truePositive,
    falsePositive: quality.falsePositive,
    falseNegative: quality.falseNegative,
    precision: round(quality.precision),
    recall: round(quality.recall),
    f1: round(quality.f1)
  };
}

const executablePath = await resolveBrowserExecutable();
const preview = startPreview(ROOT, PORT);
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

try {
  await waitForPreview(preview);
  browser = await chromium.launch(browserLaunchOptions(executablePath));
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(360_000);
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.goto(`${BASE_URL}?webgl=1&wasm=1&detection-benchmark=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__roboeyeDetectionBenchmark));

  const engineResults = [];
  for (const engine of ['rtdetr', 'owlvit'] as const) {
    console.log(`[benchmark] loading ${engine}…`);
    const ready = await page.evaluate((selectedEngine) => {
      const api = window.__roboeyeDetectionBenchmark;
      if (!api) throw new Error('Detection benchmark API không tồn tại');
      return api.start(selectedEngine);
    }, engine);

    const caseResults = [];
    const qualities: DetectionQuality[] = [];
    const allLatency: number[] = [];
    for (const fixture of manifest.cases) {
      const browserRun = await page.evaluate(async ({
        fixtureUrl,
        inputWidth,
        expectedWidth,
        expectedHeight,
        queries,
        totalRuns
      }) => {
        const api = window.__roboeyeDetectionBenchmark;
        if (!api) throw new Error('Detection benchmark API không tồn tại');
        api.setQueries(queries);

        const response = await fetch(fixtureUrl);
        if (!response.ok) throw new Error(`Không tải được benchmark fixture: HTTP ${response.status}`);
        const bitmap = await createImageBitmap(await response.blob());
        if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) {
          throw new Error(
            `Sai kích thước fixture: ${bitmap.width}x${bitmap.height}, cần ${expectedWidth}x${expectedHeight}`
          );
        }
        const inputHeight = Math.max(2, Math.round(inputWidth / (bitmap.width / bitmap.height) / 2) * 2);
        const canvas = new OffscreenCanvas(inputWidth, inputHeight);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Không tạo được 2D context cho benchmark');
        context.drawImage(bitmap, 0, 0, inputWidth, inputHeight);
        bitmap.close();
        const source = context.getImageData(0, 0, inputWidth, inputHeight).data;
        const runs = [];
        for (let index = 0; index < totalRuns; index++) {
          const rgba = new Uint8ClampedArray(source).buffer;
          runs.push(await api.infer(rgba, inputWidth, inputHeight));
        }
        return { inputHeight, runs };
      }, {
        fixtureUrl: `${BASE_URL}benchmark-fixtures/${fixture.file}`,
        inputWidth: manifest.inputWidth,
        expectedWidth: fixture.width,
        expectedHeight: fixture.height,
        queries: engine === 'owlvit' ? fixture.queries : ['person', 'bus', 'dog'],
        totalRuns: manifest.warmupRuns + manifest.measuredRuns
      });

      const measured = browserRun.runs.slice(manifest.warmupRuns) as BrowserInference[];
      if (measured.length !== manifest.measuredRuns) throw new Error(`Thiếu measured run cho ${fixture.id}`);
      const groundTruth = normalizeGroundTruth(fixture);
      const evaluationLabels = new Set(groundTruth.map((box) => box.label));
      const allPredictions = normalizePredictions(measured[0].boxes, fixture.labelAliases);
      const predictions = allPredictions.filter((box) => evaluationLabels.has(box.label));
      const quality = evaluateDetections(predictions, groundTruth, manifest.iouThreshold);
      const latencySamples = measured.map((run) => run.detMs);
      qualities.push(quality);
      allLatency.push(...latencySamples);
      caseResults.push({
        id: fixture.id,
        queries: engine === 'owlvit' ? fixture.queries : null,
        input: { width: manifest.inputWidth, height: browserRun.inputHeight },
        evaluationLabels: [...evaluationLabels],
        ignoredPredictionCount: allPredictions.length - predictions.length,
        predictions,
        groundTruth,
        quality: compactQuality(quality),
        latencyMs: Object.fromEntries(
          Object.entries(summarizeLatency(latencySamples)).map(([key, value]) => [key, round(value)])
        )
      });
      console.log(
        `[benchmark] ${engine}/${fixture.id} · TP=${quality.truePositive} FP=${quality.falsePositive} FN=${quality.falseNegative}` +
        ` · p50=${round(summarizeLatency(latencySamples).p50)}ms`
      );
    }

    const quality = aggregateDetectionQuality(qualities);
    engineResults.push({
      engine,
      config: manifest.engines[engine],
      modelReady: { ...ready, readyMs: round(ready.readyMs), cacheState: 'uncontrolled-browser-cache' },
      quality: compactQuality(quality),
      latencyMs: Object.fromEntries(
        Object.entries(summarizeLatency(allLatency)).map(([key, value]) => [key, round(value)])
      ),
      cases: caseResults
    });
  }

  if (browserErrors.length > 0) throw new Error(`Browser errors:\n${browserErrors.join('\n')}`);

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    benchmark: {
      corpus: manifest.corpus,
      purpose: manifest.purpose,
      iouThreshold: manifest.iouThreshold,
      inputWidth: manifest.inputWidth,
      warmupRuns: manifest.warmupRuns,
      measuredRuns: manifest.measuredRuns,
      qualityMethod: 'class-aware greedy one-to-one matching; micro precision/recall/F1',
      percentileMethod: 'nearest-rank'
    },
    environment: {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      node: process.version,
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      browser: await browser.version(),
      executablePath,
      backend: 'wasm'
    },
    engines: engineResults
  };

  await mkdir(dirname(RESULT_PATH), { recursive: true });
  await writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log('\nDetection benchmark summary');
  console.table(engineResults.map((item) => ({
    engine: item.engine,
    precision: item.quality.precision,
    recall: item.quality.recall,
    f1: item.quality.f1,
    readyMs: item.modelReady.readyMs,
    p50Ms: item.latencyMs.p50,
    p95Ms: item.latencyMs.p95
  })));
  console.log(`[benchmark] PASS · ${RESULT_PATH}`);
} finally {
  await browser?.close().catch(() => {});
  await stopPreview(preview);
}
