// Local experiment only: this module is not an application entry or public model.
import * as ort from 'onnxruntime-web/webgpu';
import {MetricInputBuffer} from '../src/drive/metric-input';
ort.env.wasm.wasmPaths=new URL('/ort/',self.location.href).href;ort.env.wasm.numThreads=1;
let session:ort.InferenceSession|null=null,storage:MetricInputBuffer|null=null,tensor:ort.Tensor|null=null,busy=false;
self.onmessage=async({data:m})=>{
 if(busy){self.postMessage({type:'error',message:'busy'});return;}busy=true;
 try{
  if(m.type==='init'){
   const shape=m.orientation==='portrait'?'224x392':'392x224',width=m.orientation==='portrait'?224:392,height=m.orientation==='portrait'?392:224;
   const manifests=await(await fetch('/tests/.metric-cache/da2-fp16-candidates.json')).json(),pin=manifests.find((x:{shape:string})=>x.shape===shape);
   const bytes=await(await fetch(`/tests/.metric-cache/da2-outdoor-${shape}-fp16-candidate.onnx`)).arrayBuffer();
   const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(bytes.byteLength!==pin.bytes||sha!==pin.candidateSha256)throw Error('candidate pin mismatch');
   session=await ort.InferenceSession.create(bytes,{executionProviders:['webgpu'],graphOptimizationLevel:'all'});
   storage=new MetricInputBuffer(width,height);tensor=new ort.Tensor('float32',storage.rgb,[1,3,height,width]);
   const outputs=await session.run({image:tensor});for(const value of Object.values(outputs))value.dispose();
   self.postMessage({type:'ready',model:pin,backend:'webgpu'});
  }else{
   if(!session||!storage||!tensor)throw Error('uninitialized');
   const start=performance.now();storage.update(new Uint8ClampedArray(m.rgba),m.width,m.height);
   const outputs=await session.run({image:tensor}),output=outputs.depth_metres;
   try{
    if(output.type!=='float32'||output.dims.join(',')!==`1,${storage.height},${storage.width}`)throw Error('wrong candidate output');
    const depth=(output.data as Float32Array).slice();
    if(depth.some(x=>!Number.isFinite(x)||x<=0||x>80.001))throw Error('candidate domain failure');
    self.postMessage({type:'result',id:m.id,map:{depth},latencyMs:performance.now()-start},[depth.buffer]);
   }finally{for(const value of Object.values(outputs))value.dispose();}
  }
 }catch(error){self.postMessage({type:'error',message:String(error)});}finally{busy=false;}
};
