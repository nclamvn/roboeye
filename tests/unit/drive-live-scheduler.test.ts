import test from 'node:test';
import assert from 'node:assert/strict';
import {liveMetricIntervalMs} from '../../src/drive/live-scheduler';

test('live depth yields CPU to a dual-WASM detector on mobile',()=>{
  assert.equal(liveMetricIntervalMs([], 'wasm', 'wasm'),1200);
  assert.equal(liveMetricIntervalMs([650,700,750], 'wasm', 'wasm'),1680);
  assert.equal(liveMetricIntervalMs([2000,2100], 'wasm', 'wasm'),2500);
});

test('GPU detector keeps a bounded faster depth cadence and ignores invalid samples',()=>{
  assert.equal(liveMetricIntervalMs([300,NaN,Infinity,-1], 'webgpu', 'webgpu'),500);
  assert.equal(liveMetricIntervalMs([700,800,900], 'webgpu', 'wasm'),1440);
});
