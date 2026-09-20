import { assign } from './tracking';
import type { RangeEstimate } from './geometry';

export type DistanceKind = RangeEstimate['kind'];
export type CorpusSplit = 'train' | 'validation' | 'test';
export interface ValidationBox { x0: number; y0: number; x1: number; y1: number }
export interface TruthObject { objectId: string; label: string; bbox: ValidationBox; distanceM: number | null; distanceKind: DistanceKind | null }
export interface PredictionObject { trackId: string; label: string; bbox: ValidationBox; distanceM: number | null; distanceKind: DistanceKind | null }
export interface TruthFrame { timeMs: number; objects: TruthObject[] }
export interface PredictionFrame { timeMs: number; requestToResultMs: number | null; objects: PredictionObject[] }
export interface ValidationJourney {
  journeyId: string; split: CorpusSplit; deviceId: string; cameraId: string;
  width: number; height: number; sourceSha256: string;
  truthMethod: 'measured-static' | 'calibrated-lidar' | 'calibrated-radar' | 'rtk-pair' | 'synthetic';
  rights: { basis: 'owned' | 'licensed' | 'consented' | 'synthetic'; reference: string };
  scenarioTags: string[]; truthFrames: TruthFrame[]; predictionFrames: PredictionFrame[];
}
export interface ValidationCorpus { schemaVersion: 1; corpusId: string; journeys: ValidationJourney[] }

const KINDS: DistanceKind[] = ['ground_contact_forward_m', 'learned_optical_axis_z_m'];
const SPLITS: CorpusSplit[] = ['train', 'validation', 'test'];
const METHODS: ValidationJourney['truthMethod'][] = ['measured-static', 'calibrated-lidar', 'calibrated-radar', 'rtk-pair', 'synthetic'];
const RIGHTS: ValidationJourney['rights']['basis'][] = ['owned', 'licensed', 'consented', 'synthetic'];
const IOU_GATE = 0.5;
const TIME_TOLERANCE_MS = 80;

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
function string(value: unknown, path: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${path}: chuỗi không hợp lệ`);
  return value;
}
function number(value: unknown, path: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw Error(`${path}: số ngoài giới hạn`);
  }
  return value;
}
function choice<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw Error(`${path}: giá trị không hợp lệ`);
  return value as T;
}
function box(value: unknown, path: string): ValidationBox {
  const b = record(value, path, ['x0', 'y0', 'x1', 'y1']);
  const out = { x0: number(b.x0, `${path}.x0`, 0, 1), y0: number(b.y0, `${path}.y0`, 0, 1),
    x1: number(b.x1, `${path}.x1`, 0, 1), y1: number(b.y1, `${path}.y1`, 0, 1) };
  if (out.x1 <= out.x0 || out.y1 <= out.y0) throw Error(`${path}: hộp không có diện tích`);
  return out;
}
function distance(item: Record<string, unknown>, path: string): { distanceM: number | null; distanceKind: DistanceKind | null } {
  const distanceM = item.distanceM === null ? null : number(item.distanceM, `${path}.distanceM`, 0.1, 500);
  const distanceKind = item.distanceKind === null ? null : choice(item.distanceKind, `${path}.distanceKind`, KINDS);
  if ((distanceM === null) !== (distanceKind === null)) throw Error(`${path}: distanceM và distanceKind phải cùng có hoặc cùng null`);
  return { distanceM, distanceKind };
}
function frames(value: unknown, path: string, truth: true): TruthFrame[];
function frames(value: unknown, path: string, truth: false): PredictionFrame[];
function frames(value: unknown, path: string, truth: boolean): TruthFrame[] | PredictionFrame[] {
  const parsed: Array<TruthFrame | PredictionFrame> = [];
  let previous = -1;
  for (const [i, raw] of list(value, path, 20000).entries()) {
    const p = `${path}[${i}]`;
    const frame = record(raw, p, truth ? ['timeMs', 'objects'] : ['timeMs', 'requestToResultMs', 'objects']);
    const timeMs = number(frame.timeMs, `${p}.timeMs`, 0, 86_400_000);
    if (timeMs <= previous) throw Error(`${p}: timeMs phải tăng nghiêm ngặt`);
    previous = timeMs;
    const seen = new Set<string>();
    const objects = list(frame.objects, `${p}.objects`, 100).map((rawObject, j) => {
      const op = `${p}.objects[${j}]`;
      const item = record(rawObject, op, truth
        ? ['objectId', 'label', 'bbox', 'distanceM', 'distanceKind']
        : ['trackId', 'label', 'bbox', 'distanceM', 'distanceKind']);
      const id = string(item[truth ? 'objectId' : 'trackId'], `${op}.${truth ? 'objectId' : 'trackId'}`);
      if (seen.has(id)) throw Error(`${op}: ID trùng trong frame`);
      seen.add(id);
      const common = { label: string(item.label, `${op}.label`), bbox: box(item.bbox, `${op}.bbox`), ...distance(item, op) };
      return truth ? { objectId: id, ...common } : { trackId: id, ...common };
    });
    if (truth) parsed.push({ timeMs, objects: objects as TruthObject[] });
    else parsed.push({ timeMs, requestToResultMs: frame.requestToResultMs === null ? null
      : number(frame.requestToResultMs, `${p}.requestToResultMs`, 0, 60_000), objects: objects as PredictionObject[] });
  }
  return parsed as TruthFrame[] | PredictionFrame[];
}

/** Rejects unknown fields so video bytes, paths and personal data cannot silently enter the contract. */
export function parseValidationCorpus(value: unknown): ValidationCorpus {
  const root = record(value, 'corpus', ['schemaVersion', 'corpusId', 'journeys']);
  if (root.schemaVersion !== 1) throw Error('schemaVersion phải là 1');
  const corpusId = string(root.corpusId, 'corpusId');
  const journeyIds = new Set<string>();
  const hashes = new Map<string, CorpusSplit>();
  const journeys = list(root.journeys, 'journeys', 500).map((raw, i): ValidationJourney => {
    const path = `journeys[${i}]`;
    const item = record(raw, path, ['journeyId', 'split', 'deviceId', 'cameraId', 'width', 'height', 'sourceSha256', 'truthMethod', 'rights', 'scenarioTags', 'truthFrames', 'predictionFrames']);
    const journeyId = string(item.journeyId, `${path}.journeyId`);
    if (journeyIds.has(journeyId)) throw Error(`${path}: journeyId trùng`);
    journeyIds.add(journeyId);
    const split = choice(item.split, `${path}.split`, SPLITS);
    const sourceSha256 = string(item.sourceSha256, `${path}.sourceSha256`, 64).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sourceSha256)) throw Error(`${path}: sourceSha256 phải là SHA-256 hex`);
    const previousSplit = hashes.get(sourceSha256);
    if (previousSplit && previousSplit !== split) throw Error(`${path}: cùng nguồn xuất hiện ở hai split`);
    hashes.set(sourceSha256, split);
    const truthMethod = choice(item.truthMethod, `${path}.truthMethod`, METHODS);
    const rawRights = record(item.rights, `${path}.rights`, ['basis', 'reference']);
    const rights = { basis: choice(rawRights.basis, `${path}.rights.basis`, RIGHTS), reference: string(rawRights.reference, `${path}.rights.reference`, 240) };
    if ((truthMethod === 'synthetic') !== (rights.basis === 'synthetic')) throw Error(`${path}: truthMethod/rights synthetic không khớp`);
    const scenarioTags = list(item.scenarioTags, `${path}.scenarioTags`, 30).map((tag, j) => string(tag, `${path}.scenarioTags[${j}]`, 60));
    if (new Set(scenarioTags).size !== scenarioTags.length) throw Error(`${path}: scenarioTags trùng`);
    return { journeyId, split, deviceId: string(item.deviceId, `${path}.deviceId`), cameraId: string(item.cameraId, `${path}.cameraId`),
      width: number(item.width, `${path}.width`, 160, 8192, true), height: number(item.height, `${path}.height`, 120, 8192, true),
      sourceSha256, truthMethod, rights, scenarioTags,
      truthFrames: frames(item.truthFrames, `${path}.truthFrames`, true),
      predictionFrames: frames(item.predictionFrames, `${path}.predictionFrames`, false) };
  });
  if (!journeys.length) throw Error('journeys: cần ít nhất một hành trình');
  if (journeys.some(j => j.truthMethod === 'synthetic') && journeys.some(j => j.truthMethod !== 'synthetic')) {
    throw Error('Không trộn dữ liệu synthetic và thực trong cùng một corpus');
  }
  return { schemaVersion: 1, corpusId, journeys };
}

function iou(a: ValidationBox, b: ValidationBox): number {
  const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
    * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const aa = (a.x1 - a.x0) * (a.y1 - a.y0), bb = (b.x1 - b.x0) * (b.y1 - b.y0);
  return overlap / (aa + bb - overlap);
}
function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1];
}
function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function binName(distanceM: number): string {
  return distanceM < 5 ? 'lt5m' : distanceM < 30 ? '5to30m' : distanceM < 70 ? '30to70m' : 'gte70m';
}
interface Bucket { truthObjects: number; predictions: number; matched: number; falseNegatives: number; falsePositives: number;
  rangeTruth: number; rangeMatched: number; rangeAbstentions: number; distanceKindMismatches: number; idSwitches: number;
  errors: number[]; latencies: number[]; bins: Record<string, { truth: number; errors: number[] }> }
function emptyBucket(): Bucket {
  return { truthObjects: 0, predictions: 0, matched: 0, falseNegatives: 0, falsePositives: 0, rangeTruth: 0,
    rangeMatched: 0, rangeAbstentions: 0, distanceKindMismatches: 0, idSwitches: 0, errors: [], latencies: [],
    bins: Object.fromEntries(['lt5m', '5to30m', '30to70m', 'gte70m'].map(key => [key, { truth: 0, errors: [] }])) };
}
function scoreJourney(journey: ValidationJourney): Bucket {
  const out = emptyBucket();
  const truth = journey.truthFrames, prediction = journey.predictionFrames;
  const edges: Array<[number, number, number]> = [];
  let lowerPrediction = 0;
  for (let ti = 0; ti < truth.length; ti++) {
    while (lowerPrediction < prediction.length && prediction[lowerPrediction].timeMs < truth[ti].timeMs - TIME_TOLERANCE_MS) lowerPrediction++;
    for (let pi = lowerPrediction; pi < prediction.length; pi++) {
      const delta = Math.abs(truth[ti].timeMs - prediction[pi].timeMs);
      if (delta <= TIME_TOLERANCE_MS) edges.push([delta, ti, pi]);
      if (prediction[pi].timeMs > truth[ti].timeMs + TIME_TOLERANCE_MS) break;
    }
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const usedTruth = new Set<number>(), usedPrediction = new Set<number>();
  const pairs: Array<[number, number]> = [];
  for (const [, ti, pi] of edges) if (!usedTruth.has(ti) && !usedPrediction.has(pi)) {
    usedTruth.add(ti); usedPrediction.add(pi); pairs.push([ti, pi]);
  }
  const pairByTruth = new Map(pairs);
  const priorTrack = new Map<string, string>();
  for (const [ti, frame] of truth.entries()) {
    const pred = pairByTruth.has(ti) ? prediction[pairByTruth.get(ti)!] : null;
    out.truthObjects += frame.objects.length;
    for (const obj of frame.objects) if (obj.distanceM !== null) {
      out.rangeTruth++;
      out.bins[binName(obj.distanceM)].truth++;
    }
    if (!pred) { out.falseNegatives += frame.objects.length; continue; }
    const cost = frame.objects.map(t => pred.objects.map(p => {
      const overlap = iou(t.bbox, p.bbox);
      return overlap >= IOU_GATE ? 1 - overlap : 1e6;
    }));
    const matches = assign(cost, 1 - IOU_GATE + 1e-9);
    out.matched += matches.length;
    out.falseNegatives += frame.objects.length - matches.length;
    out.falsePositives += pred.objects.length - matches.length;
    for (const [t, p] of matches) {
      const gt = frame.objects[t], model = pred.objects[p];
      const prior = priorTrack.get(gt.objectId);
      if (prior && prior !== model.trackId) out.idSwitches++;
      priorTrack.set(gt.objectId, model.trackId);
      if (gt.distanceM === null) continue;
      if (model.distanceM === null) { out.rangeAbstentions++; continue; }
      if (model.distanceKind !== gt.distanceKind) { out.distanceKindMismatches++; continue; }
      const error = model.distanceM - gt.distanceM;
      out.rangeMatched++;
      out.errors.push(error);
      out.bins[binName(gt.distanceM)].errors.push(error);
    }
  }
  out.predictions = prediction.reduce((sum, frame) => sum + frame.objects.length, 0);
  out.falsePositives += prediction.reduce((sum, frame, i) => sum + (usedPrediction.has(i) ? 0 : frame.objects.length), 0);
  out.latencies = prediction.flatMap(frame => frame.requestToResultMs === null ? [] : [frame.requestToResultMs]);
  return out;
}
function merge(buckets: Bucket[]): Bucket {
  const out = emptyBucket();
  for (const b of buckets) {
    for (const key of ['truthObjects', 'predictions', 'matched', 'falseNegatives', 'falsePositives', 'rangeTruth', 'rangeMatched', 'rangeAbstentions', 'distanceKindMismatches', 'idSwitches'] as const) out[key] += b[key];
    out.errors.push(...b.errors); out.latencies.push(...b.latencies);
    for (const key of Object.keys(out.bins)) { out.bins[key].truth += b.bins[key].truth; out.bins[key].errors.push(...b.bins[key].errors); }
  }
  return out;
}
function summarize(b: Bucket) {
  return { truthObjects: b.truthObjects, predictions: b.predictions, matched: b.matched,
    falseNegatives: b.falseNegatives, falsePositives: b.falsePositives,
    precision: b.predictions ? b.matched / b.predictions : null,
    recall: b.truthObjects ? b.matched / b.truthObjects : null,
    rangeTruth: b.rangeTruth, rangeMatched: b.rangeMatched,
    rangeCoverage: b.rangeTruth ? b.rangeMatched / b.rangeTruth : null,
    rangeAbstentions: b.rangeAbstentions, distanceKindMismatches: b.distanceKindMismatches,
    maeM: mean(b.errors.map(Math.abs)), biasM: mean(b.errors), p95AbsoluteErrorM: percentile(b.errors.map(Math.abs), .95),
    idSwitches: b.idSwitches, requestToResultP95Ms: percentile(b.latencies, .95),
    rangeBins: Object.fromEntries(Object.entries(b.bins).map(([name, bin]) => [name, {
      truth: bin.truth, measured: bin.errors.length, coverage: bin.truth ? bin.errors.length / bin.truth : null,
      maeM: mean(bin.errors.map(Math.abs)), biasM: mean(bin.errors), p95AbsoluteErrorM: percentile(bin.errors.map(Math.abs), .95)
    }])) };
}

export function evaluateValidationCorpus(corpus: ValidationCorpus) {
  const scored = corpus.journeys.map(j => ({ journey: j, bucket: scoreJourney(j) }));
  return { schemaVersion: 1, corpusId: corpus.corpusId,
    evidence: corpus.journeys.every(j => j.truthMethod === 'synthetic') ? 'synthetic-algorithm-test-only' : 'field-corpus-provenance-not-independently-verified',
    matching: { timestampToleranceMs: TIME_TOLERANCE_MS, minimumIou: IOU_GATE },
    aggregate: summarize(merge(scored.map(item => item.bucket))),
    bySplit: Object.fromEntries(SPLITS.map(split => [split, {
      journeys: scored.filter(item => item.journey.split === split).length,
      metrics: summarize(merge(scored.filter(item => item.journey.split === split).map(item => item.bucket))) }])),
    journeys: scored.map(({ journey, bucket }) => ({ journeyId: journey.journeyId, split: journey.split,
      deviceId: journey.deviceId, cameraId: journey.cameraId, truthMethod: journey.truthMethod,
      scenarioTags: journey.scenarioTags, metrics: summarize(bucket) })) };
}
