import type { RoadVectorization } from './road-vectorizer';

export const ROAD_MODEL = {
  width: 896, height: 512, bytes: 864661,
  sha256: 'be0ceeb002af577936e9b439b7194dc8df6c8e5bc84ecb9bbfcab68695c86d17',
  input: 'data', output: 'L0317_ReWeight',
} as const;
export const ROAD_MAX_AGE_MS = 400;
export interface RoadSample {
  timeMs: number;
  generation: number;
  latencyMs: number;
  vector: RoadVectorization;
}

// Media-time freshness works both during playback and while inspecting a pause.
// Generation invalidates even a seek returning to the very same timestamp.
export function roadSampleVisible(sample: RoadSample | null, timeMs: number, generation: number): boolean {
  return !!sample && sample.generation === generation && Number.isFinite(timeMs)
    && timeMs >= sample.timeMs - 1 && timeMs - sample.timeMs <= ROAD_MAX_AGE_MS;
}

export function roadInput(rgba: Uint8ClampedArray, pixels: number): Float32Array {
  if (!Number.isInteger(pixels) || pixels <= 0 || rgba.length !== pixels * 4) throw Error('Sai kích thước ảnh làn.');
  const input = new Float32Array(pixels * 3);
  for (let p = 0; p < pixels; p++) {
    input[p] = rgba[p * 4 + 2];
    input[pixels + p] = rgba[p * 4 + 1];
    input[pixels * 2 + p] = rgba[p * 4];
  }
  return input; // Model contract: planar BGR 0..255, not normalized RGB.
}

export function roadLabels(output: Float32Array, pixels: number): Uint8Array {
  if (output.length !== pixels * 4) throw Error('Sai kích thước phân vùng đường.');
  const labels = new Uint8Array(pixels);
  for (let p = 0; p < pixels; p++) {
    let winner = 0, best = -Infinity;
    for (let c = 0; c < 4; c++) {
      const score = output[c * pixels + p];
      if (!Number.isFinite(score)) throw Error('Model trả về giá trị không hữu hạn.');
      if (score > best) { best = score; winner = c; }
    }
    labels[p] = winner;
  }
  return labels;
}
