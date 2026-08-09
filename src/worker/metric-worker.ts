// Metric depth worker (P1-B-2): Depth Pro qua transformers.js, chạy THEO YÊU CẦU
// trên khung đông cứng (không phải mỗi frame). Trả về depth ĐƠN VỊ MÉT (Float32) +
// focal ước lượng. Depth Pro nặng (~600MB q4f16) nên chỉ nạp khi bật metric mode.
// Cùng style tự-host ORT + local models như depth-worker.ts (không dùng pipe chung).

import { pipeline, RawImage, env } from '@huggingface/transformers';
import type { MetricMainToWorker } from '../metric-types';

const MODEL_ID = 'onnx-community/DepthPro-ONNX';

type PipeFn = (input: unknown) => Promise<unknown>;

// Overload union của pipeline() quá phức tạp cho TS checker nên bọc lại chữ ký hẹp.
const createPipeline = pipeline as unknown as (
  task: 'depth-estimation',
  model: string,
  opts: { device: string; dtype: string; progress_callback: (item: unknown) => void }
) => Promise<PipeFn>;

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

let estimator: PipeFn | null = null;
let loading = false;
let busy = false;
let forceWasmFlag = false;

function post(msg: unknown, transfer?: Transferable[]) {
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

function progressCallback(item: unknown) {
  const it = item as { status?: string; file?: string; progress?: number; loaded?: number; total?: number };
  if (it.status === 'progress' && typeof it.progress === 'number') {
    post({ type: 'progress', file: it.file ?? '', progress: it.progress, loaded: it.loaded ?? 0, total: it.total ?? 0 });
  }
}

async function ensureLoaded() {
  if (estimator || loading) return;
  loading = true;
  post({ type: 'loading' });
  const webgpu = !forceWasmFlag && (await hasWebGPU());
  const tries: Array<{ device: string; dtype: string }> = webgpu
    ? [{ device: 'webgpu', dtype: 'q4f16' }, { device: 'wasm', dtype: 'q4' }]
    : [{ device: 'wasm', dtype: 'q4' }];
  let lastErr = '';
  for (const t of tries) {
    try {
      estimator = await createPipeline('depth-estimation', MODEL_ID, {
        device: t.device,
        dtype: t.dtype,
        progress_callback: progressCallback
      });
      post({ type: 'ready', device: t.device });
      loading = false;
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[metric] ${t.device} fail:`, e);
    }
  }
  loading = false;
  post({ type: 'error', message: `Không load được Depth Pro: ${lastErr}` });
}

async function compute(rgba: ArrayBuffer, width: number, height: number) {
  await ensureLoaded();
  if (!estimator || busy) return;
  busy = true;
  const t0 = performance.now();
  try {
    const image = new RawImage(new Uint8ClampedArray(rgba), width, height, 4);
    const res = (await estimator(image)) as {
      predicted_depth?: { data: Float32Array; dims?: number[] };
      // Depth Pro có thể trả thêm focal_length / field_of_view tuỳ phiên bản
      focallength_px?: number;
      focal_length?: number;
      field_of_view?: number;
    };
    // Ưu tiên predicted_depth (mét thật). Không có thì coi như thất bại metric.
    const pd = res.predicted_depth;
    if (!pd || !(pd.data instanceof Float32Array)) {
      post({ type: 'error', message: 'Depth Pro không trả predicted_depth mét, bỏ metric' });
      return;
    }
    const dims = pd.dims && pd.dims.length >= 2 ? pd.dims : [height, width];
    const dh = dims[dims.length - 2];
    const dw = dims[dims.length - 1];
    const meters = pd.data.slice();
    const focal = res.focallength_px ?? res.focal_length ?? 0; // 0 = main tự suy từ FOV
    post(
      { type: 'metric', depth: meters.buffer, width: dw, height: dh, focal, ms: performance.now() - t0 },
      [meters.buffer]
    );
  } catch (e) {
    post({ type: 'error', message: `Depth Pro lỗi: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    busy = false;
  }
}

self.onmessage = (ev: MessageEvent<MetricMainToWorker>) => {
  const m = ev.data;
  if (m.type === 'init') {
    forceWasmFlag = m.forceWasm === true;
    if (m.localModels === true) useLocalModels();
  } else if (m.type === 'preload') {
    void ensureLoaded();
  } else if (m.type === 'compute') {
    void compute(m.rgba, m.width, m.height);
  }
};
