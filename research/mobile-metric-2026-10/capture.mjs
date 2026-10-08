import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url);
// Primary upstream docs/code only. Download no weights; never execute fetched code.
const sources=[
 ['ort-web','https://raw.githubusercontent.com/microsoft/onnxruntime/main/js/web/README.md','Microsoft-ONNXRuntime'],
 ['ort-env','https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html','Microsoft-ONNXRuntime'],
 ['ort-gpu','https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html','Microsoft-ONNXRuntime'],
 ['ort-license','https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE','Microsoft-ONNXRuntime'],
 ['ort-native-design','https://raw.githubusercontent.com/microsoft/onnxruntime/main/docs/design/onnxruntime_web_remove_webgl_backend.md','Microsoft-ONNXRuntime'],
 ['ort-jsep-issue','https://api.github.com/repos/microsoft/onnxruntime/issues/26827','theopolis-first-hand-issue-report'],
 ['ort-jsep-comments','https://api.github.com/repos/microsoft/onnxruntime/issues/26827/comments','ONNXRuntime-issue-discussion'],
 ['ort-coreml','https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html','Microsoft-ONNXRuntime'],
 ['da2','https://raw.githubusercontent.com/DepthAnything/Depth-Anything-V2/main/README.md','DepthAnything-authors'],
 ['da2-metric','https://raw.githubusercontent.com/DepthAnything/Depth-Anything-V2/main/metric_depth/README.md','DepthAnything-authors'],
 ['da2-card','https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf/raw/main/README.md','DepthAnything-model-publisher'],
 ['zipdepth','https://raw.githubusercontent.com/fabiotosi92/ZipDepth/main/README.md','ZipDepth-authors'],
 ['zipdepth-license','https://raw.githubusercontent.com/fabiotosi92/ZipDepth/main/LICENSE','ZipDepth-authors'],
 ['litemono','https://raw.githubusercontent.com/noahzn/Lite-Mono/main/README.md','LiteMono-authors'],
 ['litemono-eval','https://raw.githubusercontent.com/noahzn/Lite-Mono/main/evaluate_depth.py','LiteMono-authors'],
 ['fastdepth','https://raw.githubusercontent.com/dwofk/fast-depth/master/README.md','FastDepth-authors'],
 ['fastdepth-license','https://raw.githubusercontent.com/dwofk/fast-depth/master/LICENSE','FastDepth-authors'],
 ['depthpro','https://raw.githubusercontent.com/apple-aiml-research/ml-depth-pro/main/README.md','Apple-DepthPro'],
 ['depthpro-license','https://raw.githubusercontent.com/apple-aiml-research/ml-depth-pro/main/LICENSE','Apple-DepthPro'],
 ['da3','https://raw.githubusercontent.com/ByteDance-Seed/Depth-Anything-3/main/README.md','ByteDance-DepthAnything3'],
 ['moge2','https://raw.githubusercontent.com/microsoft/MoGe/main/README.md','Microsoft-MoGe'],
 ['moge2-card','https://huggingface.co/Ruicheng/moge-2-vits-normal/raw/main/README.md','MoGe2-model-publisher'],
 ['moge2-license','https://raw.githubusercontent.com/microsoft/MoGe/main/LICENSE','Microsoft-MoGe'],
 ['opencv-calibration','https://raw.githubusercontent.com/opencv/opencv/4.x/doc/py_tutorials/py_calib3d/py_calibration/py_calibration.markdown','OpenCV'],
 ['opencv-flow','https://raw.githubusercontent.com/opencv/opencv/4.x/doc/tutorials/others/optical_flow.markdown','OpenCV'],
 ['coreml','https://developer.apple.com/machine-learning/models/','Apple'],
 ['coreml-compute','https://developer.apple.com/tutorials/data/documentation/coreml/mlcomputeunits.json','Apple'],
];
await mkdir(new URL('snapshots/',root),{recursive:true});
const selected=new Set(process.argv.slice(2));
const prior=JSON.parse(await readFile(new URL('captures.json',root),'utf8').catch(()=>'[]'));
const captures=prior.filter(c=>selected.size&&!selected.has(c.id)),requested=selected.size?sources.filter(s=>selected.has(s[0])):sources;let next=0;
await Promise.all(Array.from({length:2},async()=>{while(next<requested.length){
 const [id,url,source]=requested[next++];
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error(`HTTP ${r.status}`);const bytes=Buffer.from(await r.arrayBuffer());
  if(bytes.length>4_000_000)throw Error('snapshot exceeds research bound');
  const snapshot=`${id}.${r.headers.get('content-type')?.includes('text/html')?'html':'txt'}`;await writeFile(new URL(`snapshots/${snapshot}`,root),bytes);
  captures.push({id,url,finalUrl:r.url,source,snapshot,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),fetched_at:new Date().toISOString()});
  console.log(`CAPTURE ${id} ${bytes.length}`);
 }catch(error){captures.push({id,url,source,error:String(error)});console.error(`MISSING ${id}: ${error.message}`);}
}}));
captures.sort((a,b)=>a.id.localeCompare(b.id));await writeFile(new URL('captures.json',root),JSON.stringify(captures,null,2)+'\n');
await writeFile(new URL('snapshots.sha256',root),captures.filter(c=>!c.error).map(c=>`${c.sha256}  snapshots/${c.snapshot}`).join('\n')+'\n');
