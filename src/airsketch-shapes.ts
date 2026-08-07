import type { AirStroke } from './airsketch-types';

/** Local geometry fallback for common pictograms absent from the pinned model. */
export function detectHeartSketch(strokes: AirStroke[]): number | null {
  if (strokes.length !== 1) return null;
  const points = strokes[0].points;
  if (points.length < 14) return null;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 0.05 || height < 0.08) return null;
  const aspect = width / height;
  if (aspect < 0.45 || aspect > 1.45) return null;
  const normalized = points.map((point) => ({ x: (point.x - minX) / width, y: (point.y - minY) / height }));
  const left = normalized.filter((point) => point.x < 0.43);
  const right = normalized.filter((point) => point.x > 0.57);
  const center = normalized.filter((point) => point.x >= 0.43 && point.x <= 0.57);
  if (left.length < 3 || right.length < 3 || center.length < 2) return null;
  const leftTop = Math.min(...left.map((point) => point.y));
  const rightTop = Math.min(...right.map((point) => point.y));
  const centerTop = Math.min(...center.map((point) => point.y));
  const lobeTop = Math.min(leftTop, rightTop);
  const endpointNotches = [normalized[0], normalized.at(-1)!]
    .filter((point) => point.x >= 0.32 && point.x <= 0.68);
  const endpointDepth = endpointNotches.length === 2
    ? Math.min(...endpointNotches.map((point) => point.y)) - lobeTop
    : 0;
  const lobeDepth = Math.max(centerTop - lobeTop, endpointDepth);
  if (lobeDepth < 0.055) return null;
  const bottom = normalized.filter((point) => point.y > 0.86);
  if (bottom.length < 1) return null;
  const bottomCenter = bottom.reduce((sum, point) => sum + point.x, 0) / bottom.length;
  const tipScore = Math.max(0, 1 - Math.abs(bottomCenter - 0.5) / 0.28);
  if (tipScore < 0.35) return null;
  return Math.min(0.995, 0.86 + Math.min(0.12, lobeDepth * 0.8) + tipScore * 0.02);
}

export function mergeSpecialSketchPrediction(
  predictions: { label: string; score: number }[],
  special: { label: string; score: number } | null,
  limit = 5
): { label: string; score: number }[] {
  if (!special) return predictions.slice(0, limit);
  return [special, ...predictions.filter((prediction) => prediction.label !== special.label)].slice(0, limit);
}
