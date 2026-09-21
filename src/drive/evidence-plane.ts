import type { DetBox } from '../detection-types';
import { DRIVE_GPU_DETECTOR } from './detector-contract';
import { DRIVE_DECODER } from './detector-decode';
import type { ReplayFrame, ReplaySample } from './replay';
import { assign } from './tracking';
import { DRIVE_CANDIDATE_POLICY } from './vehicle-candidates';

export type EvidenceSplit = 'train' | 'validation' | 'test';
export type CommercialGateStatus = 'approved' | 'evaluation-only' | 'blocked';
export type EvidenceLabel = 'car' | 'bus' | 'truck' | 'motorcycle';

export interface EvidenceBox { x0: number; y0: number; x1: number; y1: number }
export interface EvidenceTruthObject {
  objectId: string; label: EvidenceLabel; bbox: EvidenceBox; primaryTarget: boolean;
}
export interface EvidenceTruthFrame {
  sampleIndex: number; sourceTimeMs: number; objects: EvidenceTruthObject[];
}
export interface EvidenceJourney {
  journeyId: string; split: EvidenceSplit; width: number; height: number; sourceSha256: string;
  rights: { basis: 'owned' | 'licensed' | 'consented' | 'synthetic'; reference: string };
  annotation: { method: 'independent-reviewed' | 'synthetic'; reference: string };
  scenarioTags: string[]; truthFrames: EvidenceTruthFrame[];
}
export interface EvidenceCandidateManifest {
  candidateId: string; role: 'control' | 'challenger';
  detector: { family: string; revision: string; artifactSha256: string };
  tracker: { family: string; revision: string; configId: string };
  runtime: { backend: string; environmentId: string };
  commercialGate: { status: CommercialGateStatus; reference: string };
}
export interface EvidencePredictionObject {
  trackId: string; label: EvidenceLabel; score: number; bbox: EvidenceBox;
}
export interface EvidenceFrameTelemetry {
  decodeMs: number | null; preprocessMs: number | null; inferenceMs: number | null;
  postprocessMs: number | null; trackingMs: number | null; requestToResultMs: number;
  captureToDisplayMs: number | null; evidenceAgeMs: number | null; peakMemoryBytes: number | null;
}
export interface EvidencePredictionFrame {
  sampleIndex: number; sourceTimeMs: number; primaryTrackId: string | null;
  telemetry: EvidenceFrameTelemetry; objects: EvidencePredictionObject[];
}
export interface EvidenceCandidateRun {
  journeyId: string; sourceSha256: string; width: number; height: number;
  frames: EvidencePredictionFrame[];
}
export interface EvidenceCandidate { manifest: EvidenceCandidateManifest; runs: EvidenceCandidateRun[] }
export interface EvidencePlaneEnvelope {
  schemaVersion: 1; benchmarkId: string;
  protocol: { minimumIou: number; labelPolicy: 'vehicle-family'; samplePlanId: string; preprocessingId: string };
  corpus: { corpusId: string; journeys: EvidenceJourney[] };
  candidates: EvidenceCandidate[];
}

export interface DriveCandidateExport {
  schemaVersion: 1;
  protocol: { labelPolicy: 'vehicle-family'; preprocessingId: string };
  manifest: EvidenceCandidateManifest;
  frames: EvidencePredictionFrame[];
  limitations: string[];
}

export type SingleJourneyEvidencePlan = Omit<EvidencePlaneEnvelope, 'candidates'>;

const LABELS: readonly EvidenceLabel[] = ['car', 'bus', 'truck', 'motorcycle'];
const SPLITS: readonly EvidenceSplit[] = ['train', 'validation', 'test'];
const GATES: readonly CommercialGateStatus[] = ['approved', 'evaluation-only', 'blocked'];
const HASH = /^[0-9a-f]{64}$/;

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error(`${path}: cần object`);
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!keys.includes(key)) throw Error(`${path}.${key}: trường không được phép`);
  return item;
}
function list(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw Error(`${path}: cần array ${min}–${max} phần tử`);
  return value;
}
function text(value: unknown, path: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${path}: chuỗi không hợp lệ`);
  return value;
}
function identifier(value: unknown, path: string): string {
  const out = text(value, path, 120);
  if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(out)) throw Error(`${path}: ID không hợp lệ`);
  return out;
}
function number(value: unknown, path: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw Error(`${path}: số ngoài giới hạn`);
  }
  return value;
}
function nullableNumber(value: unknown, path: string, min: number, max: number, integer = false): number | null {
  return value === null ? null : number(value, path, min, max, integer);
}
function choice<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw Error(`${path}: giá trị không hợp lệ`);
  return value as T;
}
function sha(value: unknown, path: string): string {
  const out = text(value, path, 64).toLowerCase();
  if (!HASH.test(out)) throw Error(`${path}: cần SHA-256 hex`);
  return out;
}
function box(value: unknown, path: string): EvidenceBox {
  const item = record(value, path, ['x0', 'y0', 'x1', 'y1']);
  const out = { x0: number(item.x0, `${path}.x0`, 0, 1), y0: number(item.y0, `${path}.y0`, 0, 1),
    x1: number(item.x1, `${path}.x1`, 0, 1), y1: number(item.y1, `${path}.y1`, 0, 1) };
  if (out.x1 <= out.x0 || out.y1 <= out.y0) throw Error(`${path}: hộp không có diện tích`);
  return out;
}
function parseTruthFrames(value: unknown, path: string): EvidenceTruthFrame[] {
  let priorIndex = -1, priorTime = -1;
  return list(value, path, 1, 20_000).map((raw, i) => {
    const p = `${path}[${i}]`, item = record(raw, p, ['sampleIndex', 'sourceTimeMs', 'objects']);
    const sampleIndex = number(item.sampleIndex, `${p}.sampleIndex`, 0, 10_000_000, true);
    const sourceTimeMs = number(item.sourceTimeMs, `${p}.sourceTimeMs`, 0, 86_400_000);
    if (sampleIndex <= priorIndex || sourceTimeMs <= priorTime) throw Error(`${p}: frame index/time phải tăng nghiêm ngặt`);
    priorIndex = sampleIndex; priorTime = sourceTimeMs;
    const seen = new Set<string>(); let primary = 0;
    const objects = list(item.objects, `${p}.objects`, 0, 100).map((rawObject, j): EvidenceTruthObject => {
      const op = `${p}.objects[${j}]`, object = record(rawObject, op, ['objectId', 'label', 'bbox', 'primaryTarget']);
      const objectId = identifier(object.objectId, `${op}.objectId`);
      if (seen.has(objectId)) throw Error(`${op}: objectId trùng trong frame`); seen.add(objectId);
      if (typeof object.primaryTarget !== 'boolean') throw Error(`${op}.primaryTarget: cần boolean`);
      if (object.primaryTarget) primary++;
      return { objectId, label: choice(object.label, `${op}.label`, LABELS), bbox: box(object.bbox, `${op}.bbox`), primaryTarget: object.primaryTarget };
    });
    if (primary > 1) throw Error(`${p}: tối đa một primaryTarget`);
    return { sampleIndex, sourceTimeMs, objects };
  });
}
function parseTelemetry(value: unknown, path: string): EvidenceFrameTelemetry {
  const item = record(value, path, ['decodeMs', 'preprocessMs', 'inferenceMs', 'postprocessMs', 'trackingMs', 'requestToResultMs', 'captureToDisplayMs', 'evidenceAgeMs', 'peakMemoryBytes']);
  const duration = (key: keyof EvidenceFrameTelemetry) => nullableNumber(item[key], `${path}.${key}`, 0, 600_000);
  return { decodeMs: duration('decodeMs'), preprocessMs: duration('preprocessMs'), inferenceMs: duration('inferenceMs'),
    postprocessMs: duration('postprocessMs'), trackingMs: duration('trackingMs'),
    requestToResultMs: number(item.requestToResultMs, `${path}.requestToResultMs`, 0, 600_000),
    captureToDisplayMs: duration('captureToDisplayMs'), evidenceAgeMs: duration('evidenceAgeMs'),
    peakMemoryBytes: nullableNumber(item.peakMemoryBytes, `${path}.peakMemoryBytes`, 0, 2_000_000_000_000, true) };
}
function parsePredictionFrames(value: unknown, path: string): EvidencePredictionFrame[] {
  let priorIndex = -1, priorTime = -1;
  return list(value, path, 1, 20_000).map((raw, i) => {
    const p = `${path}[${i}]`, item = record(raw, p, ['sampleIndex', 'sourceTimeMs', 'primaryTrackId', 'telemetry', 'objects']);
    const sampleIndex = number(item.sampleIndex, `${p}.sampleIndex`, 0, 10_000_000, true);
    const sourceTimeMs = number(item.sourceTimeMs, `${p}.sourceTimeMs`, 0, 86_400_000);
    if (sampleIndex <= priorIndex || sourceTimeMs <= priorTime) throw Error(`${p}: frame index/time phải tăng nghiêm ngặt`);
    priorIndex = sampleIndex; priorTime = sourceTimeMs;
    const seen = new Set<string>();
    const objects = list(item.objects, `${p}.objects`, 0, 100).map((rawObject, j): EvidencePredictionObject => {
      const op = `${p}.objects[${j}]`, object = record(rawObject, op, ['trackId', 'label', 'score', 'bbox']);
      const trackId = identifier(object.trackId, `${op}.trackId`);
      if (seen.has(trackId)) throw Error(`${op}: trackId trùng trong frame`); seen.add(trackId);
      return { trackId, label: choice(object.label, `${op}.label`, LABELS), score: number(object.score, `${op}.score`, 0, 1), bbox: box(object.bbox, `${op}.bbox`) };
    });
    const primaryTrackId = item.primaryTrackId === null ? null : identifier(item.primaryTrackId, `${p}.primaryTrackId`);
    if (primaryTrackId !== null && !seen.has(primaryTrackId)) throw Error(`${p}.primaryTrackId: không có trong objects`);
    return { sampleIndex, sourceTimeMs, primaryTrackId, telemetry: parseTelemetry(item.telemetry, `${p}.telemetry`), objects };
  });
}
function parseManifest(value: unknown, path: string): EvidenceCandidateManifest {
  const item = record(value, path, ['candidateId', 'role', 'detector', 'tracker', 'runtime', 'commercialGate']);
  const detector = record(item.detector, `${path}.detector`, ['family', 'revision', 'artifactSha256']);
  const tracker = record(item.tracker, `${path}.tracker`, ['family', 'revision', 'configId']);
  const runtime = record(item.runtime, `${path}.runtime`, ['backend', 'environmentId']);
  const gate = record(item.commercialGate, `${path}.commercialGate`, ['status', 'reference']);
  return { candidateId: identifier(item.candidateId, `${path}.candidateId`), role: choice(item.role, `${path}.role`, ['control', 'challenger'] as const),
    detector: { family: text(detector.family, `${path}.detector.family`), revision: text(detector.revision, `${path}.detector.revision`), artifactSha256: sha(detector.artifactSha256, `${path}.detector.artifactSha256`) },
    tracker: { family: text(tracker.family, `${path}.tracker.family`), revision: text(tracker.revision, `${path}.tracker.revision`), configId: identifier(tracker.configId, `${path}.tracker.configId`) },
    runtime: { backend: identifier(runtime.backend, `${path}.runtime.backend`), environmentId: identifier(runtime.environmentId, `${path}.runtime.environmentId`) },
    commercialGate: { status: choice(gate.status, `${path}.commercialGate.status`, GATES), reference: text(gate.reference, `${path}.commercialGate.reference`, 240) } };
}

/** Closed, fail-loud parser. Candidate rows must cover the exact reviewed plan;
 * misses are represented by an empty objects array, never by omitting a frame. */
export function parseEvidencePlane(value: unknown): EvidencePlaneEnvelope {
  const root = record(value, 'evidencePlane', ['schemaVersion', 'benchmarkId', 'protocol', 'corpus', 'candidates']);
  if (root.schemaVersion !== 1) throw Error('schemaVersion phải là 1');
  const protocolRaw = record(root.protocol, 'protocol', ['minimumIou', 'labelPolicy', 'samplePlanId', 'preprocessingId']);
  if (protocolRaw.labelPolicy !== 'vehicle-family') throw Error('protocol.labelPolicy phải là vehicle-family');
  const protocol = { minimumIou: number(protocolRaw.minimumIou, 'protocol.minimumIou', .1, .9), labelPolicy: 'vehicle-family' as const,
    samplePlanId: identifier(protocolRaw.samplePlanId, 'protocol.samplePlanId'), preprocessingId: identifier(protocolRaw.preprocessingId, 'protocol.preprocessingId') };
  const corpusRaw = record(root.corpus, 'corpus', ['corpusId', 'journeys']);
  const journeyIds = new Set<string>(), hashes = new Map<string, EvidenceSplit>();
  const journeys = list(corpusRaw.journeys, 'corpus.journeys', 1, 500).map((raw, i): EvidenceJourney => {
    const path = `corpus.journeys[${i}]`, item = record(raw, path, ['journeyId', 'split', 'width', 'height', 'sourceSha256', 'rights', 'annotation', 'scenarioTags', 'truthFrames']);
    const journeyId = identifier(item.journeyId, `${path}.journeyId`); if (journeyIds.has(journeyId)) throw Error(`${path}: journeyId trùng`); journeyIds.add(journeyId);
    const split = choice(item.split, `${path}.split`, SPLITS), sourceSha256 = sha(item.sourceSha256, `${path}.sourceSha256`);
    const priorSplit = hashes.get(sourceSha256); if (priorSplit && priorSplit !== split) throw Error(`${path}: cùng nguồn xuất hiện ở hai split`); hashes.set(sourceSha256, split);
    const rightsRaw = record(item.rights, `${path}.rights`, ['basis', 'reference']);
    const annotationRaw = record(item.annotation, `${path}.annotation`, ['method', 'reference']);
    const rights = { basis: choice(rightsRaw.basis, `${path}.rights.basis`, ['owned', 'licensed', 'consented', 'synthetic'] as const), reference: text(rightsRaw.reference, `${path}.rights.reference`, 240) };
    const annotation = { method: choice(annotationRaw.method, `${path}.annotation.method`, ['independent-reviewed', 'synthetic'] as const), reference: text(annotationRaw.reference, `${path}.annotation.reference`, 240) };
    if ((rights.basis === 'synthetic') !== (annotation.method === 'synthetic')) throw Error(`${path}: rights/annotation synthetic không khớp`);
    const scenarioTags = list(item.scenarioTags, `${path}.scenarioTags`, 0, 30).map((tag, j) => identifier(tag, `${path}.scenarioTags[${j}]`));
    if (new Set(scenarioTags).size !== scenarioTags.length) throw Error(`${path}.scenarioTags: giá trị trùng`);
    return { journeyId, split, width: number(item.width, `${path}.width`, 160, 8192, true), height: number(item.height, `${path}.height`, 120, 8192, true), sourceSha256, rights, annotation, scenarioTags, truthFrames: parseTruthFrames(item.truthFrames, `${path}.truthFrames`) };
  });
  if (journeys.some(j => j.annotation.method === 'synthetic') && journeys.some(j => j.annotation.method !== 'synthetic')) throw Error('Không trộn synthetic và reviewed trong một evidence plane');
  const candidates = list(root.candidates, 'candidates', 2, 20).map((raw, i): EvidenceCandidate => {
    const path = `candidates[${i}]`, item = record(raw, path, ['manifest', 'runs']), manifest = parseManifest(item.manifest, `${path}.manifest`);
    const runIds = new Set<string>();
    const runs = list(item.runs, `${path}.runs`, 1, 500).map((rawRun, j): EvidenceCandidateRun => {
      const rp = `${path}.runs[${j}]`, run = record(rawRun, rp, ['journeyId', 'sourceSha256', 'width', 'height', 'frames']);
      const journeyId = identifier(run.journeyId, `${rp}.journeyId`); if (runIds.has(journeyId)) throw Error(`${rp}: journeyId trùng`); runIds.add(journeyId);
      return { journeyId, sourceSha256: sha(run.sourceSha256, `${rp}.sourceSha256`), width: number(run.width, `${rp}.width`, 160, 8192, true), height: number(run.height, `${rp}.height`, 120, 8192, true), frames: parsePredictionFrames(run.frames, `${rp}.frames`) };
    });
    return { manifest, runs };
  });
  if (candidates.filter(c => c.manifest.role === 'control').length !== 1) throw Error('Cần đúng một candidate role=control');
  if (new Set(candidates.map(c => c.manifest.candidateId)).size !== candidates.length) throw Error('candidateId trùng');
  const environmentId = candidates[0].manifest.runtime.environmentId;
  if (candidates.some(candidate => candidate.manifest.runtime.environmentId !== environmentId)) throw Error('Mọi candidate phải chạy trên cùng environmentId');
  for (const candidate of candidates) {
    if (candidate.runs.length !== journeys.length) throw Error(`${candidate.manifest.candidateId}: phải có đúng một run cho mỗi journey`);
    const runById = new Map(candidate.runs.map(run => [run.journeyId, run]));
    for (const journey of journeys) {
      const run = runById.get(journey.journeyId); if (!run) throw Error(`${candidate.manifest.candidateId}: thiếu journey ${journey.journeyId}`);
      if (run.sourceSha256 !== journey.sourceSha256 || run.width !== journey.width || run.height !== journey.height) throw Error(`${candidate.manifest.candidateId}/${journey.journeyId}: source SHA/kích thước không khớp`);
      if (run.frames.length !== journey.truthFrames.length) throw Error(`${candidate.manifest.candidateId}/${journey.journeyId}: thiếu frame; phải ghi frame rỗng thay vì bỏ`);
      for (let i = 0; i < journey.truthFrames.length; i++) if (run.frames[i].sampleIndex !== journey.truthFrames[i].sampleIndex || run.frames[i].sourceTimeMs !== journey.truthFrames[i].sourceTimeMs) {
        throw Error(`${candidate.manifest.candidateId}/${journey.journeyId}: frame plan không khớp tại ${i}`);
      }
    }
  }
  return { schemaVersion: 1, benchmarkId: identifier(root.benchmarkId, 'benchmarkId'), protocol, corpus: { corpusId: identifier(corpusRaw.corpusId, 'corpus.corpusId'), journeys }, candidates };
}

function iou(a: EvidenceBox, b: EvidenceBox): number {
  const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const aa = (a.x1 - a.x0) * (a.y1 - a.y0), bb = (b.x1 - b.x0) * (b.y1 - b.y0);
  return overlap / (aa + bb - overlap);
}
function percentile(values: number[], p: number): number | null {
  if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
function distribution(values: Array<number | null>, denominator: number) {
  const measured = values.filter((value): value is number => value !== null);
  return { samples: measured.length, unavailable: denominator - measured.length, coverage: denominator ? measured.length / denominator : null,
    p50: percentile(measured, .5), p95: percentile(measured, .95), max: measured.length ? Math.max(...measured) : null };
}
interface JourneyScore {
  truthObjects: number; predictions: number; matched: number; classMatches: number; falseNegatives: number; falsePositives: number;
  continuityOpportunities: number; stableTrackTransitions: number; idSwitches: number; fragmentations: number;
  primaryTruthFrames: number; primaryCorrect: number; primaryMisses: number; primaryFalseSelections: number; primaryTransitions: number; primaryTrackChurn: number;
  telemetry: EvidenceFrameTelemetry[];
}
function emptyScore(): JourneyScore {
  return { truthObjects: 0, predictions: 0, matched: 0, classMatches: 0, falseNegatives: 0, falsePositives: 0,
    continuityOpportunities: 0, stableTrackTransitions: 0, idSwitches: 0, fragmentations: 0,
    primaryTruthFrames: 0, primaryCorrect: 0, primaryMisses: 0, primaryFalseSelections: 0, primaryTransitions: 0, primaryTrackChurn: 0, telemetry: [] };
}
function scoreJourney(journey: EvidenceJourney, run: EvidenceCandidateRun, minimumIou: number): JourneyScore {
  const score = emptyScore();
  const states = new Map<string, { lastFrame: number; lastTrack: string | null; everMatched: boolean }>();
  let priorPrimaryObjectId: string | null = null, priorPrimaryTrackId: string | null = null;
  for (let frameIndex = 0; frameIndex < journey.truthFrames.length; frameIndex++) {
    const truth = journey.truthFrames[frameIndex], prediction = run.frames[frameIndex]; score.telemetry.push(prediction.telemetry);
    score.truthObjects += truth.objects.length; score.predictions += prediction.objects.length;
    const costs = truth.objects.map(target => prediction.objects.map(candidate => {
      const overlap = iou(target.bbox, candidate.bbox); return overlap >= minimumIou ? 1 - overlap : 1e6;
    }));
    const matches = assign(costs, 1 - minimumIou + 1e-9), byTruth = new Map(matches), byPrediction = new Map(matches.map(([t, p]) => [p, t]));
    score.matched += matches.length; score.falseNegatives += truth.objects.length - matches.length; score.falsePositives += prediction.objects.length - matches.length;
    for (const [truthIndex, predictionIndex] of matches) if (truth.objects[truthIndex].label === prediction.objects[predictionIndex].label) score.classMatches++;
    for (let truthIndex = 0; truthIndex < truth.objects.length; truthIndex++) {
      const target = truth.objects[truthIndex], predictionIndex = byTruth.get(truthIndex), trackId = predictionIndex === undefined ? null : prediction.objects[predictionIndex].trackId;
      const prior = states.get(target.objectId);
      if (prior && prior.lastFrame === frameIndex - 1) {
        score.continuityOpportunities++;
        if (prior.lastTrack !== null && trackId !== null && prior.lastTrack === trackId) score.stableTrackTransitions++;
      }
      if (prior && prior.lastTrack !== null && trackId !== null && prior.lastTrack !== trackId) score.idSwitches++;
      if (prior?.everMatched && prior.lastTrack === null && trackId !== null) score.fragmentations++;
      states.set(target.objectId, { lastFrame: frameIndex, lastTrack: trackId, everMatched: Boolean(prior?.everMatched || trackId !== null) });
    }
    const primary = truth.objects.find(object => object.primaryTarget) ?? null;
    const selectedIndex = prediction.primaryTrackId === null ? undefined : prediction.objects.findIndex(object => object.trackId === prediction.primaryTrackId);
    const selectedTruthIndex = selectedIndex === undefined || selectedIndex < 0 ? undefined : byPrediction.get(selectedIndex);
    if (primary) {
      score.primaryTruthFrames++;
      const primaryIndex = truth.objects.indexOf(primary), expectedPredictionIndex = byTruth.get(primaryIndex);
      const correct = expectedPredictionIndex !== undefined && prediction.objects[expectedPredictionIndex].trackId === prediction.primaryTrackId;
      if (correct) score.primaryCorrect++; else score.primaryMisses++;
      if (prediction.primaryTrackId !== null && selectedTruthIndex !== primaryIndex) score.primaryFalseSelections++;
      if (priorPrimaryObjectId === primary.objectId) {
        score.primaryTransitions++;
        if (priorPrimaryTrackId !== null && prediction.primaryTrackId !== null && priorPrimaryTrackId !== prediction.primaryTrackId) score.primaryTrackChurn++;
      }
      priorPrimaryObjectId = primary.objectId; priorPrimaryTrackId = prediction.primaryTrackId;
    } else {
      if (prediction.primaryTrackId !== null) score.primaryFalseSelections++;
      priorPrimaryObjectId = null; priorPrimaryTrackId = null;
    }
  }
  return score;
}
function merge(scores: JourneyScore[]): JourneyScore {
  const out = emptyScore();
  for (const score of scores) {
    for (const key of ['truthObjects', 'predictions', 'matched', 'classMatches', 'falseNegatives', 'falsePositives', 'continuityOpportunities', 'stableTrackTransitions', 'idSwitches', 'fragmentations', 'primaryTruthFrames', 'primaryCorrect', 'primaryMisses', 'primaryFalseSelections', 'primaryTransitions', 'primaryTrackChurn'] as const) out[key] += score[key];
    out.telemetry.push(...score.telemetry);
  }
  return out;
}
function summarize(score: JourneyScore) {
  const totalFrames = score.telemetry.length, field = (key: keyof EvidenceFrameTelemetry) => distribution(score.telemetry.map(item => item[key]), totalFrames);
  return { truthObjects: score.truthObjects, predictions: score.predictions, matched: score.matched,
    falseNegatives: score.falseNegatives, falsePositives: score.falsePositives,
    precision: score.predictions ? score.matched / score.predictions : null, recall: score.truthObjects ? score.matched / score.truthObjects : null,
    classAccuracy: score.matched ? score.classMatches / score.matched : null,
    tracking: { continuityOpportunities: score.continuityOpportunities, stableTransitions: score.stableTrackTransitions,
      continuity: score.continuityOpportunities ? score.stableTrackTransitions / score.continuityOpportunities : null,
      idSwitches: score.idSwitches, fragmentations: score.fragmentations },
    primaryTarget: { truthFrames: score.primaryTruthFrames, correct: score.primaryCorrect, misses: score.primaryMisses,
      falseSelections: score.primaryFalseSelections, accuracy: score.primaryTruthFrames ? score.primaryCorrect / score.primaryTruthFrames : null,
      transitions: score.primaryTransitions, trackChurn: score.primaryTrackChurn,
      churnRate: score.primaryTransitions ? score.primaryTrackChurn / score.primaryTransitions : null },
    performance: { frames: totalFrames, decodeMs: field('decodeMs'), preprocessMs: field('preprocessMs'), inferenceMs: field('inferenceMs'),
      postprocessMs: field('postprocessMs'), trackingMs: field('trackingMs'), requestToResultMs: field('requestToResultMs'),
      captureToDisplayMs: field('captureToDisplayMs'), evidenceAgeMs: field('evidenceAgeMs'), peakMemoryBytes: field('peakMemoryBytes') } };
}

export function evaluateEvidencePlane(plane: EvidencePlaneEnvelope) {
  const evidence = plane.corpus.journeys.every(journey => journey.annotation.method === 'synthetic') ? 'synthetic-contract-only' : 'independent-reviewed-2d';
  return { schemaVersion: 1, benchmarkId: plane.benchmarkId, corpusId: plane.corpus.corpusId, evidence,
    comparability: { status: 'pass', candidates: plane.candidates.length, journeys: plane.corpus.journeys.length,
      framesPerCandidate: plane.corpus.journeys.reduce((sum, journey) => sum + journey.truthFrames.length, 0), protocol: plane.protocol },
    promotion: { automaticWinner: null, policy: 'No automatic promotion. Human review requires reviewed target-domain evidence, commercial approval and explicit thresholds.' },
    candidates: plane.candidates.map(candidate => {
      const runById = new Map(candidate.runs.map(run => [run.journeyId, run]));
      const scores = plane.corpus.journeys.map(journey => ({ journey, score: scoreJourney(journey, runById.get(journey.journeyId)!, plane.protocol.minimumIou) }));
      return { candidateId: candidate.manifest.candidateId, role: candidate.manifest.role, manifest: candidate.manifest,
        promotionReviewEligible: evidence === 'independent-reviewed-2d' && candidate.manifest.commercialGate.status === 'approved',
        metrics: summarize(merge(scores.map(item => item.score))),
        byJourney: scores.map(({ journey, score }) => ({ journeyId: journey.journeyId, split: journey.split, scenarioTags: journey.scenarioTags, metrics: summarize(score) })) };
    }) };
}

/** Binds candidate fragments exported by uploaded-video runs to one reviewed
 * journey. The final closed parser remains the authority for all fields. */
export function assembleSingleJourneyEvidencePlane(plan: SingleJourneyEvidencePlan, exports: readonly DriveCandidateExport[]): EvidencePlaneEnvelope {
  const journey = plan.corpus?.journeys?.[0];
  if (plan.corpus?.journeys?.length !== 1 || !journey) throw Error('Assembler local hiện yêu cầu đúng một reviewed journey.');
  if (exports.length < 2) throw Error('Cần ít nhất control và một challenger export.');
  for (const [index, candidate] of exports.entries()) {
    if (candidate.schemaVersion !== 1 || candidate.protocol?.labelPolicy !== plan.protocol.labelPolicy || candidate.protocol?.preprocessingId !== plan.protocol.preprocessingId) {
      throw Error(`Candidate export ${index}: protocol/preprocessing không khớp plan`);
    }
  }
  return parseEvidencePlane({ ...plan, candidates: exports.map(candidate => ({ manifest: candidate.manifest,
    runs: [{ journeyId: journey.journeyId, sourceSha256: journey.sourceSha256, width: journey.width, height: journey.height, frames: candidate.frames }] })) });
}

function evidenceObject(track: ReplayFrame['tracks'][number]): EvidencePredictionObject | null {
  if (!LABELS.includes(track.box.label as EvidenceLabel)) return null;
  return { trackId: String(track.id), label: track.box.label as EvidenceLabel, score: track.box.score,
    bbox: { x0: track.box.x0, y0: track.box.y0, x1: track.box.x1, y1: track.box.y1 } };
}

/** Adapter-shaped export from the existing uploaded-video path. Source SHA,
 * journey ID and reviewed truth are deliberately absent and must be bound by a
 * local assembler before this can enter parseEvidencePlane(). */
export function exportCurrentDriveCandidate(samples: readonly ReplaySample[], frames: readonly ReplayFrame[], primaryTrackIds: readonly (number | null)[], backend: string): DriveCandidateExport {
  if (samples.length !== frames.length || samples.length !== primaryTrackIds.length || !samples.length) throw Error('Candidate export cần samples/frames/primary cùng độ dài và không rỗng.');
  return { schemaVersion: 1, protocol: { labelPolicy: 'vehicle-family', preprocessingId: `stretch-${DRIVE_GPU_DETECTOR.width}x${DRIVE_GPU_DETECTOR.height}-rgb01` },
    manifest: { candidateId: 'drivesense-rtdetrv2-control', role: 'control',
      detector: { family: 'RT-DETRv2 R18', revision: DRIVE_GPU_DETECTOR.revision, artifactSha256: DRIVE_GPU_DETECTOR.sha256 },
      tracker: { family: 'DriveSense VehicleTracker', revision: 'hungarian-kalman-bytetrack-inspired-v1', configId: `${DRIVE_DECODER}:${DRIVE_CANDIDATE_POLICY}` },
      runtime: { backend: identifier(backend || 'unknown', 'backend'), environmentId: 'browser-local' },
      commercialGate: { status: 'evaluation-only', reference: 'TIP-56A licence evidence; explicit commercial release review pending' } },
    frames: samples.map((sample, index) => {
      const frame = frames[index]; if (sample.timeMs !== frame.timeMs) throw Error(`Candidate export lệch timeline tại frame ${index}`);
      const objects = frame.tracks.flatMap(track => { const object = evidenceObject(track); return object ? [object] : []; });
      const primaryTrackId = primaryTrackIds[index] === null ? null : String(primaryTrackIds[index]);
      if (primaryTrackId !== null && !objects.some(object => object.trackId === primaryTrackId)) throw Error(`Candidate export primaryTrackId không có tại frame ${index}`);
      return { sampleIndex: index, sourceTimeMs: sample.timeMs, primaryTrackId,
        telemetry: { decodeMs: sample.seekMs ?? null, preprocessMs: null, inferenceMs: sample.latencyMs,
          postprocessMs: null, trackingMs: null, requestToResultMs: sample.sampleWallMs ?? sample.latencyMs,
          captureToDisplayMs: null, evidenceAgeMs: null, peakMemoryBytes: null }, objects };
    }),
    limitations: ['Candidate fragment contains no source SHA or reviewed truth.', 'Offline uploaded-video mode has no capture-to-display, evidence-age or portable memory measurement.', 'Evaluation-only is not a model promotion decision.'] };
}

/** Useful for challenger adapters that already emit DetBox arrays. */
export function predictionObjects(boxes: readonly DetBox[], trackIds: readonly string[]): EvidencePredictionObject[] {
  if (boxes.length !== trackIds.length) throw Error('boxes/trackIds không cùng độ dài');
  return boxes.flatMap((candidate, index) => LABELS.includes(candidate.label as EvidenceLabel) ? [{ trackId: identifier(trackIds[index], `trackIds[${index}]`), label: candidate.label as EvidenceLabel,
    score: number(candidate.score, `boxes[${index}].score`, 0, 1), bbox: box({ x0: candidate.x0, y0: candidate.y0, x1: candidate.x1, y1: candidate.y1 }, `boxes[${index}]`) }] : []);
}
