export interface DetectionMetricBox {
  label: string;
  score?: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DetectionMatch {
  predictionIndex: number;
  groundTruthIndex: number;
  iou: number;
}

export interface DetectionQuality {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
  matches: DetectionMatch[];
}

export interface LatencySummary {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

function area(box: DetectionMetricBox): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
}

export function boxIoU(a: DetectionMetricBox, b: DetectionMetricBox): number {
  const intersectionWidth = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const intersectionHeight = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const intersection = intersectionWidth * intersectionHeight;
  const union = area(a) + area(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function evaluateDetections(
  predictions: DetectionMetricBox[],
  groundTruth: DetectionMetricBox[],
  iouThreshold = 0.5
): DetectionQuality {
  if (!(iouThreshold > 0 && iouThreshold <= 1)) {
    throw new RangeError('iouThreshold phải thuộc khoảng (0, 1]');
  }

  const orderedPredictions = predictions
    .map((prediction, index) => ({ prediction, index }))
    .sort((a, b) => (b.prediction.score ?? 0) - (a.prediction.score ?? 0));
  const matchedGroundTruth = new Set<number>();
  const matches: DetectionMatch[] = [];

  for (const { prediction, index: predictionIndex } of orderedPredictions) {
    let bestGroundTruth = -1;
    let bestIou = iouThreshold;
    for (let groundTruthIndex = 0; groundTruthIndex < groundTruth.length; groundTruthIndex++) {
      if (matchedGroundTruth.has(groundTruthIndex)) continue;
      const target = groundTruth[groundTruthIndex];
      if (prediction.label !== target.label) continue;
      const iou = boxIoU(prediction, target);
      if (iou >= bestIou) {
        bestIou = iou;
        bestGroundTruth = groundTruthIndex;
      }
    }
    if (bestGroundTruth >= 0) {
      matchedGroundTruth.add(bestGroundTruth);
      matches.push({ predictionIndex, groundTruthIndex: bestGroundTruth, iou: bestIou });
    }
  }

  const truePositive = matches.length;
  const falsePositive = predictions.length - truePositive;
  const falseNegative = groundTruth.length - truePositive;
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const f1 = ratio(2 * precision * recall, precision + recall);
  return { truePositive, falsePositive, falseNegative, precision, recall, f1, matches };
}

export function aggregateDetectionQuality(results: DetectionQuality[]): DetectionQuality {
  const truePositive = results.reduce((sum, result) => sum + result.truePositive, 0);
  const falsePositive = results.reduce((sum, result) => sum + result.falsePositive, 0);
  const falseNegative = results.reduce((sum, result) => sum + result.falseNegative, 0);
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const f1 = ratio(2 * precision * recall, precision + recall);
  return { truePositive, falsePositive, falseNegative, precision, recall, f1, matches: [] };
}

function nearestRank(sorted: number[], percentile: number): number {
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index];
}

export function summarizeLatency(samples: number[]): LatencySummary {
  if (samples.length === 0) throw new Error('Cần ít nhất một latency sample');
  if (samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new Error('Latency sample phải là số hữu hạn không âm');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    mean: sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length,
    p50: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    max: sorted[sorted.length - 1]
  };
}
