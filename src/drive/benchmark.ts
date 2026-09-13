export interface ReferenceSample {timeMs:number;trackId:number;distanceM:number}
export interface Observation {timeMs:number;trackId:number;distanceM:number|null;latencyMs:number;reason:string}
export function percentile(values:number[],p:number):number|null {
  if(!values.length)return null;const a=[...values].sort((a,b)=>a-b);return a[Math.max(0,Math.ceil(p*a.length)-1)];
}
export function parseReferences(value:unknown):ReferenceSample[] {
  if(!Array.isArray(value)||!value.length||value.length>100000)throw Error('Đối chứng cần array 1–100000 mẫu.');
  const keys=new Set<string>();
  return value.map(r=>{
    if(!r||![r.timeMs,r.trackId,r.distanceM].every(Number.isFinite)||r.timeMs<0||!Number.isInteger(r.trackId)||r.trackId<1||r.distanceM<=0||r.distanceM>500)throw Error('Mẫu đối chứng sai timeMs/trackId/distanceM.');
    const key=`${r.timeMs}:${r.trackId}`;if(keys.has(key))throw Error('Mẫu đối chứng trùng timestamp/ID.');keys.add(key);
    return {timeMs:r.timeMs,trackId:r.trackId,distanceM:r.distanceM};
  });
}
export function evaluate(observed:Observation[],refs:ReferenceSample[]) {
  // Per-track sorted times + disjoint-set neighbours avoid a full O(refs*frames)
  // scan and skip already matched measurements without quadratic splicing.
  const groups=new Map<number,{samples:Observation[];next:number[];prev:number[]}>();
  for(const o of observed){let g=groups.get(o.trackId);if(!g){g={samples:[],next:[],prev:[]};groups.set(o.trackId,g);}g.samples.push(o);}
  for(const g of groups.values()){g.samples.sort((a,b)=>a.timeMs-b.timeMs);g.next=Array.from({length:g.samples.length+1},(_,i)=>i);g.prev=[...g.next];}
  function find(parent:number[],index:number){let root=index;while(parent[root]!==root)root=parent[root];while(parent[index]!==index){const old=parent[index];parent[index]=root;index=old;}return root;}
  const errors:number[]=[];
  for(const r of refs) {
    const g=groups.get(r.trackId);if(!g)continue;const n=g.samples.length;
    let lo=0,hi=n;while(lo<hi){const mid=(lo+hi)>>>1;if(g.samples[mid].timeMs<r.timeMs)lo=mid+1;else hi=mid;}
    const right=find(g.next,lo),left=n-1-find(g.prev,n-lo);
    let best=-1,dt=80;
    for(const i of [left,right])if(i>=0&&i<n){const delta=Math.abs(g.samples[i].timeMs-r.timeMs);if(delta<=dt){best=i;dt=delta;}}
    if(best<0)continue;
    g.next[best]=find(g.next,best+1);g.prev[n-1-best]=find(g.prev,n-best);
    const d=g.samples[best].distanceM;if(d!==null)errors.push(d-r.distanceM);
  }
  return {referenceCount:refs.length,matchedMeasurements:errors.length,
    coverage:refs.length?errors.length/refs.length:null,
    maeM:errors.length?errors.reduce((a,e)=>a+Math.abs(e),0)/errors.length:null,
    biasM:errors.length?errors.reduce((a,e)=>a+e,0)/errors.length:null,
    p95AbsoluteErrorM:percentile(errors.map(Math.abs),.95),
    captureToResultP95Ms:percentile(observed.map(o=>o.latencyMs).filter(Number.isFinite),.95),
    note:'Đối chứng phải độc lập, đúng ID/timestamp và khoảng cách tới điểm đất, không tâm hộp/cản xe. Không chứng nhận an toàn.'};
}
