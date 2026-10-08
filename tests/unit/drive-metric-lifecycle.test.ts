import test from 'node:test';
import assert from 'node:assert/strict';
import {MetricLifecycle} from '../../src/drive/metric-lifecycle';

test('depth retry is bounded to two in 60 seconds even after successful warmup',()=>{
  const l=new MetricLifecycle();l.loading(0);l.ready(20);l.running(100);
  const one=l.recover(200,'infer-error');assert.equal(one?.delayMs,1000);assert.equal(l.state,'RECOVERING');
  l.loading(1200);l.ready(1250);const two=l.recover(2000,'module-error');assert.equal(two?.delayMs,3000);
  l.loading(5000);l.ready(5010);assert.equal(l.recover(6000,'infer-error'),null);assert.equal(l.state,'DEGRADED');
  assert.equal(l.recover(62001,'infer-error')?.delayMs,1000);
});
test('stop/reset cancels an old recovery token and preserves retry budget',()=>{
  const l=new MetricLifecycle(),retry=l.recover(10,'load-error')!;
  assert.equal(l.canRestart(retry.generation),true);l.cancel(20);
  assert.equal(l.canRestart(retry.generation),false);assert.equal(l.recover(30,'module-error')?.delayMs,3000);
});
test('disabled baseline mode exposes degraded state rather than pretending recovery',()=>{
  const l=new MetricLifecycle();assert.equal(l.recover(100,'infer-timeout',false),null);
  assert.equal(l.state,'DEGRADED');assert.equal(l.report().firstFailure?.fault,'infer-timeout');
});
test('lifecycle event history is bounded without losing failure totals',()=>{
  const l=new MetricLifecycle();for(let i=0;i<1000;i++){l.loading(i*1000);l.ready(i*1000+5);l.running(i*1000+10);l.completed(i*1000+20);}
  assert.equal(l.report().events.length,32);assert.equal(l.report().droppedEvents,3968);assert.equal(l.state,'READY');
});
