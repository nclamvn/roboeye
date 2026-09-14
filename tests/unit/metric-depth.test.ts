import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverMetric} from '../../src/drive/moge-geometry';
import {MetricFrameGate,probeMetric,assertMetricMap,decodeDa2Metric,decodeDa2DriveMetric,DA2_DRIVE} from '../../src/drive/metric-contract';
import {estimateLearnedVehicleRange,letterboxTransform,mapBoxToMetric} from '../../src/drive/learned-range';
import {evaluateMetric,parseMetricReferences} from '../../src/drive/metric-benchmark';
function fixture(w=64,h=48,focal=1.2,shift=.25,scale=8){
  const points=new Float32Array(w*h*3),mask=new Float32Array(w*h).fill(1),truth=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y*w+x,z=1.5+.5*Math.sin(x/8)+y/h;
    points[3*k]=((2*x+1-w)/Math.hypot(w,h))*z/focal;points[3*k+1]=((2*y+1-h)/Math.hypot(w,h))*z/focal;points[3*k+2]=z-shift;truth[k]=z*scale;}
  return {points,mask,truth,w,h,focal,shift,scale};
}
test('metric reconstruction matches independent analytic perspective for portrait/landscape/scale',()=>{
  for(const [w,h] of [[64,48],[48,64],[64,64]])for(const shift of [-.2,.25,.8]){
    const f=fixture(w,h,1.2,shift),m=recoverMetric(f.points,f.mask,w,h,f.scale);
    assert.ok(Math.abs(m.focal-f.focal)<1e-5);assert.ok(Math.abs(m.shift-shift)<1e-5);
    assert.ok(m.depth.every((z,i)=>Math.abs(z-f.truth[i])<1e-4));assert.equal(m.provenance,'learned-unverified');
  }
});
test('metric mask and bad output contracts fail closed',()=>{
  const f=fixture();f.mask[0]=0;const m=recoverMetric(f.points,f.mask,f.w,f.h,f.scale);assert.ok(Number.isNaN(m.depth[0]));
  assert.throws(()=>recoverMetric(f.points,f.mask,f.w,f.h,NaN));
  assert.throws(()=>recoverMetric(f.points,new Float32Array(1),f.w,f.h,1));
  assert.throws(()=>recoverMetric(f.points,new Float32Array(f.w*f.h),f.w,f.h,1));
  assert.throws(()=>recoverMetric(new Float32Array(f.points.length),new Float32Array(f.w*f.h).fill(1),f.w,f.h,1));
  assert.throws(()=>assertMetricMap({...m,depth:new Uint8Array(f.w*f.h)} as unknown as typeof m));
  assert.throws(()=>assertMetricMap({...m,unit:'relative'} as unknown as typeof m));
  assert.equal(probeMetric(m,-.1,.5),null);assert.ok(probeMetric(m,.5,.5)!>0);
});
test('single flight, epoch invalidation, wrong replies and expired results',()=>{
  const g=new MetricFrameGate(),first=g.begin(0,100)!;assert.ok(first);assert.equal(g.begin(1,101),null);
  assert.equal(g.finish(999,120,200),null);assert.equal(g.begin(2,130),null);
  g.reset();assert.equal(g.begin(2,140),null);assert.equal(g.finish(first.id,150,200),null);
  const second=g.begin(2,160)!;assert.equal(g.finish(second.id,361,200),null);
  const third=g.begin(3,400)!;assert.equal(g.finish(third.id,450,200)!.ageMs,50);
  assert.equal(g.begin(3,500),null);g.cancel();assert.ok(g.begin(3,500));
});
test('DA2 fixed metric contract rejects relative bytes, wrong shape and unbounded values',()=>{
  const values=new Float32Array(224*280).fill(12),map=decodeDa2Metric(values,224,280);assert.equal(probeMetric(map,.5,.5),12);assert.equal(map.focal,null);
  values[0]=81;assert.throws(()=>decodeDa2Metric(values,224,280));
  assert.throws(()=>decodeDa2Metric(new Uint8Array(224*280) as unknown as Float32Array,224,280));
  assert.throws(()=>decodeDa2Metric(new Float32Array(224*280),280,224));
});
test('landscape preprocessing letterboxes without distortion and maps source boxes',()=>{
  const t=letterboxTransform(1920,1080,392,224);assert.equal(t.scale,392/1920);assert.equal(t.offsetX,0);assert.ok(t.offsetY>1&&t.offsetY<2);
  assert.ok(Math.abs(t.contentWidth/t.contentHeight-16/9)<1e-12);
  const b=mapBoxToMetric({label:'car',score:.9,x0:0,y0:0,x1:1,y1:1},t);
  assert.equal(b.x0,0);assert.equal(b.x1,1);assert.ok(b.y0>0&&b.y1<1);
  assert.throws(()=>letterboxTransform(0,1080,392,224));
});
test('vehicle metric ROI returns robust learned Z and rejects tiny/noisy/sparse regions',()=>{
  const t=letterboxTransform(1280,720,DA2_DRIVE.width,DA2_DRIVE.height),box={label:'car',score:.9,x0:.25,y0:.35,x1:.75,y1:.8};
  const base={width:DA2_DRIVE.width,height:DA2_DRIVE.height,unit:'metres' as const,distanceKind:'optical-axis-z' as const,
    provenance:'learned-unverified' as const,focal:null,shift:null,reprojectionRmse:null};
  const good=estimateLearnedVehicleRange({...base,depth:new Float32Array(DA2_DRIVE.width*DA2_DRIVE.height).fill(17)},box,t);
  assert.equal(good.distanceM,17);assert.equal(good.kind,'learned_optical_axis_z_m');assert.equal(good.intervalCalibrated,false);
  const tiny=estimateLearnedVehicleRange({...base,depth:new Float32Array(DA2_DRIVE.width*DA2_DRIVE.height).fill(17)},
    {...box,x0:.5,x1:.505,y0:.5,y1:.51},t);assert.equal(tiny.distanceM,null);
  const noisy=new Float32Array(DA2_DRIVE.width*DA2_DRIVE.height);for(let i=0;i<noisy.length;i++)noisy[i]=i%2?2:70;
  assert.equal(estimateLearnedVehicleRange({...base,depth:noisy},box,t).distanceM,null);
  assert.throws(()=>decodeDa2DriveMetric(new Float32Array(224*392),224,392));
});
test('benchmark does not align scale, omit misses, or count stale/invalid estimates',()=>{
  const refs=parseMetricReferences({distanceKind:'optical-axis-z',samples:[{id:'a',distanceM:10},{id:'b',distanceM:20},{id:'c',distanceM:30}]});
  const result=evaluateMetric([{id:'a',estimateM:20,ageMs:100},{id:'b',estimateM:20,ageMs:201}],refs);
  assert.equal(result.coverage,1/3);assert.equal(result.maeM,10);assert.equal(result.biasM,10);assert.equal(result.alignment,'none');
  const empty=evaluateMetric([],[]);assert.equal(empty.coverage,null);assert.equal(empty.maeM,null);
  assert.throws(()=>parseMetricReferences({distanceKind:'bumper-gap',samples:refs}));
  assert.throws(()=>parseMetricReferences({distanceKind:'optical-axis-z',samples:[refs[0],refs[0]]}));
  assert.throws(()=>parseMetricReferences({distanceKind:'optical-axis-z',samples:[{id:'a',distanceM:NaN}]}));
  assert.throws(()=>evaluateMetric([{id:'a',estimateM:1,ageMs:1},{id:'a',estimateM:2,ageMs:2}],refs));
  assert.throws(()=>evaluateMetric([],[refs[0],refs[0]]));
});
