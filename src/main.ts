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
import type { WorkerToMain, Dtype } from './types';
import type { DetBox, DetectionEngine, DetectionWorkerToMain } from './detection-types';

let sceneApi: SceneAPI | null = null;
let worker: Worker | null = null;
let workerReady = false;
let workerBusy = false;
let firstDepthSeen = false;

let video: HTMLVideoElement | null = null;
let stream: MediaStream | null = null;

let captureW = 252;
let captureCanvas: OffscreenCanvas | null = null;
let captureCtx: OffscreenCanvasRenderingContext2D | null = null;

let dtype: Dtype = 'fp16';
let frozen = false;

// Engine v2: detection worker, fusion 2D→3D, gán nhãn (P1-B)
let detectWorker: Worker | null = null;
let detectReady = false;
let detectBusy = false;
let detectOn = false;
let lastBoxes: DetBox[] = []; // cũng là tập annotation khi frozen
let selectedObj = -1;
let engine: DetectionEngine = 'rtdetr';
let queries: string[] = ['person', 'chair', 'laptop', 'cup'];
let detW = 0;
let detH = 0;

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
const localModels = urlParams.has('localmodels') || __ROBOEYE_OFFLINE__;
const demoMode = urlParams.has('demo');
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
diagnostics.record('app.open', { demoMode, localModels, forceWebGL, forceWasm });

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
    if (on && !detectWorker) spawnDetectWorker();
    if (!on) {
      lastBoxes = [];
      selectedObj = -1;
      refreshAnnotations();
    }
    diagnostics.record('detection.toggle', { on });
  },
  onEngine: (e) => {
    engine = e;
    selectedObj = -1;
    lastBoxes = []; // xoá box của engine cũ khỏi overlay
    refreshAnnotations();
    if (detectWorker) {
      detectReady = false;
      shell.setObjStatus('đang tải model…');
      if (e === 'owlvit') detectWorker.postMessage({ type: 'queries', value: queries });
      detectWorker.postMessage({ type: 'engine', engine: e });
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
  }
}, { version: __ROBOEYE_VERSION__, demoMode, offlineMode: __ROBOEYE_OFFLINE__ });

function spawnDetectWorker() {
  detectWorker = new Worker(new URL('./worker/detect-worker.ts', import.meta.url), { type: 'module' });
  detectReady = false;
  detectBusy = false;
  shell.setObjStatus('đang tải model…');
  detectWorker.onmessage = (ev: MessageEvent<DetectionWorkerToMain>) => {
    const m = ev.data;
    if (m.type === 'loading') {
      detectReady = false;
      detectBusy = false;
      shell.setObjStatus('đang tải model…');
    } else if (m.type === 'ready') {
      detectReady = true;
      detectBusy = false;
      shell.setObjStatus(engine === 'owlvit' ? 'OWL-ViT · gõ chữ ra lớp' : 'RT-DETR · COCO');
      diagnostics.record('detection.ready', { engine, device: m.device });
    } else if (m.type === 'det') {
      detectBusy = false;
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
      shell.setObjStatus(recovery.status);
      diagnostics.record('detection.error', { engine, stage: m.stage, message: m.message });
    }
  };
  detectWorker.onerror = (event) => {
    detectBusy = false;
    detectReady = false;
    detectWorker?.terminate();
    detectWorker = null;
    console.error('[roboeye-detect-worker]', event.message || 'worker crash');
    shell.setObjStatus('worker lỗi · tắt/bật để thử lại');
    diagnostics.record('detection.crash', { message: event.message || 'worker crash' });
  };
  detectWorker.postMessage({ type: 'init', forceWasm, localModels, engine, queries });
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

function captureFrame(): ImageData | null {
  if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
  const aspect = video.videoWidth / video.videoHeight;
  const w = captureW;
  const h = Math.max(2, Math.round(w / aspect / 2) * 2);
  if (!captureCanvas || captureCanvas.width !== w || captureCanvas.height !== h) {
    captureCanvas = new OffscreenCanvas(w, h);
    captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!captureCtx) return null;
  captureCtx.drawImage(video, 0, 0, w, h);
  return captureCtx.getImageData(0, 0, w, h);
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
  window.addEventListener('resize', () => sceneApi?.resize());

  let lastT = performance.now();
  sceneApi.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = now - lastT;
    lastT = now;
    renderDtEma = renderDtEma * 0.9 + dt * 0.1;

    // Latest-frame-wins: chỉ capture + gửi khi worker rảnh
    if (workerReady && !workerBusy && !frozen && worker) {
      const img = captureFrame();
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
      const dimg = captureFrame();
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

    sceneApi?.render(dt);

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
