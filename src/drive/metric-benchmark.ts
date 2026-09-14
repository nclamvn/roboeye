import {percentile} from './benchmark';
export interface MetricObservation {id:string;estimateM:number|null;ageMs:number}
export interface MetricReference {id:string;distanceM:number}
export function parseMetricReferences(input:unknown):MetricReference[] {
  const value=input as {distanceKind?:unknown;samples?:unknown};
  if(!value||value.distanceKind!=='optical-axis-z'||!Array.isArray(value.samples)||!value.samples.length||value.samples.length>5000)
    throw Error('Đối chứng cần distanceKind=optical-axis-z và samples 1–5000.');
  const ids=new Set<string>();
  return value.samples.map(r=>{
    if(!r||typeof r.id!=='string'||!r.id||r.id.length>200||ids.has(r.id)||!Number.isFinite(r.distanceM)||r.distanceM<=0||r.distanceM>500)
      throw Error('Đối chứng sai hoặc trùng id/khoảng cách.');
    ids.add(r.id);return {id:r.id,distanceM:r.distanceM};
  });
}
export function evaluateMetric(observations:MetricObservation[],refs:MetricReference[],maxAgeMs=200) {
  if(!Number.isFinite(maxAgeMs)||maxAgeMs<0)throw Error('Sai giới hạn tuổi dữ liệu.');
  if(refs.length)parseMetricReferences({distanceKind:'optical-axis-z',samples:refs});
  const lookup=new Map<string,MetricObservation>();
  for(const o of observations){if(lookup.has(o.id))throw Error('Trùng ID quan sát.');lookup.set(o.id,o);}
  const errors:number[]=[],relative:number[]=[],bins=[5,10,20,30,50].slice(0,-1).map((min,i)=>({min,max:[10,20,30,50][i],references:0,errors:[] as number[]}));
  for(const r of refs){const b=bins.find(b=>r.distanceM>=b.min&&r.distanceM<b.max);if(b)b.references++;
    const o=lookup.get(r.id);if(!o||o.estimateM===null||!Number.isFinite(o.estimateM)||o.estimateM<=0||!Number.isFinite(o.ageMs)||o.ageMs<0||o.ageMs>maxAgeMs)continue;
    const e=o.estimateM-r.distanceM;errors.push(e);relative.push(Math.abs(e)/r.distanceM);b?.errors.push(e);
  }
  const mean=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
  return {distanceKind:'optical-axis-z',alignment:'none',referenceCount:refs.length,matched:errors.length,
    coverage:refs.length?errors.length/refs.length:null,maeM:mean(errors.map(Math.abs)),biasM:mean(errors),
    p95AbsoluteErrorM:percentile(errors.map(Math.abs),.95),p95RelativeError:percentile(relative,.95),
    ageP95Ms:percentile(observations.map(o=>o.ageMs).filter(x=>Number.isFinite(x)&&x>=0),.95),
    bins:bins.map(b=>({minM:b.min,maxExclusiveM:b.max,references:b.references,matched:b.errors.length,maeM:mean(b.errors.map(Math.abs))})),
    note:'Không alignment/fit bằng đáp án. Đối chứng phải độc lập, cùng nguồn/điểm/timestamp. Chưa chứng nhận an toàn.'};
}
