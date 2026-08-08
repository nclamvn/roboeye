// Helper chung cho transformers.js pipeline (gộp nợ D7).
// Overload union của pipeline() quá phức tạp cho TS checker nên bọc lại chữ ký hẹp
// dùng chung cho cả depth-worker, detect-worker và metric-worker.

import { pipeline, env } from '@huggingface/transformers';

export type PipeFn = (input: unknown, ...rest: unknown[]) => Promise<unknown>;

export const makePipeline = pipeline as unknown as (
  task: string,
  model: string,
  opts: { device: string; dtype: string; progress_callback: (item: unknown) => void }
) => Promise<PipeFn>;

/** Cấu hình env dùng chung: base URL, tự host ORT wasm khi build, cờ local models. */
export function configureEnv(localModels: boolean): string {
  const base = new URL(import.meta.env.BASE_URL, self.location.href).href;
  if (import.meta.env.PROD && env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = `${base}ort/`;
  }
  if (localModels) {
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = `${base}models/`;
  } else {
    env.allowLocalModels = false;
  }
  return base;
}

export async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}
