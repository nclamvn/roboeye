import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleTimes,buildReplay,replayAt,seekDecoded,type ReplaySample} from '../../src/drive/replay';
import {demoFrame,DEMO_PROFILE} from '../../src/drive/demo';
import type {RangeEstimate} from '../../src/drive/geometry';
import type {DetBox} from '../../src/detection-types';
import type {DriveTrack} from '../../src/drive/tracking';
const sample=(timeMs:number):ReplaySample=>({timeMs,boxes:demoFrame(timeMs).boxes,latencyMs:1800,width:1280,height:720});

test('replay sampling is bounded, monotonic, includes the tail and rejects unsupported clips',()=>{
  assert.deepEqual(sampleTimes(1000),[0,200,400,600,800,950]);
  assert.ok(sampleTimes(120000).length<=601);
  assert.ok(sampleTimes(300000).length<=1501);
  for(const n of [NaN,Infinity,0,99,300001])assert.throws(()=>sampleTimes(n));
  assert.deepEqual(sampleTimes(1000,400),[0,400,800,950]);
  for(const step of [199,2001,200.5,NaN])assert.throws(()=>sampleTimes(1000,step));
});
test('three-minute clips retain 5 Hz sampling through the complete duration without truncation',()=>{
  const times=sampleTimes(180000);
  assert.equal(times.length,901);
  assert.equal(times[0],0);assert.equal(times.at(-1),179950);
  assert.ok(times.every((t,i)=>i===0||t>times[i-1]));
  assert.ok(times.slice(1).every((t,i)=>t-times[i]<=200));
  const frames=buildReplay(times.map(sample),DEMO_PROFILE);
  assert.equal(frames.length,901);
  assert.ok(replayAt(frames,179900).tracks.length,'the third minute has actual sampled tracks');
});
test('replay recomputes calibration without inference and does not mutate raw samples',()=>{
  const raw=[sample(0),sample(200)],copy=structuredClone(raw);
  const a=buildReplay(raw,null),b=buildReplay(raw,DEMO_PROFILE);
  assert.equal(a[0].tracks[0].range.distanceM,null);assert.ok(b[0].tracks[0].range.distanceM);
  assert.deepEqual(raw,copy);assert.deepEqual(a.map(f=>f.tracks.map(t=>t.id)),b.map(f=>f.tracks.map(t=>t.id)));
});
test('replay uses learned metric ranges without a camera profile and filters them per track',()=>{
  const frames=[sample(0),sample(200),sample(400)];
  frames.forEach((frame,index)=>{frame.boxes.forEach(box=>box.score=.9);frame.learnedRanges=frame.boxes.map(()=>({
    kind:'learned_optical_axis_z_m',provenance:'learned-unverified',distanceM:18-index*.2,lateralM:null,sigmaM:2,
    interval:[14,22],intervalCalibrated:false,reason:'fixture'
  } satisfies RangeEstimate));});
  const replay=buildReplay(frames,null);assert.equal(replay[0].tracks[0].range.kind,'learned_optical_axis_z_m');
  assert.equal(replay[0].tracks[0].range.provenance,'learned-unverified');assert.ok(replay[2].tracks[0].range.distanceM);
});
test('replay interpolates matching IDs only, retains sampled range and cannot mutate cache',()=>{
  const frames=buildReplay([sample(0),sample(200)],DEMO_PROFILE);
  const original=frames[0].tracks[0].box.x0;frames[1].tracks[0].box.x0=original+.02;
  const view=replayAt(frames,100);assert.equal(view.interpolated,true);
  assert.ok(Math.abs(view.tracks[0].box.x0-original-.01)<1e-8);
  assert.equal(view.tracks[0].range.distanceM,frames[0].tracks[0].range.distanceM);
  view.tracks[0].box.x0=10;assert.equal(frames[0].tracks[0].box.x0,original);
});
test('final replay publication revalidates filtered ranges against the boxes actually shown',()=>{
  const left:DetBox={label:'car',score:.9,x0:135/862,x1:247/862,y0:298/576,y1:397/576};
  const right:DetBox={label:'truck',score:.9,x0:482/862,x1:594/862,y0:296/576,y1:387/576};
  const track=(id:number,box:DetBox,distanceM:number):DriveTrack=>({id,box,ageMs:0,
    range:{kind:'learned_optical_axis_z_m',provenance:'learned-unverified',distanceM,lateralM:null,sigmaM:5,interval:[distanceM-10,distanceM+10],intervalCalibrated:false,reason:'post-filter fixture'},
    closingSpeed:1,opticalTtcS:null,rangeTtcS:distanceM,status:'tracked',motionConfidence:.9});
  // Simulates the final Kalman output, not raw model input. This was the missing
  // publication boundary in the 10:25 screenshot.
  const view=replayAt([{timeMs:0,tracks:[track(1,left,51),track(2,right,43)]}],0);
  assert.deepEqual(view.tracks.map(item=>item.range.distanceM),[null,null]);
  assert.ok(view.tracks.every(item=>item.status==='unknown'&&item.closingSpeed===null&&item.rangeTtcS===null));
});
test('replay does not fabricate boxes through missed detections, different IDs or long gaps',()=>{
  const frames=buildReplay([sample(0),{...sample(200),boxes:[]}],null);
  assert.equal(frames[1].tracks.length,0);assert.equal(replayAt(frames,100).tracks.length,0);
  const ids=buildReplay([sample(0),sample(200)],null);ids[1].tracks.forEach(t=>t.id+=10);
  assert.equal(replayAt(ids,100).tracks.length,0);
  assert.equal(replayAt(buildReplay([sample(0),sample(1000)],null),500).tracks.length,0);
});
test('replay seeking is deterministic, hides out-of-timeline values and suppresses invalid next range',()=>{
  const frames=buildReplay([sample(0),sample(200)],DEMO_PROFILE);
  assert.deepEqual(replayAt(frames,0),replayAt(frames,0));assert.equal(replayAt(frames,-20).tracks.length,0);
  assert.equal(replayAt(frames,281).tracks.length,0);assert.ok(replayAt(frames,250).tracks.length);
  assert.equal(replayAt(frames,NaN).tracks.length,0);
  frames[1].tracks[0].range.distanceM=null;
  assert.equal(replayAt(frames,100).tracks[0].range.distanceM,null);
});
class FakeVideo extends EventTarget {
  readyState=2;seeking=false;time=0;blocked=false;
  get currentTime(){return this.time;}
  set currentTime(t:number){this.time=t;this.seeking=true;if(!this.blocked)queueMicrotask(()=>{this.seeking=false;this.dispatchEvent(new Event('seeked'));});}
}
test('decoded seek waits for the requested frame and cancellation cannot advance another source',async()=>{
  const video=new FakeVideo(),controller=new AbortController();
  await seekDecoded(video as unknown as HTMLVideoElement,400,controller.signal);assert.equal(video.currentTime,.4);
  video.blocked=true;const pending=seekDecoded(video as unknown as HTMLVideoElement,800,controller.signal);
  controller.abort();await assert.rejects(pending,{name:'AbortError'});
  await assert.rejects(seekDecoded(video as unknown as HTMLVideoElement,2000,controller.signal),{name:'AbortError'});
  assert.equal(video.currentTime,.8);
});
