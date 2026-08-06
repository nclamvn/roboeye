import type { DetBox } from './detection-types';

export interface DetectionPostprocessOptions {
  nmsIouThreshold: number;
  containmentThreshold: number;
  maxDetections: number;
}

export const RTDETR_POSTPROCESS: DetectionPostprocessOptions = {
  nmsIouThreshold: 0.45,
  containmentThreshold: 0.90,
  maxDetections: 50
};

export const OWLVIT_POSTPROCESS: DetectionPostprocessOptions = {
  nmsIouThreshold: 0.50,
  containmentThreshold: 0.92,
  maxDetections: 50
};

function area(box: DetBox): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
}

function intersection(a: DetBox, b: DetBox): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}

export function detectionIoU(a: DetBox, b: DetBox): number {
  const overlap = intersection(a, b);
  const union = area(a) + area(b) - overlap;
  return union > 0 ? overlap / union : 0;
}

export function overlapOverSmaller(a: DetBox, b: DetBox): number {
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 ? intersection(a, b) / smaller : 0;
}

function normalizedBox(box: DetBox): DetBox | null {
  if (![box.score, box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)) return null;
  const normalized: DetBox = {
    ...box,
    label: box.label.trim(),
    x0: Math.max(0, Math.min(1, box.x0)),
    y0: Math.max(0, Math.min(1, box.y0)),
    x1: Math.max(0, Math.min(1, box.x1)),
    y1: Math.max(0, Math.min(1, box.y1))
  };
  return normalized.label && normalized.score >= 0 && area(normalized) > 0 ? normalized : null;
}

export function postprocessDetections(
  boxes: DetBox[],
  options: DetectionPostprocessOptions
): DetBox[] {
  if (
    !(options.nmsIouThreshold > 0 && options.nmsIouThreshold <= 1) ||
    !(options.containmentThreshold > 0 && options.containmentThreshold <= 1) ||
    !Number.isInteger(options.maxDetections) ||
    options.maxDetections <= 0
  ) {
    throw new Error('Detection post-processing config không hợp lệ');
  }

  const candidates = boxes
    .map(normalizedBox)
    .filter((box): box is DetBox => box !== null)
    .sort((a, b) => b.score - a.score);
  const kept: DetBox[] = [];

  for (const candidate of candidates) {
    const duplicate = kept.some((existing) =>
      existing.label === candidate.label &&
      (
        detectionIoU(existing, candidate) >= options.nmsIouThreshold ||
        overlapOverSmaller(existing, candidate) >= options.containmentThreshold
      )
    );
    if (!duplicate) kept.push(candidate);
    if (kept.length >= options.maxDetections) break;
  }
  return kept;
}
