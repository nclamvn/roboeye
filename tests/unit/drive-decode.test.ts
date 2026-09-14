import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFocal,installDriveDecoder} from '../../src/drive/detector-decode';
import {vehicleCandidates} from '../../src/drive/vehicle-candidates';
import {VehicleTracker} from '../../src/drive/tracking';
import type {DetBox} from '../../src/detection-types';
const tensor=(data:number[],dims:number[])=>({data:new Float32Array(data),dims});
const fixture=()=>({logits:tensor([-8,-12,-13,2,-10,3],[1,2,3]),pred_boxes:tensor([.5,.5,.2,.4,.2,.3,.1,.2],[1,2,4])});
test('focal decoding rejects negative-background queries that generic softmax inflates',()=>{
  // softmax([-8,-12,-13]) would report class 0 at >97%, despite sigmoid(-8)<.001.
  const out=decodeFocal(fixture(),.15)[0];assert.equal(out.classes.length,2);
  assert.deepEqual(out.classes,[2,0]);assert.ok(out.scores[0]>.95);
  assert.ok(out.boxes.every(b=>b[0]<.2));
});
test('focal decoder preserves last class, uses global top num_queries and correct xy/target scaling',()=>{
  const input=fixture();const out=decodeFocal(input,.1,[[100,200]])[0];
  assert.deepEqual(out.classes,[2,0]);assert.equal(out.boxes.length,2);
  assert.ok(Math.abs(out.boxes[0][0]-30)<1e-5);assert.ok(Math.abs(out.boxes[0][3]-40)<1e-5);
  assert.equal(decodeFocal(input,1)[0].boxes.length,0);
  assert.deepEqual([...input.logits.data],[-8,-12,-13,2,-10,3]);
});
test('focal decoding validates shape, finite data, threshold and batch target size',()=>{
  for(const value of [-.1,NaN,1.1])assert.throws(()=>decodeFocal(fixture(),value));
  assert.throws(()=>decodeFocal(fixture(),.5,[[0,100]]));
  assert.throws(()=>decodeFocal(fixture(),.5,[]));
  const a=fixture();a.logits.data[0]=NaN;assert.throws(()=>decodeFocal(a));
  const b=fixture();b.pred_boxes.dims=[1,3,4];assert.throws(()=>decodeFocal(b));
  const two={logits:tensor([2,-8,-9,3],[2,1,2]),pred_boxes:tensor([.5,.5,.2,.2,.5,.5,.2,.2],[2,1,4])};
  assert.deepEqual(decodeFocal(two).map(v=>v.classes),[[0],[1]]);
});
test('decoder adapter is instance-scoped and refuses a non-focal model',()=>{
  const old=()=>[],make=()=>({model:{config:{model_type:'rt_detr_v2',use_focal_loss:true}},processor:{image_processor:{post_process_object_detection:old as unknown}}});
  const a=make(),b=make();installDriveDecoder(a);
  assert.equal(a.processor.image_processor.post_process_object_detection,decodeFocal);
  assert.equal(b.processor.image_processor.post_process_object_detection,old);
  b.model.config.use_focal_loss=false;assert.throws(()=>installDriveDecoder(b));
  assert.throws(()=>installDriveDecoder({}));
});
const car:DetBox={label:'car',score:.93,x0:.4,y0:.5,x1:.6,y1:.8};
test('vehicle hypotheses compete across labels without removing a distinct occluded vehicle',()=>{
  const truck={...car,label:'truck',score:.61},behind={...car,x0:.58,x1:.64,score:.8},small={...car,x0:.48,x1:.52,y0:.55,y1:.60,score:.7};
  const raw=[truck,behind,car,small,{...car,label:'stop sign',score:.99}],copy=structuredClone(raw);
  assert.deepEqual(vehicleCandidates(raw),[car,behind,small]);assert.deepEqual(raw,copy);
  const tracker=new VehicleTracker();tracker.observe(raw,0,0,null,1280,720);
  assert.equal(tracker.snapshot(0,0).length,1); // other two await temporal confirmation
  tracker.observe(raw,200,200,null,1280,720);assert.equal(tracker.snapshot(200,200).length,3);
});
test('vehicle candidate validation and cap cannot promote NaN or out-of-frame boxes',()=>{
  assert.deepEqual(vehicleCandidates([{...car,score:NaN},{...car,x0:-.1},{...car,score:1.1},{...car,y1:.1}]),[]);
  assert.equal(vehicleCandidates([car,{...car,score:.15}]).length,1);
});
test('vehicle confirmation rejects a weak flash and requires two adjacent strong samples',()=>{
  const tracker=new VehicleTracker();
  tracker.observe([{...car,score:.52}],0,0,null,1280,720);assert.equal(tracker.snapshot(0,0).length,0);
  tracker.observe([{...car,score:.7}],200,200,null,1280,720);assert.equal(tracker.snapshot(200,200).length,0);
  tracker.observe([{...car,score:.7}],400,400,null,1280,720);assert.equal(tracker.snapshot(400,400).length,1);
  const isolated=new VehicleTracker();isolated.observe([{...car,score:.7}],0,0,null,1280,720);
  isolated.observe([{...car,score:.7}],600,600,null,1280,720);assert.equal(isolated.snapshot(600,600).length,0);
  const missing=new VehicleTracker();missing.observe([{...car,score:.7}],0,0,null,1280,720);
  missing.observe([],200,200,null,1280,720);missing.observe([{...car,score:.7}],400,400,null,1280,720);
  assert.equal(missing.snapshot(400,400).length,0);
});
test('weak association keeps ID briefly but cannot keep a ghost alive indefinitely',()=>{
  const tracker=new VehicleTracker();tracker.observe([car],0,0,null,1280,720);
  const id=tracker.snapshot(0,0)[0].id;
  for(const t of [200,400,600,800]){
    tracker.observe([{...car,score:.2}],t,t,null,1280,720);
    assert.equal(tracker.snapshot(t,t).length,t<=400?1:0);
  }
  tracker.observe([car],1000,1000,null,1280,720);assert.equal(tracker.snapshot(1000,1000)[0].id,id);
});
