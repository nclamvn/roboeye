import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {LiveMetricJoin,LIVE_METRIC_MAX_AGE_MS} from '../../src/drive/live-metric-join';
import {liveMetricIntervalMs} from '../../src/drive/live-scheduler';
import {VehicleTracker,RangeFilter} from '../../src/drive/tracking';
import {estimateLearnedVehicleRange,letterboxTransform,validateLearnedRanges,validatePublishedLearnedTracks} from '../../src/drive/learned-range';
import type {DetBox} from '../../src/detection-types';
import type {MetricMap} from '../../src/drive/metric-contract';

// Virtual-time mechanism experiment, not a browser or trained-model benchmark.
// Uses production join, ROI, tracker, publication guard and cadence functions.
const width=1280,height=720,transform=letterboxTransform(width,height,392,224);
const box:DetBox={label:'car',score:.99,x0:.3,y0:.3,x1:.7,y1:.8};
const map:MetricMap={width:392,height:224,depth:new Float32Array(392*224).fill(24),unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:null,shift:null,reprojectionRmse:null};
interface Config{name:string;detectorMs:number;depthMs:number;backend:'wasm'|'webgpu'}
function experiment(config:Config){
  const tracker=new VehicleTracker(),join=new LiveMetricJoin(),events:Array<{at:number;kind:'detector'|'depth';id:number;t:number;wall:number}>=[],latencies:number[]=[];
  let detectorPending=false,depthPending=false,lastDepth=-Infinity,id=0,attempts=0,accepted=0,stale=0,otherRejected=0,boxTime=0,rangeTime=0;
  const step=10,end=65_000,exclude=5000;
  function flush(now:number){
    const joined=join.take(now,0,width,height);if(!joined)return;
    if(joined.reason!=='ready'){if(joined.reason==='stale')stale++;else otherRejected++;return;}
    const f=joined.value,raw=f.boxes.map(b=>estimateLearnedVehicleRange(f.map,b,f.transform));
    const ranges=validateLearnedRanges(f.boxes,raw,1,height);
    const applied=tracker.enrichLearnedRanges(f.boxes,ranges,f.t,width,height,now,{trackIds:f.trackIds,capturedWall:f.wall});
    const snapshot=validatePublishedLearnedTracks(tracker.snapshot(now,now),1,height);
    if(applied&&snapshot.some(t=>f.trackIds.includes(t.id)&&t.range.distanceM!==null))accepted++;else otherRejected++;
  }
  for(let now=0;now<end;now+=step){
    events.sort((a,b)=>a.at-b.at);
    while(events.length&&events[0].at<=now){
      const event=events.shift()!;
      if(event.kind==='detector'){
        detectorPending=false;latencies.push(now-event.wall);
        if(now-event.wall<=2500){
          tracker.observe([box],event.t,now,null,width,height,null,true,now-event.wall);
          join.detection(event.id,[box],tracker.bindLearnedFrame([box],event.t));
        }
      }else{depthPending=false;join.depth(event.id,map,config.depthMs);}
      flush(now);
    }
    const visible=validatePublishedLearnedTracks(tracker.snapshot(now,now),1,height);
    if(now>=exclude){if(visible.length)boxTime+=step;if(visible.some(t=>t.range.distanceM!==null))rangeTime+=step;}
    if(!detectorPending){
      const capture={id:++id,epoch:0,t:now,wall:now,w:width,h:height,transform};
      const interval=liveMetricIntervalMs(latencies,config.backend,config.backend);
      if(!depthPending&&!join.busy&&visible.some(t=>t.box.score>=.65)&&now-lastDepth>=interval){
        assert.ok(join.begin(capture));depthPending=true;lastDepth=now;attempts++;
        events.push({at:now+config.depthMs,kind:'depth',id,t:now,wall:now});
      }
      detectorPending=true;events.push({at:now+config.detectorMs,kind:'detector',id,t:now,wall:now});
    }
  }
  return {...config,virtualSessionMs:end,excludeInitialMs:exclude,measurementWindowMs:end-exclude,
    metricMaxCaptureAgeMs:LIVE_METRIC_MAX_AGE_MS,steadyCadenceMs:liveMetricIntervalMs(latencies,config.backend,config.backend),
    boxCoverage:boxTime/(end-exclude),metreCoverage:rangeTime/(end-exclude),attempts,accepted,stale,otherRejected,
    pendingAtEnd:Number(depthPending),note:'Stationary synthetic car and constant valid 24m map. Timings are injected, not measured on iPhone.'};
}
const results=[
  {name:'fast-GPU-control',detectorMs:100,depthMs:100,backend:'webgpu'},
  {name:'WASM-600ms',detectorMs:600,depthMs:500,backend:'wasm'},
  {name:'WASM-1100ms',detectorMs:1100,depthMs:1000,backend:'wasm'},
  {name:'WASM-detector-1690ms',detectorMs:1690,depthMs:820,backend:'wasm'},
  {name:'WASM-depth-1690ms',detectorMs:300,depthMs:1690,backend:'wasm'},
  {name:'phone-P50-timing-only-control',detectorMs:616,depthMs:647,backend:'webgpu'},
].map(config=>experiment(config as Config));
assert.ok(results[0].metreCoverage>.95);
assert.ok(results[1].metreCoverage>.33&&results[1].metreCoverage<.35);
assert.ok(results[2].metreCoverage<.05);
for(const index of [3,4]){assert.ok(results[index].boxCoverage>.95);assert.equal(results[index].metreCoverage,0);assert.ok(results[index].stale>0);}
assert.ok(results[5].metreCoverage>.44&&results[5].metreCoverage<.47);

const left={...box,x0:.15,x1:.3,y0:.45,y1:.7},right={...box,x0:.6,x1:.75,y0:.44,y1:.69};
function mapWithBoxValues(boxes:DetBox[],values:number[]):MetricMap{
  const output={...map,depth:map.depth.slice()};
  boxes.forEach((b,i)=>{for(let y=0;y<224;y++)for(let x=0;x<392;x++){
    const sx=(x-transform.offsetX)/transform.contentWidth,sy=(y-transform.offsetY)/transform.contentHeight;
    if(sx>=b.x0&&sx<=b.x1&&sy>=b.y0&&sy<=b.y1)output.depth[y*392+x]=values[i];
  }});return output;
}
const boxes=[left,right],conflictMap=mapWithBoxValues(boxes,[30,28]);
const raw=boxes.map(b=>estimateLearnedVehicleRange(conflictMap,b,transform));
assert.deepEqual(raw.map(r=>r.distanceM),[30,28]);
const conflict=validateLearnedRanges(boxes,raw,1,height);assert.ok(conflict.every(r=>r?.distanceM===null));
const zoom=validateLearnedRanges([box],[estimateLearnedVehicleRange(map,box,transform)],2,height);assert.equal(zoom[0]?.distanceM,null);
const tiny=estimateLearnedVehicleRange(map,{...box,x0:.45,x1:.47,y0:.4,y1:.42},transform);assert.equal(tiny.distanceM,null);
const edge=estimateLearnedVehicleRange(map,{...box,x0:0},transform);assert.equal(edge.distanceM,null);
const portraitTransform=letterboxTransform(720,1280,392,224),mediumBox={...box,x0:.4,x1:.45};
const landscapeMedium=estimateLearnedVehicleRange(map,mediumBox,transform);
const portraitMedium=estimateLearnedVehicleRange(map,mediumBox,portraitTransform);
assert.ok(landscapeMedium.distanceM!==null);assert.equal(portraitMedium.distanceM,null);
const shortGap=new RangeFilter();shortGap.update(26,2.6,0);assert.equal(shortGap.update(64,6.4,500),null);
const longGap=new RangeFilter();longGap.update(26,2.6,0);const restarted=longGap.update(64,6.4,1050);assert.equal(restarted?.z,64);
const policyCases=[
  {name:'stationary-multi-car-inverted-depth',rawMetres:raw.map(r=>r.distanceM),publishedMetres:conflict.map(r=>r?.distanceM),reason:conflict[0]?.reason},
  {name:'zoom-2x',reason:zoom[0]?.reason},{name:'tiny-box',reason:tiny.reason},{name:'edge-box',reason:edge.reason},
  {name:'same-normalized-box-portrait-vs-landscape',boxWidthFraction:.05,landscapeMetres:landscapeMedium.distanceM,portraitMetres:portraitMedium.distanceM,
    portraitReason:portraitMedium.reason,portraitContent:[portraitTransform.contentWidth,portraitTransform.contentHeight],
    portraitContentFraction:portraitTransform.contentWidth*portraitTransform.contentHeight/(392*224),
    landscapeContentFraction:transform.contentWidth*transform.contentHeight/(392*224)},
  {name:'range-filter-gap-reset',previousMetres:26,newMetres:64,shortGapMs:500,shortGapRejected:true,longGapMs:1050,longGapAcceptedMetres:restarted?.z,
    scope:'Demonstrates production filter reinitialization after >800ms; does not prove owner vehicle distance/identity stayed constant.'}];
const output={pass:true,generatedAt:new Date().toISOString(),scope:'Virtual-time production-function mechanism reproduction; NOT real model, browser or iPhone performance/accuracy.',
  fixtures:{box,map:'constant synthetic 24m, 392x224',sourceSize:[width,height]},results,policyCases};
await mkdir('docs/evidence/tip61r',{recursive:true});await writeFile('docs/evidence/tip61r/stationary-mechanisms.json',JSON.stringify(output,null,2)+'\n');
console.table(results.map(r=>({name:r.name,detectorMs:r.detectorMs,depthMs:r.depthMs,cadenceMs:r.steadyCadenceMs,boxCoverage:r.boxCoverage,metreCoverage:r.metreCoverage,accepted:r.accepted,stale:r.stale})));
console.log('PASS 6 timing + 6 policy/source/filter scenarios; docs/evidence/tip61r/stationary-mechanisms.json');
