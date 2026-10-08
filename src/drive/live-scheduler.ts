/** The caller enforces one in-flight snapshot. Cadence is a workload budget,
 * not a TTL or a phone throughput promise. CPU depth still yields to detection. */
const pick=(values:readonly number[],q:number,fallback:number)=>{
  const sorted=values.slice(-24).filter(n=>Number.isFinite(n)&&n>=0&&n<=15000).sort((a,b)=>a-b);
  return sorted.length?sorted[Math.ceil(sorted.length*q)-1]:fallback;
};
export function liveMetricPlan(detector:readonly number[],detectorBackend:string,metricBackend:string,depth:readonly number[]=[],joined:readonly number[]=[]) {
  const detectorP50=pick(detector,.5,250),depthP50=pick(depth,.5,250),work=Math.max(detectorP50,depthP50);
  const bothCpu=detectorBackend==='wasm'&&metricBackend==='wasm',someCpu=detectorBackend==='wasm'||metricBackend==='wasm';
  const intervalMs=bothCpu?Math.max(1000,Math.min(2500,2*work)):someCpu?Math.max(600,Math.min(1800,1.25*work)):Math.max(250,Math.min(1200,.85*work));
  const terminalAgeP95Ms=joined.length?pick(joined,.95,0):null;
  return {policy:'measured-workload-v2',intervalMs,detectorP50Ms:detectorP50,depthP50Ms:depthP50,terminalAgeP95Ms,
    targetAdmissionMs:300,targetAnchorHz:3,deadlineFeasible:terminalAgeP95Ms===null?null:terminalAgeP95Ms<=1200,
    targetLatencyMet:terminalAgeP95Ms===null?null:terminalAgeP95Ms<=300,
    note:'Runtime budget only; actual cadence, coverage and device acceptance are measured separately.'};
}
export function liveMetricIntervalMs(detector:readonly number[],detectorBackend:string,metricBackend:string,depth:readonly number[]=[],joined:readonly number[]=[]) {
  return liveMetricPlan(detector,detectorBackend,metricBackend,depth,joined).intervalMs;
}
/** Avoid phase aliasing: depth finishing a few ms after detection otherwise
 * misses the next shared capture and must wait an entire detector inference.
 * Only dual GPU and a learned completion estimate qualify; never hold >80 ms,
 * never wait for a slow/hung depth worker, never back-date a capture. */
export function liveMetricAlignmentWaitMs(now:number,pendingCapture:number,holdStarted:number|null,depth:readonly number[],detectorBackend:string,metricBackend:string) {
  if(detectorBackend!=='webgpu'||metricBackend!=='webgpu'||depth.length<3||!Number.isFinite(now+pendingCapture)||now<pendingCapture)return 0;
  if(holdStarted!==null&&now-holdStarted>=80)return 0;
  const remaining=pendingCapture+pick(depth,.5,0)-now;
  return remaining>0&&remaining<=80?Math.min(remaining,80-(holdStarted===null?0:now-holdStarted)):0;
}
