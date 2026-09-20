import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { precisionHand, precisionFrame } from './fixtures/robohand-precision';
import { solveRobotHandPose } from '../src/robohand-pose';
import { RobotHandPoseFilter } from '../src/robohand-realtime';
import { createRobotHandRig } from '../src/robohand-rig';
import { contactResidual } from '../src/robohand-retarget';

const cases=[[0,1],[0,2],[0,3],[0,4],[0,1,2],[0,1,2,3],[1,2]];
const results=cases.map(fingers=>{
  const raw=solveRobotHandPose(precisionFrame(precisionHand(fingers)))!;
  const solved=new RobotHandPoseFilter().update(raw);
  return {fingers,before:contactResidual(raw.points,raw.handTask!.contacts),after:contactResidual(solved.points,solved.handTask!.contacts)};
});
const filter=new RobotHandPoseFilter(),rig=createRobotHandRig(),solveMs:number[]=[],renderUpdateMs:number[]=[];
for(let frame=0;frame<1300;frame++){
  const input=precisionFrame(precisionHand(cases[Math.floor(frame/100)%cases.length],0,.4*Math.sin(frame/120)),frame*16);
  const start=performance.now();
  const pose=filter.update(solveRobotHandPose(input)!);
  const solvedAt=performance.now();
  rig.setPose(pose);rig.update(16);
  const renderedAt=performance.now();
  if(frame>=100){solveMs.push(solvedAt-start);renderUpdateMs.push(renderedAt-solvedAt);}
}
rig.dispose();
const percentiles=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};
console.log(JSON.stringify({date:new Date().toISOString(),runtime:process.version,cpu:os.cpus()[0].model,
  scope:'Synthetic geometry only. Excludes camera, MediaPipe, GPU rendering and motion-to-photon latency.',
  contactCases:results,solveAndFilterMs:percentiles(solveMs),rigUpdateMs:percentiles(renderUpdateMs)},null,2));
