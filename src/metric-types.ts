// Giao thức message giữa main thread và metric worker (P1-B-2, Depth Pro on-demand).
// Metric worker dùng protocol RIÊNG, không dùng chung WorkerToMain/MsgError của depth
// worker (MsgError của depth có field `stage`), nên định nghĩa tách bạch ở đây.

export interface MetricInit {
  type: 'init';
  forceWasm: boolean;
  localModels: boolean;
}
export interface MetricPreload {
  type: 'preload';
}
export interface MetricCompute {
  type: 'compute';
  rgba: ArrayBuffer; // RGBA của khung đông cứng, transferred
  width: number;
  height: number;
}
export type MetricMainToWorker = MetricInit | MetricPreload | MetricCompute;

export interface MetricLoading {
  type: 'loading';
}
export interface MetricProgress {
  type: 'progress';
  file: string;
  progress: number; // 0..100
  loaded: number;
  total: number;
}
export interface MetricReady {
  type: 'ready';
  device: string;
}
export interface MetricResult {
  type: 'metric';
  depth: ArrayBuffer; // Float32 w*h ĐƠN VỊ MÉT, transferred
  width: number;
  height: number;
  focal: number; // pixel; 0 = để main tự suy từ FOV
  ms: number;
}
export interface MetricError {
  type: 'error';
  message: string;
}
export type MetricWorkerToMain = MetricLoading | MetricProgress | MetricReady | MetricResult | MetricError;
