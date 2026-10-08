import * as ort from 'onnxruntime-web/webgpu';
import {DA2_DRIVE,DA2_DRIVE_PORTRAIT,decodeDa2DriveMetric,type Da2DriveContract} from '../drive/metric-contract';
import {fetchVerifiedModelArtifact} from '../drive/model-artifact';
import {driveBackend} from '../drive/backend';
import {MetricInputBuffer} from '../drive/metric-input';

const base=new URL(import.meta.env.BASE_URL,self.location.href).href;
ort.env.wasm.wasmPaths=`${base}ort/`;ort.env.wasm.numThreads=1;
let session:ort.InferenceSession|null=null,busy=false;
let contract:Da2DriveContract=DA2_DRIVE;
let inputBuffer:MetricInputBuffer|null=null,inputTensor:ort.Tensor|null=null;
const post=(message:Record<string,unknown>,transfer:Transferable[]=[])=>self.postMessage({channel:'drive-range-v1',...message},{transfer});

self.onmessage=async({data:m})=>{
  if(busy){post({type:'error',id:m.id,stage:'infer',message:'Metric worker đang bận.'});return;}
  busy=true;
  try{
    if(m.type==='init'){
      if(session)throw Error('Metric worker đã khởi tạo.');
      if(m.orientation!==undefined&&!['landscape','portrait'].includes(m.orientation))throw Error('Metric orientation không hợp lệ.');
      contract=m.orientation==='portrait'?DA2_DRIVE_PORTRAIT:DA2_DRIVE;
      if(!['webgpu','wasm'].includes(m.backend))throw Error('Metric backend không hợp lệ.');
      const requestedBackend=await driveBackend(m.backend==='wasm',navigator);
      post({type:'status',message:'Đang kiểm model khoảng cách…'});
      let lastProgress=-1;
      const artifact=await fetchVerifiedModelArtifact(base,'drive-metric',contract,fetch,(loaded,total)=>{
        const progress=Math.floor(100*loaded/total);if(progress!==lastProgress){lastProgress=progress;post({type:'status',message:`Tải khoảng cách ${progress}% · ${requestedBackend}`});}
      });
      post({type:'status',message:artifact.source==='same-origin'?'Đang mở model khoảng cách local…':'Đang mở model khoảng cách release…'});
      const opened=await ort.InferenceSession.create(artifact.bytes,{executionProviders:[requestedBackend],graphOptimizationLevel:'all'});
      const storage=new MetricInputBuffer(contract.width,contract.height),tensor=new ort.Tensor('float32',storage.rgb,[1,3,contract.height,contract.width]);
      const warmStart=performance.now();let warmOutput:ort.Tensor|undefined;
      try{
        if(opened.inputNames.join(',')!=='image'||opened.outputNames.join(',')!=='depth_metres')throw Error('Sai contract input/output metric.');
        post({type:'status',message:'Đang warm-up khoảng cách AI…'});
        warmOutput=(await opened.run({image:tensor})).depth_metres;
        if(warmOutput.type!=='float32'||warmOutput.dims.join(',')!==`1,${contract.height},${contract.width}`)throw Error('Sai output metric warm-up.');
      }catch(error){tensor.dispose();await opened.release();throw error;}
      finally{warmOutput?.dispose();}
      session=opened;inputBuffer=storage;inputTensor=tensor;
      post({type:'ready',backend:requestedBackend,warmupMs:performance.now()-warmStart,model:contract,artifactSource:artifact.source});
    }else if(m.type==='frame'){
      if(!session||!inputBuffer||!inputTensor)throw Error('Metric model chưa sẵn sàng.');
      const {width,height}=m;if(width!==contract.width||height!==contract.height)throw Error('Sai shape metric frame.');
      const start=performance.now();inputBuffer.update(new Uint8ClampedArray(m.rgba),width,height);
      let output:ort.Tensor|undefined;
      try{
        const result=await session.run({image:inputTensor});output=result.depth_metres;
        if(output.type!=='float32'||output.dims.join(',')!==`1,${height},${width}`)throw Error('Sai output metric.');
        const map=decodeDa2DriveMetric(output.data as Float32Array,width,height,contract);
        post({type:'result',id:m.id,map,latencyMs:performance.now()-start},[map.depth.buffer]);
      }finally{output?.dispose();}
    }else throw Error('Thông điệp metric không hợp lệ.');
  }catch(error){post({type:'error',id:m.id,stage:m.type==='init'?'load':'infer',message:error instanceof Error?error.message:String(error)});}
  finally{busy=false;}
};
