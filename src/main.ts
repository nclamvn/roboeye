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
import type { WorkerToMain, Dtype } from './types';

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

// Cần thử fallback (mục 9 PRD): ?webgl=1 ép render WebGL2, ?wasm=1 ép inference WASM
const urlParams = new URLSearchParams(location.search);
const forceWebGL = urlParams.has('webgl');
const forceWasm = urlParams.has('wasm');
const localModels = urlParams.has('localmodels');

let lastDepthAt = 0;
let inferIntervalEma = 0;
let renderDtEma = 16.7;
let lastMeterUpdate = 0;

const shell = createShell({
  onMode: (m) => sceneApi?.setMode(m),
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
  onStart: () => {
    void start();
  }
});

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
        }
        break;
      }
      case 'error': {
        console.error('[roboeye]', msg.message);
        shell.setBootError(msg.message);
        break;
      }
    }
  };
  worker.onerror = (e) => {
    shell.setBootError(`Worker lỗi: ${e.message ?? 'không rõ'}`);
  };
  worker.postMessage({ type: 'init', dtype, forceWasm, localModels });
}

function restartWorker() {
  worker?.terminate();
  lastDepthAt = 0;
  inferIntervalEma = 0;
  spawnWorker();
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
  try {
    await openCamera();
    await refreshCameraList();
  } catch (e) {
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

    sceneApi?.render(dt);

    if (now - lastMeterUpdate > 250) {
      lastMeterUpdate = now;
      shell.setRenderFps(1000 / renderDtEma);
      shell.setInferFps(inferIntervalEma > 0 ? 1000 / inferIntervalEma : null);
    }
  });
}

void boot();
