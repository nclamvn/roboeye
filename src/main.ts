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
import { AirGestureController, AirInkDocument, drawAirStrokes, rasterizeAirStrokes } from './airsketch-ink';
import { AirSketchMetrics } from './airsketch-metrics';
import { localizeSketchLabel } from './airsketch-labels';
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
  DetectionEngine,
  DetectionWorkerToMain
} from './detection-types';

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
let lastBoxes: DetBox[] = []; // cũng là tập annotation khi frozen
let selectedObj = -1;
let engine: DetectionEngine = 'rtdetr';
let queries: string[] = [...OWL_QUERY_PRESETS.everyday.queries];
let detW = 0;
let detH = 0;

// T16: hand tracking → air ink → sketch classifier → AAC/TTS.
const airGesture = new AirGestureController();
const airInk = new AirInkDocument();
const airMetrics = new AirSketchMetrics();
let airSketchOn = false;
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
let airLastInkAt = 0;
let airLastClassifiedRevision = -1;
let airPointerActive = false;
let airPenWasDown = false;

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

function exportAnnotations(fmt: 'coco' | 'yolo' | '3d') {
  const W = detW || 1280;
  const H = detH || 720;
  if (lastBoxes.length === 0) return;
  if (fmt === 'yolo') {
    const yolo = createYoloExport(lastBoxes);
    downloadFile('roboeye-labels.txt', yolo.labelsText);
    downloadFile('classes.txt', yolo.classesText);
  } else if (fmt === 'coco') {
    const coco = createCocoExport(lastBoxes, { width: W, height: H });
    downloadFile('roboeye-coco.json', JSON.stringify(coco, null, 2), 'application/json');
  } else {
    const d3 = sceneApi?.getDetections3D() ?? [];
    const out = createRelative3dExport(lastBoxes, { width: W, height: H }, d3);
    downloadFile('roboeye-3d.json', JSON.stringify(out, null, 2), 'application/json');
  }
}

// Cần thử fallback (mục 9 PRD): ?webgl=1 ép render WebGL2, ?wasm=1 ép inference WASM
const urlParams = new URLSearchParams(location.search);
const forceWebGL = urlParams.has('webgl');
const forceWasm = urlParams.has('wasm') || __ROBOEYE_OFFLINE__;
// Detection ưu tiên WASM ổn định. WebGPU detection vẫn có thể thử nghiệm bằng
// ?detectwebgpu=1; nếu init lỗi, worker mới sẽ retry sạch bằng WASM.
const detectWebGPU = urlParams.has('detectwebgpu') && !forceWasm;
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
  onFov: (deg) => sceneApi?.setFov(deg),
  onFreeze: (f) => {
    frozen = f;
    sceneApi?.setFrozen(f);
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
  drawAirStrokes(airCtx, airInk.snapshot(), airCanvas.width, airCanvas.height, {
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
  airInk.undo();
  airPenWasDown = false;
  noteAirInkChanged();
  shell.setAirSketchStatus('Đã hoàn tác nét gần nhất');
}

function clearAirDrawing() {
  airInk.clear();
  airGesture.reset();
  airPenWasDown = false;
  airPredictions = [];
  airLastClassifiedRevision = -1;
  renderAirInk();
  shell.setAirSketchPredictions([]);
  shell.setAirSketchStatus('Khung vẽ đã sạch · chụm ngón để bắt đầu');
}

function addAirPrediction(index: number) {
  const prediction = airPredictions[index];
  if (!prediction) return;
  airPhrase.push(localizeSketchLabel(prediction.label));
  shell.setAirSketchPhrase(airPhrase);
  diagnostics.record('airsketch.word.add', { label: prediction.label });
}

function speakAirPhrase() {
  const fallback = airPredictions[0] ? localizeSketchLabel(airPredictions[0].label) : '';
  const text = airPhrase.length ? airPhrase.join(' ') : fallback;
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
  if (!airHandWorker && !__ROBOEYE_OFFLINE__ && classifierSettled) {
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
      } else if (message.type === 'ready') {
        airHandStage = 'ready';
        airHandReady = true;
        shell.setAirSketchStatus('Bút không khí sẵn sàng · chụm ngón cái và ngón trỏ để vẽ');
        diagnostics.record('airsketch.hand.ready', { model: AIRSKETCH_CONFIG.handModel.version });
      } else if (message.type === 'landmarks') {
        airHandBusy = false;
        if (airHandWarmupRemaining > 0) airHandWarmupRemaining--;
        else airMetrics.addHand(message.inferMs);
        handleAirLandmarks(message.landmarks);
      } else {
        airHandBusy = false;
        if (message.stage === 'load') airHandReady = false;
        airHandStage = `error:${message.stage}:${message.message}`;
        shell.setAirSketchStatus(`Tracking tay chưa sẵn sàng · dùng chuột/chạm (${message.message})`);
        diagnostics.record('airsketch.hand.error', { stage: message.stage, message: message.message });
      }
    };
    instance.onerror = (event) => {
      airHandBusy = false;
      airHandReady = false;
      airHandStage = 'crash';
      shell.setAirSketchStatus('Tracking tay gặp lỗi · chuột/chạm vẫn dùng được');
      diagnostics.record('airsketch.hand.crash', { message: event.message });
    };
    instance.postMessage({
      type: 'init',
      modelUrl: AIRSKETCH_CONFIG.handModel.url,
      expectedBytes: AIRSKETCH_CONFIG.handModel.bytes,
      expectedSha256: AIRSKETCH_CONFIG.handModel.sha256,
      visionBundleUrl: new URL('mediapipe/vision_bundle.js', runtimeBase).href,
      wasmBase: new URL('mediapipe/wasm', runtimeBase).href
    });
  }

  if (!airClassifierWorker) {
    const instance = new Worker(new URL('./worker/air-classifier-worker.ts', import.meta.url), { type: 'module' });
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
        if (message.revision !== airInk.revision) return;
        airPredictions = message.predictions;
        shell.setAirSketchPredictions(airPredictions);
        const top = airPredictions[0];
        shell.setAirSketchStatus(top
          ? `Đoán trong ${Math.round(message.inferMs)} ms · chạm một dự đoán để thêm vào câu`
          : 'Chưa nhận ra · thử thêm vài nét');
        diagnostics.record('airsketch.prediction', { inferMs: Math.round(message.inferMs), top: top?.label ?? null });
      } else {
        airClassifierBusy = false;
        if (message.stage === 'load') {
          airClassifierReady = false;
          if (!__ROBOEYE_OFFLINE__ && airSketchOn && airClassifierLoadRetries < 1) {
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
    instance.postMessage({ type: 'init', localModels });
  }
}

function setAirSketch(on: boolean) {
  airSketchOn = on;
  shell.setAirSketchActive(on);
  airCanvas.classList.toggle('active', on);
  if (on) {
    if (!airClassifierWorker && airClassifierRetryTimer == null) airClassifierLoadRetries = 0;
    shell.setMode('rgb');
    resizeAirCanvas();
    spawnAirWorkers();
    shell.setAirSketchStatus(__ROBOEYE_OFFLINE__
      ? 'Bản offline: dùng chuột/chạm để vẽ; model AirSketch chưa đóng gói'
      : 'Đang chuẩn bị tracking tay và bộ đoán hình…');
  } else {
    if (airClassifierRetryTimer != null) clearTimeout(airClassifierRetryTimer);
    airClassifierRetryTimer = null;
    airPenWasDown = false;
    airPointerActive = false;
    airGesture.release();
    airInk.end();
    shell.setAirSketchCursor(null);
  }
  diagnostics.record('airsketch.toggle', { on });
  requestAnimationFrame(() => {
    sceneApi?.resize();
    resizeAirCanvas();
  });
}

function applyAirPen(point: AirPoint, down: boolean) {
  if (down) {
    if (!airPenWasDown) airInk.begin(point);
    else airInk.move(point);
    airPenWasDown = true;
    noteAirInkChanged();
  } else if (airPenWasDown) {
    airInk.end();
    airPenWasDown = false;
    noteAirInkChanged();
  }
}

function handleAirLandmarks(landmarks: import('./airsketch-types').HandLandmark[] | null) {
  if (!airSketchOn || airPointerActive) return;
  if (!landmarks) {
    applyAirPen({ x: 0, y: 0, t: performance.now() }, false);
    airGesture.release();
    shell.setAirSketchCursor(null);
    return;
  }
  const sample = airGesture.update(landmarks, performance.now());
  if (!sample || !sceneApi) return;
  const rect = sceneApi.imageRectPx();
  const point = {
    x: (rect.x + sample.cursor.x * rect.w) / Math.max(1, airStage.clientWidth),
    y: (rect.y + sample.cursor.y * rect.h) / Math.max(1, airStage.clientHeight),
    t: sample.cursor.t
  };
  shell.setAirSketchCursor(point, sample.gesture, sample.holdProgress);
  if (sample.command === 'undo') undoAirStroke();
  else if (sample.command === 'clear') clearAirDrawing();
  else applyAirPen(point, sample.penDown);
  if (sample.gesture === 'draw') shell.setAirSketchStatus('Đang vẽ · thả chụm để nhấc bút');
  else if (sample.gesture === 'undo-hold') shell.setAirSketchStatus(`Giữ hai ngón để hoàn tác · ${Math.round(sample.holdProgress * 100)}%`);
  else if (sample.gesture === 'clear-hold') shell.setAirSketchStatus(`Giữ bàn tay mở để xóa · ${Math.round(sample.holdProgress * 100)}%`);
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
    { hand: airHandReady, classifier: airClassifierReady, handStage: airHandStage }
  )
};

function spawnDetectWorker() {
  const instance = new Worker(new URL('./worker/detect-worker.ts', import.meta.url), { type: 'module' });
  detectWorker = instance;
  detectReady = false;
  detectBusy = false;
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
        lastBoxes = m.boxes;
        selectedObj = -1;
        refreshAnnotations();
        shell.setObjStatus(`${lastBoxes.length} vật · ${engine === 'owlvit' ? 'OWL-ViT' : 'RT-DETR'}`);
      }
    } else if (m.type === 'error') {
      const recovery = recoverDetectionError(m.stage);
      detectBusy = recovery.busy;
      detectReady = recovery.ready;
      console.error('[roboeye-detect]', m.message);
      diagnostics.record('detection.error', { engine, stage: m.stage, message: m.message });
      if (m.stage === 'load') rejectBenchmarkReady(m.message);
      else rejectBenchmarkInfer(m.message);
      if (m.stage === 'load') {
        instance.terminate();
        if (detectWorker === instance) detectWorker = null;
        if (detectOn && !detectionBenchmarkMode && detectLoadRetries < 1) {
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
    detectWorker?.postMessage({ type: 'frame', rgba, width, height }, [rgba]);
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

    // Latest-frame-wins: chỉ capture + gửi khi worker rảnh
    if (workerReady && !workerBusy && !frozen && worker) {
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
          { type: 'frame', rgba: dimg.data.buffer, width: dimg.width, height: dimg.height },
          [dimg.data.buffer]
        );
      }
    }

    // Hand tracking chạy nhịp riêng tối đa 24 fps. ImageBitmap được transfer sang
    // worker nên main thread không đọc lại pixel và không xếp hàng frame.
    const airFrameInterval = 1000 / AIRSKETCH_CONFIG.tracking.maxFps;
    if (airSketchOn && airHandReady && !airClassifierLoading && !airHandBusy && !frozen && airHandWorker && video &&
        video.readyState >= 2 && now - airLastCaptureAt >= airFrameInterval) {
      airHandBusy = true;
      airLastCaptureAt = now;
      const aspect = video.videoWidth / Math.max(1, video.videoHeight);
      const width = AIRSKETCH_CONFIG.tracking.captureWidth;
      const height = Math.max(2, Math.round(width / Math.max(0.1, aspect)));
      void createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' })
        .then((bitmap) => {
          if (!airSketchOn || !airHandWorker) {
            bitmap.close();
            airHandBusy = false;
            return;
          }
          airHandWorker.postMessage({ type: 'frame', bitmap, timestamp: now }, [bitmap]);
        })
        .catch((error) => {
          airHandBusy = false;
          diagnostics.record('airsketch.capture.error', { message: error instanceof Error ? error.message : String(error) });
        });
    }

    sceneApi?.render(dt);
    maybeClassifyAirSketch(now);

    // Overlay 2D box: chỉ ở chế độ RGB và Depth (cloud dùng 3D box, BEV ẩn)
    if (sceneApi) {
      const m = shell.currentMode();
      const show2d = detectOn && (m === 'rgb' || m === 'depth');
      shell.drawDetections(lastBoxes, sceneApi.imageRectPx(), show2d, selectedObj);
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
