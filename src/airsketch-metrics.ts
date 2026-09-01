import type { AirSketchBenchmarkSnapshot } from './airsketch-types';

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

export class AirSketchMetrics {
  private hand: number[] = [];
  private pipeline: number[] = [];
  private classify: number[] = [];

  addHand(ms: number): void { if (Number.isFinite(ms) && ms >= 0) this.hand.push(ms); }
  addPipeline(ms: number): void { if (Number.isFinite(ms) && ms >= 0) this.pipeline.push(ms); }
  addClassify(ms: number): void { if (Number.isFinite(ms) && ms >= 0) this.classify.push(ms); }

  snapshot(
    strokes: number,
    points: number,
    ready: AirSketchBenchmarkSnapshot['ready'] = { hand: false, classifier: false },
    objects = 0
  ): AirSketchBenchmarkSnapshot {
    const summarize = (values: number[]) => ({ samples: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) });
    return {
      ready,
      hand: summarize(this.hand),
      pipeline: summarize(this.pipeline),
      classify: summarize(this.classify),
      strokes,
      points,
      objects
    };
  }
}
