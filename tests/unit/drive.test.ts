import test from 'node:test';
import assert from 'node:assert/strict';
import { distort, groundPoint, parseProfile, estimateGroundRange, refineMount, type GroundControl, type CameraProfile } from '../../src/drive/geometry';
import { DEMO_PROFILE, demoFrame } from '../../src/drive/demo';
import { assign, RangeFilter, VehicleTracker } from '../../src/drive/tracking';
import { evaluate, parseReferences } from '../../src/drive/benchmark';
const close=(a:number,b:number,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
// Forward projection written independently of inverse ray/plane implementation.
function project(x:number,z:number,p:CameraProfile):[number,number] {
  const pitch=p.pitchDeg*Math.PI/180,roll=p.rollDeg*Math.PI/180;
  const yc=p.heightM*Math.cos(pitch)-z*Math.sin(pitch),zc=p.heightM*Math.sin(pitch)+z*Math.cos(pitch);
  const xx=(Math.cos(roll)*x+Math.sin(roll)*yc)/zc,yy=(-Math.sin(roll)*x+Math.cos(roll)*yc)/zc;
  const [dx,dy]=distort(xx,yy,p.distortion);return [p.cx+p.fx*dx,p.cy+p.fy*dy];
}
test('drive calibration rejects NaN, unsupported distortion, dimensions and unbounded inputs',()=>{
  assert.deepEqual(parseProfile(DEMO_PROFILE),DEMO_PROFILE);
  for(const patch of [{fx:NaN},{heightM:0},{width:1280.5},{minM:20,maxM:10},{distortion:[]},{pixelSigma:0},{pitchDeg:90},{version:2}])assert.throws(()=>parseProfile({...DEMO_PROFILE,...patch}));
});
test('drive ray/plane agrees with independent projection over yaw position, pitch, roll and Brown distortion',()=>{
  for(const pitchDeg of [-2,0,8])for(const rollDeg of [-5,0,5])for(const z of [5,10,30,50])for(const x of [-2,0,2]){
    const p:CameraProfile={...DEMO_PROFILE,pitchDeg,rollDeg,distortion:[-.06,.015,.001,-.002,.001]};
    const [u,v]=project(x,z,p),result=groundPoint(u,v,p)!;assert.ok(result);close(result.z,z,1e-4);close(result.x,x,1e-4);
  }
});
test('drive geometry reproduces 2D ideal distances without using car dimensions',()=>{
  for(const time of [0,1500,6000,12000,17000]){
    const f=demoFrame(time);f.boxes.forEach((box,i)=>{const r=estimateGroundRange(box,DEMO_PROFILE,1280,720);assert.ok(r.distanceM);close(r.distanceM!,f.truth[i]);assert.equal(r.kind,'ground_contact_forward_m');assert.equal(r.intervalCalibrated,false);});
  }
});
test('drive fails closed for missing calibration, changed source geometry, clipped/tiny boxes and horizon',()=>{
  const b=demoFrame(0).boxes[0];
  for(const result of [estimateGroundRange(b,null,1280,720),estimateGroundRange(b,DEMO_PROFILE,1920,1080),estimateGroundRange({...b,x0:0},DEMO_PROFILE,1280,720),estimateGroundRange({...b,y1:1},DEMO_PROFILE,1280,720),estimateGroundRange({...b,y0:.4,y1:.41},DEMO_PROFILE,1280,720),estimateGroundRange({...b,y0:.1,y1:.3},DEMO_PROFILE,1280,720)])assert.equal(result.distanceM,null);
  assert.equal(groundPoint(640,360,DEMO_PROFILE),null);
});
test('drive sensitivity grows with pitch uncertainty; unsafe uncertainty suppresses meter labels',()=>{
  const b=demoFrame(0).boxes[0],low=estimateGroundRange(b,DEMO_PROFILE,1280,720);
  assert.ok(low.sigmaM!>3);assert.equal(estimateGroundRange(b,{...DEMO_PROFILE,pitchSigmaDeg:4},1280,720).distanceM,null);
});
test('drive robust mount refinement has held-out ground truth, tolerates one fit outlier',()=>{
  const truth={...DEMO_PROFILE,heightM:1.6,pitchDeg:3};
  const points:GroundControl[]=[6,9,12,16,22,29,36,43,11,26,39].map((z,i)=>{const [u,v]=project((i%3-1)*.4,z,truth);return {u,v,zM:z,split:i<8?'fit':'check'};});
  points[3].zM+=12;
  const fitted=refineMount({...truth,heightM:1.45,pitchDeg:2.5},points);
  assert.ok(fitted.checkMAE<.6,JSON.stringify(fitted));assert.ok(Math.abs(fitted.profile.heightM-1.6)<.1);
  assert.throws(()=>refineMount(truth,points.slice(0,6)));
  assert.throws(()=>refineMount(truth,points.map(p=>({...p,zM:10}))));
  assert.throws(()=>refineMount(truth,[...points.slice(0,8),{...points[0],split:'check'},{...points[1],split:'check'}]));
  assert.throws(()=>refineMount(truth,points.map(p=>p.split==='check'?{...p,zM:p.zM+30}:p)));
});
test('drive Hungarian finds global assignment and respects dummy unmatched columns',()=>{
  assert.deepEqual(assign([[.1,.2],[.11,.9]]).sort(),[[0,1],[1,0]]);
  assert.deepEqual(assign([[1e6,.2],[1e6,1e6]]),[[0,1]]);
  assert.deepEqual(assign([[]]),[]);
});
test('drive two-stage association preserves ID through low confidence and reordered vehicles',()=>{
  const tracker=new VehicleTracker(),b=demoFrame(0).boxes;
  tracker.observe(b,0,0,DEMO_PROFILE,1280,720);const first=tracker.snapshot(0,0);
  tracker.observe([...b].reverse().map(a=>({...a,score:.2})),100,100,DEMO_PROFILE,1280,720);
  const second=tracker.snapshot(100,100);assert.equal(second.length,2);assert.deepEqual(second.map(a=>[a.id,a.box.label]),first.map(a=>[a.id,a.box.label]));
  assert.ok(second.every(a=>a.range.distanceM===null)); // weak association is not a metre measurement
  const low=new VehicleTracker();low.observe(b.map(a=>({...a,score:.2})),0,0,DEMO_PROFILE,1280,720);assert.equal(low.snapshot(0,0).length,0);
});
test('drive associates a fast non-overlapping vehicle and resists one-frame subclass flicker',()=>{
  const tracker=new VehicleTracker(),first={label:'car',score:.92,x0:.1,y0:.2,x1:.2,y1:.4};
  tracker.observe([first],0,0,null,1280,720);const id=tracker.snapshot(0,0)[0].id;
  tracker.observe([{label:'truck',score:.76,x0:.21,y0:.22,x1:.31,y1:.42}],200,200,null,1280,720);
  const moved=tracker.snapshot(200,200);assert.equal(moved.length,1);assert.equal(moved[0].id,id);assert.equal(moved[0].box.label,'car');
  tracker.observe([{label:'car',score:.92,x0:.7,y0:.2,x1:.8,y1:.4}],400,400,null,1280,720);
  const split=tracker.snapshot(400,400);assert.ok(split.some(track=>track.id!==id));assert.equal(split.find(track=>track.id===id)?.range.distanceM,null);
});
test('drive missed detection and stale data never retain a current distance',()=>{
  const tracker=new VehicleTracker();tracker.observe(demoFrame(0).boxes,0,0,DEMO_PROFILE,1280,720);
  assert.ok(tracker.snapshot(100,100)[0].range.distanceM);
  assert.equal(tracker.snapshot(500,500).length,0); // strong-evidence window expired
  tracker.observe([],100,100,DEMO_PROFILE,1280,720);assert.equal(tracker.snapshot(100,100)[0].range.distanceM,null);
  assert.equal(tracker.snapshot(1200,1200).length,0);
});
test('drive reordered/duplicate time is ignored; reset does not transfer old range to a new source',()=>{
  const tracker=new VehicleTracker();tracker.observe(demoFrame(0).boxes,100,100,DEMO_PROFILE,1280,720);
  tracker.observe([],50,110,null,1280,720);assert.ok(tracker.snapshot(100,110)[0].range.distanceM);
  tracker.reset();assert.equal(tracker.snapshot(0,0).length,0);
  tracker.observe(demoFrame(0).boxes,0,0,null,1280,720);assert.equal(tracker.snapshot(0,0)[0].range.distanceM,null);
});
test('drive Kalman follows closing motion, suppresses jitter and rejects large innovations',()=>{
  const filter=new RangeFilter();let result:ReturnType<RangeFilter['update']>=null;let filteredError=0,rawError=0;
  for(let i=0;i<80;i++){const z=40-i*.2,noise=Math.sin(i*2.3)*.5;result=filter.update(z+noise,.5,i*100);assert.ok(result);if(i>15){filteredError+=(result!.z-z)**2;rawError+=noise**2;}}
  assert.ok(filteredError<rawError*.5);assert.ok(Math.abs(result!.velocity!+2)<.4);
  assert.equal(filter.update(100,.2,8000),null);assert.equal(filter.update(NaN,1,8100),null);
  filter.clear();assert.equal(filter.update(10,1,0)?.velocity,null);
});
test('drive optical TTC resets after a miss instead of preserving stale motion',()=>{
  const tracker=new VehicleTracker();
  for(const timeMs of [0,200,400,600]){const s=.12*Math.exp(timeMs/3000);tracker.observe([{label:'car',score:.96,x0:.5-s/2,x1:.5+s/2,y0:.72-s,y1:.72}],timeMs,timeMs,null,1280,720);}
  assert.ok(tracker.snapshot(600,600)[0].opticalTtcS);
  tracker.observe([],800,800,null,1280,720);
  const after=tracker.snapshot(800,800)[0];assert.equal(after?.opticalTtcS,null);
});
test('drive report exposes missing ground truth and includes abstention in coverage',()=>{
  const obs=[{timeMs:0,trackId:1,distanceM:11,latencyMs:60,reason:''},{timeMs:100,trackId:1,distanceM:null,latencyMs:120,reason:'unknown'}];
  assert.equal(evaluate(obs,[]).maeM,null);assert.equal(evaluate(obs,[]).coverage,null);
  const refs=parseReferences([{timeMs:0,trackId:1,distanceM:10},{timeMs:100,trackId:1,distanceM:10},{timeMs:200,trackId:2,distanceM:20}]);
  const result=evaluate(obs,refs);close(result.coverage!,1/3);close(result.maeM!,1);assert.equal(result.captureToResultP95Ms,120);
  assert.throws(()=>parseReferences([{timeMs:NaN,trackId:1,distanceM:10}]));assert.throws(()=>parseReferences([refs[0],refs[0]]));
});
test('drive report indexed matching consumes nearest samples once and respects the 80 ms window',()=>{
  const observed=[200,0,100].map((timeMs,i)=>({timeMs,trackId:1,distanceM:10+i,latencyMs:50,reason:''}));
  const refs=[0,0,100,200,300].map(timeMs=>({timeMs,trackId:1,distanceM:10}));
  assert.equal(evaluate(observed,refs).matchedMeasurements,3);
  assert.equal(evaluate(observed,[{timeMs:281,trackId:1,distanceM:10}]).matchedMeasurements,0);
  assert.equal(evaluate(observed,[{timeMs:280,trackId:1,distanceM:10}]).matchedMeasurements,1);
  const many=Array.from({length:20000},(_,i)=>({timeMs:i*100,trackId:1,distanceM:10,latencyMs:50,reason:''}));
  assert.equal(evaluate(many,many.map(o=>({...o,distanceM:10}))).matchedMeasurements,20000);
});
