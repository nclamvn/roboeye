import * as ort from 'onnxruntime-web/webgpu';
import type {DetectionMainToWorker,DetectionWorkerToMain,DetBox} from '../detection-types';
import {DRIVE_GPU_DETECTOR,DRIVE_CLASS_LABELS,detectorRgbPlanes} from '../drive/detector-contract';
import {decodeFocal} from '../drive/detector-decode';
import {postprocessDetections,RTDETR_POSTPROCESS} from '../detection-postprocess';

const base=new URL(import.meta.env.BASE_URL,self.location.href).href;
ort.env.wasm.wasmPaths=`${base}ort/`;ort.env.wasm.numThreads=1;
let session:ort.InferenceSession|null=null,busy=false;
const post=(message:DetectionWorkerToMain)=>self.postMessage(message);
const inputCanvas=new OffscreenCanvas(1,1),resized=new OffscreenCanvas(640,640);
const inputCtx=inputCanvas.getContext('2d')!,resizeCtx=resized.getContext('2d',{willReadFrequently:true})!;
async function run(rgb:Float32Array){
  if(!session)throw Error('Detector GPU chưa sẵn sàng.');
  const input=new ort.Tensor('float32',rgb,[1,3,640,640]);let outputs:ort.InferenceSession.OnnxValueMapType|undefined;
  try{
    outputs=await session.run({pixel_values:input});
    const logits=outputs.logits,pred_boxes=outputs.pred_boxes;
    if(logits.type!=='float32'||pred_boxes.type!=='float32'||logits.dims.join(',')!=='1,300,80'||pred_boxes.dims.join(',')!=='1,300,4')throw Error('RT-DETR output lệch contract.');
    return decodeFocal({logits:{dims:logits.dims,data:logits.data as Float32Array},pred_boxes:{dims:pred_boxes.dims,data:pred_boxes.data as Float32Array}},.15)[0];
  }finally{if(outputs)for(const tensor of Object.values(outputs))tensor.dispose();input.dispose();}
}
self.onmessage=async({data:m}:MessageEvent<DetectionMainToWorker>)=>{
  if(busy){post({type:'error',stage:'infer',message:'Detector GPU đang bận.'});return;}
  busy=true;
  try{
    if(m.type==='init'){
      if(session||m.engine!=='rtdetr'||m.profile!=='drive'||m.forceWasm)throw Error('Sai contract detector GPU DriveSense.');
      post({type:'loading',engine:'rtdetr'});
      const response=await fetch(`${base}models/drive-detector/${DRIVE_GPU_DETECTOR.file}`,{credentials:'omit'});
      if(!response.ok)throw Error('Thiếu graph GPU: chạy npm run fixtures:drive-detector.');
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength!==DRIVE_GPU_DETECTOR.bytes)throw Error('Graph detector GPU sai kích thước.');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
      if(hash!==DRIVE_GPU_DETECTOR.sha256)throw Error('Graph detector GPU sai SHA-256.');
      session=await ort.InferenceSession.create(bytes,{executionProviders:['webgpu'],graphOptimizationLevel:'all'});
      if(session.inputNames.join(',')!=='pixel_values'||session.outputNames.join(',')!=='logits,pred_boxes')throw Error('Detector GPU sai input/output.');
      await run(new Float32Array(3*640*640));
      post({type:'ready',engine:'rtdetr',device:'webgpu'});
    }else if(m.type==='frame'){
      if(!session)throw Error('Detector GPU chưa tải.');
      const start=performance.now(),{width,height}=m;
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||m.rgba.byteLength!==width*height*4)throw Error('Frame detector GPU không hợp lệ.');
      if(inputCanvas.width!==width)inputCanvas.width=width;if(inputCanvas.height!==height)inputCanvas.height=height;
      inputCtx.putImageData(new ImageData(new Uint8ClampedArray(m.rgba),width,height),0,0);
      resizeCtx.drawImage(inputCanvas,0,0,640,640);
      const decoded=await run(detectorRgbPlanes(resizeCtx.getImageData(0,0,640,640).data));
      const boxes:DetBox[]=decoded.boxes.flatMap(([x0,y0,x1,y1],i)=>{
        const label=DRIVE_CLASS_LABELS[decoded.classes[i]];return label?[{label,score:decoded.scores[i],x0,y0,x1,y1}]:[];
      });
      post({type:'det',capturedAt:m.capturedAt,detMs:performance.now()-start,boxes:postprocessDetections(boxes,RTDETR_POSTPROCESS)});
    }else throw Error('Thông điệp không hỗ trợ bởi detector DriveSense.');
  }catch(error){post({type:'error',stage:m.type==='init'?'load':'infer',message:`Detector GPU: ${error instanceof Error?error.message:String(error)}`});}
  finally{busy=false;}
};
