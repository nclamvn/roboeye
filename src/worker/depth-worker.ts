// Depth worker: chạy transformers.js depth-anything-v2-small trong Web Worker riêng.
// Vòng inference tách khỏi vòng render. Main thread chỉ gửi frame khi worker rảnh
// (latest-frame-wins nằm ở phía main), nên ở đây không có hàng đợi.

import { pipeline, RawImage, env, type DepthEstimationPipeline } from '@huggingface/transformers';
import type { MainToWorker, WorkerToMain } from '../types';

const MODEL_ID = 'onnx-community/depth-anything-v2-small';

// Overload union của pipeline() quá phức tạp cho TS checker nên bọc lại với chữ ký hẹp.
// Runtime shape đúng theo docs transformers.js v3.
const createPipeline = pipeline as unknown as (
  task: 'depth-estimation',
  model: string,
  opts: { device: string; dtype: string; progress_callback: (item: unknown) => void }
) => Promise<DepthEstimationPipeline>;

// Mặc định lấy model từ HF Hub (có cache trình duyệt). ?localmodels=1 → load từ /models/
env.allowLocalModels = false;

// Tự host runtime WASM của onnxruntime (copy vào /ort/ qua scripts/copy-ort.mjs),
// không gọi CDN jsdelivr lúc chạy
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = '/ort/';
}

function useLocalModels() {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = '/models/';
}

let estimator: DepthEstimationPipeline | null = null;
let busy = false;

function post(msg: WorkerToMain, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, { transfer: transfer ?? [] });
}

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return adapter != null;
  } catch {
    return false;
  }
}

function progressCallback(item: unknown) {
  const it = item as { status?: string; file?: string; progress?: number; loaded?: number; total?: number };
  if (it.status === 'progress' && typeof it.progress === 'number') {
    post({
      type: 'progress',
      file: it.file ?? '',
      progress: it.progress,
      loaded: it.loaded ?? 0,
      total: it.total ?? 0
    });
  }
}

async function init(dtype: 'fp16' | 'q4f16', forceWasm = false, localModels = false) {
  if (localModels) useLocalModels();
  const webgpu = !forceWasm && (await hasWebGPU());
  // Thứ tự thử: webgpu với dtype yêu cầu → wasm q8. Báo thật device dùng được.
  if (webgpu) {
    try {
      estimator = await createPipeline('depth-estimation', MODEL_ID, {
        device: 'webgpu',
        dtype,
        progress_callback: progressCallback
      });
      post({ type: 'ready', device: 'webgpu', dtype });
      return;
    } catch (e) {
      // WebGPU có adapter nhưng pipeline fail → rơi xuống wasm, không giấu
      console.warn('[roboeye-worker] webgpu pipeline fail, fallback wasm:', e);
    }
  }
  try {
    estimator = await createPipeline('depth-estimation', MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: progressCallback
    });
    post({ type: 'ready', device: 'wasm', dtype: 'q8' });
  } catch (e) {
    post({ type: 'error', message: `Không load được model: ${e instanceof Error ? e.message : String(e)}` });
  }
}

async function inferFrame(rgba: ArrayBuffer, width: number, height: number) {
  if (!estimator || busy) return; // main không bao giờ gửi khi busy, đây là chốt an toàn
  busy = true;
  const t0 = performance.now();
  try {
    const image = new RawImage(new Uint8ClampedArray(rgba), width, height, 4);
    const result = await estimator(image);
    const single = Array.isArray(result) ? result[0] : result;
    const depth = single.depth; // RawImage 1 kênh, cùng kích thước input, 255 = gần
    const out = new Uint8Array(depth.data.buffer, depth.data.byteOffset, depth.width * depth.height).slice();
    post(
      { type: 'depth', depth: out.buffer, width: depth.width, height: depth.height, inferMs: performance.now() - t0 },
      [out.buffer]
    );
  } catch (e) {
    post({ type: 'error', message: `Inference lỗi: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    busy = false;
  }
}

self.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'init') void init(msg.dtype, msg.forceWasm === true, msg.localModels === true);
  else if (msg.type === 'frame') void inferFrame(msg.rgba, msg.width, msg.height);
};
