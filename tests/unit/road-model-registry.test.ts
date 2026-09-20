import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRoadModelRegistry, ROAD_EVIDENCE_REFS, ROAD_MODEL_CANDIDATES } from '../../src/drive/road-model-registry';

test('road model registry is internally valid but fail-closes every unverified commercial candidate', () => {
  const audit = auditRoadModelRegistry();
  assert.equal(audit.valid, true);
  assert.equal(audit.gates.length, 5);
  assert.ok(audit.gates.every(gate => !gate.commercialEligible));
  assert.deepEqual(audit.gates.filter(gate => gate.benchmarkReady).map(gate => gate.id), ['openvino-road-segmentation-adas-0001-fp16']);
  assert.match(audit.gates.find(gate => gate.id === 'yolopv2-bdd100k')!.blockers.join(' '), /commercial-license-required/);
  assert.match(audit.gates.find(gate => gate.id === 'openvino-road-segmentation-adas-0001-fp16')!.blockers.join(' '), /Mighty AI.*unknown/);
});

test('registry rejects duplicate IDs and rights claims without provenance', () => {
  const duplicate = [...ROAD_MODEL_CANDIDATES, ROAD_MODEL_CANDIDATES[0]];
  assert.equal(auditRoadModelRegistry(duplicate).valid, false);
  const broken = structuredClone(ROAD_MODEL_CANDIDATES);
  broken[0].codeRights.evidenceRefId = 'missing';
  assert.equal(auditRoadModelRegistry(broken).valid, false);
  assert.equal(auditRoadModelRegistry(ROAD_MODEL_CANDIDATES, [...ROAD_EVIDENCE_REFS, ROAD_EVIDENCE_REFS[0]]).valid, false);
});
