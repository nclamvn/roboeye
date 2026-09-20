import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { precisionHand, precisionFrame, precisionFist } from '../fixtures/robohand-precision';
import { solveRobotHandPose } from '../../src/robohand-pose';
import { RobotHandPoseFilter } from '../../src/robohand-realtime';
import { createRobotHandRig } from '../../src/robohand-rig';
import { contactResidual, HAND_TIPS } from '../../src/robohand-retarget';
import { ROBOT_HAND_SEGMENTS, type Vec3 } from '../../src/robohand-types';

const cases=[[0,1],[0,2],[0,3],[0,4],[0,1,2],[0,1,2,3],[1,2]];
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('precision contacts close despite different palm/finger proportions, including 3/4 fingertips',()=>{
  const results=[];
  for(const fingers of cases){
    const filter=new RobotHandPoseFilter();
    const raw=solveRobotHandPose(precisionFrame(precisionHand(fingers)))!;
    assert.ok(raw?.handTask);
    const solved=filter.update(raw);
    const before=contactResidual(raw.points,raw.handTask.contacts),after=contactResidual(solved.points,raw.handTask.contacts);
    results.push({fingers,before,after});
    for(const c of raw.handTask.contacts.filter(c=>c.weight>.95))
      assert.ok(distance(solved.points[HAND_TIPS[c.a]],solved.points[HAND_TIPS[c.b]])>.012,'distinct fingertip endpoints collapsed');
    for(const s of ROBOT_HAND_SEGMENTS)assert.ok(Math.abs(distance(solved.points[s.parent],solved.points[s.child])-s.length)<1e-6);
  }
  console.log('precision before/after',JSON.stringify(results));
  for(const row of results)assert.ok(row.after<=.035,JSON.stringify(row));
  const before=results.map(r=>r.before).sort((a,b)=>a-b)[3],after=results.map(r=>r.after).sort((a,b)=>a-b)[3];
  assert.ok(after<before*.3);
});

test('contact remains closed at rendered shell endpoints after filtering and moving the pinch',()=>{
  const filter=new RobotHandPoseFilter(),rig=createRobotHandRig();
  for(let frame=0;frame<30;frame++){
    const pose=filter.update(solveRobotHandPose(precisionFrame(precisionHand([0,1,2],0,frame/30),frame*33))!);
    rig.setPose(pose);
    for(let subframe=0;subframe<2;subframe++){
      rig.update(16);
      const rendered=pose.points.map(p=>({...p}));
      for(let f=0;f<5;f++){
        const s=ROBOT_HAND_SEGMENTS[f*4+3],root=rig.group.getObjectByName(`${s.finger}-phalange-3`)!;
        rendered[HAND_TIPS[f]]=new THREE.Vector3(0,s.length,0).applyQuaternion(root.quaternion).add(root.position);
      }
      assert.ok(contactResidual(rendered,pose.handTask!.contacts)<.035,`frame ${frame}: ${contactResidual(rendered,pose.handTask!.contacts)}`);
    }
  }
  rig.dispose();
});

test('open and release do not retain contact; invalid observations are rejected',()=>{
  const raw=solveRobotHandPose(precisionFrame(precisionHand()))!;
  assert.equal(raw.handTask!.contacts.length,0);
  const open=new RobotHandPoseFilter().update(raw);
  for(let i=0;i<21;i++)assert.ok(distance(open.points[i],raw.points[i])<1e-9,'open articulation distorted by task-space fitting');
  const pinching=solveRobotHandPose(precisionFrame(precisionHand([0,1])))!;
  const pinched=new RobotHandPoseFilter().update(pinching);
  for(let i=9;i<21;i++)assert.ok(distance(pinching.points[i],pinched.points[i])<1e-9,'free finger moved while other fingers pinched');
  const filter=new RobotHandPoseFilter();
  filter.update(solveRobotHandPose(precisionFrame(precisionHand([0,1])))!);
  let last=raw;
  for(let frame=1;frame<20;frame++)last=filter.update(solveRobotHandPose(precisionFrame(precisionHand(),frame*33))!);
  assert.ok(distance(last.points[4],last.points[8])>.3);
  const broken=precisionFrame(precisionHand());broken.worldLandmarks[8].z=NaN;
  assert.equal(solveRobotHandPose(broken),null);
});

test('precision gestures survive both hands, source scale and out-of-plane rotation',()=>{
  for(const mirror of [false,true])for(const scale of [.5,2])for(const yaw of [-1,0,1])for(const fingers of cases){
    const source=precisionHand(fingers).map(p=>({x:p.x*scale,y:p.y*scale,z:p.z*scale}));
    const raw=solveRobotHandPose(precisionFrame(source,0,mirror,yaw))!;
    const pose=new RobotHandPoseFilter().update(raw);
    assert.ok(contactResidual(pose.points,pose.handTask!.contacts)<.035,JSON.stringify({mirror,scale,yaw,fingers,residual:contactResidual(pose.points,pose.handTask!.contacts)}));
  }
});

test('fist preserves deep flexion and bounded consecutive joint angles',()=>{
  const pose=new RobotHandPoseFilter().update(solveRobotHandPose(precisionFrame(precisionFist()))!);
  for(let f=1;f<5;f++){
    assert.ok(distance(pose.points[f*4+1],pose.points[f*4+4])<.72,`fist finger ${f} remained open`);
    const dirs=pose.directions.slice(f*4+1,f*4+4);
    for(let k=0;k<2;k++){
      const a=dirs[k],b=dirs[k+1];
      const bend=Math.acos(Math.max(-1,Math.min(1,a.x*b.x+a.y*b.y+a.z*b.z)));
      assert.ok(bend<=1.951,`unbounded bend ${bend}`);
    }
  }
});

test('millimetre-like small target motion is continuous and no contact is inferred from a 2D crossing alone',()=>{
  const filter=new RobotHandPoseFilter();let previous:Vec3|undefined,total=0;
  for(let step=0;step<60;step++){
    const raw=solveRobotHandPose(precisionFrame(precisionHand([0,1],0,step*.02),step*33))!;
    const pose=filter.update(raw);
    if(previous){const delta=distance(previous,pose.points[4]);assert.ok(delta<.012,`micro-motion jump ${delta}`);total+=delta;}
    previous=pose.points[4];
  }
  assert.ok(total>.015,`small motions suppressed ${total}`);
  const source=precisionHand([0,1]);source[4].z-=.5;
  const raw=solveRobotHandPose(precisionFrame(source))!;
  assert.ok(!raw.handTask!.contacts.some(c=>c.a===0&&c.b===1));
});

test('task-space pipeline suppresses small contact jitter without losing fast contact motion',()=>{
  const filter=new RobotHandPoseFilter(),rawX:number[]=[],filteredX:number[]=[];
  for(let step=0;step<45;step++){
    const frame=precisionFrame(precisionHand([0,1],0,step%2?.08:-.08),step*16);
    const raw=solveRobotHandPose(frame)!;
    rawX.push(new RobotHandPoseFilter().update(raw).points[4].x);
    filteredX.push(filter.update(raw).points[4].x);
  }
  const spread=(xs:number[])=>Math.max(...xs.slice(15))-Math.min(...xs.slice(15));
  assert.ok(spread(filteredX)<spread(rawX)*.6,`${spread(filteredX)} / ${spread(rawX)}`);
  const baseline=filteredX.at(-1)!;
  const target=solveRobotHandPose(precisionFrame(precisionHand([0,1],0,3),45*16))!;
  const rawTarget=new RobotHandPoseFilter().update(target).points[4].x;
  let moved=baseline;
  for(let frame=45;frame<48;frame++)moved=filter.update({...target,capturedAt:frame*16}).points[4].x;
  assert.ok(Math.abs(moved-baseline)>.65*Math.abs(rawTarget-baseline));
});
