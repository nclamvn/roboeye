import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleSingleJourneyEvidencePlane, evaluateEvidencePlane, exportCurrentDriveCandidate, parseEvidencePlane } from '../../src/drive/evidence-plane';
import type { ReplayFrame, ReplaySample } from '../../src/drive/replay';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/drive-evidence-plane-synthetic.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(fixture);

test('common plane compares detection, continuity, primary target and performance without choosing a winner', () => {
  const report = evaluateEvidencePlane(parseEvidencePlane(copy()));
  assert.equal(report.evidence, 'synthetic-contract-only');
  assert.equal(report.comparability.status, 'pass');
  assert.equal(report.comparability.framesPerCandidate, 4);
  assert.equal(report.promotion.automaticWinner, null);
  const control = report.candidates.find(candidate => candidate.candidateId === 'rtdetr-control')!;
  const challenger = report.candidates.find(candidate => candidate.candidateId === 'challenger-blocked')!;
  assert.equal(control.metrics.truthObjects, 7);
  assert.equal(control.metrics.predictions, 7);
  assert.equal(control.metrics.matched, 6);
  assert.equal(control.metrics.falseNegatives, 1);
  assert.equal(control.metrics.falsePositives, 1);
  assert.equal(control.metrics.classAccuracy, 5 / 6);
  assert.equal(control.metrics.tracking.idSwitches, 1);
  assert.equal(control.metrics.tracking.fragmentations, 1);
  assert.equal(control.metrics.tracking.continuityOpportunities, 5);
  assert.equal(control.metrics.tracking.stableTransitions, 2);
  assert.equal(control.metrics.primaryTarget.correct, 4);
  assert.equal(control.metrics.primaryTarget.trackChurn, 1);
  assert.equal(control.metrics.performance.requestToResultMs.p95, 79);
  assert.equal(control.metrics.performance.peakMemoryBytes.coverage, 0);
  assert.equal(control.metrics.performance.peakMemoryBytes.p95, null);
  assert.equal(challenger.metrics.recall, 1);
  assert.equal(challenger.metrics.tracking.continuity, 1);
  assert.equal(challenger.metrics.primaryTarget.churnRate, 0);
  assert.equal(challenger.metrics.performance.peakMemoryBytes.coverage, 1);
  assert.equal(challenger.metrics.performance.peakMemoryBytes.max, 210000000);
  assert.equal(challenger.promotionReviewEligible, false);
});

test('candidate cannot hide a miss by dropping or changing a source frame', () => {
  const missing = copy(); missing.candidates[1].runs[0].frames.splice(1, 1);
  assert.throws(() => parseEvidencePlane(missing), /thiếu frame/);
  const shifted = copy(); shifted.candidates[1].runs[0].frames[1].sourceTimeMs = 201;
  assert.throws(() => parseEvidencePlane(shifted), /frame plan không khớp/);
});

test('candidate run is bound to source hash, dimensions and complete journey set', () => {
  const hash = copy(); hash.candidates[0].runs[0].sourceSha256 = 'd'.repeat(64);
  assert.throws(() => parseEvidencePlane(hash), /source SHA\/kích thước/);
  const dimensions = copy(); dimensions.candidates[0].runs[0].width = 640;
  assert.throws(() => parseEvidencePlane(dimensions), /source SHA\/kích thước/);
  const missingRun = copy(); missingRun.candidates[0].runs = [];
  assert.throws(() => parseEvidencePlane(missingRun), /array 1/);
});

test('closed schema rejects hidden paths, duplicate candidates and unbound primary IDs', () => {
  const path = copy(); path.corpus.journeys[0].videoPath = '/private/video.mp4';
  assert.throws(() => parseEvidencePlane(path), /trường không được phép/);
  const duplicate = copy(); duplicate.candidates[1].manifest.candidateId = 'rtdetr-control';
  assert.throws(() => parseEvidencePlane(duplicate), /candidateId trùng/);
  const primary = copy(); primary.candidates[0].runs[0].frames[0].primaryTrackId = 'not-present';
  assert.throws(() => parseEvidencePlane(primary), /không có trong objects/);
  const device = copy(); device.candidates[1].manifest.runtime.environmentId = 'another-device';
  assert.throws(() => parseEvidencePlane(device), /cùng environmentId/);
});

test('commercial approval and reviewed truth are both required for promotion review eligibility', () => {
  const raw = copy();
  raw.corpus.journeys[0].rights = { basis: 'owned', reference: 'owner release R-1' };
  raw.corpus.journeys[0].annotation = { method: 'independent-reviewed', reference: 'review batch R-1' };
  raw.candidates[1].manifest.commercialGate = { status: 'approved', reference: 'licence review L-1' };
  const report = evaluateEvidencePlane(parseEvidencePlane(raw));
  assert.equal(report.evidence, 'independent-reviewed-2d');
  assert.equal(report.candidates.every(candidate => candidate.promotionReviewEligible), true);
  assert.equal(report.promotion.automaticWinner, null);
});

test('uploaded-video adapter exports exact sample index/time and honest telemetry nulls', () => {
  const samples: ReplaySample[] = [{ timeMs: 200, boxes: [], latencyMs: 30, width: 1280, height: 720, seekMs: 8, sampleWallMs: 45 }];
  const frames = [{ timeMs: 200, tracks: [{ id: 7, ageMs: 0, box: { label: 'car', score: .9, x0: .4, y0: .4, x1: .6, y1: .7 } }] }] as unknown as ReplayFrame[];
  const exported = exportCurrentDriveCandidate(samples, frames, [7], 'webgpu');
  assert.equal(exported.frames[0].sampleIndex, 0);
  assert.equal(exported.frames[0].sourceTimeMs, 200);
  assert.equal(exported.frames[0].primaryTrackId, '7');
  assert.equal(exported.frames[0].telemetry.decodeMs, 8);
  assert.equal(exported.frames[0].telemetry.requestToResultMs, 45);
  assert.equal(exported.frames[0].telemetry.captureToDisplayMs, null);
  assert.equal(exported.frames[0].telemetry.peakMemoryBytes, null);
  assert.equal(exported.manifest.commercialGate.status, 'evaluation-only');
  assert.doesNotMatch(JSON.stringify(exported), /videoBase64|videoPath|\/private\//);
});

test('single-journey assembler binds report fragments and re-runs the closed parser', () => {
  const raw = copy();
  const plan = { schemaVersion: raw.schemaVersion, benchmarkId: raw.benchmarkId, protocol: raw.protocol, corpus: raw.corpus };
  const exports = raw.candidates.map((candidate: Record<string, unknown> & {manifest: unknown; runs: Array<{frames: unknown}>}) => ({
    schemaVersion: 1 as const, protocol: { labelPolicy: raw.protocol.labelPolicy, preprocessingId: raw.protocol.preprocessingId },
    manifest: candidate.manifest, frames: candidate.runs[0].frames, limitations: []
  }));
  const assembled = assembleSingleJourneyEvidencePlane(plan, exports as never);
  assert.equal(assembled.candidates.length, 2);
  assert.equal(evaluateEvidencePlane(assembled).comparability.status, 'pass');
  const wrong = structuredClone(exports); wrong[1].protocol.preprocessingId = 'different';
  assert.throws(() => assembleSingleJourneyEvidencePlane(plan, wrong as never), /không khớp/);
});
