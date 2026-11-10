export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface TrackedHandLandmarks {
  landmarks: HandLandmark[];
  worldLandmarks: HandLandmark[];
  handedness: string | null;
  handednessScore: number;
}

export type MainToHandWorker =
  | {
      type: 'init'; modelUrl: string; expectedBytes: number; expectedSha256: string;
      visionBundleUrl: string; wasmBase: string; preferredDelegate?: 'GPU' | 'CPU';
      gpuFallbackInferMs?: number; gpuFallbackSlowSamples?: number;
      numHands?: 1 | 2;
      confidence?: { detection:number; presence:number; tracking:number };
    }
  | {
      type: 'frame'; bitmap: ImageBitmap; timestamp: number;
      capturedAt?: number; captureStartedAt?: number; sentAt?: number;
    };

export type HandWorkerToMain =
  | { type: 'loading'; stage: 'runtime' | 'model' | 'graph' }
  | { type: 'ready'; delegate?: 'GPU' | 'CPU' }
  | {
      type: 'landmarks'; landmarks: HandLandmark[] | null; worldLandmarks: HandLandmark[] | null;
      handedness: string | null; handednessScore: number; inferMs: number;
      /** All observations. Legacy single-hand fields above remain the first hand. */
      hands?: TrackedHandLandmarks[];
      // Timestamp of the video frame, not the later worker reply.
      capturedAt: number; captureStartedAt?: number; sentAt?: number; delegate?: 'GPU' | 'CPU';
    }
  | { type: 'error'; stage: 'load' | 'infer'; message: string };
