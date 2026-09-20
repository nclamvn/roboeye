import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateLiveEvidence} from '../../src/drive/live-evidence';

function report(durationMs=65_000, accepted=650, dropped=0) {
  return {sourceKind:'camera',synthetic:false,runtime:{sourceDimensions:{width:1280,height:720}},rangeModel:{name:'DA2'},
    liveMetric:{attempts:20,accepted:19,droppedOrUnmatched:1},liveTiming:{schema:'drivesense-live-timing-v1',
      session:{durationMs},counts:{started:accepted+dropped,accepted,dropped,dropReasons:{}},stages:{frameToOverlay:{p95Ms:92}}}};
}

test('one-minute camera evidence passes runtime smoke but not soak', () => {
  const verdict=evaluateLiveEvidence(report());
  assert.equal(verdict.status,'smoke-pass');
  assert.equal(verdict.runtimeSmoke.pass,true);assert.equal(verdict.runtimeSoak.pass,false);
  assert.equal(verdict.metricPath.status,'pass');
  assert.match(verdict.claimBoundary,/does not validate distance accuracy/i);
});

test('thirty-minute camera evidence can pass soak', () => {
  const verdict=evaluateLiveEvidence(report(1_800_000,18_000));
  assert.equal(verdict.status,'soak-pass');assert.equal(verdict.runtimeSoak.pass,true);
});

test('metric path remains explicitly unobserved when no vehicle triggered depth', () => {
  const input=report();input.liveMetric={attempts:0,accepted:0,droppedOrUnmatched:0};
  assert.equal(evaluateLiveEvidence(input).metricPath.status,'not-observed');
});

test('latency, stale drops and non-camera reports fail closed', () => {
  const slow=report(65_000,100,2);slow.liveTiming.stages.frameToOverlay.p95Ms=151;
  assert.equal(evaluateLiveEvidence(slow).status,'smoke-pending');
  const file=report();file.sourceKind='file';
  assert.equal(evaluateLiveEvidence(file).status,'not-camera');
  assert.equal(evaluateLiveEvidence({sourceKind:'camera'}).status,'invalid');
});

test('explicit worker or geometry drops fail even when the aggregate rate is low', () => {
  const input=report(65_000,10_000);input.liveTiming.counts.dropReasons={'worker-error':1};
  assert.equal(evaluateLiveEvidence(input).runtimeSmoke.pass,false);
  input.liveTiming.counts.dropReasons={'worker-error':0,'geometry-change':0};
  assert.equal(evaluateLiveEvidence(input).runtimeSmoke.pass,true);
});
