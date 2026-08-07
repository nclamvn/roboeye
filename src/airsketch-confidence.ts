import type { SketchPrediction } from './airsketch-types';

export type SketchConfidence = 'confident' | 'possible' | 'uncertain';

export function assessSketchConfidence(predictions: SketchPrediction[]): SketchConfidence {
  const top = predictions[0];
  if (!top) return 'uncertain';
  const margin = top.score - (predictions[1]?.score ?? 0);
  if (top.score >= 0.45 && margin >= 0.10) return 'confident';
  if (top.score >= 0.20 && margin >= 0.04) return 'possible';
  return 'uncertain';
}
