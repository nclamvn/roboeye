import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {LiveMetricJoin,LIVE_METRIC_MAX_AGE_MS} from '../../src/drive/live-metric-join';
import {liveMetricIntervalMs,liveMetricAlignmentWaitMs} from '../../src/drive/live-scheduler';
import {VehicleTracker,RangeFilter} from '../../src/drive/tracking';
import {estimateLearnedVehicleRange,letterboxTransform,validateLearnedRanges,validatePublishedLearnedTracks} from '../../src/drive/learned-range';
import type {MetricMap} from '../../src/drive/metric-contract';
// Same timings/geometry as TIP-61R baseline, but feed measured depth/join timing
// into the new scheduler. Virtual time is not a phone or real-model benchmark.
const baseline=JSON.parse(await readFile('docs/evidence/tip61r/stationary-mechanisms.json','utf8'));
const box={label:'car',score:.99,x0:.3,y0:.3,x1:.7,y1:.8},width=1280,height=720,transform=letterboxTransform(width,height,392,224);
const map:MetricMap={width:392,height:224,depth:new Float32Array(392*224).fill(24),unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:null,shift:null,reprojectionRmse:null};
function experiment(config:{name:string;detectorMs:number;depthMs:number;backend:string}){
  const tracker=new VehicleTracker(),join=new LiveMetricJoin(),events:Array<{at:number;kind:string;id:number;t:number}>=[],det:number[]=[],dep:number[]=[],joint:number[]=[];
  let detectorPending=false,depthPending=false,lastDepth=-Infinity,id=0,attempts=0,accepted=0,stale=0,boxTime=0,rangeTime=0,holdStarted:number|null=null;
  for(let now=0;now<65000;now+=10){
    events.sort((a,b)=>a.at-b.at);
    while(events.length&&events[0].at<=now){
      const e=events.shift()!;
      if(e.kind==='detector'){
        detectorPending=false;det.push(now-e.t);if(now-e.t<=2500){tracker.observe([box],e.t,now,null,width,height,null,true,now-e.t);join.detection(e.id,[box],tracker.bindLearnedFrame([box],e.t));}
      }else{depthPending=false;dep.push(config.depthMs);join.depth(e.id,map,config.depthMs);}
      const joined=join.take(now,0,width,height);if(!joined)continue;
      joint.push(now-joined.wall);
      if(joined.reason!=='ready'){if(joined.reason==='stale')stale++;continue;}
      const f=joined.value,ranges=validateLearnedRanges(f.boxes,f.boxes.map(b=>estimateLearnedVehicleRange(f.map,b,f.transform)),1,height);
      if(tracker.enrichLearnedRanges(f.boxes,ranges,f.t,width,height,now,{trackIds:f.trackIds,capturedWall:f.wall}))accepted++;
    }
    const visible=validatePublishedLearnedTracks(tracker.snapshot(now,now),1,height);
    if(now>=5000){if(visible.length)boxTime+=10;if(visible.some(t=>t.range.distanceM!==null))rangeTime+=10;}
    if(!detectorPending){
      if(depthPending&&now-lastDepth>=liveMetricIntervalMs(det,config.backend,config.backend,dep,joint)&&liveMetricAlignmentWaitMs(now,lastDepth,holdStarted,dep,config.backend,config.backend)>0){holdStarted??=now;continue;}
      holdStarted=null;
      const capture={id:++id,epoch:0,t:now,wall:now,w:width,h:height,transform},interval=liveMetricIntervalMs(det,config.backend,config.backend,dep,joint);
      if(!depthPending&&!join.busy&&visible.some(t=>t.box.score>=.65)&&now-lastDepth>=interval){assert.ok(join.begin(capture));depthPending=true;lastDepth=now;attempts++;events.push({at:now+config.depthMs,kind:'depth',id,t:now});}
      detectorPending=true;events.push({at:now+config.detectorMs,kind:'detector',id,t:now});
    }
  }
  return {...config,metricMaxCaptureAgeMs:LIVE_METRIC_MAX_AGE_MS,boxCoverage:boxTime/60000,metreCoverage:rangeTime/60000,attempts,accepted,stale};
}
const results=baseline.results.map((config:any)=>({before:config,after:experiment(config)}));
for(const row of results){assert.equal(row.after.metricMaxCaptureAgeMs,row.before.metricMaxCaptureAgeMs);assert.ok(row.after.boxCoverage>=row.before.boxCoverage-.001);if(row.before.metreCoverage===0)assert.equal(row.after.metreCoverage,0);}
const short=new RangeFilter();short.update(26,2.6,0);assert.equal(short.update(64,6.4,1050),null);
await mkdir('docs/evidence/tip61d',{recursive:true});
await writeFile('docs/evidence/tip61d/stationary-before-after.json',JSON.stringify({pass:true,scope:'Virtual-time constant-depth mechanism tests, NOT measured mobile speed/coverage or physical accuracy. Original TIP-61R baseline file is unchanged.',results,filter:{beforeAcceptedM:64,afterAcceptedM:null,gapMs:1050}},null,2)+'\n');
console.table(results.map((r:any)=>({name:r.after.name,before:r.before.metreCoverage,after:r.after.metreCoverage,stale:r.after.stale})));
