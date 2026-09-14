import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReplay,replayAt,type ReplaySample} from '../../src/drive/replay';
import {assessRisk} from '../../src/drive/risk';
import {hudDistance,hudWarning,redThreat} from '../../src/drive/hud';
import type {RangeEstimate} from '../../src/drive/geometry';

// Pipeline fixtures, not detector/depth accuracy or sensor-latency evidence.
function sample(timeMs:number,distanceM=18,size=.18):ReplaySample {
  const range:RangeEstimate={kind:'learned_optical_axis_z_m',provenance:'learned-unverified',
    distanceM,lateralM:null,sigmaM:1,interval:[distanceM-2,distanceM+2],
    intervalCalibrated:false,reason:'pipeline fixture'};
  return {timeMs,width:1280,height:720,latencyMs:900,metricLatencyMs:50,
    boxes:[{label:'car',score:.97,x0:.5-size/2,x1:.5+size/2,y0:.75-size,y1:.75}],
    learnedRanges:[range]};
}
const config={speedKph:80,adverse:false};
const timeline=()=>Array.from({length:12},(_,index)=>sample(index*200));
function viewAt(frames:ReturnType<typeof buildReplay>,timeMs:number){
  const view=replayAt(frames,timeMs),risk=assessRisk(view.tracks,config,'analysed-replay');
  return {view,risk,warning:hudWarning(risk.primary,true)};
}

test('real replay pipeline holds one red warning across 120 rendered frames, without resetting measured age',()=>{
  const raw=timeline(),copy=structuredClone(raw),frames=buildReplay(raw,null),cache=structuredClone(frames);
  const warnings:string[]=[],ids=new Set<number>();
  for(let frame=0;frame<120;frame++){
    const t=frame*1000/60,result=viewAt(frames,t),track=result.view.tracks[0];
    assert.ok(track,`rendered frame ${frame}`);
    assert.equal(redThreat(result.risk.primary),true,`red gate at ${t}`);
    assert.equal(result.warning,'Quá gần');
    assert.ok(Math.abs(track.ageMs-(t-result.view.sampleTimeMs!))<1e-6);
    assert.equal(track.range.distanceM,18);
    ids.add(track.id);warnings.push(result.warning!);
  }
  assert.equal(ids.size,1);
  assert.equal(warnings.slice(1).filter((value,index)=>value!==warnings[index]).length,0);
  assert.deepEqual(raw,copy);assert.deepEqual(frames,cache);
});

test('a recorded missing vehicle breaks interpolation and cannot leave a red warning behind',()=>{
  const raw=timeline();raw[5].boxes=[];raw[5].learnedRanges=[];
  const frames=buildReplay(raw,null);
  for(const t of [816,900,999,1000,1100,1199]){
    const result=viewAt(frames,t);
    assert.equal(result.view.tracks.length,0,`lost interval ${t}`);
    assert.equal(result.warning,null);
  }
  assert.equal(viewAt(frames,1200).warning,'Quá gần');
});

test('loss of depth clears metres and range-derived TTC during interpolation',()=>{
  const raw=Array.from({length:8},(_,i)=>sample(i*200,30-i*.9));
  raw[6].learnedRanges=[null];
  const frames=buildReplay(raw,null),prior=frames[5].tracks[0];
  assert.ok(prior.rangeTtcS!==null,'fixture must establish a range motion signal');
  for(const t of [1016,1100,1199,1200]){
    const result=viewAt(frames,t),track=result.view.tracks[0];
    assert.equal(track.range.distanceM,null);
    assert.equal(track.rangeTtcS,null);
    assert.equal(track.closingSpeed,null);
    assert.equal(hudDistance(track.range),'Chưa đo');
    assert.notEqual(result.warning,'Quá gần');
  }
});

test('a known weak endpoint cannot lend its interpolated box old strong motion evidence',()=>{
  const raw=Array.from({length:9},(_,i)=>sample(i*200,18,.12*Math.exp(i*200/1200)));
  raw[8].boxes[0].score=.4;
  const frames=buildReplay(raw,null);
  assert.ok(frames[7].tracks[0].opticalTtcS!==null,'fixture must establish optical approach');
  for(const t of [1416,1500,1599,1600]){
    const result=viewAt(frames,t),track=result.view.tracks[0];
    assert.ok(track,'weak association may preserve identity, not a red warning');
    assert.equal(track.opticalTtcS,null);
    assert.equal(track.motionConfidence,0);
    assert.equal(redThreat(result.risk.primary),false);
    assert.equal(result.warning,null);
  }
});

test('depth loss does not erase independently supported optical approach or invent metres',()=>{
  const raw=Array.from({length:9},(_,i)=>sample(i*200,18,.12*Math.exp(i*200/1200)));
  raw[8].learnedRanges=[null];
  const frames=buildReplay(raw,null);
  for(const t of [1416,1500,1599,1600]){
    const result=viewAt(frames,t),track=result.view.tracks[0];
    assert.ok(track.opticalTtcS!==null,'strong optical signal exists at both endpoints');
    assert.equal(track.range.distanceM,null);
    assert.equal(track.rangeTtcS,null);
    assert.equal(result.risk.primary?.ttcAgreement,'single');
    assert.equal(hudDistance(track.range),'Chưa đo');
    assert.equal(result.warning,'Nguy cơ cao');
  }
});

test('end-of-replay hold reports its actual measurement age and expires after 80 ms',()=>{
  const frames=buildReplay(timeline(),null),last=frames.at(-1)!.timeMs;
  for(const ageMs of [1,25,50,80]){
    const result=viewAt(frames,last+ageMs);
    assert.equal(result.view.tracks[0].ageMs,ageMs);
  }
  assert.equal(viewAt(frames,last+81).warning,null);
});

test('fractional playback timestamps retain actual age and never precede the first observation',()=>{
  const frames=buildReplay(timeline(),null),last=frames.at(-1)!.timeMs;
  for(const ageMs of [.25,.5,.999]){
    assert.equal(viewAt(frames,ageMs).view.tracks[0].ageMs,ageMs);
    assert.ok(Math.abs(viewAt(frames,last+ageMs).view.tracks[0].ageMs-ageMs)<1e-9);
  }
  for(const t of [-.001,-.5,-1])assert.equal(viewAt(frames,t).view.tracks.length,0);
});

test('interpolated evidence is endpoint-bounded and cannot acquire a future motion signal early',()=>{
  const frames=buildReplay(timeline(),null);
  frames[1].tracks[0].box.score=.66;
  frames[1].tracks[0].opticalTtcS=.6;
  frames[1].tracks[0].rangeTtcS=.6;
  frames[1].tracks[0].motionConfidence=1;
  const cache=structuredClone(frames),track=viewAt(frames,100).view.tracks[0];
  assert.equal(track.box.score,.66);
  assert.equal(track.opticalTtcS,null);
  assert.equal(track.rangeTtcS,null);
  assert.equal(track.motionConfidence,0);
  assert.deepEqual(frames,cache);
});

test('random-access playback cannot mutate cached risk evidence or leak a warning beyond the timeline',()=>{
  const raw=timeline(),frames=buildReplay(raw,null),copy=structuredClone(frames);
  const order=[1500,0,333,2199,400,900,1500,0];
  for(const t of order)assert.deepEqual(viewAt(frames,t),viewAt(frames,t));
  for(const t of [-100,Number.NaN,Infinity,3000]){
    assert.equal(viewAt(frames,t).warning,null);
  }
  assert.deepEqual(frames,copy);
});
