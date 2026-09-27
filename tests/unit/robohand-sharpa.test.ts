import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRobotHandRestPoints } from '../../src/robohand-rig';
import { computeSharpaJointTargets, targetsWithinSharpaLimits } from '../../src/robohand-sharpa';
import { ROBOT_HAND_SEGMENTS, type RobotFingerCurls, type RobotHandPose } from '../../src/robohand-types';

function pose(fingerCurls: RobotFingerCurls): RobotHandPose {
  const points=createRobotHandRestPoints();
  const directions=ROBOT_HAND_SEGMENTS.map(segment=>{
    const a=points[segment.parent],b=points[segment.child];
    const length=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
    return {x:(b.x-a.x)/length,y:(b.y-a.y)/length,z:(b.z-a.z)/length};
  });
  return {
    points,directions,fingerCurls,rootPosition:{x:0,y:0,z:0},rootOrientation:{x:0,y:0,z:0,w:1},
    rootScale:1,handedness:'Right',handednessScore:1,capturedAt:0,receivedAt:0
  };
}

test('Wave joint mapping covers the native rig and respects every URDF limit',()=>{
  for(const side of ['Left','Right'] as const){
    const targets=computeSharpaJointTargets(pose([1,1,1,1,1]),side);
    assert.equal(Object.keys(targets).length,22);
    assert.ok(Object.keys(targets).every(name=>name.startsWith(side.toLowerCase()+'_')));
    assert.ok(targetsWithinSharpaLimits(targets));
  }
});

test('closed-hand evidence creates a compact forward-flexing chain',()=>{
  const open=computeSharpaJointTargets(pose([0,0,0,0,0]),'Right');
  const closed=computeSharpaJointTargets(pose([1,1,1,1,1]),'Right');
  for(const finger of ['index','middle','ring','pinky']){
    assert.ok(closed[`right_${finger}_MCP_FE`]>open[`right_${finger}_MCP_FE`]);
    assert.ok(closed[`right_${finger}_PIP`]>open[`right_${finger}_PIP`]);
    assert.ok(closed[`right_${finger}_DIP`]>open[`right_${finger}_DIP`]);
    assert.ok(closed[`right_${finger}_DIP`]>=closed[`right_${finger}_PIP`]*.55,
      `${finger} distal link unfolded during fist`);
  }
  assert.ok(closed.right_thumb_CMC_FE>open.right_thumb_CMC_FE);
  assert.ok(closed.right_thumb_IP>open.right_thumb_IP);
  assert.ok(closed.right_pinky_CMC>0);
});

test('thumb-index contact increases opposition without exceeding mechanics',()=>{
  const input=pose([.2,.2,.1,.1,.1]);
  const free=computeSharpaJointTargets(input,'Left');
  input.handTask={
    tips:[4,8,12,16,20].map(index=>({...input.points[index]})),
    tipDirections:[3,7,11,15,19].map(index=>({...input.directions[index]})),
    contacts:[{a:0,b:1,weight:1,distance:.025}]
  };
  const pinch=computeSharpaJointTargets(input,'Left');
  assert.ok(pinch.left_thumb_CMC_FE>free.left_thumb_CMC_FE);
  assert.ok(pinch.left_thumb_MCP_FE>free.left_thumb_MCP_FE);
  assert.ok(targetsWithinSharpaLimits(pinch));
});
