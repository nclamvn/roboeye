import test from 'node:test';
import assert from 'node:assert/strict';
import {runOfflinePipeline} from '../../src/drive/offline-pipeline';

const deferred=<T>()=>{let resolve!:(v:T)=>void,reject!:(e:Error)=>void;
  const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('offline pipeline overlaps next detector with prior depth; keeps snapshots and ordered output',async()=>{
  const signal=new AbortController().signal,events:string[]=[],output:number[]=[],first=deferred<number>(),started=deferred<void>();
  let decoded=-1,inflight=0,max=0;
  const work=runOfflinePipeline([0,200,400],signal,async target=>{decoded=target;events.push(`detect ${target}`);if(target===200)started.resolve();return target;},sample=>{
    assert.equal(decoded,sample,'depth snapshots this frame before next seek');
    events.push(`depth ${sample}`);inflight++;max=Math.max(max,inflight);
    return (sample===0?first.promise:Promise.resolve(sample)).finally(()=>inflight--);
  },sample=>output.push(sample));
  await started.promise;assert.deepEqual(events,['detect 0','depth 0','detect 200']);assert.deepEqual(output,[]);
  first.resolve(0);await work;assert.deepEqual(output,[0,200,400]);assert.equal(max,1);
});
test('cancel or produce failure cannot commit unfinished/stale frame or open extra depth requests',async()=>{
  const controller=new AbortController(),depth=deferred<number>(),started=deferred<void>(),output:number[]=[];
  const work=runOfflinePipeline([0,1],controller.signal,async t=>{if(t===1){started.resolve();controller.abort();}return t;},()=>depth.promise,n=>output.push(n));
  await started.promise;await assert.rejects(work,{name:'AbortError'});depth.resolve(0);await Promise.resolve();assert.deepEqual(output,[]);
  await assert.rejects(runOfflinePipeline([0,1],new AbortController().signal,async t=>{if(t)throw Error('decode');return t;},async t=>t,n=>output.push(n)),/decode/);
  assert.deepEqual(output,[]);
});
test('depth failure is observed, not swallowed or committed as a completed analysis',async()=>{
  const output:number[]=[];
  await assert.rejects(runOfflinePipeline([0,1],new AbortController().signal,async t=>t,async()=>{throw Error('depth');},n=>output.push(n)),/depth/);
  assert.deepEqual(output,[]);
});
