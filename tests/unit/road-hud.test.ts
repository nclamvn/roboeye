import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LaneHud,lanePosition} from '../../src/drive/road-hud';
import type {RoadSample} from '../../src/drive/road-runtime';

function sample(t:number,p=.5,generation=1):RoadSample {
  const left=.5-p*.4;
  const diagnostic={accepted:true,reason:'accepted' as const,supportRows:25,span:.45,rmsPx:2,confidence:.85};
  return {timeMs:t,generation,latencyMs:100,vector:{lines:[{id:'l',class:'lane-marking',role:'ego-left',points:[{x:left,y:.6},{x:left,y:.99}]},{id:'r',class:'lane-marking',role:'ego-right',points:[{x:left+.4,y:.6},{x:left+.4,y:.99}]}],areas:[],diagnostics:{vectorizerVersion:2,roadRows:30,markRows:25,horizonY:.4,paths:{left:{...diagnostic},right:{...diagnostic}}}}};
}
function feed(hud:LaneHud,t:number,p=.5){const s=sample(t,p);hud.observe(s,t,1);return hud.view(s,t,1);}
function track(hud:LaneHud){feed(hud,0);feed(hud,350);assert.equal(feed(hud,700),'tracking');}

test('quiet lane HUD waits for three distinct good frames over dwell duration',()=>{
  const h=new LaneHud();assert.equal(feed(h,0),'unknown');
  for(let i=0;i<100;i++)assert.equal(feed(h,0),'unknown');
  assert.equal(feed(h,350),'unknown');assert.equal(feed(h,700),'tracking');
});
test('stationary off-centre start is not a departure; both warning sides require prior tracking',()=>{
  for(const [p,side] of [[.15,'left'],[.85,'right']] as const){
    const h=new LaneHud();for(const t of [0,350,700,1050])assert.equal(feed(h,t,p),'unknown');
    h.reset();track(h);assert.equal(feed(h,1000,p),'tracking');assert.equal(feed(h,1350,p),'tracking');assert.equal(feed(h,1700,p),side);
  }
});
test('short proximity jitter never becomes a warning; recovery has separate threshold/dwell',()=>{
  const h=new LaneHud();track(h);feed(h,1000,.15);feed(h,1350,.5);assert.equal(feed(h,1700,.15),'tracking');
  feed(h,2050,.15);assert.equal(feed(h,2400,.15),'left');
  for(const t of [2750,3100,3450])assert.equal(feed(h,t,.27),'left');
  assert.equal(feed(h,3800,.5),'left');assert.equal(feed(h,4150,.5),'left');assert.equal(feed(h,4500,.5),'tracking');
});
test('missing one lane, weak/nonfinite diagnostics, crossing and narrow geometry fail closed',()=>{
  const fixtures=[sample(1000),sample(1000),sample(1000),sample(1000),sample(1000)];
  fixtures[0].vector.lines.pop();fixtures[1].vector.diagnostics.paths.left!.confidence=.2;
  fixtures[2].vector.diagnostics.paths.left!.confidence=NaN;
  fixtures[3].vector.lines[0].points.forEach(p=>p.x=.9);
  fixtures[4].vector.lines[0].points.forEach(p=>p.x=.48);fixtures[4].vector.lines[1].points.forEach(p=>p.x=.52);
  for(const s of fixtures){const h=new LaneHud();track(h);assert.equal(lanePosition(s),null);h.observe(s,1000,1);assert.equal(h.view(s,1000,1),'unknown');}
});
test('stale, future, generation changes and gaps clear tracking and require reacquisition',()=>{
  for(const [t,g] of [[1101,1],[600,1],[700,2]]){const h=new LaneHud();track(h);assert.equal(h.view(sample(700),t,g),'unknown');assert.equal(feed(h,1200),'unknown');}
  const h=new LaneHud();track(h);assert.equal(feed(h,1500),'unknown');h.reset();assert.equal(feed(h,1850),'unknown');
});
test('opposite-side identity switch cannot jump directly from left to right warning',()=>{
  const h=new LaneHud();track(h);feed(h,1000,.15);feed(h,1350,.15);assert.equal(feed(h,1700,.15),'left');
  assert.equal(feed(h,2050,.85),'unknown');
});
