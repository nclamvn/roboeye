import * as ort from 'onnxruntime-web/webgpu';
import {MOGE_SMALL,DA2_METRIC,decodeDa2Metric} from '../drive/metric-contract';
import {recoverMetric} from '../drive/moge-geometry';
const base=new URL(import.meta.env.BASE_URL,self.location.href).href;
// Keep the direct runtime and its binaries on exactly the same installed version.
ort.env.wasm.wasmPaths=`${base}ort/`;
ort.env.wasm.numThreads=1;
let session:ort.InferenceSession|null=null,busy=false;
let model:'moge'|'da2'='moge';
const post=(message:unknown,transfer:Transferable[]=[])=>self.postMessage(message,{transfer});
self.onmessage=async({data:m})=>{
  if(busy){post({type:'error',id:m.id,message:'Worker đang bận; không xếp hàng frame.'});return;}
  busy=true;
  try {
    if(m.type==='init'){
      if(session)throw Error('Phiên đã khởi tạo.');
      if(!['webgpu','wasm'].includes(m.backend))throw Error('Backend không hợp lệ.');
      if(!['moge','da2'].includes(m.model))throw Error('Model không hợp lệ.');
      model=m.model;const contract=model==='moge'?MOGE_SMALL:DA2_METRIC;
      post({type:'status',message:`Đang đọc và kiểm SHA-256 ${model}…`});
      if(import.meta.env.PROD)throw Error('Metric lab chưa được phê duyệt cho production.');
      const response=await fetch(`${base}tests/.metric-cache/${model==='moge'?'moge-small':'da2-metric'}.onnx`,{credentials:'omit'});
      if(!response.ok)throw Error('Chưa có model local. Chạy npm run fixtures:metric.');
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength!==contract.bytes)throw Error('Sai kích thước model.');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      if(hash!==contract.sha256)throw Error('Model không khớp SHA-256 đã khóa.');
      session=await ort.InferenceSession.create(bytes,{executionProviders:[m.backend],graphOptimizationLevel:'all'});
      // This pinned artifact names Exp(scale_head) `scale`, unlike current README's `metric_scale`.
      if(model==='moge'?(session.inputNames.join(',')!=='image,num_tokens'||session.outputNames.join(',')!=='points,normal,mask,scale'):
        (session.inputNames.join(',')!=='image'||session.outputNames.join(',')!=='depth_metres'))throw Error('Sai input/output contract.');
      post({type:'ready',backend:m.backend,model:contract});
    } else if(m.type==='frame'){
      if(!session)throw Error('Model chưa sẵn sàng.');
      const {width:w,height:h,tokens}=m;
      if(!Number.isInteger(w)||!Number.isInteger(h)||w<28||h<28||w*h>1024*1024||![196,400,800,1600].includes(tokens))throw Error('Kích thước/token budget không hợp lệ.');
      const start=performance.now(),pixels=new Float32Array(m.rgb);
      if(pixels.length!==3*w*h||pixels.some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('Sai RGB NCHW [0,1].');
      if(model==='da2'&&(w!==DA2_METRIC.width||h!==DA2_METRIC.height))throw Error('DA2 chỉ nhận tensor fixture cố định.');
      const feeds:Record<string,ort.Tensor>={image:new ort.Tensor('float32',pixels,[1,3,h,w])};
      if(model==='moge')feeds.num_tokens=new ort.Tensor('int64',BigInt64Array.of(BigInt(tokens)),[]);
      let outputs:ort.InferenceSession.ReturnType|undefined;
      try {
        outputs=await session.run(feeds);const computeMs=performance.now()-start;
        if(model==='da2'){
          const d=outputs.depth_metres;
          if(d.type!=='float32'||d.dims.join(',')!==`1,${h},${w}`)throw Error('Sai DA2 output.');
          const map=decodeDa2Metric(d.data as Float32Array,w,h);
          post({type:'result',id:m.id,map,computeMs,postMs:performance.now()-start-computeMs},[map.depth.buffer]);return;
        }
        const p=outputs.points,mask=outputs.mask,scale=outputs.scale;
        if(p.type!=='float32'||mask.type!=='float32'||scale.type!=='float32'||p.dims.length!==4||p.dims[0]!==1||p.dims[3]!==3||scale.size!==1)throw Error('Sai shape/type đầu ra.');
        const width=p.dims[2],height=p.dims[1],points=p.data as Float32Array,masks=mask.data as Float32Array;
        const map=recoverMetric(points,masks,width,height,Number(scale.data[0]));
        const postMs=performance.now()-start-computeMs;
        post({type:'result',id:m.id,map,computeMs,postMs},[map.depth.buffer]);
      } finally {if(outputs)for(const tensor of Object.values(outputs))tensor.dispose();for(const tensor of Object.values(feeds))tensor.dispose();}
    } else throw Error('Thông điệp không hợp lệ.');
  } catch(error){post({type:'error',id:m.id,message:error instanceof Error?error.message:String(error)});}
  finally {busy=false;}
};
