import test from 'node:test';
import assert from 'node:assert/strict';
import {VehicleTracker} from '../../src/drive/tracking';
import type {DetBox} from '../../src/detection-types';
import type {RangeEstimate} from '../../src/drive/geometry';
import {LiveMetricJoin} from '../../src/drive/live-metric-join';
import {letterboxTransform} from '../../src/drive/learned-range';
import {decodeDa2DriveMetric,DA2_DRIVE} from '../../src/drive/metric-contract';
import {driveBackend} from '../../src/drive/backend';
import {assessRisk} from '../../src/drive/risk';

const box:DetBox={label:'car',score:.95,x0:.3,y0:.3,x1:.7,y1:.8};
const range:RangeEstimate={kind:'learned_optical_axis_z_m',provenance:'learned-unverified',distanceM:24,lateralM:null,sigmaM:4,interval:[16,32],intervalCalibrated:false,reason:'same-frame test depth'};

test('new unknown detector observation must not block delayed same-frame depth',()=>{
  const tracker=new VehicleTracker();
  tracker.observe([box],100,100,null,1280,720);
  const trackIds=tracker.bindLearnedFrame([box],100);
  tracker.observe([box],300,500,null,1280,720,null,true,200);
  assert.equal(tracker.enrichLearnedRanges([box],[range],100,1280,720,800,{trackIds,capturedWall:100}),1);
  assert.equal(tracker.snapshot(300,800)[0].range.distanceM,24);
  tracker.observe([box],1100,1250,null,1280,720,null,true,150);
  assert.equal(tracker.snapshot(1100,1301)[0].range.distanceM,null,'expiry starts at capture, not depth publication');
});

const capture={id:1,epoch:3,t:100,wall:100,w:1280,h:720,transform:letterboxTransform(1280,720,DA2_DRIVE.width,DA2_DRIVE.height)};
const map=()=>decodeDa2DriveMetric(new Float32Array(DA2_DRIVE.width*DA2_DRIVE.height).fill(24),DA2_DRIVE.width,DA2_DRIVE.height);

for(const order of ['depth-first','detector-first'])test(`join ${order} keeps a single same-frame capture`,()=>{
  const join=new LiveMetricJoin();assert.equal(join.begin(capture),true);assert.equal(join.begin({...capture,id:2}),false);
  if(order==='depth-first'){join.depth(1,map(),800);assert.equal(join.take(800,3,1280,720),null);join.detection(1,[box],[1]);}
  else{join.detection(1,[box],[1]);assert.equal(join.take(400,3,1280,720),null);join.depth(1,map(),800);}
  const result=join.take(950,3,1280,720);assert.equal(result?.reason,'ready');
  if(result?.reason==='ready'){assert.equal(result.value.t,100);assert.deepEqual(result.value.trackIds,[1]);}
  assert.equal(join.busy,false);assert.equal(join.take(1000,3,1280,720),null);
});

test('join rejects source, geometry, clock and age mismatches',()=>{
  for(const [now,epoch,width,reason] of [[1400,3,1280,'stale'],[50,3,1280,'stale'],[700,4,1280,'reset'],[700,3,720,'reset']] as const){
    const join=new LiveMetricJoin();join.begin(capture);join.depth(2,map(),100);join.detection(2,[box],[1]);
    assert.equal(join.take(now,epoch,width,720)?.reason,reason);assert.equal(join.busy,false);
  }
});

test('identity binding rejects moved, missing, weak, replaced and duplicate vehicle measurements',()=>{
  for(const mode of ['moved','missing','weak','wrong-id','old','too-late']){
    const tracker=new VehicleTracker();tracker.observe([box],100,100,null,1280,720);
    const trackIds=tracker.bindLearnedFrame([box],100);
    if(mode==='moved')tracker.observe([{...box,x0:.6,x1:.98}],300,500,null,1280,720,null,true);
    if(mode==='missing'){tracker.observe([],200,300,null,1280,720,null,true);tracker.observe([box],300,500,null,1280,720,null,true);}
    if(mode==='weak')tracker.observe([{...box,score:.3}],300,500,null,1280,720,null,true);
    if(mode==='old')assert.equal(tracker.enrichLearnedRanges([box],[range],100,1280,720,300,{trackIds,capturedWall:100}),1);
    const binding={trackIds:mode==='wrong-id'?[999]:trackIds,capturedWall:100};
    assert.equal(tracker.enrichLearnedRanges([box],[range],100,1280,720,mode==='too-late'?1301:800,binding),0,mode);
  }
});

test('slow detector boxes are visual-only and cannot be relabelled fresh danger evidence',()=>{
  const tracker=new VehicleTracker();tracker.observe([box],100,1500,null,1280,720,null,true,1400);
  const track=tracker.snapshot(100,1500)[0];assert.equal(track.ageMs,0);assert.equal(track.evidenceAgeMs,1400);
  const risk=assessRisk([{...track,range:{...range,distanceM:5},opticalTtcS:1,motionConfidence:1}],{speedKph:80,adverse:false});
  assert.equal(risk.primary?.confidence,0);assert.notEqual(risk.primary?.level,'critical');
});

test('worker backend probe fails safely without browser-name assumptions',async()=>{
  assert.equal(await driveBackend(false,{}),'wasm');
  assert.equal(await driveBackend(false,{gpu:{requestAdapter:async()=>null}}),'wasm');
  assert.equal(await driveBackend(false,{gpu:{requestAdapter:async()=>{throw Error('adapter blocked');}}}),'wasm');
  assert.equal(await driveBackend(false,{gpu:{requestAdapter:async()=>({})}}),'webgpu');
  assert.equal(await driveBackend(true,{gpu:{requestAdapter:async()=>{throw Error('must not call');}}}),'wasm');
});
