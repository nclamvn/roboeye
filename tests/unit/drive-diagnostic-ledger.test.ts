import test from 'node:test';
import assert from 'node:assert/strict';
import {DiagnosticLedger} from '../../src/drive/diagnostic-ledger';

test('late inference cannot turn a stale attempt into an accepted measurement',()=>{
  const l=new DiagnosticLedger();l.begin('metric',1,0,100);l.stage('metric',1,'dispatch',105);
  assert.equal(l.finish('metric',1,'stale',1301),true);
  assert.equal(l.stage('metric',1,'result',1800),true);
  assert.equal(l.finish('metric',1,'accepted-observed',1800),false);
  assert.deepEqual(l.report().metric.outcomes,{stale:1});assert.equal(l.report().metric.stages.result,1);
  assert.equal(l.report().metric.balanced,true);
});
test('reset accounts every pending request once without inventing inference result timing',()=>{
  const l=new DiagnosticLedger();l.begin('detector',1,0,100);l.begin('metric',1,0,100);
  l.reset(200);l.reset(300);
  assert.equal(l.report().detector.completed,1);assert.equal(l.report().metric.completed,1);
  assert.equal(l.report().metric.stages.result,undefined);assert.equal(l.begin('metric',1,1,400),false);
});
test('availability observes 250 ms lifespan and sparse cadence, not 60 Hz paints as new measurements',()=>{
  const l=new DiagnosticLedger();l.begin('metric',1,0,0);l.finish('metric',1,'accepted-observed',950);
  l.presentation(950,true,false);l.presentation(1200,false,true);l.presentation(3450,true,false);
  const a=l.report().availability;assert.equal(a.visibleMs,250);assert.equal(a.maxBlackoutMs,2250);
  assert.equal(a.freshAcceptedMeasurements,1);assert.equal(a.eligibleCoverage,null);
});
test('bounded two-hour accounting retains cumulative totals and first failure',()=>{
  const l=new DiagnosticLedger();
  for(let i=1;i<=72000;i++){l.begin('metric',i,0,i*100);l.stage('metric',i,'dispatch',i*100+1);l.finish('metric',i,i===1?'worker-error':'accepted-observed',i*100+2);}
  const r=l.report();assert.equal(r.metric.started,72000);assert.equal(r.metric.completed,72000);
  assert.equal(r.metric.balanced,true);assert.equal(r.boundedState.retainedDetails,128);
  assert.equal(r.boundedState.discardedDetails,71872);assert.equal(r.firstFailure?.id,1);
  assert.equal(r.metric.outcomes['worker-error'],1);
});
test('pause does not invent availability over hidden/background time',()=>{
  const l=new DiagnosticLedger();l.presentation(0,false,true);l.presentation(100,false,true);
  l.pausePresentation();l.presentation(60000,true,false);l.presentation(60100,true,false);
  assert.equal(l.report().availability.observedMs,200);assert.equal(l.report().availability.visibleMs,100);
});
