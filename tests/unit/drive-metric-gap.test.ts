import test from 'node:test';
import assert from 'node:assert/strict';
import {DiagnosticLedger} from '../../src/drive/diagnostic-ledger';
import {probeLearnedVehicleRange,letterboxTransform,mapBoxToMetric} from '../../src/drive/learned-range';
import {RangeFilter,VehicleTracker} from '../../src/drive/tracking';
import {liveMetricPlan,liveMetricAlignmentWaitMs} from '../../src/drive/live-scheduler';
import {selectDa2DriveContract,DA2_DRIVE,DA2_DRIVE_PORTRAIT,decodeDa2DriveMetric,type MetricMap} from '../../src/drive/metric-contract';
import type {MetricObjectDiagnostic} from '../../src/drive/metric-diagnostics';
const box={label:'car',score:.99,x0:.3,x1:.7,y0:.3,y1:.8};
const transform=letterboxTransform(1280,720,392,224);
const map=():MetricMap=>({width:392,height:224,depth:new Float32Array(392*224).fill(24),unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:null,shift:null,reprojectionRmse:null});
test('decoded portrait chooses a separate pinned graph and recovers usable spatial support without lowering the ROI gate',()=>{
  assert.equal(selectDa2DriveContract(720,1280),DA2_DRIVE_PORTRAIT);assert.equal(selectDa2DriveContract(1280,720),DA2_DRIVE);
  assert.throws(()=>selectDa2DriveContract(0,720));
  const portrait=DA2_DRIVE_PORTRAIT,values=new Float32Array(portrait.width*portrait.height).fill(24);
  assert.throws(()=>decodeDa2DriveMetric(values,224,392));
  const depth=decodeDa2DriveMetric(values,224,392,portrait),t=letterboxTransform(720,1280,224,392),medium={...box,x0:.4,x1:.45};
  assert.equal(probeLearnedVehicleRange(map(),medium,letterboxTransform(720,1280,392,224)).range.distanceM,null);
  assert.equal(probeLearnedVehicleRange(depth,medium,t).range.distanceM,24);
  assert.ok(t.contentWidth*t.contentHeight/(224*392)>.98);
});
test('ROI evidence explicitly distinguishes tiny, clipped, invalid shape, sparse and out-of-domain',()=>{
  assert.equal(probeLearnedVehicleRange(map(),{...box,x1:.31},transform).evidence.code,'tiny-roi');
  assert.equal(probeLearnedVehicleRange(map(),{...box,x0:0},transform).evidence.code,'clipped-box');
  assert.equal(probeLearnedVehicleRange(map(),box,letterboxTransform(720,1280,224,392)).evidence.code,'shape-mismatch');
  const sparse=map();sparse.depth.fill(NaN);assert.equal(probeLearnedVehicleRange(sparse,box,transform).evidence.code,'sparse-roi');
  const far=map();far.depth.fill(79);assert.equal(probeLearnedVehicleRange(far,box,transform).evidence.code,'out-of-domain');
});
test('connected support keeps a coherent surface, rejects minority centre occlusion and mixed depths',()=>{
  const good=probeLearnedVehicleRange(map(),box,transform);assert.equal(good.range.distanceM,24);assert.equal(good.evidence.supportFraction,1);
  const occluded=map(),roi=good.evidence.roi!;
  const cx=(roi[0]+roi[2])/2,cy=(roi[1]+roi[3])/2;
  for(let y=roi[1];y<=roi[3];y++)for(let x=roi[0];x<=roi[2];x++)if(Math.abs(x-cx)<(roi[2]-roi[0])*.23&&Math.abs(y-cy)<(roi[3]-roi[1])*.23)occluded.depth[y*392+x]=19;
  const probe=probeLearnedVehicleRange(occluded,box,transform);assert.equal(probe.range.distanceM,null);assert.equal(probe.evidence.code,'foreground-ambiguous');
  const mixed=map();for(let y=roi[1];y<=roi[3];y++)for(let x=roi[0];x<=roi[2];x++)mixed.depth[y*392+x]=x<cx?8:40;
  assert.equal(probeLearnedVehicleRange(mixed,box,transform).evidence.code,'mixed-depth');
});
test('1050 ms cadence no longer erases filter history; repeated outliers do not reset identity in tracker',()=>{
  const f=new RangeFilter();f.update(26,2.6,0);assert.equal(f.update(64,6.4,1050),null);assert.equal(f.lastReason,'temporal-outlier');
  assert.ok(f.update(26.1,2.6,1500));
  const t=new VehicleTracker(),range={...probeLearnedVehicleRange(map(),box,transform).range,distanceM:26,sigmaM:2.6};
  for(const at of [0,1050,1500]){
    t.observe([box],at,at,null,1280,720,null,true);const ids=t.bindLearnedFrame([box],at);
    const raw=at===0?range:{...range,distanceM:64,sigmaM:6.4};
    t.enrichLearnedRanges([box],[raw],at,1280,720,at,{trackIds:ids,capturedWall:at});
    assert.equal(t.snapshot(at,at)[0].range.distanceM,at===0?26:null);
  }
});
test('long gaps require two new observations; no single arbitrary reset or duplicate timestamp',()=>{
  const f=new RangeFilter();f.update(26,1,0);
  assert.equal(f.update(64,1,3000),null);assert.equal(f.lastReason,'temporal-reacquiring');
  assert.equal(f.update(10,1,3500),null);assert.equal(f.update(10.1,1,4000)?.z,10.1);
  assert.equal(f.update(10.1,1,4000),null);
});
test('bounded per-object reasons survive detail eviction and cannot reverse a terminal attempt',()=>{
  const l=new DiagnosticLedger(),probe=probeLearnedVehicleRange(map(),box,transform).evidence;
  const row:MetricObjectDiagnostic={index:0,trackId:1,label:'car',score:.99,box:[.3,.3,.7,.8],probe,rawM:24,policyM:24,filteredM:null,publishedM:null,terminalStage:'filter',code:'temporal-outlier'};
  for(let id=1;id<=200;id++){
    assert.ok(l.begin('metric',id,0,id));
    assert.ok(l.metricContext(id,{sourceWidth:1280,sourceHeight:720,targetWidth:392,targetHeight:224,contentFraction:.984375,modelSha256:'a'.repeat(64),preparationMs:2,requestedIntervalMs:250}));
    assert.ok(l.metricObjects(id,[row]));assert.equal(l.metricObjects(id,[row]),false);l.finish('metric',id,'filter-rejected',id+1);
    assert.equal(l.metricObjects(id,[row]),false);
  }
  const r=l.report();assert.equal(r.objectTerminalReasons['temporal-outlier'],200);assert.equal(r.details.length,128);
  assert.equal(r.firstFailure?.objects?.[0].code,'temporal-outlier');assert.ok(JSON.stringify(r).length<200000);
  assert.equal(r.metric.balanced,true);
});
test('scheduler uses both workloads and exposes missed latency target rather than changing freshness',()=>{
  const plan=liveMetricPlan([616],'webgpu','webgpu',[647],[650,1400]);
  assert.equal(plan.intervalMs,.85*647);assert.equal(plan.deadlineFeasible,false);assert.equal(plan.targetLatencyMet,false);
  assert.ok(liveMetricPlan([100],'wasm','wasm',[1300]).intervalMs>=2500);
});
test('GPU phase alignment holds at most 80 ms and cannot stall detection for hung/CPU depth',()=>{
  assert.equal(liveMetricAlignmentWaitMs(616,0,null,[647,647,647],'webgpu','webgpu'),31);
  assert.equal(liveMetricAlignmentWaitMs(696,0,616,[750,750,750],'webgpu','webgpu'),0);
  assert.equal(liveMetricAlignmentWaitMs(616,0,null,[2000,2000,2000],'webgpu','webgpu'),0);
  assert.equal(liveMetricAlignmentWaitMs(616,0,null,[647,647,647],'wasm','webgpu'),0);
});
