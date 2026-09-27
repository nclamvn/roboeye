import assert from 'node:assert/strict';
import test from 'node:test';
import {RoboHandStudioController,StudioHandIdentityTracker,handIntent,resolveStudioHandIdentities,type StudioHandInput} from '../../src/robohand-studio';
import type {RobotHandPose} from '../../src/robohand-types';

const pose=(x:number,y:number,at:number):RobotHandPose=>({
  points:Array.from({length:21},()=>({x:0,y:0,z:0})),directions:Array.from({length:20},()=>({x:0,y:1,z:0})),
  rootPosition:{x,y,z:0},rootOrientation:{x:0,y:0,z:0,w:1},rootScale:1,
  handedness:x<0?'Left':'Right',handednessScore:1,capturedAt:at,receivedAt:at
});
const hand=(id:string,x:number,y:number,at:number,gesture:StudioHandInput['gesture']='OPEN',grip=0):StudioHandInput=>({
  id,handedness:x<0?'Left':'Right',pose:pose(x,y,at),gesture,pinchStrength:gesture==='PINCH'?1:0,gripStrength:grip
});

test('two hands independently grab, manipulate and release props',()=>{
  const studio=new RoboHandStudioController();
  let frame=studio.update([hand('left',-1.05,-.18,0,'OPEN'),hand('right',1.05,-.18,0,'OPEN')],0);
  assert.equal(frame.hands.length,2);
  frame=studio.update([hand('left',-1.05,-.18,16,'PINCH'),hand('right',1.05,-.18,16,'PINCH')],16);
  assert.equal(frame.props.find(p=>p.id==='phone')?.ownerId,'left');
  assert.equal(frame.props.find(p=>p.id==='book')?.ownerId,'right');
  frame=studio.update([hand('left',-.2,.2,32,'OPEN'),hand('right',.2,.2,32,'OPEN')],32);
  assert.ok(frame.props.every(prop=>prop.ownerId!==null),'one OPEN sample must not drop props');
  frame=studio.update([hand('left',-.2,.2,160,'OPEN'),hand('right',.2,.2,160,'OPEN')],160);
  assert.ok(frame.props.every(prop=>prop.ownerId===null));
  assert.ok(frame.props.every(prop=>prop.action==='falling'));
});

test('ambiguous tracking retains ownership; a deliberate open palm falls under gravity and rests',()=>{
  const studio=new RoboHandStudioController();
  studio.update([hand('left',-1.05,-.18,0,'OPEN')],0);
  let frame=studio.update([hand('left',-1.05,-.18,16,'PINCH')],16);
  assert.equal(frame.props.find(prop=>prop.id==='phone')?.ownerId,'left');
  frame=studio.update([hand('left',-.4,.35,48,'FREE POSE',.4)],48);
  assert.equal(frame.props.find(prop=>prop.id==='phone')?.ownerId,'left','ambiguous pose dropped held prop');
  studio.update([hand('left',-.4,.35,80,'OPEN')],80);
  frame=studio.update([hand('left',-.4,.35,208,'OPEN')],208);
  const released=frame.props.find(prop=>prop.id==='phone')!;
  assert.equal(released.action,'falling');
  const releaseY=released.position.y;
  for(let at=258;at<=1458;at+=50)frame=studio.update([],at);
  const resting=frame.props.find(prop=>prop.id==='phone')!;
  assert.ok(resting.position.y<releaseY-.5,'released prop did not fall');
  assert.equal(resting.action,'resting');
});

test('free pointing hand swipes a held phone and page-turns a held book',()=>{
  const studio=new RoboHandStudioController();
  studio.update([hand('left',-1.05,-.18,0,'OPEN'),hand('right',-.82,-.18,0,'POINT')],0);
  studio.update([hand('left',-1.05,-.18,16,'PINCH'),hand('right',-.82,-.18,16,'POINT')],16);
  let frame=studio.update([hand('left',-1.05,-.18,32,'PINCH'),hand('right',-.66,-.18,32,'POINT')],32);
  assert.equal(frame.props.find(p=>p.id==='phone')?.action,'swipe');
  assert.match(frame.actionLabel,/Vuốt điện thoại/);
  studio.reset();
  studio.update([hand('right',1.05,-.18,0,'OPEN'),hand('left',.82,-.18,0,'POINT')],0);
  studio.update([hand('right',1.05,-.18,16,'PINCH'),hand('left',.82,-.18,16,'POINT')],16);
  frame=studio.update([hand('right',1.05,-.18,32,'PINCH'),hand('left',.66,-.18,32,'POINT')],32);
  assert.equal(frame.props.find(p=>p.id==='book')?.action,'page-turn');
});

test('intent descriptor is normalized by palm width',()=>{
  const points=Array.from({length:21},(_,index)=>({x:index*.02,y:index*.01,z:0}));
  points[5]={x:0,y:0,z:0};points[17]={x:1,y:0,z:0};points[4]={x:.5,y:.1,z:0};points[8]={x:.52,y:.1,z:0};
  const small=handIntent(points),large=handIntent(points.map(point=>({x:point.x*3,y:point.y*3,z:0})));
  assert.ok(small.pinchStrength>.9);
  assert.ok(Math.abs(small.pinchStrength-large.pinchStrength)<1e-9);
});

test('two observations always receive opposite identities when handedness briefly duplicates',()=>{
  assert.deepEqual(resolveStudioHandIdentities([
    {handedness:'Right',wristX:.32},{handedness:'Right',wristX:.68}
  ]),['right','left']);
  assert.deepEqual(resolveStudioHandIdentities([
    {handedness:null,wristX:.32},{handedness:null,wristX:.68}
  ]),['right','left']);
  assert.deepEqual(resolveStudioHandIdentities([
    {handedness:'Left',wristX:.68},{handedness:'Right',wristX:.32}
  ]),['left','right']);
});

test('observation-centric identity survives a crossing even when handedness labels flip',()=>{
  const tracker=new StudioHandIdentityTracker();
  const observation=(handedness:string,wristX:number)=>({handedness,handednessScore:.99,wristX,wristY:.5,palmSpan:.18});
  assert.deepEqual(tracker.assign([observation('Left',.70),observation('Right',.30)],0),['left','right']);
  assert.deepEqual(tracker.assign([observation('Left',.55),observation('Right',.45)],16),['left','right']);
  // The physical hands crossed, while the classifier emitted the opposite
  // labels for one frame. Predicted wrist motion remains the durable identity.
  assert.deepEqual(tracker.assign([observation('Right',.42),observation('Left',.58)],32),['left','right']);
});

test('identity tracker expires stale trajectories instead of reviving a ghost hand',()=>{
  const tracker=new StudioHandIdentityTracker();
  tracker.assign([{handedness:'Left',handednessScore:1,wristX:.7,wristY:.5,palmSpan:.18}],0);
  assert.deepEqual(tracker.assign([],700),[]);
  assert.deepEqual(tracker.assign([{handedness:'Right',handednessScore:1,wristX:.7,wristY:.5,palmSpan:.18}],716),['right']);
});
