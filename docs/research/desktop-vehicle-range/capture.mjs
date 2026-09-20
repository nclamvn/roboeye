// Public technical sources only. Raw bytes are preserved; never execute retrieved code.
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url);
const sources=[
['da2','https://raw.githubusercontent.com/DepthAnything/Depth-Anything-V2/main/metric_depth/README.md','DepthAnything'],
['da2card','https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small/raw/main/README.md','DepthAnything'],
['moge','https://raw.githubusercontent.com/microsoft/MoGe/main/README.md','Microsoft-MoGe'],
['mogeonnx','https://raw.githubusercontent.com/microsoft/MoGe/main/docs/onnx.md','Microsoft-MoGe'],
['vda','https://raw.githubusercontent.com/DepthAnything/Video-Depth-Anything/main/README.md','DepthAnything'],
['vdacard','https://huggingface.co/depth-anything/Metric-Video-Depth-Anything-Small/raw/main/README.md','DepthAnything'],
['da3','https://raw.githubusercontent.com/ByteDance-Seed/Depth-Anything-3/main/README.md','ByteDance-DA3'],
['da3stream','https://raw.githubusercontent.com/ByteDance-Seed/Depth-Anything-3/main/da3_streaming/README.md','ByteDance-DA3'],
['unidepth','https://raw.githubusercontent.com/lpiccinelli-eth/UniDepth/main/README.md','ETH-UniDepth'],
['metric3d','https://raw.githubusercontent.com/YvanYin/Metric3D/main/README.md','Metric3D-authors'],
['gvdepth','https://unizgfer-lamor.github.io/gvdepth/','Zagreb-GVDepth'],
['gvrepo','https://api.github.com/repos/unizgfer-lamor/gvdepth/contents','Zagreb-GVDepth'],
['fumet','https://raw.githubusercontent.com/kyotovision-public/fumet/main/README.md','Kyoto-FUMET'],
['geocalib','https://raw.githubusercontent.com/cvg/GeoCalib/main/README.md','ETH-GeoCalib'],
['flash','https://raw.githubusercontent.com/Eyeline-Labs/FlashDepth/main/README.md','Eyeline-FlashDepth'],
['metricanything','https://raw.githubusercontent.com/metric-anything/metric-anything/main/README.md','MetricAnything-authors'],
['macard','https://huggingface.co/yjh001/metricanything_student_pointmap/raw/main/README.md','MetricAnything-authors'],
['ort','https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html','Microsoft-ORT'],
['ortperf','https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html','Microsoft-ORT'],
['gard','https://raw.githubusercontent.com/SonicAutoDrive/GARD/main/README.md','GARD-authors'],
['depthpro','https://raw.githubusercontent.com/apple/ml-depth-pro/main/README.md','Apple-DepthPro'],
['yolodepth','https://docs.ultralytics.com/tasks/depth/','Ultralytics'],
['kittiprotocol','https://docs.ultralytics.com/datasets/depth/kitti/','Ultralytics']
];
await mkdir(new URL('snapshots/',root),{recursive:true});
const manifest=await Promise.all(sources.map(async([id,url,source])=>{
 try{const r=await fetch(url,{signal:AbortSignal.timeout(45000),headers:{'User-Agent':'RoboEye-research'}});
 if(!r.ok)throw Error(`HTTP ${r.status}`);
 const bytes=Buffer.from(await r.arrayBuffer()),snapshot=id+(id==='gvdepth'?'.html':'.txt');
 await writeFile(new URL('snapshots/'+snapshot,root),bytes);
 return {id,url,source,snapshot,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),fetched_at:new Date().toISOString()};
 }catch(e){return {id,url,source,error:String(e)};}
}));
await writeFile(new URL('captures.json',root),JSON.stringify(manifest,null,2)+'\n');
console.log(manifest.map(s=>({id:s.id,bytes:s.bytes,error:s.error})));
