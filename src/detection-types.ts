export type DetectionEngine = 'rtdetr' | 'owlvit';
export type DetectionDevice = 'webgpu' | 'wasm';
export type DetectionErrorStage = 'load' | 'infer';

export interface DetBox {
  label: string;
  score: number;
  x0: number; // normalized 0..1, gốc trên-trái
  y0: number;
  x1: number;
  y1: number;
}

export interface DetectionBenchmarkReady {
  engine: DetectionEngine;
  device: DetectionDevice;
  readyMs: number;
}

export interface DetectionBenchmarkResult {
  boxes: DetBox[];
  detMs: number;
}

export interface DetectionBenchmarkAPI {
  start(engine: DetectionEngine): Promise<DetectionBenchmarkReady>;
  setQueries(value: string[]): void;
  infer(rgba: ArrayBuffer, width: number, height: number): Promise<DetectionBenchmarkResult>;
  stop(): void;
}

declare global {
  interface Window {
    __roboeyeDetectionBenchmark?: DetectionBenchmarkAPI;
  }
}

export interface RelativeBox3D {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
}

export type DetectionMainToWorker =
  | {
      type: 'init';
      forceWasm: boolean;
      localModels: boolean;
      engine: DetectionEngine;
      queries: string[];
    }
  | { type: 'engine'; engine: DetectionEngine }
  | { type: 'queries'; value: string[] }
  // The capture timestamp lets the main thread compensate for detector latency
  // before drawing a result over the newer camera frame.
  | { type: 'frame'; rgba: ArrayBuffer; width: number; height: number; capturedAt: number };

export type DetectionWorkerToMain =
  | { type: 'loading'; engine: DetectionEngine }
  | { type: 'progress'; file: string; progress: number; loaded: number; total: number }
  | { type: 'ready'; engine: DetectionEngine; device: DetectionDevice }
  | { type: 'det'; boxes: DetBox[]; detMs: number; capturedAt: number }
  | { type: 'error'; stage: DetectionErrorStage; message: string };
