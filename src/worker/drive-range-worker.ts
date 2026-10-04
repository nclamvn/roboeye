import * as ort from 'onnxruntime-web/webgpu';
import {DA2_DRIVE,decodeDa2DriveMetric} from '../drive/metric-contract';
import {fetchVerifiedModelArtifact} from '../drive/model-artifact';
import {driveBackend} from '../drive/backend';

const base=new URL(import.meta.env.BASE_URL,self.location.href).href;
ort.env.wasm.wasmPaths=`${base}ort/`;ort.env.wasm.numThreads=1;
let session:ort.InferenceSession|null=null,busy=false;
const post=(message:Record<string,unknown>,transfer:Transferable[]=[])=>self.postMessage({channel:'drive-range-v1',...message},{transfer});

self.onmessage=async({data:m})=>{
  if(busy){post({type:'error',id:m.id,stage:'infer',message:'Metric worker đang bận.'});return;}
  busy=true;
  try{
    if(m.type==='init'){
      if(session)throw Error('Metric worker đã khởi tạo.');
      if(!['webgpu','wasm'].includes(m.backend))throw Error('Metric backend không hợp lệ.');
      const requestedBackend=await driveBackend(m.backend==='wasm',navigator);
      post({type:'status',message:'Đang kiểm model khoảng cách…'});
      let lastProgress=-1;
      const artifact=await fetchVerifiedModelArtifact(base,'drive-metric',DA2_DRIVE,fetch,(loaded,total)=>{
        const progress=Math.floor(100*loaded/total);if(progress!==lastProgress){lastProgress=progress;post({type:'status',message:`Tải khoảng cách ${progress}% · ${requestedBackend}`});}
      });
      post({type:'status',message:artifact.source==='same-origin'?'Đang mở model khoảng cách local…':'Đang mở model khoảng cách release…'});
      session=await ort.InferenceSession.create(artifact.bytes,{executionProviders:[requestedBackend],graphOptimizationLevel:'all'});
      if(session.inputNames.join(',')!=='image'||session.outputNames.join(',')!=='depth_metres')throw Error('Sai contract input/output metric.');
      post({type:'status',message:'Đang warm-up khoảng cách AI…'});
      const warmStart=performance.now(),warmInput=new ort.Tensor('float32',new Float32Array(3*DA2_DRIVE.width*DA2_DRIVE.height),[1,3,DA2_DRIVE.height,DA2_DRIVE.width]);
      let warmOutput:ort.Tensor|undefined;try{warmOutput=(await session.run({image:warmInput})).depth_metres;}finally{warmOutput?.dispose();warmInput.dispose();}
      post({type:'ready',backend:requestedBackend,warmupMs:performance.now()-warmStart,model:DA2_DRIVE});
    }else if(m.type==='frame'){
      if(!session)throw Error('Metric model chưa sẵn sàng.');
      const {width,height}=m;if(width!==DA2_DRIVE.width||height!==DA2_DRIVE.height)throw Error('Sai shape metric frame.');
      const rgba=new Uint8ClampedArray(m.rgba);if(rgba.length!==width*height*4)throw Error('Sai RGBA metric frame.');
      const start=performance.now(),plane=width*height,rgb=new Float32Array(plane*3);
      for(let i=0,j=0;i<plane;i++,j+=4){rgb[i]=rgba[j]/255;rgb[plane+i]=rgba[j+1]/255;rgb[2*plane+i]=rgba[j+2]/255;}
      const input=new ort.Tensor('float32',rgb,[1,3,height,width]);let output:ort.Tensor|undefined;
      try{
        const result=await session.run({image:input});output=result.depth_metres;
        if(output.type!=='float32'||output.dims.join(',')!==`1,${height},${width}`)throw Error('Sai output metric.');
        const map=decodeDa2DriveMetric(output.data as Float32Array,width,height);
        post({type:'result',id:m.id,map,latencyMs:performance.now()-start},[map.depth.buffer]);
      }finally{output?.dispose();input.dispose();}
    }else throw Error('Thông điệp metric không hợp lệ.');
  }catch(error){post({type:'error',id:m.id,stage:m.type==='init'?'load':'infer',message:error instanceof Error?error.message:String(error)});}
  finally{busy=false;}
};
