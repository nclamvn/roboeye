import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const path = new URL('../../docs/evidence/TIP-49L-B-REAL-CLIP-PROFILE-2026-09-20.json', import.meta.url);

test('real-clip profiling evidence is complete, hash-bound and privacy-bounded', () => {
  const raw = readFileSync(path, 'utf8');
  const evidence = JSON.parse(raw) as {
    schemaVersion: number;
    scope: string;
    sources: Array<{clipId:string;sha256:string;bytes:number;durationS:number;rights:string}>;
    runs: Array<{clipId:string;preset:string;elapsedMs:number;sampledFrames:number;depthFailed:number;droppedResults:number}>;
    caveats: string[];
  };
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.sources.length, 2);
  assert.equal(evidence.runs.length, 6);
  assert.equal(new Set(evidence.sources.map(source => source.clipId)).size, 2);
  for (const source of evidence.sources) {
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.bytes > 0 && source.durationS > 0);
    assert.match(source.rights, /not redistributed/i);
  }
  const keys = evidence.runs.map(run => `${run.clipId}:${run.preset}`);
  assert.equal(new Set(keys).size, 6);
  assert.deepEqual(new Set(evidence.runs.map(run => run.preset)), new Set(['quality', 'balanced', 'fast']));
  for (const run of evidence.runs) {
    assert.ok(run.elapsedMs > 0 && run.sampledFrames > 0);
    assert.equal(run.depthFailed, 0);
    assert.equal(run.droppedResults, 0);
  }
  assert.ok(evidence.caveats.some(caveat => /accuracy/i.test(caveat)));
  assert.doesNotMatch(raw, /\/Users\/|\/private\/|\/tmp\/|videoBytes|data:/);
});
