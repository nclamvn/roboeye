/** Keep the detector as the primary realtime workload. When both models fall
 * back to WASM (notably mobile Safari), running depth every 500 ms makes the
 * two workers contend for the same CPU and destabilises tracking. The cadence
 * follows measured detector latency and remains bounded for eventual refresh. */
export function liveMetricIntervalMs(detectorLatencies:readonly number[],detectorBackend:string,metricBackend:string):number {
  const recent=detectorLatencies.slice(-24).filter(value=>Number.isFinite(value)&&value>=0&&value<=5000).sort((a,b)=>a-b);
  const p50=recent.length?recent[Math.ceil(recent.length*.5)-1]:250;
  if(detectorBackend==='wasm'&&metricBackend==='wasm')return Math.max(1200,Math.min(2500,2.4*p50));
  if(detectorBackend==='wasm'||metricBackend==='wasm')return Math.max(800,Math.min(1800,1.8*p50));
  return Math.max(500,Math.min(1200,1.25*p50));
}
