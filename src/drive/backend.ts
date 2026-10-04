/** Probe the actual worker surface, not user-agent guesses or presence alone. */
export async function driveBackend(forceWasm:boolean,surface:object):Promise<'webgpu'|'wasm'> {
  const gpu=(surface as {gpu?:{requestAdapter():Promise<unknown>}}).gpu;
  if(forceWasm||!gpu||typeof gpu.requestAdapter!=='function')return 'wasm';
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const adapter=await Promise.race([gpu.requestAdapter(),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),2000);})]);
    return adapter?'webgpu':'wasm';
  }catch{return 'wasm';}finally{if(timer!==undefined)clearTimeout(timer);}
}
