import { env, pipeline, RawImage } from '@huggingface/transformers';
import { AIRSKETCH_CONFIG } from '../airsketch-config';
import type { AirSketchClassifierWorkerToMain, AirSketchMainToClassifierWorker, SketchPrediction } from '../airsketch-types';

env.allowLocalModels = false;
const BASE = new URL(import.meta.env.BASE_URL, self.location.href).href;
if (import.meta.env.PROD && env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = `${BASE}ort/`;

const makeClassifier = pipeline as unknown as (
  task: 'image-classification',
  model: string,
  options: { device: 'wasm'; dtype: 'q8'; revision: string; progress_callback: (item: unknown) => void }
) => Promise<(image: RawImage, options: { top_k: number }) => Promise<SketchPrediction[]>>;

let classifier: ((image: RawImage, options: { top_k: number }) => Promise<SketchPrediction[]>) | null = null;
let busy = false;

function post(message: AirSketchClassifierWorkerToMain) {
  (self as unknown as Worker).postMessage(message);
}

async function init(localModels: boolean) {
  if (localModels) {
    post({ type: 'error', stage: 'load', message: 'AirSketch classifier chưa được đóng gói trong bản offline' });
    return;
  }
  try {
    classifier = await makeClassifier('image-classification', AIRSKETCH_CONFIG.classifier.model, {
      device: 'wasm',
      dtype: AIRSKETCH_CONFIG.classifier.dtype,
      revision: AIRSKETCH_CONFIG.classifier.revision,
      progress_callback(item: unknown) {
        const progress = (item as { progress?: number }).progress;
        if (typeof progress === 'number') post({ type: 'progress', progress });
      }
    });
    post({ type: 'ready', device: 'wasm' });
  } catch (error) {
    post({ type: 'error', stage: 'load', message: error instanceof Error ? error.message : String(error) });
  }
}

async function classify(rgba: ArrayBuffer, width: number, height: number, revision: number) {
  if (!classifier || busy) return;
  busy = true;
  const startedAt = performance.now();
  try {
    const image = new RawImage(new Uint8ClampedArray(rgba), width, height, 4).grayscale();
    const predictions = await classifier(image, { top_k: AIRSKETCH_CONFIG.classifier.topK });
    post({ type: 'prediction', predictions, inferMs: performance.now() - startedAt, revision });
  } catch (error) {
    post({ type: 'error', stage: 'infer', message: error instanceof Error ? error.message : String(error), revision });
  } finally {
    busy = false;
  }
}

self.onmessage = (event: MessageEvent<AirSketchMainToClassifierWorker>) => {
  if (event.data.type === 'init') void init(event.data.localModels);
  else void classify(event.data.rgba, event.data.width, event.data.height, event.data.revision);
};
