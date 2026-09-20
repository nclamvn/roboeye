export type RoadLineClass = 'lane-marking' | 'curb' | 'median' | 'barrier' | 'guardrail';
export type RoadLineRole = 'ego-left' | 'ego-right' | 'adjacent' | 'unknown';
export type CorpusSplit = 'train' | 'validation' | 'test';
export interface RoadPoint { x: number; y: number }
export interface RoadLine { id: string; class: RoadLineClass; role: RoadLineRole; points: RoadPoint[] }
export interface RoadArea { id: string; class: 'drivable'; points: RoadPoint[] }
export interface RoadTruthFrame { timeMs: number; lines: RoadLine[]; areas: RoadArea[] }
export interface RoadPredictionFrame extends RoadTruthFrame { inferenceMs: number; evidenceAgeMs: number }
export interface RoadClip {
  clipId: string; split: CorpusSplit; width: number; height: number; sourceSha256: string;
  rights: { basis: 'owned' | 'licensed' | 'consented' | 'synthetic'; reference: string };
  scenarioTags: string[]; truthFrames: RoadTruthFrame[]; predictionFrames: RoadPredictionFrame[];
}
export interface RoadBenchmarkCorpus { schemaVersion: 1; corpusId: string; modelId: string; clips: RoadClip[] }

const LINE_CLASSES: RoadLineClass[] = ['lane-marking', 'curb', 'median', 'barrier', 'guardrail'];
const ROLES: RoadLineRole[] = ['ego-left', 'ego-right', 'adjacent', 'unknown'];
const SPLITS: CorpusSplit[] = ['train', 'validation', 'test'];
const RIGHTS: RoadClip['rights']['basis'][] = ['owned', 'licensed', 'consented', 'synthetic'];
const TIME_TOLERANCE_MS = 80;
const LINE_GATE_PX = 20;
const STALE_GATE_MS = 250;

function record(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error(`${path}: cần object`);
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!keys.includes(key)) throw Error(`${path}.${key}: trường không được phép`);
  return item;
}
function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw Error(`${path}: cần array tối đa ${max} phần tử`);
  return value;
}
function string(value: unknown, path: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${path}: chuỗi không hợp lệ`);
  return value;
}
function number(value: unknown, path: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw Error(`${path}: số ngoài giới hạn`);
  return value;
}
function choice<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw Error(`${path}: giá trị không hợp lệ`);
  return value as T;
}
function point(value: unknown, path: string): RoadPoint {
  const item = record(value, path, ['x', 'y']);
  return { x: number(item.x, `${path}.x`, 0, 1), y: number(item.y, `${path}.y`, 0, 1) };
}
function points(value: unknown, path: string, minimum: number): RoadPoint[] {
  const parsed = list(value, path, 300).map((item, i) => point(item, `${path}[${i}]`));
  if (parsed.length < minimum) throw Error(`${path}: cần ít nhất ${minimum} điểm`);
  return parsed;
}
function line(value: unknown, path: string): RoadLine {
  const item = record(value, path, ['id', 'class', 'role', 'points']);
  return { id: string(item.id, `${path}.id`), class: choice(item.class, `${path}.class`, LINE_CLASSES),
    role: choice(item.role, `${path}.role`, ROLES), points: points(item.points, `${path}.points`, 2) };
}
function area(value: unknown, path: string): RoadArea {
  const item = record(value, path, ['id', 'class', 'points']);
  if (item.class !== 'drivable') throw Error(`${path}.class: chỉ chấp nhận drivable`);
  return { id: string(item.id, `${path}.id`), class: 'drivable', points: points(item.points, `${path}.points`, 3) };
}
function frames(value: unknown, path: string, prediction: true): RoadPredictionFrame[];
function frames(value: unknown, path: string, prediction: false): RoadTruthFrame[];
function frames(value: unknown, path: string, prediction: boolean): RoadTruthFrame[] | RoadPredictionFrame[] {
  let previous = -1;
  return list(value, path, 20_000).map((raw, i) => {
    const p = `${path}[${i}]`, item = record(raw, p, prediction
      ? ['timeMs', 'inferenceMs', 'evidenceAgeMs', 'lines', 'areas'] : ['timeMs', 'lines', 'areas']);
    const timeMs = number(item.timeMs, `${p}.timeMs`, 0, 86_400_000);
    if (timeMs <= previous) throw Error(`${p}.timeMs: phải tăng nghiêm ngặt`);
    previous = timeMs;
    const parsedLines = list(item.lines, `${p}.lines`, 100).map((value, j) => line(value, `${p}.lines[${j}]`));
    const parsedAreas = list(item.areas, `${p}.areas`, 30).map((value, j) => area(value, `${p}.areas[${j}]`));
    const ids = [...parsedLines, ...parsedAreas].map(item => item.id);
    if (new Set(ids).size !== ids.length) throw Error(`${p}: ID line/area trùng`);
    const common = { timeMs, lines: parsedLines, areas: parsedAreas };
    return prediction ? { ...common, inferenceMs: number(item.inferenceMs, `${p}.inferenceMs`, 0, 60_000),
      evidenceAgeMs: number(item.evidenceAgeMs, `${p}.evidenceAgeMs`, 0, 60_000) } : common;
  }) as RoadTruthFrame[] | RoadPredictionFrame[];
}

/** Closed schema rejects video bytes, local paths and arbitrary personal fields. */
export function parseRoadBenchmarkCorpus(value: unknown): RoadBenchmarkCorpus {
  const root = record(value, 'corpus', ['schemaVersion', 'corpusId', 'modelId', 'clips']);
  if (root.schemaVersion !== 1) throw Error('schemaVersion phải là 1');
  const clipIds = new Set<string>(), hashes = new Map<string, CorpusSplit>();
  const clips = list(root.clips, 'clips', 500).map((raw, i): RoadClip => {
    const path = `clips[${i}]`, item = record(raw, path, ['clipId', 'split', 'width', 'height', 'sourceSha256', 'rights', 'scenarioTags', 'truthFrames', 'predictionFrames']);
    const clipId = string(item.clipId, `${path}.clipId`);
    if (clipIds.has(clipId)) throw Error(`${path}: clipId trùng`);
    clipIds.add(clipId);
    const split = choice(item.split, `${path}.split`, SPLITS);
    const sourceSha256 = string(item.sourceSha256, `${path}.sourceSha256`, 64).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sourceSha256)) throw Error(`${path}: sourceSha256 phải là SHA-256 hex`);
    const previous = hashes.get(sourceSha256);
    if (previous && previous !== split) throw Error(`${path}: cùng nguồn xuất hiện ở hai split`);
    hashes.set(sourceSha256, split);
    const rawRights = record(item.rights, `${path}.rights`, ['basis', 'reference']);
    const rights = { basis: choice(rawRights.basis, `${path}.rights.basis`, RIGHTS), reference: string(rawRights.reference, `${path}.rights.reference`, 240) };
    const scenarioTags = list(item.scenarioTags, `${path}.scenarioTags`, 30).map((tag, j) => string(tag, `${path}.scenarioTags[${j}]`, 60));
    if (new Set(scenarioTags).size !== scenarioTags.length) throw Error(`${path}: scenarioTags trùng`);
    return { clipId, split, width: number(item.width, `${path}.width`, 160, 8192, true), height: number(item.height, `${path}.height`, 120, 8192, true),
      sourceSha256, rights, scenarioTags, truthFrames: frames(item.truthFrames, `${path}.truthFrames`, false),
      predictionFrames: frames(item.predictionFrames, `${path}.predictionFrames`, true) };
  });
  if (!clips.length) throw Error('clips: cần ít nhất một clip');
  const synthetic = clips.map(clip => clip.rights.basis === 'synthetic');
  if (synthetic.some(Boolean) && !synthetic.every(Boolean)) throw Error('Không trộn synthetic và dữ liệu thực trong cùng corpus');
  return { schemaVersion: 1, corpusId: string(root.corpusId, 'corpusId'), modelId: string(root.modelId, 'modelId'), clips };
}

function pointSegmentDistance(point: RoadPoint, start: RoadPoint, end: RoadPoint, width: number, height: number): number {
  const px = point.x * width, py = point.y * height;
  const ax = start.x * width, ay = start.y * height;
  const bx = end.x * width, by = end.y * height;
  const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
}
function directedDistance(a: RoadPoint[], b: RoadPoint[], width: number, height: number): number {
  return a.reduce((sum, point) => {
    let distance = Infinity;
    for (let index = 1; index < b.length; index += 1) {
      distance = Math.min(distance, pointSegmentDistance(point, b[index - 1], b[index], width, height));
    }
    return sum + distance;
  }, 0) / a.length;
}
function lineDistance(a: RoadLine, b: RoadLine, width: number, height: number): number {
  if (a.class !== b.class || (a.class === 'lane-marking' && a.role !== b.role)) return Infinity;
  return (directedDistance(a.points, b.points, width, height) + directedDistance(b.points, a.points, width, height)) / 2;
}
function matchLines(truth: RoadLine[], prediction: RoadLine[], width: number, height: number) {
  const edges: Array<{ truth: number; prediction: number; distancePx: number }> = [];
  for (let ti = 0; ti < truth.length; ti++) for (let pi = 0; pi < prediction.length; pi++) {
    const distancePx = lineDistance(truth[ti], prediction[pi], width, height);
    if (distancePx <= LINE_GATE_PX) edges.push({ truth: ti, prediction: pi, distancePx });
  }
  edges.sort((a, b) => a.distancePx - b.distancePx || a.truth - b.truth || a.prediction - b.prediction);
  const usedTruth = new Set<number>(), usedPrediction = new Set<number>();
  return edges.filter(edge => {
    if (usedTruth.has(edge.truth) || usedPrediction.has(edge.prediction)) return false;
    usedTruth.add(edge.truth); usedPrediction.add(edge.prediction); return true;
  });
}
function inside(point: RoadPoint, polygon: RoadPoint[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
function areaIou(truth: RoadArea[], prediction: RoadArea[]): number | null {
  if (!truth.length) return null;
  let intersection = 0, union = 0;
  for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) {
    const p = { x: (x + .5) / 64, y: (y + .5) / 36 };
    const a = truth.some(area => inside(p, area.points)), b = prediction.some(area => inside(p, area.points));
    if (a && b) intersection++;
    if (a || b) union++;
  }
  return union ? intersection / union : 1;
}
function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
function mean(values: number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function stddev(values: number[]): number | null {
  const average = mean(values); return average === null ? null : Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

interface ScoreBucket {
  truthLines: number; predictedLines: number; matchedLines: number; egoCorridorTruth: number; egoCorridorMatched: number;
  lineDistances: number[]; lateralResiduals: number[]; drivableIous: number[]; latencies: number[]; stale: number; predictionFrames: number;
  byClass: Record<RoadLineClass, { truth: number; prediction: number; matched: number }>;
}
function bucket(): ScoreBucket {
  return { truthLines: 0, predictedLines: 0, matchedLines: 0, egoCorridorTruth: 0, egoCorridorMatched: 0,
    lineDistances: [], lateralResiduals: [], drivableIous: [], latencies: [], stale: 0, predictionFrames: 0,
    byClass: Object.fromEntries(LINE_CLASSES.map(name => [name, { truth: 0, prediction: 0, matched: 0 }])) as ScoreBucket['byClass'] };
}
function scoreClip(clip: RoadClip): ScoreBucket {
  const out = bucket();
  for (const frame of clip.predictionFrames) {
    out.predictionFrames++; out.latencies.push(frame.inferenceMs); if (frame.evidenceAgeMs > STALE_GATE_MS) out.stale++;
  }
  const frameEdges: Array<[number, number, number]> = [];
  for (let ti = 0; ti < clip.truthFrames.length; ti++) for (let pi = 0; pi < clip.predictionFrames.length; pi++) {
    const delta = Math.abs(clip.truthFrames[ti].timeMs - clip.predictionFrames[pi].timeMs);
    if (delta <= TIME_TOLERANCE_MS) frameEdges.push([delta, ti, pi]);
  }
  frameEdges.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const usedTruth = new Set<number>(), usedPrediction = new Set<number>(), framePairs = new Map<number, number>();
  for (const [, ti, pi] of frameEdges) if (!usedTruth.has(ti) && !usedPrediction.has(pi)) { usedTruth.add(ti); usedPrediction.add(pi); framePairs.set(ti, pi); }
  for (const [ti, truthFrame] of clip.truthFrames.entries()) {
    const prediction = framePairs.has(ti) ? clip.predictionFrames[framePairs.get(ti)!] : null;
    out.truthLines += truthFrame.lines.length;
    for (const line of truthFrame.lines) out.byClass[line.class].truth++;
    const hasEgo = ['ego-left', 'ego-right'].every(role => truthFrame.lines.some(line => line.class === 'lane-marking' && line.role === role));
    if (hasEgo) out.egoCorridorTruth++;
    const iou = areaIou(truthFrame.areas, prediction?.areas ?? []); if (iou !== null) out.drivableIous.push(iou);
    if (!prediction) continue;
    const matches = matchLines(truthFrame.lines, prediction.lines, clip.width, clip.height);
    out.matchedLines += matches.length; out.lineDistances.push(...matches.map(match => match.distancePx));
    for (const match of matches) {
      const truth = truthFrame.lines[match.truth], predicted = prediction.lines[match.prediction];
      out.byClass[truth.class].matched++;
      if (truth.class === 'lane-marking' && ['ego-left', 'ego-right'].includes(truth.role)) {
        const truthBottom = truth.points.reduce((bottom, point) => point.y > bottom.y ? point : bottom);
        const predictedBottom = predicted.points.reduce((bottom, point) => point.y > bottom.y ? point : bottom);
        out.lateralResiduals.push((predictedBottom.x - truthBottom.x) * clip.width);
      }
    }
    if (hasEgo && ['ego-left', 'ego-right'].every(role => matches.some(match => truthFrame.lines[match.truth].role === role))) out.egoCorridorMatched++;
  }
  for (const [pi, prediction] of clip.predictionFrames.entries()) {
    out.predictedLines += prediction.lines.length;
    for (const line of prediction.lines) out.byClass[line.class].prediction++;
    if (!usedPrediction.has(pi)) continue;
  }
  return out;
}
function merge(items: ScoreBucket[]): ScoreBucket {
  const out = bucket();
  for (const item of items) {
    for (const key of ['truthLines', 'predictedLines', 'matchedLines', 'egoCorridorTruth', 'egoCorridorMatched', 'stale', 'predictionFrames'] as const) out[key] += item[key];
    out.lineDistances.push(...item.lineDistances); out.lateralResiduals.push(...item.lateralResiduals); out.drivableIous.push(...item.drivableIous); out.latencies.push(...item.latencies);
    for (const name of LINE_CLASSES) for (const key of ['truth', 'prediction', 'matched'] as const) out.byClass[name][key] += item.byClass[name][key];
  }
  return out;
}
function summarize(item: ScoreBucket) {
  const precision = item.predictedLines ? item.matchedLines / item.predictedLines : null;
  const recall = item.truthLines ? item.matchedLines / item.truthLines : null;
  return { truthLines: item.truthLines, predictedLines: item.predictedLines, matchedLines: item.matchedLines,
    precision, recall, f1: precision !== null && recall !== null && precision + recall ? 2 * precision * recall / (precision + recall) : null,
    meanLineDistancePx: mean(item.lineDistances), p95LineDistancePx: percentile(item.lineDistances, .95),
    temporalLateralJitterPx: stddev(item.lateralResiduals), drivableMeanIou: mean(item.drivableIous),
    egoCorridorRecall: item.egoCorridorTruth ? item.egoCorridorMatched / item.egoCorridorTruth : null,
    inferenceP50Ms: percentile(item.latencies, .5), inferenceP95Ms: percentile(item.latencies, .95),
    staleFrameRate: item.predictionFrames ? item.stale / item.predictionFrames : null,
    byClass: Object.fromEntries(LINE_CLASSES.map(name => { const value = item.byClass[name]; return [name, { ...value,
      precision: value.prediction ? value.matched / value.prediction : null, recall: value.truth ? value.matched / value.truth : null }]; })) };
}

export function evaluateRoadBenchmarkCorpus(corpus: RoadBenchmarkCorpus) {
  const scored = corpus.clips.map(clip => ({ clip, score: scoreClip(clip) }));
  return { schemaVersion: 1, corpusId: corpus.corpusId, modelId: corpus.modelId,
    evidence: corpus.clips.every(clip => clip.rights.basis === 'synthetic') ? 'synthetic-algorithm-test-only' : 'field-corpus-provenance-not-independently-verified',
    contract: { timestampToleranceMs: TIME_TOLERANCE_MS, lineGatePx: LINE_GATE_PX, staleGateMs: STALE_GATE_MS },
    aggregate: summarize(merge(scored.map(item => item.score))),
    bySplit: Object.fromEntries(SPLITS.map(split => [split, { clips: scored.filter(item => item.clip.split === split).length,
      metrics: summarize(merge(scored.filter(item => item.clip.split === split).map(item => item.score))) }])),
    clips: scored.map(item => ({ clipId: item.clip.clipId, split: item.clip.split, scenarioTags: item.clip.scenarioTags, metrics: summarize(item.score) })) };
}
