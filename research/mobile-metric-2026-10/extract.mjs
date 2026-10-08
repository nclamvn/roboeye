import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url),captures=JSON.parse(await readFile(new URL('captures.json',root),'utf8'));
const byId=new Map(captures.map(c=>[c.id,c]));
// Manual context-reviewed claim specifications; engine extraction is deterministic.
// Each value is tied to a literal source span. No DriveSense benchmark is invented.
const specs=[
 ['ONNX Runtime Web','layer','browser-runtime','ort-env','The environment flags'],
 ['ONNX Runtime Web','capability','WASM threading is explicitly disabled by numThreads=1; isolation is required otherwise','ort-env','will force disable multi-threading'],
 ['ONNX Runtime Web','metric_contract','Executes an ONNX model; the runtime itself provides no physical scale','ort-web','running ONNX models on browsers'],
 ['ONNX Runtime Web','code_license','MIT','ort-license','MIT License'],
 ['ONNX Runtime Web','upstream_evidence_scope','Graph capture requires static shape and all kernels on WebGPU; speed improvement is conditional','ort-gpu','if your model has static shapes and all its computing kernels are running on WebGPU EP'],
 ['ONNX Runtime Web','ios_webgpu_support','README compatibility table marks iOS WebGPU unsupported','ort-web','| WebGPU            | ✔️<sup>\\[2]</sup>     | ✔️<sup>\\[3]</sup>     | ✔️                  | ❌'],
 ['ONNX Runtime Web','ios_webgpu_support','2026 design document says Safari macOS/iOS WebGPU ships enabled by default','ort-native-design','Safari (macOS/iOS), and Chrome for Android'],

 ['ORT JSEP/WebKit incident','layer','runtime-risk','ort-jsep-issue','JSEP mode'],
 ['ORT JSEP/WebKit incident','capability','Primary issue reporter observed runaway CPU/memory after inference on WebKit','ort-jsep-issue','severe resource consumption issues after running inference'],
 ['ORT JSEP/WebKit incident','upstream_evidence_scope','Original incident uses PaddleOCR v4, not DriveSense depth; not proof of this iPhone incident','ort-jsep-issue','PaddleOCR v4 (detection + recognition)'],
 ['ORT JSEP/WebKit incident','limitation','Later report also implicates native WebGPU asyncify; WASM-only was stable for that workload','ort-jsep-comments','Plain wasm build'],

 ['DA2 Metric Outdoor Small','layer','metric-model','da2-metric','Depth Anything V2 for Metric Depth Estimation'],
 ['DA2 Metric Outdoor Small','capability','Metric encoder fine-tune plus DPT regression head, not the relative base checkpoint','da2-metric','we use a simple DPT head to regress the depth'],
 ['DA2 Metric Outdoor Small','metric_contract','Outdoor checkpoint is fine-tuned using synthetic Virtual KITTI data','da2-card','outdoor metric depth estimation using the synthetic Virtual KITTI datasets'],
 ['DA2 Metric Outdoor Small','code_license','Apache-2.0 for Small; other scales have different terms','da2','Depth-Anything-V2-Small model is under the Apache-2.0 license'],
 ['DA2 Metric Outdoor Small','upstream_evidence_scope','Small model has 24.8M parameters; no DriveSense iPhone latency claim','da2-metric','| Depth-Anything-V2-Small | 24.8M |'],

 ['ZipDepth','layer','relative-mobile-candidate','zipdepth','lightweight zero-shot monocular depth estimation model'],
 ['ZipDepth','capability','Approximately 6.1M fused parameters with unfold-free NPU/mobile variant and ONNX export','zipdepth','Convex (unfold-free) | ~6.1 M | NPU / mobile / CPU'],
 ['ZipDepth','metric_contract','Evaluation aligns predictions with ground-truth scale and shift; not independent zero-shot absolute metres','zipdepth','predictions are aligned to the ground truth with a least-squares scale and shift'],
 ['ZipDepth','code_license','MIT','zipdepth-license','MIT License'],
 ['ZipDepth','upstream_evidence_scope','Published deployment latency is RTX3090 profiling, not browser/iPhone metric acceptance','zipdepth','Representative latency on an **RTX 3090**'],

 ['Lite-Mono','layer','relative-mobile-candidate','litemono','Self-Supervised Monocular Depth Estimation'],
 ['Lite-Mono','capability','Tiny model 2.2M parameters; KITTI-oriented compact baseline','litemono','|  2.2M  |'],
 ['Lite-Mono','metric_contract','Mono evaluation uses ground-truth median scaling; cannot directly claim independent metres','litemono-eval','ratio = np.median(gt_depth) / np.median(pred_depth)'],
 ['Lite-Mono','code_license','MIT','litemono','License: MIT'],

 ['FastDepth','layer','compact-depth-baseline','fastdepth','FastDepth'],
 ['FastDepth','capability','Pruned MobileNet encoder with depthwise decoder and additive skip connections','fastdepth','MobileNet-NNConv5 architecture with depthwise separable layers'],
 ['FastDepth','upstream_evidence_scope','Official dataset/evaluation is NYU Depth V2 and deployment targets Jetson TX2','fastdepth','deployment on an NVIDIA Jetson TX2'],
 ['FastDepth','code_license','MIT','fastdepth-license','MIT License'],
 ['FastDepth','limitation','Indoor NYU-based pretrained baseline is not traffic-domain accuracy evidence','fastdepth','NYU Depth V2'],

 ['Apple Depth Pro','layer','offline-metric-teacher','depthpro','zero-shot metric monocular depth estimation'],
 ['Apple Depth Pro','capability','Metric scale and focal estimation without supplied camera metadata','depthpro','without relying on the availability of metadata such as camera intrinsics'],
 ['Apple Depth Pro','metric_contract','Returns depth metres and focal length in pixels','depthpro','depth = prediction["depth"]  # Depth in [m].'],
 ['Apple Depth Pro','code_license','Apple custom licence with conditions; not labelled MIT/Apache','depthpro-license','to use, reproduce, modify and redistribute the Apple'],
 ['Apple Depth Pro','upstream_evidence_scope','Publisher 0.3-second claim is on a standard GPU, not iPhone browser','depthpro','0.3 seconds on a standard GPU'],

 ['DA3 Metric Large','layer','offline-metric-teacher','da3','Monocular Metric Depth'],
 ['DA3 Metric Large','capability','Specialized monocular metric series, separate from DA3 Small/relative','da3','A specialized model fine-tuned for metric depth estimation in monocular settings'],
 ['DA3 Metric Large','metric_contract','Metres require focal-scaled output: focal * net_output / 300','da3','metric_depth = focal * net_output / 300.'],
 ['DA3 Metric Large','weights_terms','Apache-2.0 for DA3METRIC-LARGE; other checkpoints differ','da3','| [DA3METRIC-LARGE](https://huggingface.co/depth-anything/DA3METRIC-LARGE)              | 0.35B     | ✅             |              |               |       | ✅             | ✅         | Apache 2.0'],

 ['MoGe2 Small','layer','metric-cross-check-candidate','moge2-card','pipeline_tag: depth-estimation'],
 ['MoGe2 Small','weights_terms','MIT model card for moge-2-vits-normal','moge2-card','license: mit'],
 ['MoGe2 Small','capability','Official repository offers MoGe2 small checkpoint and ONNX support','moge2','Ruicheng/moge-2-vits-normal'],
 ['MoGe2 Small','metric_contract','Model family includes metric depth and camera FOV; adapter/recovery must match chosen version','moge2','including metric point maps, metric depth maps, normal maps and camera FOV'],
 ['MoGe2 Small','code_license','MIT, DINOv2 submodule Apache-2.0','moge2','MoGe code is released under the MIT license'],

 ['OpenCV camera geometry','layer','camera-calibration','opencv-calibration','Camera Calibration'],
 ['OpenCV camera geometry','capability','Estimates camera matrix and distortion, reusable for that camera','opencv-calibration','cv.calibrateCamera()** which returns the camera matrix, distortion coefficients'],
 ['OpenCV camera geometry','metric_contract','Camera matrix gives pixel focal lengths and principal point, not scene distance by itself','opencv-calibration','Intrinsic parameters are specific to a camera.'],

 ['OpenCV optical flow','layer','temporal-propagation','opencv-flow','Lucas-Kanade'],
 ['OpenCV optical flow','capability','Tracks apparent image motion between consecutive frames','opencv-flow','apparent motion'],
 ['OpenCV optical flow','metric_contract','Produces image motion, not independent absolute metric scale','opencv-flow','2D vector field'],

 ['Apple Core ML','layer','native-execution-option','coreml-compute','processing-unit configurations'],
 ['Apple Core ML','capability','Native compute-unit selection can include Apple Neural Engine','coreml-compute','including the neural engine, if available'],
 ['Apple Core ML','upstream_evidence_scope','Apple publishes native CoreML DepthAnythingV2SmallF16 package; not DriveSense metric weights/JS runtime','coreml','DepthAnythingV2SmallF16.mlpackage'],
];
const claims=[];
for(const [entity,field,value,id,evidence_span]of specs){
 const capture=byId.get(id);assert.ok(capture&&!capture.error,`Missing captured source ${id}`);
 const bytes=await readFile(new URL(`snapshots/${capture.snapshot}`,root));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),capture.sha256,`${id} hash`);
 assert.ok(bytes.toString('utf8').includes(evidence_span),`${entity}/${field}: SPAN_NOT_FOUND ${id}: ${evidence_span}`);
 claims.push({entity,field,value,evidence_span,extraction:'normalized',tier:id.startsWith('ort-jsep')?'B':'A',
   capture:{url:capture.url,fetched_at:capture.fetched_at,snapshot:capture.snapshot,source:capture.source}});
}
await writeFile(new URL('claims.jsonl',root),claims.map(c=>JSON.stringify(c)).join('\n')+'\n');
console.log(`${claims.length} claims, ${new Set(claims.map(c=>c.entity)).size} entities; verified spans + capture SHA`);
