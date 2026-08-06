export interface AirPoint {
  x: number;
  y: number;
  t: number;
}

export interface AirStroke {
  points: AirPoint[];
}

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export type AirGesture = 'hover' | 'draw' | 'undo-hold' | 'clear-hold';

export interface AirHandSample {
  cursor: AirPoint;
  penDown: boolean;
  gesture: AirGesture;
  holdProgress: number;
  command: 'undo' | 'clear' | null;
}

export interface SketchPrediction {
  label: string;
  score: number;
}

export type AirSketchMainToHandWorker =
  | { type: 'init'; modelUrl: string; expectedBytes: number; expectedSha256: string; visionBundleUrl: string; wasmBase: string }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number };

export type AirSketchHandWorkerToMain =
  | { type: 'loading'; stage: 'runtime' | 'model' | 'graph' }
  | { type: 'ready' }
  | { type: 'landmarks'; landmarks: HandLandmark[] | null; handedness: string | null; inferMs: number }
  | { type: 'error'; stage: 'load' | 'infer'; message: string };

export type AirSketchMainToClassifierWorker =
  | { type: 'init'; localModels: boolean }
  | { type: 'classify'; rgba: ArrayBuffer; width: number; height: number; revision: number };

export type AirSketchClassifierWorkerToMain =
  | { type: 'progress'; progress: number }
  | { type: 'ready'; device: 'wasm' }
  | { type: 'prediction'; predictions: SketchPrediction[]; inferMs: number; revision: number }
  | { type: 'error'; stage: 'load' | 'infer'; message: string; revision?: number };

export interface AirSketchBenchmarkSnapshot {
  ready: { hand: boolean; classifier: boolean; handStage?: string };
  hand: { samples: number; p50: number | null; p95: number | null };
  classify: { samples: number; p50: number | null; p95: number | null };
  strokes: number;
  points: number;
}
