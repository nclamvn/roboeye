import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roadInput, roadLabels, roadSampleVisible, type RoadSample } from '../../src/drive/road-runtime';
import { vectorizeRoadMaskV2 } from '../../src/drive/road-vectorizer';

test('road UI preprocessing preserves canonical planar BGR 0..255', () => {
  assert.deepEqual([...roadInput(new Uint8ClampedArray([10,20,30,255,40,50,60,0]),2)], [30,60,20,50,10,40]);
  assert.throws(() => roadInput(new Uint8ClampedArray(4),2));
});
test('road UI argmax is class-first and rejects invalid outputs', () => {
  assert.deepEqual([...roadLabels(new Float32Array([1,0,0,1,0,0,0,2]),2)], [0,3]);
  assert.throws(() => roadLabels(new Float32Array(2),2));
  assert.throws(() => roadLabels(new Float32Array([1,2,NaN,0]),1));
});
const sample: RoadSample = { timeMs:1000,generation:7,latencyMs:100,vector:vectorizeRoadMaskV2(new Uint8Array(896*512),896,512) };
test('road UI media freshness rejects future, stale, old-generation and missing samples', () => {
  assert.equal(roadSampleVisible(sample,1000,7),true);
  assert.equal(roadSampleVisible(sample,1400,7),true);
  assert.equal(roadSampleVisible(sample,1401,7),false);
  assert.equal(roadSampleVisible(sample,900,7),false);
  assert.equal(roadSampleVisible(sample,1000,8),false);
  assert.equal(roadSampleVisible(sample,NaN,7),false);
  assert.equal(roadSampleVisible(null,1000,7),false);
});
test('road UI blank mask does not fabricate lanes or drivable geometry', () => {
  assert.deepEqual(sample.vector.lines,[]);
  assert.deepEqual(sample.vector.areas,[]);
});
