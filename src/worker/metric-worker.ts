// Metric depth worker (P1-B-2): Depth Pro qua transformers.js, chạy THEO YÊU CẦU
// trên khung đông cứng (không phải mỗi frame). Trả về depth ĐƠN VỊ MÉT (Float32) +
// focal ước lượng. Depth Pro nặng (~600MB q4f16) nên chỉ nạp khi bật metric mode.

import { RawImage } from '@huggingface/transformers';
import { makePipeline, configureEnv, hasWebGPU, type PipeFn } from './pipe';

const MODEL_ID = 'onnx-community/DepthPro-ONNX';

let estimator: PipeFn | null = null;
let loading = false;
let busy = false;
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
      estimator = await makePipeline('depth-estimation', MODEL_ID, {
        device: t.device,
        dtype: t.dtype,
        progress_callback: progress
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
      depth?: { data: ArrayBufferView; width: number; height: number };
      // Depth Pro có thể trả thêm focal_length / field_of_view tuỳ phiên bản
      focallength_px?: number;
      focal_length?: number;
      field_of_view?: number;
    };
    // Ưu tiên predicted_depth (mét thật). Nếu chỉ có RawImage depth thì suy ra không được
    // mét, nên coi như thất bại metric và báo lên.
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

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === 'init') {
    forceWasmFlag = m.forceWasm === true;
    configureEnv(m.localModels === true);
  } else if (m.type === 'preload') {
    void ensureLoaded();
  } else if (m.type === 'compute') {
    void compute(m.rgba, m.width, m.height);
  }
};
