// Deterministic claim extraction for TIP-56A. Every evidence span must occur
// verbatim in the captured snapshot before claims.jsonl is written.
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const captures = JSON.parse(await readFile(new URL('captures.json', root), 'utf8'));
const byId = new Map(captures.map((item) => [item.id, item]));

const specs = [
  ['YOLO26', 'layer', 'vehicle_detection', 'yolo26', 'Newest SOTA Ultralytics models, released January 2026.'],
  ['YOLO26', 'capability', 'native end-to-end multi-task real-time vision family', 'yolo26', 'native end-to-end inference, a lighter detection head'],
  ['YOLO26', 'deployment_target', 'TensorRT, ONNX, CoreML, LiteRT and OpenVINO', 'yolo26', 'Flexible export formats including TensorRT, ONNX, CoreML, LiteRT, and OpenVINO'],
  ['YOLO26', 'code_license', 'AGPL-3.0 or commercial Enterprise licence', 'yolo26', 'AGPL-3.0'],
  ['YOLO26', 'benchmark_or_contract', 'vendor reports 1.7–11.8 ms T4 TensorRT across detection scales', 'yolo26', '1.7-11.8 ms T4 TensorRT latency'],

  ['RF-DETR Nano–Large', 'layer', 'vehicle_detection', 'rfdetr', 'RF-DETR is a real-time transformer architecture for object detection'],
  ['RF-DETR Nano–Large', 'capability', 'real-time detection and instance segmentation with DINOv2 backbone', 'rfdetr', 'Built on a DINOv2 vision transformer backbone'],
  ['RF-DETR Nano–Large', 'code_license', 'Apache-2.0 for package and designated core models; Plus is PML 1.0', 'rfdetr', 'The open-source `rfdetr` package and Apache-designated models are released under Apache 2.0, while Plus components (`rfdetr_plus`, including RF-DETR-XL/2XL detection models) are licensed under PML 1.0.'],
  ['RF-DETR Nano–Large', 'benchmark_or_contract', 'latency table measured on NVIDIA T4, TensorRT FP16, batch 1', 'rfdetr', 'All latency numbers were measured on an NVIDIA T4 using TensorRT, FP16, and batch size 1.'],
  ['RF-DETR Nano–Large', 'limitation', 'development branch may be less stable than published release', 'rfdetr', 'Please note that these updates are still in development and may not be as stable as the latest published release.'],

  ['RT-DETRv2', 'layer', 'vehicle_detection', 'rtdetr', 'RT-DETR: DETRs Beat YOLOs on Real-time Object Detection'],
  ['RT-DETRv2', 'capability', 'real-time end-to-end detector; official RT-DETRv2 implementation', 'rtdetr', 'RT-DETRv2: Improved Baseline with Bag-of-Freebies for Real-Time Detection Transformer'],
  ['RT-DETRv2', 'deployment_target', 'ONNX Runtime, TensorRT and OpenVINO', 'rtdetr', 'supported onnxruntime, TensorRT, openVINO.'],
  ['RT-DETRv2', 'code_license', 'Apache-2.0', 'rtdetr-license', 'Apache License'],
  ['RT-DETRv2', 'benchmark_or_contract', 'upstream table reports T4 TensorRT FP16 FPS at 640 input', 'rtdetr', 'T4 TensorRT FP16(FPS)'],
  ['RT-DETRv2', 'limitation', 'RT-DETR family has newer v4 member; v2 remains a baseline, not the frontier', 'rtdetr', 'Release the **newest** member of the RT-DETR family'],

  ['ByteTrack', 'layer', 'multi_object_tracking', 'bytetrack', 'tracking by associating every detection box'],
  ['ByteTrack', 'capability', 'uses low-score detections to recover true objects and reduce fragmented tracks', 'bytetrack', 'For the low score detection boxes, we utilize their similarities with tracklets to recover true objects and filter out the background detections.'],
  ['ByteTrack', 'deployment_target', 'ONNX Runtime and TensorRT deployment examples', 'bytetrack', '[ONNX export and ONNXRuntime]'],
  ['ByteTrack', 'code_license', 'MIT', 'bytetrack-license', 'MIT License'],
  ['ByteTrack', 'benchmark_or_contract', 'MOT17 result reported at 30 FPS on one V100', 'bytetrack', 'with 30 FPS running speed on a single V100 GPU.'],

  ['Metric3D v2', 'layer', 'monocular_metric_geometry', 'metric3d', 'zero-shot **metric depth** and **surface normal** estimation from a single image'],
  ['Metric3D v2', 'capability', 'zero-shot metric depth and surface normals', 'metric3d', 'Metric3D V2 models released, supporting metric depth and surface normal now!'],
  ['Metric3D v2', 'deployment_target', 'ONNX export and small ONNX checkpoint are published', 'metric3d', 'v2-S-ONNX'],
  ['Metric3D v2', 'code_license', 'BSD-2-Clause for code', 'metric3d', 'The *Metric 3D* code is under a 2-clause BSD License.'],
  ['Metric3D v2', 'weights_or_data_terms', 'commercial use of the complete model package requires clarification with authors', 'metric3d', 'For further commercial inquiries, please contact'],

  ['UniDepthV2', 'layer', 'monocular_metric_geometry', 'unidepth', 'Universal Monocular Metric Depth Estimation Made Simpler'],
  ['UniDepthV2', 'capability', 'metric depth with camera classes and confidence output', 'unidepth', 'Confidence output.'],
  ['UniDepthV2', 'deployment_target', 'ONNX support', 'unidepth', 'ONNX support.'],
  ['UniDepthV2', 'code_license', 'Creative Commons BY-NC 4.0', 'unidepth', 'This software is released under Creatives Common BY-NC 4.0 license.'],
  ['UniDepthV2', 'limitation', 'non-commercial licence blocks default commercial integration', 'unidepth', 'BY-NC 4.0'],

  ['Apple Depth Pro', 'layer', 'monocular_metric_geometry', 'depthpro', 'zero-shot metric monocular depth estimation'],
  ['Apple Depth Pro', 'capability', 'metric depth without supplied intrinsics plus focal-length estimation', 'depthpro', 'The predictions are metric, with absolute scale, without relying on the availability of metadata such as camera intrinsics.'],
  ['Apple Depth Pro', 'benchmark_or_contract', 'reference claim: 2.25 MP depth in 0.3 s on a standard GPU', 'depthpro', 'producing a 2.25-megapixel depth map in 0.3 seconds on a standard GPU.'],
  ['Apple Depth Pro', 'code_license', 'Apple licence permits use, reproduction, modification and redistribution subject to its terms', 'depthpro-license', 'to use, reproduce, modify and redistribute the Apple\nSoftware'],
  ['Apple Depth Pro', 'limitation', 'released reference model does not exactly match paper performance', 'depthpro', 'Its performance is close to the model reported in the paper but does not match it exactly.'],

  ['Depth Anything V2 Small', 'layer', 'monocular_depth', 'da2', 'robust relative depth estimation'],
  ['Depth Anything V2 Small', 'capability', 'small relative-depth backbone with separately released metric fine-tunes', 'da2', 'We provide **four models** of varying scales for robust relative depth estimation:'],
  ['Depth Anything V2 Small', 'deployment_target', 'Transformers and Core ML integrations are documented', 'da2', 'Depth Anything V2 is supported in [Transformers]'],
  ['Depth Anything V2 Small', 'code_license', 'Apache-2.0 for Small; larger models CC-BY-NC-4.0', 'da2', 'Depth-Anything-V2-Small model is under the Apache-2.0 license. Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license.'],
  ['Depth Anything V2 Small', 'limitation', 'base checkpoint is relative depth; metric output requires a metric fine-tune and validation', 'da2', 'robust relative depth estimation'],

  ['YOLOPv2', 'layer', 'road_understanding', 'yolopv2', 'Panoptic driving Perception'],
  ['YOLOPv2', 'capability', 'joint traffic-object detection, drivable-area segmentation and lane detection', 'yolopv2', 'YOLOPv2: Better, Faster, Stronger for Panoptic driving Perception'],
  ['YOLOPv2', 'code_license', 'MIT', 'yolopv2-license', 'MIT License'],
  ['YOLOPv2', 'benchmark_or_contract', 'upstream reports 91 FPS at size 640 on NVIDIA Tesla V100', 'yolopv2', '**91 (+42)**'],
  ['YOLOPv2', 'limitation', 'upstream experiments use BDD100K and V100, not Vietnam target-domain browser evidence', 'yolopv2', 'We used the BDD100K as our datasets,and experiments are run on **NVIDIA TESLA V100**.'],

  ['OpenVINO road-segmentation-adas-0001', 'layer', 'road_understanding', 'openvino-road', 'road-segmentation-adas-0001'],
  ['OpenVINO road-segmentation-adas-0001', 'capability', 'four-class background, road, curb and lane-mark segmentation', 'openvino-road', 'recognizes four classes: background, road, curb and mark.'],
  ['OpenVINO road-segmentation-adas-0001', 'deployment_target', 'OpenVINO local inference', 'openvino-road', 'openvino.compile_model'],
  ['OpenVINO road-segmentation-adas-0001', 'limitation', 'documentation demonstrates capability but is not Vietnam-domain accuracy evidence', 'openvino-road', 'This is a self-contained example that relies solely on its own code.'],

  ['ONNX Runtime Web', 'layer', 'browser_inference_runtime', 'ort-web', 'onnxruntime-web'],
  ['ONNX Runtime Web', 'capability', 'on-device browser inference with WebGPU/WebNN/WebGL/WASM execution providers', 'ort-web', 'There are benefits to doing on-device and in-browser inference.'],
  ['ONNX Runtime Web', 'deployment_target', 'browser and Electron; offline local inference', 'ort-web', 'It works offline.'],
  ['ONNX Runtime Web', 'code_license', 'MIT', 'ort-license', 'MIT License'],
  ['ONNX Runtime Web', 'limitation', 'GPU execution providers support only operator subsets; WASM supports all ONNX operators', 'ort-web', 'All ONNX operators are supported by WASM but only a subset are currently supported by WebGL, WebGPU and WebNN.'],

  ['Browser Video APIs', 'layer', 'video_ingest_runtime', 'webcodecs', 'WebCodecs API'],
  ['Browser Video APIs', 'capability', 'hardware-accelerated per-frame decode/control plus compositor-aligned callbacks', 'webcodecs', 'encode and decode video and audio in the browser efficiently (using hardware acceleration) and with very low-level control (processing on a per-frame basis).'],
  ['Browser Video APIs', 'deployment_target', 'WebCodecs and requestVideoFrameCallback in modern browsers', 'video-frame-callback', 'registers a callback function that runs when a new video frame is sent to the compositor.'],
  ['Browser Video APIs', 'limitation', 'requestVideoFrameCallback runs on the main thread and gives no strict synchronization guarantee', 'video-frame-callback', 'does not offer any strict guarantees that the output from your callback will remain in sync with the video frame rate.'],

  ['NVIDIA DeepStream NvMultiObjectTracker', 'layer', 'edge_video_runtime', 'deepstream-tracker', 'NvMultiObjectTracker'],
  ['NVIDIA DeepStream NvMultiObjectTracker', 'capability', 'persistent multi-object IDs with IOU, SORT, DeepSORT and DCF tracking', 'deepstream-tracker', 'keep persistent IDs to the same objects over time.'],
  ['NVIDIA DeepStream NvMultiObjectTracker', 'deployment_target', 'CPU, GPU and Jetson PVA batch tracking', 'deepstream-tracker', 'It supports multi-stream, multi-object tracking in the batch processing mode for efficient processing on CPU and GPU'],
  ['NVIDIA DeepStream NvMultiObjectTracker', 'benchmark_or_contract', 'tracker may process video-only frames when detector inference is skipped', 'deepstream-tracker', 'For the frame batches where the inference is skipped'],
  ['NVIDIA DeepStream NvMultiObjectTracker', 'limitation', 'PVA NvDCF path is Jetson-specific and configuration must be benchmarked', 'deepstream-tracker', 'Allow PVA-based execution of a significant part of NvDCF on Jetson'],

  ['OpenCV Camera Calibration', 'layer', 'camera_geometry', 'opencv-calibration', 'Camera Calibration'],
  ['OpenCV Camera Calibration', 'capability', 'estimates camera matrix and lens distortion coefficients', 'opencv-calibration', 'cv.calibrateCamera()** which returns the camera matrix, distortion coefficients'],
  ['OpenCV Camera Calibration', 'benchmark_or_contract', 'camera matrix is specific to the camera and reusable for images from that camera', 'opencv-calibration', 'The camera matrix is unique to a specific camera, so once calculated, it can be reused on other images taken by the same camera.'],
  ['OpenCV Camera Calibration', 'limitation', 'calibration must account for radial and tangential distortion', 'opencv-calibration', 'radial distortion and tangential distortion.'],

  ['BDD100K', 'layer', 'validation_dataset', 'bdd100k', 'BDD100K'],
  ['BDD100K', 'capability', 'driving-video benchmark for detection, lane, drivable area and tracking', 'bdd100k', 'image tagging, lane detection, drivable area segmentation, road object'],
  ['BDD100K', 'benchmark_or_contract', '100K videos and over 1000 hours with geographic/weather diversity', 'bdd100k', 'dataset represents more than 1000 hours of driving experience'],
  ['BDD100K', 'limitation', 'public benchmark diversity is not target-domain Vietnam physical range truth', 'bdd100k', 'geographic, environmental, and weather diversity'],

  ['KITTI', 'layer', 'validation_dataset', 'kitti', 'The KITTI Vision Benchmark Suite'],
  ['KITTI', 'capability', 'calibrated object, tracking and depth benchmarks', 'kitti', 'More complete calibration information (cameras, velodyne, imu)'],
  ['KITTI', 'weights_or_data_terms', 'CC BY-NC-SA 3.0 dataset licence', 'kitti', 'Creative Commons Attribution-NonCommercial-ShareAlike 3.0'],
  ['KITTI', 'limitation', 'non-commercial dataset terms prevent treating it as unrestricted commercial training data', 'kitti', 'you may not use this work for commercial purposes'],

  ['comma2k19', 'layer', 'validation_dataset', 'comma2k19', 'comma2k19'],
  ['comma2k19', 'capability', 'highway video with smartphone-like camera, GPS, IMU, raw GNSS and CAN', 'comma2k19', 'road-facing camera, phone GPS, thermometers and 9-axis IMU.'],
  ['comma2k19', 'benchmark_or_contract', 'over 33 hours on a 20 km California highway section', 'comma2k19', 'a dataset of over 33 hours of commute in California\'s 280 highway.'],
  ['comma2k19', 'limitation', 'single California corridor does not represent Vietnam target domain', 'comma2k19', 'on a 20km section of highway driving between California\'s San Jose and San Francisco.'],

  ['NHTSA Human Factors Guidance', 'layer', 'safety_hmi', 'nhtsa-hmi', 'Human Factors Design Guidance'],
  ['NHTSA Human Factors Guidance', 'capability', 'human-factors guidance for in-vehicle displays and crash warnings', 'nhtsa-hmi', 'Design Goal: Design in-vehicle tasks and messages that do not divert attention from activities critical for safe'],
  ['NHTSA Human Factors Guidance', 'benchmark_or_contract', 'minimize false and nuisance warnings and their acceptance impact', 'nhtsa-hmi', 'Design Goal: Minimize false and nuisance warnings and their effects on driver performance and acceptance.'],
  ['NHTSA Human Factors Guidance', 'limitation', 'warning modality and staging require scenario-specific evaluation', 'nhtsa-hmi', 'Selection of one- versus two-stage warning should include careful consideration'],
];

const rows = [];
for (const [entity, field, value, sourceId, evidence_span] of specs) {
  const captured = byId.get(sourceId);
  if (!captured || captured.error) throw Error(`Missing capture: ${sourceId}`);
  const snapshot = sourceId === 'nhtsa-hmi' ? captured.text_snapshot : captured.snapshot;
  const body = await readFile(new URL(`snapshots/${snapshot}`, root), 'utf8');
  if (!body.includes(evidence_span)) throw Error(`SPAN_NOT_FOUND preflight: ${sourceId}: ${evidence_span}`);
  rows.push({
    entity,
    field,
    value,
    evidence_span,
    extraction: value === evidence_span ? 'verbatim' : 'normalized',
    tier: sourceId === 'webcodecs' || sourceId === 'video-frame-callback' ? 'B' : 'A',
    capture: {
      url: captured.url,
      fetched_at: captured.fetched_at,
      snapshot,
      source: captured.source,
    },
  });
}
await writeFile(new URL('claims.jsonl', root), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
console.log({ claims: rows.length, entities: new Set(rows.map((row) => row.entity)).size });
