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
import { AIRSKETCH_CONFIG } from './airsketch-config';
import { AirInkDocument, drawAirStrokes, rasterizeAirStrokes } from './airsketch-ink';
import { AirInteractionController } from './airsketch-interaction';
import { AirSketchScene } from './airsketch-scene';
import { AirSketchMetrics } from './airsketch-metrics';
import { AirDeskController, type AirDeskAction, type AirDeskHandSample } from './airdesk';
import { nearestTargetWithin, type TargetRect } from './airdesk-targeting';
import { localizeSketchLabel } from './airsketch-labels';
import { assessSketchConfidence } from './airsketch-confidence';
import { detectHeartSketch, mergeSpecialSketchPrediction } from './airsketch-shapes';
import type { WorkerToMain, Dtype } from './types';
import type {
  AirPoint,
  AirSketchClassifierWorkerToMain,
  AirSketchHandWorkerToMain,
  SketchPrediction
} from './airsketch-types';
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

// T16: hand tracking → air ink → sketch classifier → AAC/TTS.
const airInteraction = new AirInteractionController();
const airInk = new AirInkDocument();
const airScene = new AirSketchScene();
const airMetrics = new AirSketchMetrics();
const airDesk = new AirDeskController();
let airSketchOn = false;
let airDeskOn = false;
let airHandWorker: Worker | null = null;
let airHandReady = false;
let airHandStage = 'idle';
let airHandBusy = false;
let airHandWarmupRemaining = 3;
let airClassifierWorker: Worker | null = null;
let airClassifierReady = false;
let airClassifierBusy = false;
let airClassifierLoading = false;
let airClassifierLoadRetries = 0;
let airClassifierRetryTimer: ReturnType<typeof setTimeout> | null = null;
let airPredictions: SketchPrediction[] = [];
let airPhrase: string[] = [];
let airLastCaptureAt = 0;
let airVideoFrameCallbackId: number | null = null;
let airVideoFrameGeneration = 0;
let airLastPresentedFrame = 0;
let airUsesVideoFrameCallback = false;
let airLastInkAt = 0;
let airLastClassifiedRevision = -1;
let airPointerActive = false;
let airPenWasDown = false;
let airBenchmarkRevision = -1_000;
const airBenchmarkClassifications = new Map<number, {
  resolve: (predictions: SketchPrediction[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

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
    sceneApi?.setMode(m);
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
  onAirSketch: (on) => setAirSketch(on),
  onAirDesk: (on) => setAirDesk(on),
  onAirUndo: () => undoAirStroke(),
  onAirClear: () => clearAirDrawing(),
  onAirAddPrediction: (index) => addAirPrediction(index),
  onAirSpeak: () => speakAirPhrase(),
  onAirClearPhrase: () => {
    airPhrase = [];
    shell.setAirSketchPhrase(airPhrase);
  }
}, { version: __ROBOEYE_VERSION__, demoMode, offlineMode: __ROBOEYE_OFFLINE__ });

const airCanvas = document.getElementById('airsketch-overlay') as HTMLCanvasElement;
const airStage = document.getElementById('stage') as HTMLElement;
const airCtx = airCanvas.getContext('2d');
const airDeskFingerLayer = document.getElementById('airdesk-fingers') as HTMLElement;
const airDeskImage = document.getElementById('airdesk-image') as HTMLElement;
const airDeskDrawings = document.getElementById('airdesk-drawings') as unknown as SVGSVGElement;
const airDeskEditor = document.getElementById('airdesk-editor') as HTMLElement;

function resizeAirCanvas() {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const width = Math.max(1, Math.round(airStage.clientWidth * dpr));
  const height = Math.max(1, Math.round(airStage.clientHeight * dpr));
  if (airCanvas.width === width && airCanvas.height === height) return;
  airCanvas.width = width;
  airCanvas.height = height;
  renderAirInk();
}

function renderAirInk() {
  if (!airCtx) return;
  airCtx.clearRect(0, 0, airCanvas.width, airCanvas.height);
  if (!airSketchOn) return;
  airScene.render(airCtx, airCanvas.width, airCanvas.height);
  drawAirStrokes(airCtx, airInk.currentSnapshot(), airCanvas.width, airCanvas.height, {
    color: '#ffffff',
    width: Math.max(5, airCanvas.width / Math.max(280, airStage.clientWidth) * 4.2),
    shadow: 'rgba(255, 255, 255, 0.55)'
  });
}

function noteAirInkChanged() {
  airLastInkAt = performance.now();
  renderAirInk();
}

function undoAirStroke() {
  const wasDrawing = airInk.isDrawing();
  airInk.undo();
  if (!wasDrawing) airScene.undo();
  airPenWasDown = false;
  noteAirInkChanged();
  shell.setAirSketchStatus('Đã hoàn tác nét gần nhất');
}

function clearAirDrawing() {
  airInk.clear();
  airScene.clear();
  airInteraction.reset();
  airPenWasDown = false;
  airPredictions = [];
  airLastClassifiedRevision = -1;
  renderAirInk();
  shell.setAirSketchPredictions([]);
  shell.setAirSketchStatus('Khung vẽ đã sạch · giơ trỏ để định vị, chụm cái + trỏ để vẽ');
}

function addAirPrediction(index: number) {
  const prediction = airPredictions[index];
  if (!prediction) return;
  airPhrase.push(localizeSketchLabel(prediction.label));
  shell.setAirSketchPhrase(airPhrase);
  diagnostics.record('airsketch.word.add', { label: prediction.label });
}

function speakAirPhrase() {
  const text = airPhrase.join(' ');
  if (!text) {
    shell.setAirSketchStatus('Hãy vẽ và chọn ít nhất một từ trước khi nói');
    return;
  }
  if (!('speechSynthesis' in window)) {
    shell.setAirSketchStatus('Trình duyệt này chưa hỗ trợ đọc thành tiếng');
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'vi-VN';
  utterance.rate = 0.92;
  speechSynthesis.speak(utterance);
  shell.setAirSketchStatus(`Đang nói: “${text}”`);
  diagnostics.record('airsketch.speak', { words: text.split(/\s+/).length });
}

function spawnAirWorkers() {
  // Cold start tuần tự: ONNX classifier hoàn tất trước khi MediaPipe dựng graph,
  // tránh hai runtime WASM tranh bộ nhớ/compile rồi báo network error giả.
  const classifierSettled = airClassifierReady || (airClassifierWorker != null && !airClassifierLoading);
  if (!airHandWorker && classifierSettled) {
    const runtimeBase = new URL(import.meta.env.BASE_URL, location.href);
    // MediaPipe loader vẫn dùng importScripts nội bộ; classic worker là contract
    // tương thích chính thức, đồng thời giữ inference khỏi main thread.
    const instance = new Worker(new URL('workers/air-hand-worker.js', runtimeBase));
    airHandWorker = instance;
    airHandReady = false;
    airHandWarmupRemaining = 3;
    instance.onmessage = (event: MessageEvent<AirSketchHandWorkerToMain>) => {
      if (airHandWorker !== instance) return;
      const message = event.data;
      if (message.type === 'loading') {
        airHandStage = message.stage;
        const label = message.stage === 'runtime' ? 'runtime WASM' : message.stage === 'model' ? 'model bàn tay' : 'đồ thị tracking';
        shell.setAirSketchStatus(`Đang chuẩn bị ${label}…`);
        if (airDeskOn) shell.setAirDeskStatus(`Đang chuẩn bị ${label}…`);
      } else if (message.type === 'ready') {
        airHandStage = 'ready';
        airHandReady = true;
        const delegate = message.delegate ?? 'CPU';
        shell.setAirSketchStatus(`Tracking tay ${delegate} sẵn sàng · chụm lên vật thể để cầm, chụm vùng trống để vẽ`);
        if (airDeskOn) shell.setAirDeskStatus(`Tracking tay ${delegate} sẵn sàng · các đầu ngón vàng đã hoạt động.`);
        diagnostics.record('airsketch.hand.ready', { model: AIRSKETCH_CONFIG.handModel.version, delegate });
      } else if (message.type === 'landmarks') {
        airHandBusy = false;
        const resultAt = performance.now();
        if (airHandWarmupRemaining > 0) airHandWarmupRemaining--;
        else {
          airMetrics.addHand(message.inferMs);
          if (message.captureStartedAt != null && message.sentAt != null) {
            airMetrics.addCapture(message.sentAt - message.captureStartedAt);
          }
          // Source-frame age includes bitmap conversion, worker transit,
          // inference and reply. The previous timestamp started only after
          // conversion and therefore materially under-reported felt latency.
          airMetrics.addPipeline(resultAt - message.capturedAt);
        }
        if (airSketchOn) handleAirLandmarks(message.landmarks, message.capturedAt, resultAt);
        else if (airDeskOn) handleAirDeskLandmarks(message.landmarks, message.capturedAt, resultAt);
      } else {
        airHandBusy = false;
        if (message.stage === 'load') airHandReady = false;
        airHandStage = `error:${message.stage}:${message.message}`;
        shell.setAirSketchStatus(`Tracking tay chưa sẵn sàng · dùng chuột/chạm (${message.message})`);
        if (airDeskOn) shell.setAirDeskStatus(`Tracking tay chưa sẵn sàng · dùng chuột/chạm (${message.message})`);
        diagnostics.record('airsketch.hand.error', { stage: message.stage, message: message.message });
      }
    };
    instance.onerror = (event) => {
      airHandBusy = false;
      airHandReady = false;
      airHandStage = 'crash';
      shell.setAirSketchStatus('Tracking tay gặp lỗi · chuột/chạm vẫn dùng được');
      if (airDeskOn) shell.setAirDeskStatus('Tracking tay gặp lỗi · chuột/chạm vẫn dùng được');
      diagnostics.record('airsketch.hand.crash', { message: event.message });
    };
    instance.postMessage({
      type: 'init',
      modelUrl: localModels
        ? new URL('models/airsketch/hand_landmarker.task', runtimeBase).href
        : AIRSKETCH_CONFIG.handModel.url,
      expectedBytes: AIRSKETCH_CONFIG.handModel.bytes,
      expectedSha256: AIRSKETCH_CONFIG.handModel.sha256,
      visionBundleUrl: new URL('mediapipe/vision_bundle.js', runtimeBase).href,
      wasmBase: new URL('mediapipe/wasm', runtimeBase).href,
      preferredDelegate: 'GPU'
    });
  }

  if (!airClassifierWorker) {
    const runtimeBase = new URL(import.meta.env.BASE_URL, location.href);
    const instance = new Worker(new URL('workers/air-classifier-worker.js', runtimeBase));
    airClassifierWorker = instance;
    airClassifierReady = false;
    airClassifierLoading = true;
    instance.onmessage = (event: MessageEvent<AirSketchClassifierWorkerToMain>) => {
      if (airClassifierWorker !== instance) return;
      const message = event.data;
      if (message.type === 'progress') {
        shell.setAirSketchStatus(`Đang chuẩn bị bộ não đoán hình · ${Math.round(message.progress)}%`);
      } else if (message.type === 'ready') {
        airClassifierLoadRetries = 0;
        airClassifierReady = true;
        airClassifierLoading = false;
        if (!airHandReady) shell.setAirSketchStatus(`Bộ đoán hình sẵn sàng · tracking tay: ${airHandStage}…`);
        diagnostics.record('airsketch.classifier.ready', { model: AIRSKETCH_CONFIG.classifier.model });
        spawnAirWorkers();
      } else if (message.type === 'prediction') {
        airClassifierBusy = false;
        airMetrics.addClassify(message.inferMs);
        const benchmark = airBenchmarkClassifications.get(message.revision);
        if (benchmark) {
          clearTimeout(benchmark.timer);
          airBenchmarkClassifications.delete(message.revision);
          benchmark.resolve(message.predictions);
          return;
        }
        if (message.revision !== airInk.revision) return;
        const specialHeart = detectHeartSketch(airInk.snapshot());
        airPredictions = mergeSpecialSketchPrediction(message.predictions, specialHeart == null
          ? null
          : { label: 'heart', score: specialHeart }, AIRSKETCH_CONFIG.classifier.topK);
        shell.setAirSketchPredictions(airPredictions);
        const top = airPredictions[0];
        const confidence = assessSketchConfidence(airPredictions);
        shell.setAirSketchStatus(!top
          ? 'Chưa nhận ra · thử thêm vài nét'
          : confidence === 'confident'
            ? `Gợi ý rõ trong ${Math.round(message.inferMs)} ms · hãy chạm để xác nhận`
            : confidence === 'possible'
              ? `Kết quả còn gần nhau · chọn đúng trong 5 gợi ý hoặc vẽ thêm chi tiết`
              : 'Không đủ chắc chắn · không dùng kết quả này nếu chưa xác nhận');
        diagnostics.record('airsketch.prediction', { inferMs: Math.round(message.inferMs), top: top?.label ?? null });
      } else {
        airClassifierBusy = false;
        console.error('[roboeye-airsketch-classifier]', message.stage, message.message);
        if (message.revision != null) {
          const benchmark = airBenchmarkClassifications.get(message.revision);
          if (benchmark) {
            clearTimeout(benchmark.timer);
            airBenchmarkClassifications.delete(message.revision);
            benchmark.reject(new Error(message.message));
          }
        }
        if (message.stage === 'load') {
          airClassifierReady = false;
          if (airSketchOn && airClassifierLoadRetries < 1) {
            airClassifierLoadRetries++;
            instance.terminate();
            if (airClassifierWorker === instance) airClassifierWorker = null;
            shell.setAirSketchStatus('Tải bộ đoán hình lỗi · đang thử lại một lần…');
            airClassifierRetryTimer = setTimeout(() => {
              airClassifierRetryTimer = null;
              if (airSketchOn && !airClassifierWorker) spawnAirWorkers();
            }, 800);
            return;
          }
          airClassifierLoading = false;
          spawnAirWorkers();
        }
        if (message.revision != null) airLastClassifiedRevision = -1;
        shell.setAirSketchStatus(`Chưa thể đoán hình · nét vẽ vẫn hoạt động (${message.message})`);
        diagnostics.record('airsketch.classifier.error', { stage: message.stage, message: message.message });
      }
    };
    instance.onerror = (event) => {
      airClassifierBusy = false;
      airClassifierReady = false;
      airClassifierLoading = false;
      spawnAirWorkers();
      shell.setAirSketchStatus('Bộ đoán hình gặp lỗi · nét vẽ vẫn hoạt động');
      diagnostics.record('airsketch.classifier.crash', { message: event.message });
    };
    instance.postMessage({
      type: 'init',
      localModels,
      modelUrl: localModels
        ? new URL('models/airsketch/quickdraw_model.tflite', runtimeBase).href
        : AIRSKETCH_CONFIG.classifier.url,
      expectedBytes: AIRSKETCH_CONFIG.classifier.bytes,
      expectedSha256: AIRSKETCH_CONFIG.classifier.sha256,
      labelsUrl: localModels
        ? new URL('models/airsketch/labels.txt', runtimeBase).href
        : AIRSKETCH_CONFIG.classifier.labelsUrl,
      expectedLabelsBytes: AIRSKETCH_CONFIG.classifier.labelsBytes,
      expectedLabelsSha256: AIRSKETCH_CONFIG.classifier.labelsSha256,
      tfliteBase: new URL('tflite/', runtimeBase).href,
      topK: AIRSKETCH_CONFIG.classifier.topK
    });
  }
}

function setAirSketch(on: boolean) {
  if (on && airDeskOn) setAirDesk(false);
  airSketchOn = on;
  shell.setAirSketchActive(on);
  airCanvas.classList.toggle('active', on);
  if (on) {
    if (!airClassifierWorker && airClassifierRetryTimer == null) airClassifierLoadRetries = 0;
    shell.setMode('rgb');
    resizeAirCanvas();
    spawnAirWorkers();
    shell.setAirSketchStatus(__ROBOEYE_OFFLINE__
      ? 'Bản offline: đang mở tracking tay và bộ đoán hình tại thiết bị…'
      : 'Đang chuẩn bị tracking tay và bộ đoán hình…');
  } else {
    if (airClassifierRetryTimer != null) clearTimeout(airClassifierRetryTimer);
    airClassifierRetryTimer = null;
    applyAirPen({ x: 0, y: 0, t: performance.now() }, false);
    airPointerActive = false;
    airInteraction.release();
    shell.setAirSketchCursor(null);
  }
  diagnostics.record('airsketch.toggle', { on });
  requestAnimationFrame(() => {
    sceneApi?.resize();
    resizeAirCanvas();
  });
}

let airDeskGesture: 'move' | 'scale' | 'rotate' | 'draw' | 'text' | null = null;
let airDeskTextAnchor: Range | null = null;
let airDeskLastSeenAt = -Infinity;
let airDeskLossTimer: ReturnType<typeof setTimeout> | null = null;
let airDeskRenderedDrawingRevision = -1;
let airDeskRenderedTransform = '';
const airDeskFingerElements = new Map<number, HTMLElement>();
const airDeskPathElements: SVGPolylineElement[] = [];
const airDeskRenderedPathLengths: number[] = [];

function airDeskClientPoint(point: Pick<AirPoint, 'x' | 'y'>): { x: number; y: number } {
  const rect = airStage.getBoundingClientRect();
  return { x: rect.left + point.x * rect.width, y: rect.top + point.y * rect.height };
}

function airDeskImagePoint(client: { x: number; y: number }, at: number): AirPoint | null {
  const rect = airDeskImage.getBoundingClientRect();
  if (client.x < rect.left || client.x > rect.right || client.y < rect.top || client.y > rect.bottom) return null;
  return { x: (client.x - rect.left) / rect.width, y: (client.y - rect.top) / rect.height, t: at };
}

function pickAirDeskTarget(client: { x: number; y: number }): HTMLElement | null {
  const exact = document.elementFromPoint(client.x, client.y) as HTMLElement | null;
  if (exact?.closest('[data-airdesk-action], [data-airdesk-text-action], [data-airdesk-handle], #airdesk-image, #airdesk-editor')) {
    return exact;
  }
  const targets: TargetRect<HTMLElement>[] = [];
  for (const element of document.querySelectorAll<HTMLElement>('[data-airdesk-action], [data-airdesk-text-action], [data-airdesk-handle]')) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    targets.push({ target: element, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }
  const stageRect = airStage.getBoundingClientRect();
  const radius = Math.min(38, Math.max(22, Math.hypot(stageRect.width, stageRect.height) * 0.022));
  return nearestTargetWithin(client, targets, radius);
}

function renderAirDeskImage(): void {
  const transform = airDesk.getTransform();
  const transformKey = `${transform.x}|${transform.y}|${transform.scale}|${transform.rotation}|${transform.flipX}|${transform.flipY}`;
  if (transformKey !== airDeskRenderedTransform) {
    airDeskRenderedTransform = transformKey;
    airDeskImage.style.setProperty('--image-x', String(transform.x));
    airDeskImage.style.setProperty('--image-y', String(transform.y));
    airDeskImage.style.setProperty('--image-scale', String(transform.scale));
    airDeskImage.style.setProperty('--image-rotation', `${transform.rotation}deg`);
    airDeskImage.style.setProperty('--image-flip-x', transform.flipX ? '-1' : '1');
    airDeskImage.style.setProperty('--image-flip-y', transform.flipY ? '-1' : '1');
  }
  const drawingRevision = airDesk.getDrawingRevision();
  if (drawingRevision !== airDeskRenderedDrawingRevision) {
    airDeskRenderedDrawingRevision = drawingRevision;
    const svgNs = 'http://www.w3.org/2000/svg';
    const paths = airDesk.getRenderablePaths();
    while (airDeskPathElements.length < paths.length) {
      const line = document.createElementNS(svgNs, 'polyline');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', '#f2c94c');
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      airDeskDrawings.appendChild(line);
      airDeskPathElements.push(line);
      airDeskRenderedPathLengths.push(-1);
    }
    while (airDeskPathElements.length > paths.length) {
      airDeskPathElements.pop()?.remove();
      airDeskRenderedPathLengths.pop();
    }
    for (let index = 0; index < paths.length; index++) {
      const path = paths[index];
      if (airDeskRenderedPathLengths[index] === path.length) continue;
      airDeskRenderedPathLengths[index] = path.length;
      airDeskPathElements[index].setAttribute('points', path.map((point) => `${point.x * 320},${point.y * 210}`).join(' '));
    }
  }
  document.getElementById('airdesk-draw-btn')?.classList.toggle('active', airDesk.getTool() === 'draw');
}

function renderAirDeskFingers(fingertips: AirDeskHandSample['fingertips']): void {
  airDeskFingerLayer.hidden = false;
  const width = airDeskFingerLayer.clientWidth;
  const height = airDeskFingerLayer.clientHeight;
  for (const finger of fingertips) {
    let dot = airDeskFingerElements.get(finger.index);
    if (!dot) {
      dot = document.createElement('i');
      dot.dataset.finger = String(finger.index);
      airDeskFingerElements.set(finger.index, dot);
      airDeskFingerLayer.appendChild(dot);
    }
    dot.className = `airdesk-finger${finger.extended ? ' extended' : ''}`;
    dot.style.transform = `translate3d(${finger.point.x * width}px, ${finger.point.y * height}px, 0)`;
  }
}

function clearAirDeskFingers(): void {
  airDeskFingerLayer.hidden = true;
}

function pointRangeAt(client: { x: number; y: number }): Range | null {
  const documentWithCaret = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  return documentWithCaret.caretRangeFromPoint?.(client.x, client.y) ?? null;
}

function updateAirDeskTextSelection(client: { x: number; y: number }): void {
  if (!airDeskTextAnchor) return;
  const focus = pointRangeAt(client);
  if (!focus || !airDeskEditor.contains(focus.startContainer)) return;
  const selection = window.getSelection();
  if (!selection) return;
  selection.setBaseAndExtent(
    airDeskTextAnchor.startContainer, airDeskTextAnchor.startOffset,
    focus.startContainer, focus.startOffset
  );
}

function performAirDeskTextAction(action: string): void {
  airDeskEditor.focus();
  const selection = window.getSelection();
  if (action === 'spell') {
    airDeskEditor.textContent = (airDeskEditor.textContent ?? '').replace(/tập kêt/g, 'tập kết');
    shell.setAirDeskStatus('Đã áp dụng đề xuất: “tập kết”.');
    return;
  }
  if (!selection?.toString()) {
    const range = document.createRange();
    range.selectNodeContents(airDeskEditor);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  if (action === 'copy') {
    const text = selection?.toString() ?? '';
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    document.execCommand('copy');
    shell.setAirDeskStatus('Đã sao chép phần chữ đang chọn.');
  } else if (action === 'cut') {
    document.execCommand('cut');
    shell.setAirDeskStatus('Đã cắt phần chữ đang chọn.');
  } else if (action === 'delete') {
    document.execCommand('delete');
    shell.setAirDeskStatus('Đã xóa phần chữ đang chọn.');
  }
}

function handleAirDeskLandmarks(
  landmarks: import('./airsketch-types').HandLandmark[] | null,
  capturedAt = performance.now(),
  receivedAt = performance.now()
): void {
  if (!airDeskOn) return;
  if (!landmarks) {
    // A worker may return an occasional empty sample during a turn or brief
    // blur. Do not make all five markers flash out, or drop an active drag,
    // until the same bounded continuity window used by AirSketch has elapsed.
    if (receivedAt - airDeskLastSeenAt < AIRSKETCH_CONFIG.tracking.lostHandGraceMs) {
      if (airDeskLossTimer == null) {
        airDeskLossTimer = setTimeout(() => {
          airDeskLossTimer = null;
          if (airDeskOn && performance.now() - airDeskLastSeenAt >= AIRSKETCH_CONFIG.tracking.lostHandGraceMs) {
            clearAirDeskFingers();
            airDesk.end();
            airDeskGesture = null;
          }
        }, AIRSKETCH_CONFIG.tracking.lostHandGraceMs);
      }
      return;
    }
    clearAirDeskFingers();
    airDesk.end();
    airDeskGesture = null;
    return;
  }
  airDeskLastSeenAt = receivedAt;
  if (airDeskLossTimer != null) {
    clearTimeout(airDeskLossTimer);
    airDeskLossTimer = null;
  }
  const sample = airDesk.hand(landmarks, capturedAt, receivedAt);
  if (!sample) return;
  renderAirDeskFingers(sample.fingertips);
  const client = airDeskClientPoint(sample.pointer);
  const target = pickAirDeskTarget(client);
  if (sample.justPinched) {
    const imageAction = target?.closest<HTMLElement>('[data-airdesk-action]')?.dataset.airdeskAction as AirDeskAction | undefined;
    const textAction = target?.closest<HTMLElement>('[data-airdesk-text-action]')?.dataset.airdeskTextAction;
    if (imageAction) {
      airDesk.perform(imageAction);
      renderAirDeskImage();
      shell.setAirDeskStatus(imageAction === 'toggle-draw' ? (airDesk.getTool() === 'draw' ? 'Chế độ vẽ trên ảnh đã bật.' : 'Chế độ di chuyển ảnh đã bật.') : 'Đã cập nhật ảnh.');
    } else if (textAction) {
      performAirDeskTextAction(textAction);
    } else if (target?.closest('[data-airdesk-handle="scale"]')) {
      airDesk.begin(sample.controlPointer, 'scale');
      airDeskGesture = 'scale';
      shell.setAirDeskStatus('Đang phóng to / thu nhỏ ảnh…');
    } else if (target?.closest('[data-airdesk-handle="rotate"]')) {
      airDesk.begin(sample.controlPointer, 'rotate');
      airDeskGesture = 'rotate';
      shell.setAirDeskStatus('Đang xoay ảnh…');
    } else if (target?.closest('#airdesk-image')) {
      const imagePoint = airDeskImagePoint(client, capturedAt);
      if (airDesk.getTool() === 'draw' && imagePoint) {
        airDesk.beginDrawing(imagePoint);
        airDeskGesture = 'draw';
        shell.setAirDeskStatus('Đang vẽ trực tiếp lên ảnh…');
      } else {
        airDesk.begin(sample.controlPointer, 'move');
        airDeskGesture = 'move';
        shell.setAirDeskStatus('Đang kéo ảnh…');
      }
    } else if (target?.closest('#airdesk-editor')) {
      airDeskTextAnchor = pointRangeAt(client);
      airDeskGesture = 'text';
      updateAirDeskTextSelection(client);
      shell.setAirDeskStatus('Đang chọn văn bản…');
    }
  }
  if (sample.pinch) {
    if (airDeskGesture === 'draw') {
      const imagePoint = airDeskImagePoint(client, capturedAt);
      if (imagePoint) airDesk.draw(imagePoint);
    } else if (airDeskGesture === 'move' || airDeskGesture === 'scale' || airDeskGesture === 'rotate') {
      airDesk.move(sample.controlPointer);
    } else if (airDeskGesture === 'text') {
      updateAirDeskTextSelection(client);
    }
    renderAirDeskImage();
  }
  if (sample.justReleased) {
    airDesk.end();
    airDeskGesture = null;
    airDeskTextAnchor = null;
    shell.setAirDeskStatus('Đã đặt. Chụm lại để thao tác tiếp.');
  }
}

function setAirDesk(on: boolean): void {
  if (on && airSketchOn) setAirSketch(false);
  airDeskOn = on;
  shell.setAirDeskActive(on);
  if (on) {
    shell.setMode('rgb');
    renderAirDeskImage();
    spawnAirWorkers();
    shell.setAirDeskStatus('Đang chuẩn bị tracking tay · các đầu ngón sẽ hiện màu vàng.');
  } else {
    airDesk.reset();
    airDeskGesture = null;
    airDeskTextAnchor = null;
    airDeskLastSeenAt = -Infinity;
    if (airDeskLossTimer != null) clearTimeout(airDeskLossTimer);
    airDeskLossTimer = null;
    clearAirDeskFingers();
  }
  diagnostics.record('airdesk.toggle', { on });
}

for (const control of document.querySelectorAll<HTMLButtonElement>('[data-airdesk-action]')) {
  control.addEventListener('click', () => {
    airDesk.perform(control.dataset.airdeskAction as AirDeskAction);
    renderAirDeskImage();
  });
}
for (const control of document.querySelectorAll<HTMLButtonElement>('[data-airdesk-text-action]')) {
  control.addEventListener('click', () => performAirDeskTextAction(control.dataset.airdeskTextAction ?? ''));
}

function applyAirPen(point: AirPoint, down: boolean) {
  if (down) {
    if (!airPenWasDown) airInk.begin(point);
    else airInk.move(point);
    airPenWasDown = true;
    noteAirInkChanged();
  } else if (airPenWasDown) {
    const completed = airInk.currentSnapshot()[0];
    airInk.end();
    if (completed && completed.points.length >= 2) airScene.addStroke(completed);
    airPenWasDown = false;
    noteAirInkChanged();
  }
}

function handleAirLandmarks(
  landmarks: import('./airsketch-types').HandLandmark[] | null,
  capturedAt = performance.now(),
  receivedAt = performance.now()
) {
  if (!airSketchOn || airPointerActive) return;
  if (!landmarks) {
    // Tracker confidence can briefly disappear during fast movement or motion
    // blur. Do not end the active stroke/object on one missing observation.
    if (!airInteraction.shouldReleaseAfterMissing(receivedAt)) return;
    applyAirPen({ x: 0, y: 0, t: performance.now() }, false);
    airInteraction.release();
    shell.setAirSketchCursor(null);
    return;
  }
  const sample = airInteraction.update(landmarks, capturedAt, receivedAt);
  if (!sample || !sceneApi) return;
  const rect = sceneApi.imageRectPx();
  const point = {
    x: (rect.x + sample.cursor.x * rect.w) / Math.max(1, airStage.clientWidth),
    y: (rect.y + sample.cursor.y * rect.h) / Math.max(1, airStage.clientHeight),
    t: sample.cursor.t
  };
  const grabPoint = {
    x: (rect.x + sample.grabCursor.x * rect.w) / Math.max(1, airStage.clientWidth),
    y: (rect.y + sample.grabCursor.y * rect.h) / Math.max(1, airStage.clientHeight),
    t: sample.grabCursor.t
  };
  let interactionNotice: string | null = null;
  // A pinch that begins on an existing scene object means “pick this up”. A
  // pinch on empty space remains the pen clutch. Spatial intent is more
  // reliable than forcing an open-palm timing gesture before every pickup.
  if (sample.justPinched && sample.mode === 'drawing') {
    const object = airScene.beginGrab(point, grabPoint, sample.palmSpan);
    if (object && airInteraction.promotePinchToGrab()) {
      sample.mode = 'grabbing';
      sample.penDown = false;
      interactionNotice = 'Đang cầm vật thể · đưa tay gần/xa để đổi kích thước';
    } else if (object) {
      airScene.release();
    }
  }
  // The interaction controller decides whether the pen is down; this bridge
  // is the sole path that turns a tracked hand sample into an ink stroke.
  // Keep it before scene manipulation so releasing a stroke first commits it
  // as a selectable object.
  applyAirPen(point, sample.penDown);
  const cursorGesture = sample.mode === 'drawing' ? 'draw' : sample.mode === 'grabbing' ? 'grab' : sample.mode === 'manipulating' ? 'manipulate' : 'hover';
  shell.setAirSketchCursor(sample.fist ? null : point, cursorGesture);
  if (sample.justGrabbed) {
    const object = airScene.beginGrab(point, grabPoint, sample.palmSpan);
    interactionNotice = object ? 'Đang cầm vật thể · đưa tay gần/xa để đổi kích thước' : 'Không có vật thể trong vùng nhón';
  }
  if (sample.mode === 'grabbing') airScene.moveGrab(grabPoint, sample.palmSpan);
  if (sample.justReleased) {
    airScene.release();
    interactionNotice = 'Đã đặt vật thể · xòe bàn tay để cầm vật khác';
  }
  if (interactionNotice) shell.setAirSketchStatus(interactionNotice);
  else if (sample.mode === 'drawing') shell.setAirSketchStatus('Đang vẽ · nới ngón cái + trỏ để nhấc bút');
  else if (sample.mode === 'manipulating') shell.setAirSketchStatus('Chế độ cầm · chụm ngón cái + trỏ gần vật thể để cầm');
  else if (sample.mode === 'idle') shell.setAirSketchStatus(sample.fist
    ? 'Bút đã hạ · giơ trỏ để định vị, chụm cái + trỏ để vẽ'
    : sample.openPalm
      ? `Giữ bàn tay mở để vào chế độ cầm · ${Math.round(sample.manipulationProgress * 100)}%`
      : 'Giơ trỏ để định vị · chụm cái + trỏ để vẽ');
  // Ink writes already render in applyAirPen(). Only scene manipulation needs
  // an explicit redraw here; the old unconditional call painted every drawing
  // sample twice and competed with hand tracking on the main thread.
  if (sample.mode === 'grabbing' || sample.justGrabbed || sample.justReleased) renderAirInk();
}

function pointerPoint(event: PointerEvent): AirPoint {
  const rect = airCanvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))),
    t: performance.now()
  };
}

airCanvas.addEventListener('pointerdown', (event) => {
  if (!airSketchOn) return;
  airPointerActive = true;
  airCanvas.setPointerCapture(event.pointerId);
  applyAirPen(pointerPoint(event), true);
});
airCanvas.addEventListener('pointermove', (event) => {
  if (airPointerActive) applyAirPen(pointerPoint(event), true);
});
const endPointer = (event: PointerEvent) => {
  if (!airPointerActive) return;
  applyAirPen(pointerPoint(event), false);
  airPointerActive = false;
};
airCanvas.addEventListener('pointerup', endPointer);
airCanvas.addEventListener('pointercancel', endPointer);

function maybeClassifyAirSketch(now: number) {
  if (!airSketchOn || !airClassifierReady || airClassifierBusy || airInk.isDrawing() || !airInk.hasInk()) return;
  if (airLastClassifiedRevision === airInk.revision || now - airLastInkAt < AIRSKETCH_CONFIG.recognition.idleMs) return;
  const image = rasterizeAirStrokes(airInk.snapshot());
  if (!image) return;
  airClassifierBusy = true;
  airLastClassifiedRevision = airInk.revision;
  shell.setAirSketchStatus('Đang đoán hình bạn vừa vẽ…');
  const rgba = image.data.slice().buffer;
  airClassifierWorker?.postMessage({
    type: 'classify', rgba, width: image.width, height: image.height, revision: airInk.revision
  }, [rgba]);
}

window.__roboeyeAirSketchBenchmark = {
  snapshot: () => airMetrics.snapshot(
    airInk.strokeCount(),
    airInk.pointCount(),
    { hand: airHandReady, classifier: airClassifierReady, handStage: airHandStage },
    airScene.snapshot().length
  ),
  classifyImage: (rgba, width, height) => new Promise((resolve, reject) => {
    if (!airClassifierWorker || !airClassifierReady) {
      reject(new Error('AirSketch classifier chưa sẵn sàng'));
      return;
    }
    const revision = airBenchmarkRevision--;
    const buffer = rgba.slice().buffer;
    const timer = setTimeout(() => {
      airBenchmarkClassifications.delete(revision);
      reject(new Error('AirSketch benchmark inference timeout'));
    }, 30_000);
    airBenchmarkClassifications.set(revision, { resolve, reject, timer });
    airClassifierWorker.postMessage({ type: 'classify', rgba: buffer, width, height, revision }, [buffer]);
  })
};

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
  const interval = 1_000 / AIRSKETCH_CONFIG.tracking.maxFps;
  if ((!airSketchOn && !airDeskOn) || !airHandReady || airClassifierLoading || airHandBusy || frozen ||
      !airHandWorker || !currentVideo || currentVideo.readyState < 2 || callbackAt - airLastCaptureAt < interval) return;
  airHandBusy = true;
  airLastCaptureAt = callbackAt;
  const aspect = currentVideo.videoWidth / Math.max(1, currentVideo.videoHeight);
  const width = AIRSKETCH_CONFIG.tracking.captureWidth;
  const height = Math.max(2, Math.round(width / Math.max(0.1, aspect)));
  const captureStartedAt = performance.now();
  void createImageBitmap(currentVideo, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' })
    .then((bitmap) => {
      if ((!airSketchOn && !airDeskOn) || !airHandWorker || currentVideo !== video) {
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
      diagnostics.record('airsketch.capture.error', { message: error instanceof Error ? error.message : String(error) });
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
    if ((airSketchOn || airDeskOn) && airLastPresentedFrame > 0 && metadata.presentedFrames > airLastPresentedFrame + 1) {
      airMetrics.addDroppedVideoFrames(metadata.presentedFrames - airLastPresentedFrame - 1);
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
    video = document.createElement('video');
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
    shell.setBootError(
      `Không mở được camera: ${e instanceof Error ? e.message : String(e)}. RoboEye cần chạy trên localhost hoặc https và cần quyền camera.`
    );
    return;
  }
  shell.setBootStatus('Camera đã mở. Đang tải model…');
  spawnWorker();
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
  window.addEventListener('resize', () => {
    sceneApi?.resize();
    resizeAirCanvas();
  });

  let lastT = performance.now();
  sceneApi.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = now - lastT;
    lastT = now;
    renderDtEma = renderDtEma * 0.9 + dt * 0.1;

    // Depth đọc pixel rất tốn tài nguyên. Khi người dùng đang xem RGB với
    // detection hoặc AirSketch, video texture vẫn cập nhật trực tiếp còn depth
    // được nhường tài nguyên cho model tương tác thời gian thực.
    if (workerReady && !workerBusy && !frozen && worker && !airSketchOn &&
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
    if (detectOn && detectReady && !detectBusy && !frozen && detectWorker) {
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
    maybeClassifyAirSketch(now);

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
