// Detection worker đa-engine (engine v2, P1-B).
//   'rtdetr'  : closed-set COCO, nhanh, cho realtime
//   'owlvit'  : open-vocabulary zero-shot, gõ chữ ra lớp bất kỳ, cho gán nhãn domain mới
// Vòng riêng tách khỏi depth và render, latest-frame-wins. Đổi engine thì nạp lại pipeline.

import { pipeline, RawImage, env } from '@huggingface/transformers';
import type {
  DetBox,
  DetectionDevice,
  DetectionEngine,
  DetectionMainToWorker,
  DetectionWorkerToMain
} from '../detection-types';
import { DETECTION_CONFIG } from '../detection-config';
import {
  OWLVIT_POSTPROCESS,
  RTDETR_POSTPROCESS,
  postprocessDetections
} from '../detection-postprocess';
import { createOwlPromptPlan, OWL_QUERY_PRESETS } from '../detection-presets';

env.allowLocalModels = false;
const BASE = new URL(import.meta.env.BASE_URL, self.location.href).href;
if (import.meta.env.PROD && env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = `${BASE}ort/`;
}
function useLocalModels() {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = `${BASE}models/`;
}

// pipeline() overload union quá phức tạp cho TS, bọc chữ ký hẹp
const makePipe = pipeline as unknown as (
  task: string,
  model: string,
  opts: { device: string; dtype: string; revision: string; progress_callback: (item: unknown) => void }
) => Promise<(input: unknown, ...rest: unknown[]) => Promise<unknown>>;

let engine: DetectionEngine = 'rtdetr';
let detector: ((input: unknown, ...rest: unknown[]) => Promise<unknown>) | null = null;
let busy = false;
let loadVersion = 0;
let queries: string[] = [...OWL_QUERY_PRESETS.everyday.queries];
let forceWasmFlag = false;
let localFlag = false;

function post(msg: DetectionWorkerToMain, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, { transfer: transfer ?? [] });
}

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

function progress(item: unknown) {
  const it = item as { status?: string; file?: string; progress?: number; loaded?: number; total?: number };
  if (it.status === 'progress' && typeof it.progress === 'number') {
    post({ type: 'progress', file: it.file ?? '', progress: it.progress, loaded: it.loaded ?? 0, total: it.total ?? 0 });
  }
}

async function loadEngine(e: DetectionEngine) {
  const version = ++loadVersion;
  detector = null;
  post({ type: 'loading', engine: e });
  const task = e === 'rtdetr' ? 'object-detection' : 'zero-shot-object-detection';
  const config = DETECTION_CONFIG[e];
  const webgpu = !forceWasmFlag && (await hasWebGPU());
  const tries: Array<{ device: DetectionDevice; dtype: string }> = webgpu
    ? [{ device: 'webgpu', dtype: e === 'rtdetr' ? 'fp16' : 'q4f16' }, { device: 'wasm', dtype: 'q8' }]
    : [{ device: 'wasm', dtype: 'q8' }];
  let lastErr = '';
  for (const t of tries) {
    try {
      const candidate = await makePipe(task, config.model, {
        device: t.device,
        dtype: t.dtype,
        revision: config.revision,
        progress_callback: progress
      });
      if (version !== loadVersion) return;
      detector = candidate;
      post({ type: 'ready', engine: e, device: t.device });
      return;
    } catch (err) {
      if (version !== loadVersion) return;
      lastErr = err instanceof Error ? err.message : String(err);
      console.warn(`[detect] ${e} ${t.device} fail:`, err);
    }
  }
  if (version === loadVersion) {
    post({ type: 'error', stage: 'load', message: `Không load được ${e}: ${lastErr}` });
  }
}

async function detect(rgba: ArrayBuffer, width: number, height: number, capturedAt: number) {
  const activeDetector = detector;
  const activeEngine = engine;
  if (!activeDetector || busy) return;
  busy = true;
  const t0 = performance.now();
  try {
    const image = new RawImage(new Uint8ClampedArray(rgba), width, height, 4);
    const promptPlan = createOwlPromptPlan(queries);
    let raw: Array<{ score: number; label: string; box: { xmin: number; ymin: number; xmax: number; ymax: number } }>;
    if (activeEngine === 'owlvit') {
      raw = (await activeDetector(image, promptPlan.prompts, {
        threshold: DETECTION_CONFIG.owlvit.threshold,
        percentage: false
      })) as typeof raw;
    } else {
      raw = (await activeDetector(image, {
        threshold: DETECTION_CONFIG.rtdetr.threshold,
        percentage: false
      })) as typeof raw;
    }
    if (activeEngine !== engine || activeDetector !== detector) return;
    const boxes: DetBox[] = postprocessDetections(raw.map((r) => ({
      label: activeEngine === 'owlvit' ? (promptPlan.labelByPrompt.get(r.label) ?? r.label) : r.label,
      score: r.score,
      x0: r.box.xmin / width,
      y0: r.box.ymin / height,
      x1: r.box.xmax / width,
      y1: r.box.ymax / height
    })), activeEngine === 'rtdetr' ? RTDETR_POSTPROCESS : OWLVIT_POSTPROCESS);
    post({ type: 'det', boxes, detMs: performance.now() - t0, capturedAt });
  } catch (e) {
    post({ type: 'error', stage: 'infer', message: `Detect lỗi: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    busy = false;
  }
}

self.onmessage = (ev: MessageEvent<DetectionMainToWorker>) => {
  const m = ev.data;
  if (m.type === 'init') {
    forceWasmFlag = m.forceWasm === true;
    localFlag = m.localModels === true;
    if (localFlag) useLocalModels();
    engine = m.engine;
    if (m.queries.length) queries = m.queries;
    void loadEngine(engine);
  } else if (m.type === 'engine') {
    engine = m.engine;
    void loadEngine(engine);
  } else if (m.type === 'queries') {
    const nextQueries = m.value.filter((value) => value.trim().length > 0);
    if (nextQueries.length > 0) queries = nextQueries;
  } else if (m.type === 'frame') {
    void detect(m.rgba, m.width, m.height, m.capturedAt);
  }
};
