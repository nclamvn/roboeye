import * as ort from 'onnxruntime-web-mobile/webgpu';
import {DRIVE_LITE_DETECTOR,decodeLite,liteBgr,type DriveWorkerMessage} from '../drive/lite-detector';
import {fetchVerifiedModelArtifact} from '../drive/model-artifact';
import {driveBackend} from '../drive/backend';
const base=new URL(import.meta.env.BASE_URL,self.location.href).href;
ort.env.wasm.wasmPaths=`${base}ort/mobile/`;ort.env.wasm.numThreads=1;
const canvas=new OffscreenCanvas(416,416),ctx=canvas.getContext('2d',{willReadFrequently:true})!;
let input:OffscreenCanvas|null=null,session:ort.InferenceSession|null=null,tensor:ort.Tensor|null=null,busy=false;
const planes=new Float32Array(3*416*416);
const post=(message:DriveWorkerMessage)=>self.postMessage(message);
self.onmessage=async({data:m})=>{
  if(busy){post({type:'error',stage:'infer',message:'Nano worker busy'});return;}busy=true;
  try{
    if(m.type==='init'){
      if(session)throw Error('Nano worker already initialised');
      const device=await driveBackend(!!m.forceWasm,navigator);
      const artifact=await fetchVerifiedModelArtifact(base,'drive-detector',DRIVE_LITE_DETECTOR,fetch,(loaded,total)=>post({type:'progress',file:DRIVE_LITE_DETECTOR.file,loaded,total,progress:100*loaded/total}));
      session=await ort.InferenceSession.create(artifact.bytes,{executionProviders:[device],graphOptimizationLevel:'all'});
      if(session.inputNames.join(',')!=='images'||session.outputNames.join(',')!=='output')throw Error('Nano graph names mismatch');
      tensor=new ort.Tensor('float32',planes,[1,3,416,416]);
      const warm=await session.run({images:tensor});try{decodeLite(warm.output.data as Float32Array,warm.output.dims,416,416);}finally{Object.values(warm).forEach(t=>t.dispose());}
      post({type:'ready',engine:'yolox',device});
    }else if(m.type==='frame'){
      if(!session||!tensor)throw Error('Nano not ready');const start=performance.now(),{width,height}=m;
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||m.rgba.byteLength!==width*height*4)throw Error('Nano frame mismatch');
      if(!input||input.width!==width||input.height!==height)input=new OffscreenCanvas(width,height);
      input.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(m.rgba),width,height),0,0);
      const ratio=Math.min(416/width,416/height);ctx.fillStyle='rgb(114,114,114)';ctx.fillRect(0,0,416,416);ctx.drawImage(input,0,0,Math.floor(width*ratio),Math.floor(height*ratio));
      liteBgr(ctx.getImageData(0,0,416,416).data,planes);const outputs=await session.run({images:tensor});
      try{if(outputs.output.type!=='float32')throw Error('Nano output dtype mismatch');post({type:'det',capturedAt:m.capturedAt,detMs:performance.now()-start,boxes:decodeLite(outputs.output.data as Float32Array,outputs.output.dims,width,height)});}finally{Object.values(outputs).forEach(t=>t.dispose());}
    }else throw Error('Unknown Nano message');
  }catch(error){post({type:'error',stage:m.type==='init'?'load':'infer',message:`Nano: ${error instanceof Error?error.message:String(error)}`});}
  finally{busy=false;}
};
