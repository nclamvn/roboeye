import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  assessRoadArtifact,
  parseRoadArtifactManifest,
  parseRoadRuntimeProof,
  type RoadArtifactManifest,
  type RoadRuntimeProof,
} from '../../src/drive/road-artifact-contract';
import type { RoadEvidenceRef, RoadModelCandidate } from '../../src/drive/road-model-registry';

const revision = 'a'.repeat(40);
const sourceHash = 'b'.repeat(64);
const exportHash = 'c'.repeat(64);

function rawManifest(): unknown {
  return {
    schemaVersion: 1,
    artifactId: 'synthetic-lane-v1',
    candidateId: 'synthetic-lane',
    purpose: 'commercial-product',
    source: { repository: 'https://example.test/lane', revision, url: 'https://example.test/weights.bin', sha256: sourceHash },
    export: { file: 'lane-v1.onnx', sha256: exportHash, bytes: 4096, opset: 17, tool: 'torch.onnx', toolVersion: '2.8.0' },
    tensors: {
      inputs: [{ name: 'images', dtype: 'float32', shape: [1, 3, 320, 640] }],
      outputs: [{ name: 'lanes', dtype: 'float32', shape: [1, 4, 72] }],
    },
    runtime: { preferredProvider: 'webgpu', fallbackProviders: ['wasm'], maxInputPixels: 2073600, maxArtifactBytes: 10485760, requiresOperatorAudit: true },
    tasks: ['lane-marking'], evidenceRefIds: ['synthetic-rights'],
  };
}

const evidence: RoadEvidenceRef[] = [{ id: 'synthetic-rights', url: 'https://example.test/license', capturedAt: '2026-09-17', tier: 'A', claim: 'Synthetic commercial grant for contract testing only.' }];
const candidate: RoadModelCandidate = {
  id: 'synthetic-lane', name: 'Synthetic lane', repository: 'https://example.test/lane', tasks: ['lane-marking'],
  codeRights: { state: 'verified-commercial', label: 'synthetic', evidenceRefId: 'synthetic-rights' },
  weightsRights: { state: 'verified-commercial', label: 'synthetic', evidenceRefId: 'synthetic-rights' },
  trainingDatasets: [{ name: 'synthetic', state: 'verified-commercial', label: 'synthetic', evidenceRefId: 'synthetic-rights' }],
  pinnedRevision: revision, weightsSha256: sourceHash, webReadiness: 'documented-onnx-export', evidenceRefIds: ['synthetic-rights'], sourceReportedProfile: 'Synthetic fixture; no field claim.',
};

function runtimeProof(): RoadRuntimeProof {
  return parseRoadRuntimeProof({
    schemaVersion: 1,
    artifactSha256: exportHash,
    operatorInventorySha256: 'd'.repeat(64),
    testedAt: '2026-09-17T05:00:00.000Z',
    environment: { os: 'macOS', arch: 'arm64', hardware: 'M1 Max 32GB', browser: 'Chrome 140', ortVersion: '1.22.0' },
    results: [
      { provider: 'webgpu', status: 'passed', coldStartMs: 120, inferenceP50Ms: 8, inferenceP95Ms: 11, peakMemoryMb: 128, error: null },
      { provider: 'wasm', status: 'passed', coldStartMs: 180, inferenceP50Ms: 24, inferenceP95Ms: 31, peakMemoryMb: 96, error: null },
    ],
  });
}

test('road artifact contract accepts a fully pinned, static, commercially cleared manifest', () => {
  const manifest = parseRoadArtifactManifest(rawManifest());
  const assessment = assessRoadArtifact(manifest, [candidate], evidence, runtimeProof());
  assert.equal(assessment.manifestValid, true);
  assert.equal(assessment.researchEligible, true);
  assert.equal(assessment.commercialEligible, true);
  assert.equal(assessment.allowedForDeclaredPurpose, true);
  assert.deepEqual(assessment.blockers, []);
  assert.deepEqual(assessment.commercialBlockers, []);
});

test('road artifact contract rejects unknown fields, paths and dynamic tensor shapes', () => {
  const unknown = rawManifest() as Record<string, unknown>;
  unknown.surprise = true;
  assert.throws(() => parseRoadArtifactManifest(unknown), /không thuộc schema/);
  const path = rawManifest() as { export: Record<string, unknown> };
  path.export.file = '../lane.onnx';
  assert.throws(() => parseRoadArtifactManifest(path), /basename \.onnx an toàn/);
  const dynamic = rawManifest() as { tensors: { inputs: Array<{ shape: number[] }> } };
  dynamic.tensors.inputs[0].shape[2] = -1;
  assert.throws(() => parseRoadArtifactManifest(dynamic), /số nguyên dương/);
});

test('self-declared manifest cannot bypass registry pinning or commercial rights', () => {
  const manifest = parseRoadArtifactManifest(rawManifest());
  const unpinned = structuredClone(candidate);
  unpinned.pinnedRevision = null;
  unpinned.weightsRights = { state: 'unknown', label: 'not verified', evidenceRefId: null };
  const assessment = assessRoadArtifact(manifest, [unpinned], evidence, runtimeProof());
  assert.equal(assessment.researchEligible, false);
  assert.equal(assessment.commercialEligible, false);
  assert.match(assessment.blockers.join(' '), /revision không khớp|quyền weights chưa rõ/);
});

test('artifact purpose controls the promotion gate', () => {
  const manifest = parseRoadArtifactManifest(rawManifest());
  const researchOnly = structuredClone(candidate);
  researchOnly.trainingDatasets[0].state = 'research-only';
  const researchManifest: RoadArtifactManifest = { ...manifest, purpose: 'research-benchmark' };
  const assessment = assessRoadArtifact(researchManifest, [researchOnly], evidence, runtimeProof());
  assert.equal(assessment.researchEligible, true);
  assert.equal(assessment.commercialEligible, false);
  assert.equal(assessment.allowedForDeclaredPurpose, true);
});

test('runtime proof is independently hash-bound and covers every declared provider', () => {
  const manifest = parseRoadArtifactManifest(rawManifest());
  const missing = assessRoadArtifact(manifest, [candidate], evidence);
  assert.equal(missing.allowedForDeclaredPurpose, false);
  assert.match(missing.blockers.join(' '), /thiếu runtime proof/);
  const wrongHash = runtimeProof();
  wrongHash.artifactSha256 = 'e'.repeat(64);
  assert.match(assessRoadArtifact(manifest, [candidate], evidence, wrongHash).blockers.join(' '), /không thuộc artifact/);
  const missingFallback = runtimeProof();
  missingFallback.results = missingFallback.results.filter(result => result.provider !== 'wasm');
  assert.match(assessRoadArtifact(manifest, [candidate], evidence, missingFallback).blockers.join(' '), /thiếu provider wasm/);
});

test('runtime proof rejects fabricated passed rows and invalid latency order', () => {
  const missingTiming = runtimeProof() as RoadRuntimeProof;
  missingTiming.results[0].inferenceP50Ms = null;
  assert.throws(() => parseRoadRuntimeProof(structuredClone(missingTiming)), /passed phải có timing/);
  const reversed = runtimeProof() as RoadRuntimeProof;
  reversed.results[0].inferenceP50Ms = 12;
  reversed.results[0].inferenceP95Ms = 10;
  assert.throws(() => parseRoadRuntimeProof(structuredClone(reversed)), /p95 không được nhỏ hơn p50/);
});

test('tracked OpenVINO research evidence remains internally hash-bound and commercially blocked', async () => {
  const root = new URL('../../docs/research/road-structure/artifacts/', import.meta.url);
  const manifest = parseRoadArtifactManifest(JSON.parse(await readFile(new URL('openvino-road-segmentation-adas-0001.manifest.json', root), 'utf8')) as unknown);
  const proof = parseRoadRuntimeProof(JSON.parse(await readFile(new URL('openvino-road-segmentation-adas-0001.runtime-proof.json', root), 'utf8')) as unknown);
  const inventory = await readFile(new URL('openvino-road-segmentation-adas-0001.operators.json', root));
  assert.equal(createHash('sha256').update(inventory).digest('hex'), proof.operatorInventorySha256);
  assert.equal(JSON.parse(inventory.toString('utf8')).artifactSha256, manifest.export.sha256);
  const assessment = assessRoadArtifact(manifest, undefined, undefined, proof);
  assert.equal(assessment.researchEligible, true);
  assert.equal(assessment.allowedForDeclaredPurpose, true);
  assert.equal(assessment.commercialEligible, false);
  assert.match(assessment.commercialBlockers.join(' '), /Mighty AI.*unknown/);
});
