// Giao thức message giữa main thread và depth worker

export type Dtype = 'fp16' | 'q4f16';
export type InferDevice = 'webgpu' | 'wasm';
export type Mode = 'rgb' | 'depth' | 'cloud' | 'bev';
export type DepthErrorStage = 'load' | 'infer';

export interface MsgInit {
  type: 'init';
  dtype: Dtype;
  /** true → bỏ qua webgpu, vào thẳng wasm (dùng cho ?wasm=1 và test fallback) */
  forceWasm?: boolean;
  /** true → load model từ /models/ trên chính origin thay vì HF Hub (?localmodels=1, demo offline) */
  localModels?: boolean;
}

export interface MsgFrame {
  type: 'frame';
  rgba: ArrayBuffer; // RGBA Uint8ClampedArray buffer, transferred
  width: number;
  height: number;
}

export type MainToWorker = MsgInit | MsgFrame;

export interface MsgProgress {
  type: 'progress';
  file: string;
  progress: number; // 0..100
  loaded: number;
  total: number;
}

export interface MsgReady {
  type: 'ready';
  device: InferDevice;
  dtype: string;
}

export interface MsgDepth {
  type: 'depth';
  depth: ArrayBuffer; // Uint8 w*h, transferred. 255 = gần, 0 = xa
  width: number;
  height: number;
  inferMs: number;
}

export interface MsgError {
  type: 'error';
  stage: DepthErrorStage;
  message: string;
}

export type WorkerToMain = MsgProgress | MsgReady | MsgDepth | MsgError;
