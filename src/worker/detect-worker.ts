// Detection worker đa-engine (engine v2, P1-B).
//   'rtdetr'  : closed-set COCO, nhanh, cho realtime
//   'owlvit'  : open-vocabulary zero-shot, gõ chữ ra lớp bất kỳ, cho gán nhãn domain mới
// Vòng riêng tách khỏi depth và render, latest-frame-wins. Đổi engine thì nạp lại pipeline.

import { RawImage } from '@huggingface/transformers';
import { makePipeline, configureEnv, hasWebGPU, type PipeFn } from './pipe';

type Engine = 'rtdetr' | 'owlvit';
const MODELS: Record<Engine, string> = {
  rtdetr: 'onnx-community/rtdetr_v2_r18vd-ONNX',
  owlvit: 'Xenova/owlvit-base-patch32'
};

export interface DetBox {
  label: string;
  score: number;
  x0: number; // normalized 0..1, gốc trên-trái
  y0: number;
  x1: number;
  y1: number;
}

let engine: Engine = 'rtdetr';
let detector: PipeFn | null = null;
let busy = false;
let queries: string[] = ['person', 'car', 'chair'];
let forceWasmFlag = false;

function post(msg: unknown, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, { transfer: transfer ?? [] });
}

function progress(item: unknown) {
  const it = item as { status?: string; file?: string; progress?: number; loaded?: number; total?: number };
  if (it.status === 'progress' && typeof it.progress === 'number') {
    post({ type: 'progress', file: it.file ?? '', progress: it.progress, loaded: it.loaded ?? 0, total: it.total ?? 0 });
  }
}

async function loadEngine(e: Engine) {
  detector = null;
  post({ type: 'loading', engine: e });
  const task = e === 'rtdetr' ? 'object-detection' : 'zero-shot-object-detection';
  const webgpu = !forceWasmFlag && (await hasWebGPU());
  const tries: Array<{ device: string; dtype: string }> = webgpu
    ? [{ device: 'webgpu', dtype: e === 'rtdetr' ? 'fp16' : 'q4f16' }, { device: 'wasm', dtype: 'q8' }]
    : [{ device: 'wasm', dtype: 'q8' }];
  let lastErr = '';
  for (const t of tries) {
    try {
      detector = await makePipeline(task, MODELS[e], { device: t.device, dtype: t.dtype, progress_callback: progress });
      post({ type: 'ready', engine: e, device: t.device });
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.warn(`[detect] ${e} ${t.device} fail:`, err);
    }
  }
  post({ type: 'error', message: `Không load được ${e}: ${lastErr}` });
}

async function detect(rgba: ArrayBuffer, width: number, height: number) {
  if (!detector || busy) return;
  busy = true;
  const t0 = performance.now();
  try {
    const image = new RawImage(new Uint8ClampedArray(rgba), width, height, 4);
    let raw: Array<{ score: number; label: string; box: { xmin: number; ymin: number; xmax: number; ymax: number } }>;
    if (engine === 'owlvit') {
      const th = 0.08; // OWL-ViT ngưỡng thấp
      raw = (await detector(image, queries, { threshold: th, percentage: false })) as typeof raw;
    } else {
      raw = (await detector(image, { threshold: 0.45, percentage: false })) as typeof raw;
    }
    const boxes: DetBox[] = raw.map((r) => ({
      label: r.label,
      score: r.score,
      x0: r.box.xmin / width,
      y0: r.box.ymin / height,
      x1: r.box.xmax / width,
      y1: r.box.ymax / height
    }));
    post({ type: 'det', boxes, detMs: performance.now() - t0 });
  } catch (e) {
    post({ type: 'error', message: `Detect lỗi: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    busy = false;
  }
}

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === 'init') {
    forceWasmFlag = m.forceWasm === true;
    configureEnv(m.localModels === true);
    engine = (m.engine as Engine) || 'rtdetr';
    if (Array.isArray(m.queries) && m.queries.length) queries = m.queries;
    void loadEngine(engine);
  } else if (m.type === 'engine') {
    engine = m.engine as Engine;
    void loadEngine(engine);
  } else if (m.type === 'queries') {
    if (Array.isArray(m.value)) queries = m.value.filter((s: string) => s.trim().length > 0);
  } else if (m.type === 'frame') {
    void detect(m.rgba, m.width, m.height);
  }
};
