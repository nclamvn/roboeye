// RoboEye — orchestration: webcam → worker inference → render.
// Vòng inference tách khỏi vòng render (R2): main chỉ gửi frame khi worker rảnh,
// frame mới nhất thắng, không xếp hàng.

import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/noto-serif/400.css';
import '@fontsource/noto-serif/600.css';
import './styles.css';

import { createShell } from './ui/shell';
import { createScene, type SceneAPI } from './render/scene';
import { createCocoExport, createRelative3dExport, createYoloExport } from './annotations';
import { recoverDetectionError } from './detection-state';
import { recoverDepthError } from './depth-state';
import { createRuntimeDiagnostics } from './runtime-diagnostics';
import { OWL_QUERY_PRESETS } from './detection-presets';
import { HAND_TRACKING_CONFIG } from './hand-tracking-config';
import type { WorkerToMain, Dtype } from './types';
import type { HandWorkerToMain, MainToHandWorker } from './hand-tracking-types';
import type {
  DetBox,
  DetectionBenchmarkAPI,
  DetectionBenchmarkReady,
  DetectionBenchmarkResult,
  DetectionDevice,
  DetectionEngine,
  DetectionWorkerToMain
} from './detection-types';
import { metricLift, toKittiLines, focalFromFov, type MetricBox3D } from './render/lift-metric';
import type { MetricWorkerToMain } from './metric-types';
import { DetectionSmoother } from './detection-smooth';
import { solveRobotHandPose } from './robohand-pose';
import { contactResidual } from './robohand-retarget';
import { RobotHandMetrics, RobotHandRealtimeController } from './robohand-realtime';
import {RoboHandStudioController,StudioHandIdentityTracker,handIntent,type StudioHandInput} from './robohand-studio';
import {classifyRobotHandGesture,type RobotHandGesture} from './robohand-gestures';

let sceneApi: SceneAPI | null = null;
let worker: Worker | null = null;
let workerReady = false;
let workerBusy = false;
let firstDepthSeen = false;

let video: HTMLVideoElement | null = null;
let stream: MediaStream | null = null;

let captureW = 252;

interface CaptureSurface {
  canvas: OffscreenCanvas | null;
  ctx: OffscreenCanvasRenderingContext2D | null;
}

const depthCapture: CaptureSurface = { canvas: null, ctx: null };
const detectionCapture: CaptureSurface = { canvas: null, ctx: null };
// Detection giữ nguồn riêng đủ chi tiết, không bị hạ theo depth khi WASM dùng 140 px.
const DETECTION_CAPTURE_W = 384;

let dtype: Dtype = 'fp16';
let frozen = false;

// Engine v2: detection worker, fusion 2D→3D, gán nhãn (P1-B)
let detectWorker: Worker | null = null;
let detectReady = false;
let detectBusy = false;
let detectOn = false;
let detectLoadRetries = 0;
let detectRetryTimer: ReturnType<typeof setTimeout> | null = null;
let detectDevice: DetectionDevice | null = null;
let lastDetectionResultAt = 0;
let detectionFpsEma = 0;
let lastBoxes: DetBox[] = []; // cũng là tập annotation khi frozen (thô, cho panel/export/3D)
const detSmoother = new DetectionSmoother(); // bám mượt + xác nhận khung cho overlay 2D
let selectedObj = -1;
let engine: DetectionEngine = 'rtdetr';
let queries: string[] = [...OWL_QUERY_PRESETS.everyday.queries];
let detW = 0;
let detH = 0;

// P1-B-2 metric: Depth Pro chạy trên khung đông cứng (opt-in ~600MB)
let metricMode = false;
let metricWorker: Worker | null = null;
let metricBoxes: Array<MetricBox3D | null> = [];
let fovDeg = 60;
// Test hook: verify toán metric lift bằng synthetic depth (dùng trong smoke, vô hại)
(window as unknown as { __roboeyeMetric?: unknown }).__roboeyeMetric = { metricLift, toKittiLines, focalFromFov };

let roboHandOn = false;
const roboHandRealtime = new Map<string,RobotHandRealtimeController>();
const roboHandStudio = new RoboHandStudioController();
const roboHandIdentity = new StudioHandIdentityTracker();
const roboHandMemory = new Map<string,{gesture:RobotHandGesture;pinchStrength:number;gripStrength:number}>();
const roboHandMetrics = new RobotHandMetrics();
let airHandWorker: Worker | null = null;
let airHandReady = false;
let airHandBusy = false;
let airLastCaptureAt = 0;
let airVideoFrameCallbackId: number | null = null;
let airVideoFrameGeneration = 0;
let airLastPresentedFrame = 0;
let airUsesVideoFrameCallback = false;

interface BenchmarkPending<T> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let benchmarkReadyPending: (BenchmarkPending<DetectionBenchmarkReady> & {
  engine: DetectionEngine;
  startedAt: number;
}) | null = null;
let benchmarkInferPending: BenchmarkPending<DetectionBenchmarkResult> | null = null;

function refreshAnnotations() {
  sceneApi?.setDetections(lastBoxes);
  sceneApi?.setSelectedBox(selectedObj);
  shell.renderObjects(lastBoxes, selectedObj);
}

function downloadFile(name: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportAnnotations(fmt: 'coco' | 'yolo' | '3d' | 'kitti') {
  const W = detW || 1280;
  const H = detH || 720;
  if (lastBoxes.length === 0) return;
  if (fmt === 'kitti') {
    if (!metricBoxes.some(Boolean)) return; // KITTI cần metric mét thật (bật Metric mode + F)
    downloadFile('roboeye-kitti.txt', toKittiLines(lastBoxes, metricBoxes, W, H));
  } else if (fmt === 'yolo') {
    const yolo = createYoloExport(lastBoxes);
    downloadFile('roboeye-labels.txt', yolo.labelsText);
    downloadFile('classes.txt', yolo.classesText);
  } else if (fmt === 'coco') {
    const coco = createCocoExport(lastBoxes, { width: W, height: H });
    downloadFile('roboeye-coco.json', JSON.stringify(coco, null, 2), 'application/json');
  } else {
    // 3D JSON: có metric (Depth Pro) thì xuất MÉT thật, không thì view-space tương đối
    const hasMetric = metricMode && metricBoxes.some(Boolean);
    if (hasMetric) {
      const out = {
        note: 'RoboEye 3D annotations, đơn vị MÉT (Depth Pro). center/dims camera coords KITTI (X phải, Y xuống, Z tới).',
        scale: 'metric',
        unit: 'meter',
        image: { width: W, height: H },
        objects: lastBoxes.map((b, i) => ({
          label: b.label,
          score: +b.score.toFixed(3),
          box2d: { x0: +b.x0.toFixed(4), y0: +b.y0.toFixed(4), x1: +b.x1.toFixed(4), y1: +b.y1.toFixed(4) },
          box3d: metricBoxes[i]
            ? {
                center_m: metricBoxes[i]!.center.map((v) => +v.toFixed(3)),
                dims_m: metricBoxes[i]!.dims.map((v) => +v.toFixed(3)),
                distance_m: +metricBoxes[i]!.distance.toFixed(3)
              }
            : null
        }))
      };
      downloadFile('roboeye-3d-metric.json', JSON.stringify(out, null, 2), 'application/json');
    } else {
      const d3 = sceneApi?.getDetections3D() ?? [];
      const out = createRelative3dExport(lastBoxes, { width: W, height: H }, d3);
      downloadFile('roboeye-3d.json', JSON.stringify(out, null, 2), 'application/json');
    }
  }
}

// Cần thử fallback (mục 9 PRD): ?webgl=1 ép render WebGL2, ?wasm=1 ép inference WASM
const urlParams = new URLSearchParams(location.search);
const forceWebGL = urlParams.has('webgl');
const forceWasm = urlParams.has('wasm') || __ROBOEYE_OFFLINE__;
// Detection mặc định ưu tiên WebGPU để tránh độ trễ nhiều giây trên WASM/CPU.
// ?detectwasm=1 giữ đường chẩn đoán CPU; nếu GPU không sẵn sàng, worker tự retry
// sạch bằng WASM thay vì làm hỏng luồng camera.
const detectWebGPU = !forceWasm && !urlParams.has('detectwasm');
let detectForceWasm = !detectWebGPU;
const localModels = urlParams.has('localmodels') || __ROBOEYE_OFFLINE__;
const demoMode = urlParams.has('demo');
const roboHandPreviewMode = urlParams.has('robohand');
const detectionBenchmarkMode = urlParams.has('detection-benchmark');
let demoRequested = demoMode;

let diagnosticsStorage: Storage | undefined;
try { diagnosticsStorage = window.localStorage; } catch { diagnosticsStorage = undefined; }
const diagnostics = createRuntimeDiagnostics({
  version: __ROBOEYE_VERSION__,
  commit: __ROBOEYE_COMMIT__,
  storage: diagnosticsStorage,
  userAgent: () => navigator.userAgent,
  online: () => navigator.onLine
});
diagnostics.record('app.open', { demoMode, localModels, forceWebGL, forceWasm, detectWebGPU });

let lastDepthAt = 0;
let inferIntervalEma = 0;
let renderDtEma = 16.7;
let lastMeterUpdate = 0;

const shell = createShell({
  onMode: (m) => {
    if (m === 'robohand') {
      setRoboHand(true, false);
      if (!video?.srcObject) shell.setRoboHandStatus('Sharpa Wave trái/phải · đang xem thử không cần camera.');
    }
    else if (roboHandOn) setRoboHand(false, false);
    sceneApi?.setMode(m);
    if (m !== 'robohand' && video?.srcObject && !worker) spawnWorker();
    diagnostics.record('mode.change', { mode: m });
  },
  onSize: (px) => {
    captureW = px;
  },
  onPointScale: (mult) => sceneApi?.setPointScale(mult),
  onDtype: (d) => {
    dtype = d;
    restartWorker();
  },
  onCamera: (deviceId) => {
    void openCamera(deviceId);
  },
  onFov: (deg) => {
    fovDeg = deg;
    sceneApi?.setFov(deg);
  },
  onFreeze: (f) => {
    frozen = f;
    sceneApi?.setFrozen(f);
    if (f) computeMetricOnFreeze();
    else if (metricMode) {
      metricBoxes = [];
      shell.setMetricStatus('nhấn F trên khung để đo mét');
    }
  },
  onDetect: (on) => {
    detectOn = on;
    shell.showLabelTools(on);
    if (on) {
      detectLoadRetries = 0;
      detectForceWasm = !detectWebGPU;
      if (!detectWorker) spawnDetectWorker();
    }
    if (!on) {
      stopDetectWorker();
      lastBoxes = [];
      detSmoother.reset();
      selectedObj = -1;
      refreshAnnotations();
    }
    diagnostics.record('detection.toggle', { on });
  },
  onEngine: (e) => {
    engine = e;
    detectLoadRetries = 0;
    detectForceWasm = !detectWebGPU;
    selectedObj = -1;
    lastBoxes = []; // xoá box của engine cũ khỏi overlay
    detSmoother.reset();
    refreshAnnotations();
    if (detectWorker) {
      detectReady = false;
      shell.setObjStatus('đang tải model…');
      if (e === 'owlvit') detectWorker.postMessage({ type: 'queries', value: queries });
      detectWorker.postMessage({ type: 'engine', engine: e });
    } else if (detectOn) {
      spawnDetectWorker();
    }
  },
  onQueries: (list) => {
    queries = list;
    detectWorker?.postMessage({ type: 'queries', value: list });
  },
  onExport: (fmt) => exportAnnotations(fmt),
  onMetric: (on) => {
    metricMode = on;
    shell.showMetric(on);
    if (on) {
      if (!metricWorker) spawnMetricWorker();
      else metricWorker.postMessage({ type: 'preload' });
      shell.setMetricStatus('nhấn F trên khung để đo mét');
    } else {
      metricBoxes = [];
    }
    diagnostics.record('metric.toggle', { on });
  },
  onMetricExport: () => exportAnnotations('kitti'),
  onSelectObject: (i) => {
    selectedObj = selectedObj === i ? -1 : i;
    refreshAnnotations();
  },
  onDeleteObject: (i) => {
    lastBoxes.splice(i, 1);
    if (selectedObj === i) selectedObj = -1;
    else if (selectedObj > i) selectedObj--;
    refreshAnnotations();
  },
  onRelabelObject: (i, label) => {
    if (lastBoxes[i]) lastBoxes[i].label = label;
    refreshAnnotations();
  },
  onStart: () => {
    demoRequested = false;
    void start();
  },
  onDemoStart: () => {
    demoRequested = true;
    diagnostics.record('tour.request');
    void start();
  },
  onRetryDepth: () => {
    retryDepthWorker();
  },
  onDiagnostics: () => {
    diagnostics.record('diagnostics.export');
    downloadFile(
      `roboeye-diagnostics-v${__ROBOEYE_VERSION__}.json`,
      JSON.stringify(diagnostics.snapshot(), null, 2),
      'application/json'
    );
  },
}, { version: __ROBOEYE_VERSION__, demoMode, offlineMode: __ROBOEYE_OFFLINE__ });

function spawnHandWorker() {
  if (!roboHandOn || airHandWorker) return;
  const runtimeBase = new URL(import.meta.env.BASE_URL, location.href);
  // MediaPipe loads the local WASM runtime from a classic worker.
  const instance = new Worker(new URL('workers/air-hand-worker.js', runtimeBase));
  airHandWorker = instance;
  airHandReady = false;
  instance.onmessage = (event: MessageEvent<HandWorkerToMain>) => {
    if (airHandWorker !== instance) return;
    const message = event.data;
    if (message.type === 'loading') {
      airHandReady = false;
      const label = message.stage === 'runtime' ? 'runtime WASM' : message.stage === 'model' ? 'model bàn tay' : 'đồ thị tracking';
      if (roboHandOn) shell.setRoboHandStatus(`Đang chuẩn bị ${label}…`);
    } else if (message.type === 'ready') {
      airHandReady = true;
      const delegate = message.delegate ?? 'CPU';
      if (roboHandOn) shell.setRoboHandStatus(`Tracking ${delegate} sẵn sàng · đưa một hoặc hai bàn tay trọn vẹn vào camera.`);
      diagnostics.record('robohand.tracking.ready', { model: HAND_TRACKING_CONFIG.handModel.version, delegate });
    } else if (message.type === 'landmarks') {
      airHandBusy = false;
      if (roboHandOn) handleRoboHandLandmarks(message, performance.now());
    } else {
      airHandBusy = false;
      if (message.stage === 'load') {
        airHandReady = false;
        airHandWorker = null;
        instance.terminate();
      }
      if (roboHandOn) shell.setRoboHandStatus(`Tracking tay gặp lỗi: ${message.message}`);
      diagnostics.record('robohand.tracking.error', { stage: message.stage, message: message.message });
    }
  };
  instance.onerror = (event) => {
    if (airHandWorker !== instance) return;
    airHandBusy = false;
    airHandReady = false;
    airHandWorker = null;
    instance.terminate();
    if (roboHandOn) shell.setRoboHandStatus('Hand Worker bị dừng · chuyển mode rồi quay lại để thử lại.');
    diagnostics.record('robohand.tracking.crash', { message: event.message });
  };
  instance.postMessage({
    type: 'init',
    modelUrl: localModels || import.meta.env.PROD
      ? new URL('models/hand/hand_landmarker.task', runtimeBase).href
      : HAND_TRACKING_CONFIG.handModel.url,
    expectedBytes: HAND_TRACKING_CONFIG.handModel.bytes,
    expectedSha256: HAND_TRACKING_CONFIG.handModel.sha256,
    visionBundleUrl: new URL('mediapipe/vision_bundle.js', runtimeBase).href,
    wasmBase: new URL('mediapipe/wasm', runtimeBase).href,
    preferredDelegate: 'GPU',
    gpuFallbackInferMs: HAND_TRACKING_CONFIG.tracking.gpuFallbackInferMs,
    gpuFallbackSlowSamples: HAND_TRACKING_CONFIG.tracking.gpuFallbackSlowSamples,
    numHands: 2,
    confidence: { detection: .5, presence: .42, tracking: .35 }
  } satisfies MainToHandWorker);
}

function handleRoboHandLandmarks(message: Extract<HandWorkerToMain, { type: 'landmarks' }>, receivedAt: number) {
  if (!roboHandOn) return;
  const observations=message.hands?.length?message.hands:message.landmarks&&message.worldLandmarks?[{
    landmarks:message.landmarks,worldLandmarks:message.worldLandmarks,
    handedness:message.handedness,handednessScore:message.handednessScore
  }]:[];
  const identities=roboHandIdentity.assign(observations.map(observation=>({
    handedness:observation.handedness,handednessScore:observation.handednessScore,
    wristX:observation.landmarks[0].x,wristY:observation.landmarks[0].y,
    palmSpan:Math.hypot(
      observation.landmarks[5].x-observation.landmarks[17].x,
      observation.landmarks[5].y-observation.landmarks[17].y
    )
  })),receivedAt);
  const used=new Set<string>();
  const inputs:StudioHandInput[]=[];
  const overlays:Array<{id:string;landmarks:NonNullable<typeof message.landmarks>;gesture:string;handedness:string|null}>=[];
  for(let index=0;index<observations.length&&index<2;index++){
    const observation=observations[index];
    const id=identities[index];
    used.add(id);
    let controller=roboHandRealtime.get(id);
    if(!controller){controller=new RobotHandRealtimeController(420,180);roboHandRealtime.set(id,controller);}
    const pose=solveRobotHandPose({imageAspectRatio:video?video.videoWidth/Math.max(1,video.videoHeight):1,
      landmarks:observation.landmarks,worldLandmarks:observation.worldLandmarks,
      handedness:id==='left'?'Left':'Right',handednessScore:observation.handednessScore,
      capturedAt:message.capturedAt,receivedAt});
    if(!pose)continue;
    const result=controller.update(pose,observation.landmarks,receivedAt);
    if(!result.pose)continue;
    const intent=handIntent(observation.worldLandmarks);
    const gesture=classifyRobotHandGesture(observation.landmarks);
    roboHandMemory.set(id,{gesture,pinchStrength:intent.pinchStrength,gripStrength:intent.gripStrength});
    inputs.push({id,handedness:result.pose.handedness,pose:result.pose,gesture,
      pinchStrength:intent.pinchStrength,gripStrength:intent.gripStrength});
    overlays.push({id,landmarks:observation.landmarks,gesture:result.gesture,handedness:result.pose.handedness});
  }
  for(const [id,controller] of roboHandRealtime){
    if(used.has(id))continue;
    const missing=controller.missing(receivedAt),memory=roboHandMemory.get(id);
    if(missing.pose&&memory)inputs.push({id,handedness:missing.pose.handedness,pose:missing.pose,...memory});
    else if(missing.state==='rest'){roboHandRealtime.delete(id);roboHandMemory.delete(id);}
  }
  const studio=inputs.length?roboHandStudio.update(inputs,receivedAt):roboHandStudio.missing(new Set(),receivedAt);
  sceneApi?.setRobotHandStudio(studio);
  shell.drawRoboHandLandmarks(overlays,{hands:inputs.length,pose:studio.actionLabel,
    latencyMs:receivedAt-message.capturedAt,delegate:message.delegate});
  const unclosed=inputs.some(input=>contactResidual(input.pose.points,input.pose.handTask?.contacts??[])>.035);
  const hasContact=inputs.some(input=>(input.pose.handTask?.contacts??[]).some(contact=>contact.weight>.95));
  shell.setRoboHandStatus(inputs.length
    ? unclosed?'Cử chỉ chụm chưa khép ổn định · xoay lòng bàn tay để camera thấy rõ đầu ngón.'
      : `${studio.actionLabel} · ${inputs.length}/2 tay · ${hasContact?'tiếp xúc IK':'khớp tự do'}`
    : 'Chưa thấy bàn tay · giữ cổ tay và các đầu ngón trong khung camera nhỏ.');
}

function setRoboHand(on: boolean, selectMode = true) {
  if (on === roboHandOn) return;
  roboHandOn = on;
  shell.setRoboHandActive(on);
  if (on) {
    if (selectMode && shell.currentMode() !== 'robohand') shell.setMode('robohand');
    shell.setRoboHandStatus(video?.readyState && video.readyState >= 2
      ? 'Đang khởi động tracking tối đa 42 khớp…'
      : 'Mở camera để bắt đầu RoboHand Studio.');
    roboHandRealtime.forEach(controller=>controller.reset());
    roboHandRealtime.clear();roboHandMemory.clear();roboHandStudio.reset();roboHandIdentity.reset();
    roboHandMetrics.reset();
    // Showcase phải hoạt động độc lập camera. Chỉ dựng MediaPipe graph sau
    // khi đã có source video; nếu không một lỗi worker có thể chặn cả scene 3D.
    if (video?.srcObject) spawnHandWorker();
  } else {
    roboHandRealtime.forEach(controller=>controller.reset());
    roboHandRealtime.clear();roboHandMemory.clear();roboHandStudio.reset();roboHandIdentity.reset();
    sceneApi?.setRobotHandStudio({hands:[],props:[],actionLabel:'Sẵn sàng',capturedAt:null});
    shell.drawRoboHandLandmarks(null);
  }
  diagnostics.record('robohand.toggle', { on });
}

function spawnDetectWorker() {
  const instance = new Worker(new URL('./worker/detect-worker.ts', import.meta.url), { type: 'module' });
  detectWorker = instance;
  detectReady = false;
  detectBusy = false;
  detectDevice = null;
  lastDetectionResultAt = 0;
  detectionFpsEma = 0;
  shell.setObjStatus('đang tải model…');
  instance.onmessage = (ev: MessageEvent<DetectionWorkerToMain>) => {
    if (detectWorker !== instance) return;
    const m = ev.data;
    if (m.type === 'loading') {
      detectReady = false;
      detectBusy = false;
      shell.setObjStatus('đang tải model…');
    } else if (m.type === 'ready') {
      detectLoadRetries = 0;
      detectReady = true;
      detectBusy = false;
      detectDevice = m.device;
      shell.setObjStatus(engine === 'owlvit' ? `OWL-ViT · ${m.device.toUpperCase()}` : `RT-DETR · ${m.device.toUpperCase()} · COCO`);
      diagnostics.record('detection.ready', { engine, device: m.device });
      if (benchmarkReadyPending?.engine === m.engine) {
        const pending = benchmarkReadyPending;
        benchmarkReadyPending = null;
        clearTimeout(pending.timer);
        pending.resolve({ engine: m.engine, device: m.device, readyMs: performance.now() - pending.startedAt });
      }
    } else if (m.type === 'det') {
      detectBusy = false;
      if (benchmarkInferPending) {
        const pending = benchmarkInferPending;
        benchmarkInferPending = null;
        clearTimeout(pending.timer);
        pending.resolve({ boxes: m.boxes, detMs: m.detMs });
      }
      if (!frozen) {
        const resultAt = performance.now();
        if (lastDetectionResultAt > 0) {
          const instantaneousFps = 1_000 / Math.max(1, resultAt - lastDetectionResultAt);
          detectionFpsEma = detectionFpsEma === 0 ? instantaneousFps : detectionFpsEma * 0.72 + instantaneousFps * 0.28;
        }
        lastDetectionResultAt = resultAt;
        lastBoxes = m.boxes;
        // `m.capturedAt` belongs to the camera frame that produced these boxes,
        // not the later frame now on screen. The tracker projects that gap.
        detSmoother.observe(m.boxes, m.capturedAt, resultAt);
        selectedObj = -1;
        refreshAnnotations();
        const backend = detectDevice?.toUpperCase() ?? '…';
        const cadence = detectionFpsEma > 0 ? ` · ${detectionFpsEma.toFixed(1)} fps` : '';
        shell.setObjStatus(`${lastBoxes.length} vật · ${engine === 'owlvit' ? 'OWL-ViT' : 'RT-DETR'} · ${backend} · ${Math.round(m.detMs)} ms${cadence}`);
      }
    } else if (m.type === 'error') {
      const recovery = recoverDetectionError(m.stage);
      const retryingGpuLoad = m.stage === 'load' && detectOn && !detectionBenchmarkMode && detectLoadRetries < 1;
      detectBusy = recovery.busy;
      detectReady = recovery.ready;
      // GPU init failure followed by the documented WASM retry is recoverable.
      // Keep it visible to a developer without flagging a successful fallback
      // as a browser-console application error.
      if (retryingGpuLoad) console.warn('[roboeye-detect] WebGPU không sẵn sàng, thử WASM:', m.message);
      else console.error('[roboeye-detect]', m.message);
      diagnostics.record('detection.error', { engine, stage: m.stage, message: m.message });
      if (m.stage === 'load') rejectBenchmarkReady(m.message);
      else rejectBenchmarkInfer(m.message);
      if (m.stage === 'load') {
        instance.terminate();
        if (detectWorker === instance) detectWorker = null;
        if (retryingGpuLoad) {
          detectLoadRetries++;
          detectForceWasm = true;
          shell.setObjStatus('tải lỗi · đang thử lại WASM…');
          detectRetryTimer = setTimeout(() => {
            detectRetryTimer = null;
            if (detectOn && !detectWorker) spawnDetectWorker();
          }, 600);
          return;
        }
        shell.setObjStatus('lỗi tải · tắt/bật để thử lại');
      } else {
        shell.setObjStatus(recovery.status);
      }
    }
  };
  instance.onerror = (event) => {
    if (detectWorker !== instance) return;
    detectBusy = false;
    detectReady = false;
    instance.terminate();
    detectWorker = null;
    console.error('[roboeye-detect-worker]', event.message || 'worker crash');
    shell.setObjStatus('worker lỗi · tắt/bật để thử lại');
    diagnostics.record('detection.crash', { message: event.message || 'worker crash' });
    rejectBenchmarkReady(event.message || 'Detection worker crash');
    rejectBenchmarkInfer(event.message || 'Detection worker crash');
  };
  instance.postMessage({ type: 'init', forceWasm: detectForceWasm, localModels, engine, queries });
}

function rejectBenchmarkReady(message: string) {
  if (!benchmarkReadyPending) return;
  const pending = benchmarkReadyPending;
  benchmarkReadyPending = null;
  clearTimeout(pending.timer);
  pending.reject(new Error(message));
}

function rejectBenchmarkInfer(message: string) {
  if (!benchmarkInferPending) return;
  const pending = benchmarkInferPending;
  benchmarkInferPending = null;
  clearTimeout(pending.timer);
  pending.reject(new Error(message));
}

function stopDetectWorker() {
  if (detectRetryTimer != null) clearTimeout(detectRetryTimer);
  detectRetryTimer = null;
  detectWorker?.terminate();
  detectWorker = null;
  detectReady = false;
  detectBusy = false;
  rejectBenchmarkReady('Detection benchmark đã dừng');
  rejectBenchmarkInfer('Detection benchmark đã dừng');
}

// P1-B-2: Depth Pro on-demand đo mét thật trên khung đông cứng, mở khoá KITTI.
function spawnMetricWorker() {
  const instance = new Worker(new URL('./worker/metric-worker.ts', import.meta.url), { type: 'module' });
  metricWorker = instance;
  instance.onmessage = (ev: MessageEvent<MetricWorkerToMain>) => {
    if (metricWorker !== instance) return;
    const m = ev.data;
    if (m.type === 'loading') {
      shell.setMetricStatus('đang tải Depth Pro (~600MB, chỉ lần đầu)…');
    } else if (m.type === 'progress') {
      if (m.file.endsWith('.onnx')) {
        shell.setMetricStatus(`tải Depth Pro · ${(m.loaded / 1e6).toFixed(0)}/${(m.total / 1e6).toFixed(0)} MB`);
      }
    } else if (m.type === 'ready') {
      shell.setMetricStatus('Depth Pro sẵn sàng · nhấn F trên khung để đo');
      diagnostics.record('metric.ready', { device: m.device });
    } else if (m.type === 'metric') {
      const depth = new Float32Array(m.depth);
      const focal = m.focal > 0 ? m.focal : focalFromFov(fovDeg, m.width);
      metricBoxes = metricLift(depth, m.width, m.height, focal, lastBoxes);
      const n = metricBoxes.filter(Boolean).length;
      const near = metricBoxes.filter(Boolean).map((b) => b!.distance).sort((a, b) => a - b)[0];
      shell.setMetricStatus(`metric ✓ ${n} vật${near != null ? ` · gần nhất ${near.toFixed(2)} m` : ''}`);
      diagnostics.record('metric.done', { objects: n, ms: Math.round(m.ms) });
    } else if (m.type === 'error') {
      console.error('[roboeye-metric]', m.message);
      shell.setMetricStatus(`metric lỗi · ${m.message}`);
      diagnostics.record('metric.error', { message: m.message });
    }
  };
  instance.onerror = (event) => {
    if (metricWorker !== instance) return;
    console.error('[roboeye-metric-worker]', event.message || 'worker crash');
    shell.setMetricStatus('metric worker lỗi · tắt/bật Metric mode để thử lại');
    diagnostics.record('metric.crash', { message: event.message || 'worker crash' });
  };
  instance.postMessage({ type: 'init', forceWasm, localModels });
}

function computeMetricOnFreeze() {
  if (!metricMode || !metricWorker) return;
  const img = captureFrame(DETECTION_CAPTURE_W, detectionCapture);
  if (!img) return;
  detW = img.width;
  detH = img.height;
  shell.setMetricStatus('đang đo Depth Pro trên khung đông cứng…');
  metricWorker.postMessage(
    { type: 'compute', rgba: img.data.buffer, width: img.width, height: img.height },
    [img.data.buffer]
  );
}

function startDetectionBenchmark(nextEngine: DetectionEngine): Promise<DetectionBenchmarkReady> {
  stopDetectWorker();
  detectOn = true;
  detectForceWasm = true;
  detectLoadRetries = 0;
  engine = nextEngine;
  queries = [...OWL_QUERY_PRESETS.everyday.queries];
  lastBoxes = [];
  selectedObj = -1;
  refreshAnnotations();
  shell.showLabelTools(true);

  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const timer = setTimeout(() => {
      rejectBenchmarkReady(`Quá thời gian tải model ${nextEngine}`);
    }, 300_000);
    benchmarkReadyPending = { engine: nextEngine, startedAt, resolve, reject, timer };
    spawnDetectWorker();
  });
}

function inferDetectionBenchmark(
  rgba: ArrayBuffer,
  width: number,
  height: number
): Promise<DetectionBenchmarkResult> {
  if (!detectWorker || !detectReady) return Promise.reject(new Error('Detection model chưa sẵn sàng'));
  if (detectBusy || benchmarkInferPending) return Promise.reject(new Error('Detection worker đang bận'));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return Promise.reject(new Error('Kích thước benchmark không hợp lệ'));
  }
  if (rgba.byteLength !== width * height * 4) {
    return Promise.reject(new Error('RGBA buffer không khớp kích thước benchmark'));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      detectBusy = false;
      rejectBenchmarkInfer('Quá thời gian inference detection');
    }, 120_000);
    benchmarkInferPending = { resolve, reject, timer };
    detectBusy = true;
    detW = width;
    detH = height;
    detectWorker?.postMessage({ type: 'frame', rgba, width, height, capturedAt: performance.now() }, [rgba]);
  });
}

if (detectionBenchmarkMode) {
  const benchmarkApi: DetectionBenchmarkAPI = {
    start: startDetectionBenchmark,
    setQueries(value) {
      const normalized = value.map((item) => item.trim()).filter(Boolean);
      if (normalized.length === 0) throw new Error('Benchmark cần ít nhất một query');
      queries = normalized;
      detectWorker?.postMessage({ type: 'queries', value: normalized });
    },
    infer: inferDetectionBenchmark,
    stop() {
      detectOn = false;
      stopDetectWorker();
    }
  };
  window.__roboeyeDetectionBenchmark = benchmarkApi;
}

function spawnWorker() {
  worker = new Worker(new URL('./worker/depth-worker.ts', import.meta.url), { type: 'module' });
  workerReady = false;
  workerBusy = false;
  shell.setInferBadge(null);
  worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
    const msg = ev.data;
    switch (msg.type) {
      case 'progress': {
        if (msg.file.endsWith('.onnx')) {
          shell.setBootStatus(`Đang tải model ${dtype} · ${(msg.loaded / 1e6).toFixed(1)}/${(msg.total / 1e6).toFixed(1)} MB`);
          shell.setBootProgress(msg.progress);
        }
        break;
      }
      case 'ready': {
        workerReady = true;
        shell.setInferBadge(msg.device);
        shell.setBootStatus('Model sẵn sàng. Đang chờ depth frame đầu tiên…');
        shell.setBootProgress(100);
        shell.hideRuntimeNotice();
        diagnostics.record('depth.ready', { device: msg.device, dtype: msg.dtype });
        // PRD mục 9: rơi về WASM thì hạ inference size còn 140 và nói thật trên badge
        if (msg.device === 'wasm' && captureW > 140) {
          captureW = 140;
          shell.setSizeValue(140);
        }
        break;
      }
      case 'depth': {
        workerBusy = false;
        const now = performance.now();
        if (lastDepthAt > 0) {
          const interval = now - lastDepthAt;
          inferIntervalEma = inferIntervalEma === 0 ? interval : inferIntervalEma * 0.8 + interval * 0.2;
        }
        lastDepthAt = now;
        sceneApi?.pushDepth(new Uint8Array(msg.depth), msg.width, msg.height, inferIntervalEma || msg.inferMs);
        if (!firstDepthSeen) {
          firstDepthSeen = true;
          shell.hideBoot();
          diagnostics.record('depth.first-frame', { width: msg.width, height: msg.height });
          if (demoRequested) shell.startTour();
        }
        break;
      }
      case 'error': {
        const recovery = recoverDepthError(msg.stage);
        workerBusy = recovery.busy;
        workerReady = recovery.ready;
        console.error('[roboeye]', msg.message);
        diagnostics.record('depth.error', { stage: msg.stage, message: msg.message });
        if (msg.stage === 'load') {
          if (firstDepthSeen) shell.showRuntimeNotice(`${recovery.status}. Kiểm tra mạng rồi thử lại.`, true);
          else shell.setBootError(`${msg.message}. Kiểm tra mạng rồi thử lại.`);
        } else {
          shell.setBootStatus(recovery.status);
          if (firstDepthSeen) shell.showRuntimeNotice(recovery.status, false);
        }
        break;
      }
    }
  };
  worker.onerror = (e) => {
    workerBusy = false;
    workerReady = false;
    worker?.terminate();
    worker = null;
    const message = `Worker depth lỗi: ${e.message ?? 'không rõ'}`;
    diagnostics.record('depth.crash', { message });
    if (firstDepthSeen) shell.showRuntimeNotice(message, true);
    else shell.setBootError(message);
  };
  worker.postMessage({ type: 'init', dtype, forceWasm, localModels });
}

function restartWorker() {
  worker?.terminate();
  lastDepthAt = 0;
  inferIntervalEma = 0;
  spawnWorker();
}

function retryDepthWorker() {
  shell.hideRuntimeNotice();
  diagnostics.record('depth.retry');
  worker?.terminate();
  worker = null;
  workerBusy = false;
  workerReady = false;
  if (video?.srcObject) spawnWorker();
  else void start();
}

function captureAirHandFrame(sourceAt: number, callbackAt = performance.now()): void {
  const currentVideo = video;
  const interval = 1_000 / HAND_TRACKING_CONFIG.tracking.maxFps;
  if (!roboHandOn || !airHandReady || airHandBusy || frozen ||
      !airHandWorker || !currentVideo || currentVideo.readyState < 2 || callbackAt - airLastCaptureAt < interval) return;
  airHandBusy = true;
  airLastCaptureAt = callbackAt;
  const aspect = currentVideo.videoWidth / Math.max(1, currentVideo.videoHeight);
  const width = HAND_TRACKING_CONFIG.tracking.captureWidth;
  const height = Math.max(2, Math.round(width / Math.max(0.1, aspect)));
  const captureStartedAt = performance.now();
  void createImageBitmap(currentVideo, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' })
    .then((bitmap) => {
      if (!roboHandOn || !airHandWorker || currentVideo !== video) {
        bitmap.close();
        airHandBusy = false;
        return;
      }
      const sentAt = performance.now();
      airHandWorker.postMessage({
        type: 'frame', bitmap, timestamp: sourceAt, capturedAt: sourceAt, captureStartedAt, sentAt
      }, [bitmap]);
    })
    .catch((error) => {
      airHandBusy = false;
      diagnostics.record('robohand.capture.error', { message: error instanceof Error ? error.message : String(error) });
    });
}

function startAirVideoFrameLoop(): void {
  const currentVideo = video;
  const generation = ++airVideoFrameGeneration;
  airLastPresentedFrame = 0;
  airUsesVideoFrameCallback = Boolean(currentVideo && 'requestVideoFrameCallback' in currentVideo);
  if (!currentVideo || !airUsesVideoFrameCallback) return;
  if (airVideoFrameCallbackId != null && 'cancelVideoFrameCallback' in currentVideo) {
    currentVideo.cancelVideoFrameCallback(airVideoFrameCallbackId);
  }
  const onFrame = (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
    if (generation !== airVideoFrameGeneration || currentVideo !== video) return;
    airVideoFrameCallbackId = currentVideo.requestVideoFrameCallback(onFrame);
    if (roboHandOn && airLastPresentedFrame > 0 && metadata.presentedFrames > airLastPresentedFrame + 1) {
      const dropped = metadata.presentedFrames - airLastPresentedFrame - 1;
      roboHandMetrics.addDroppedVideoFrames(dropped);
    }
    airLastPresentedFrame = metadata.presentedFrames;
    // captureTime is available for camera-backed media in supporting browsers;
    // presentationTime is the honest fallback and remains in the same high-res
    // clock domain as performance.now().
    const extendedMetadata = metadata as VideoFrameCallbackMetadata & { captureTime?: number };
    const sourceAt = Number.isFinite(extendedMetadata.captureTime)
      ? extendedMetadata.captureTime!
      : Number.isFinite(metadata.presentationTime) ? metadata.presentationTime : now;
    captureAirHandFrame(sourceAt, now);
  };
  airVideoFrameCallbackId = currentVideo.requestVideoFrameCallback(onFrame);
}

async function openCamera(deviceId?: string) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Trình duyệt này không cung cấp Camera API. Hãy mở bằng Chrome/Edge/Safari trên localhost hoặc HTTPS');
  }
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {})
    },
    audio: false
  });
  if (!video) {
    video = document.getElementById('robohand-video') as HTMLVideoElement | null;
    if (!video) video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
  }
  video.srcObject = stream;
  await video.play();
  startAirVideoFrameLoop();
  sceneApi?.attachVideo(video);
  diagnostics.record('camera.ready', { width: video.videoWidth, height: video.videoHeight });
}

async function refreshCameraList() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  shell.setCameras(cams);
}

function captureFrame(width: number, surface: CaptureSurface): ImageData | null {
  if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
  const aspect = video.videoWidth / video.videoHeight;
  const w = width;
  const h = Math.max(2, Math.round(w / aspect / 2) * 2);
  if (!surface.canvas || surface.canvas.width !== w || surface.canvas.height !== h) {
    surface.canvas = new OffscreenCanvas(w, h);
    surface.ctx = surface.canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!surface.ctx) return null;
  surface.ctx.drawImage(video, 0, 0, w, h);
  return surface.ctx.getImageData(0, 0, w, h);
}

async function start() {
  shell.setBootStatus('Đang xin quyền camera…');
  if (roboHandOn) shell.setRoboHandStatus('Đang xin quyền camera để điều khiển mô hình…');
  shell.setBootError('');
  shell.hideRuntimeNotice();
  worker?.terminate();
  worker = null;
  workerReady = false;
  workerBusy = false;
  try {
    await openCamera();
    await refreshCameraList();
  } catch (e) {
    diagnostics.record('camera.error', { message: e instanceof Error ? e.message : String(e) });
    if (roboHandOn) shell.setRoboHandStatus(`Không mở được camera: ${e instanceof Error ? e.message : String(e)}`);
    shell.setBootError(
      `Không mở được camera: ${e instanceof Error ? e.message : String(e)}. RoboEye cần chạy trên localhost hoặc https và cần quyền camera.`
    );
    return;
  }
  shell.setBootStatus('Camera đã mở. Đang tải model…');
  if (roboHandOn) {
    shell.hideBoot();
    shell.setRoboHandStatus('Camera đã mở · đang khởi động tracking tối đa 42 khớp…');
    spawnHandWorker();
  } else {
    spawnWorker();
  }
}

async function boot() {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  try {
    sceneApi = await createScene(canvas, { forceWebGL });
  } catch (e) {
    shell.setBootError(`Không khởi tạo được renderer: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  shell.setRenderBadge(sceneApi.isWebGPU);
  diagnostics.record('renderer.ready', { backend: sceneApi.isWebGPU ? 'webgpu' : 'webgl2' });
  // TIP-05: obstacle alert từ BEV, hiện ở mọi chế độ
  sceneApi.bev.onStatus = (s) => {
    shell.setAlert(s.alert ? s.nearest : null);
    shell.setBevStatus(s.route, s.pathSteps);
  };
  shell.setBootStatus(
    sceneApi.isWebGPU
      ? `Renderer WebGPU sẵn sàng · point cloud ${sceneApi.cloudCount.toLocaleString('vi-VN')} điểm. Nhấn "Mở camera".`
      : `Renderer WebGL2 (fallback) · point cloud ${sceneApi.cloudCount.toLocaleString('vi-VN')} điểm. Nhấn "Mở camera".`
  );
  shell.setMode('rgb');
  if (roboHandPreviewMode) {
    shell.setMode('robohand');
    shell.hideBoot();
  }
  window.addEventListener('resize', () => {
    sceneApi?.resize();
  });

  let lastT = performance.now();
  sceneApi.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = now - lastT;
    lastT = now;
    renderDtEma = renderDtEma * 0.9 + dt * 0.1;

    // Depth đọc pixel rất tốn tài nguyên. Khi người dùng đang xem RGB với
    // detection hoặc RoboHand, video texture vẫn cập nhật trực tiếp còn depth
    // được nhường tài nguyên cho model tương tác thời gian thực.
    if (workerReady && !workerBusy && !frozen && worker && !roboHandOn &&
        (!detectOn || shell.currentMode() !== 'rgb')) {
      const img = captureFrame(captureW, depthCapture);
      if (img) {
        sceneApi?.uploadColor(img);
        workerBusy = true;
        worker.postMessage(
          { type: 'frame', rgba: img.data.buffer, width: img.width, height: img.height },
          [img.data.buffer]
        );
      }
    }

    // Detection chạy nhịp riêng, cũng latest-frame-wins
    if (detectOn && detectReady && !detectBusy && !frozen && !roboHandOn && detectWorker) {
      const dimg = captureFrame(DETECTION_CAPTURE_W, detectionCapture);
      if (dimg) {
        detectBusy = true;
        detW = dimg.width;
        detH = dimg.height;
        detectWorker.postMessage(
          { type: 'frame', rgba: dimg.data.buffer, width: dimg.width, height: dimg.height, capturedAt: now },
          [dimg.data.buffer]
        );
      }
    }

    // Modern browsers capture on actual decoded camera frames. Keep the old
    // render-loop sampler only as a compatibility fallback.
    if (!airUsesVideoFrameCallback) captureAirHandFrame(now, now);

    sceneApi?.render(dt);
    if (roboHandOn) {
      roboHandMetrics.addRender(dt);
      const presentedCaptureAt = sceneApi?.consumeRobotHandPresentedFrame();
      if (presentedCaptureAt != null) roboHandMetrics.addPipeline(now - presentedCaptureAt);
    }

    // Overlay 2D box: chỉ ở chế độ RGB và Depth (cloud dùng 3D box, BEV ẩn)
    if (sceneApi) {
      const m = shell.currentMode();
      const show2d = detectOn && (m === 'rgb' || m === 'depth');
      // Không đông cứng: vẽ khung ĐÃ MƯỢT (bám vật + đã xác nhận, bớt box rác).
      // Đông cứng: vẽ đúng khung thô đang review + highlight vật đang chọn.
      const overlayBoxes = frozen ? lastBoxes : detSmoother.advance(dt);
      shell.drawDetections(overlayBoxes, sceneApi.imageRectPx(), show2d, frozen ? selectedObj : -1);
    }

    if (now - lastMeterUpdate > 250) {
      lastMeterUpdate = now;
      shell.setRenderFps(1000 / renderDtEma);
      shell.setInferFps(inferIntervalEma > 0 ? 1000 / inferIntervalEma : null);
    }
  });
}

(window as unknown as {
  __roboeyeRoboHand?: { snapshot(): ReturnType<RobotHandMetrics['snapshot']>; active(): boolean }
}).__roboeyeRoboHand = {
  snapshot: () => roboHandMetrics.snapshot(),
  active: () => roboHandOn
};

function syncNetwork() {
  shell.setNetwork(navigator.onLine);
  diagnostics.record('network.change', { online: navigator.onLine });
}

async function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    const base = new URL(import.meta.env.BASE_URL, location.href);
    const registration = await navigator.serviceWorker.register(new URL('sw.js', base));
    diagnostics.record('service-worker.ready', { scope: registration.scope });
  } catch (error) {
    diagnostics.record('service-worker.error', { message: error instanceof Error ? error.message : String(error) });
  }
}

window.addEventListener('online', syncNetwork);
window.addEventListener('offline', syncNetwork);
syncNetwork();
void registerServiceWorker();
void boot();
