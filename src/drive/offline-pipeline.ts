const aborted=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('Đã hủy phân tích','AbortError');};
type Settled<T>={ok:true;value:T}|{ok:false;error:unknown};

/** Bounded two-stage pipeline. enrich MUST snapshot the current decoded frame
 * synchronously before returning its promise. Only then may produce seek the
 * next frame. At most one detector and one depth request; output stays ordered.
 * An immediate rejection handler avoids unhandled depth errors during decode.
 */
export async function runOfflinePipeline<T,R>(targets:readonly number[],signal:AbortSignal,
  produce:(target:number)=>Promise<T>,enrich:(sample:T)=>Promise<R>,commit:(result:R)=>void):Promise<void> {
  let previous:Promise<Settled<R>>|null=null;
  const flush=async()=>{
    if(!previous)return;const settled=await previous;previous=null;aborted(signal);
    if(!settled.ok)throw settled.error;commit(settled.value);
  };
  for(const target of targets){
    aborted(signal);
    const sample=await produce(target);aborted(signal);
    await flush();aborted(signal);
    previous=enrich(sample).then(value=>({ok:true,value}),error=>({ok:false,error}));
  }
  await flush();aborted(signal);
}
