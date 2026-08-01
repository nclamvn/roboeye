// Shell UI: sidebar HIVE, phím tắt, meters, badges, panel giải thích.
// DOM thuần, không framework (mục 7 PRD).

import type { Mode, InferDevice } from '../types';

export interface ShellCallbacks {
  onMode(mode: Mode): void;
  onSize(px: number): void;
  onPointScale(mult: number): void;
  onDtype(dtype: 'fp16' | 'q4f16'): void;
  onCamera(deviceId: string): void;
  onFov(deg: number): void;
  onFreeze(frozen: boolean): void;
  onStart(): void;
}

export interface ShellAPI {
  setMode(mode: Mode): void;
  setInferFps(fps: number | null): void;
  setRenderFps(fps: number): void;
  setInferBadge(device: InferDevice | null): void;
  setRenderBadge(isWebGPU: boolean): void;
  setBootStatus(text: string): void;
  setBootProgress(pct: number | null): void;
  setBootError(text: string): void;
  hideBoot(): void;
  setCameras(cams: { id: string; label: string }[]): void;
  setSizeValue(px: number): void;
  isFrozen(): boolean;
  currentMode(): Mode;
}

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Thiếu phần tử ${sel}`);
  return el;
};

export function createShell(cb: ShellCallbacks): ShellAPI {
  let mode: Mode = 'rgb';
  let frozen = false;

  const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-btn'));
  const sizeSlider = $<HTMLInputElement>('#size-slider');
  const sizeValue = $('#size-value');
  const pointSlider = $<HTMLInputElement>('#point-slider');
  const pointValue = $('#point-value');
  const dtypeSelect = $<HTMLSelectElement>('#dtype-select');
  const cameraSelect = $<HTMLSelectElement>('#camera-select');
  const fovSlider = $<HTMLInputElement>('#fov-slider');
  const fovValue = $('#fov-value');
  const fpsInfer = $('#fps-infer');
  const fpsRender = $('#fps-render');
  const badgeInfer = $('#badge-infer');
  const badgeRender = $('#badge-render');
  const freezeBtn = $<HTMLButtonElement>('#freeze-btn');
  const frozenTag = $('#frozen-tag');
  const panel = $('#panel');
  const panelBtn = $<HTMLButtonElement>('#panel-btn');
  const panelClose = $<HTMLButtonElement>('#panel-close');
  const boot = $('#boot');
  const bootStatus = $('#boot-status');
  const bootProgress = $('#boot-progress');
  const bootError = $('#boot-error');
  const startBtn = $<HTMLButtonElement>('#start-btn');

  function applyMode(m: Mode) {
    mode = m;
    for (const btn of modeButtons) btn.classList.toggle('active', btn.dataset.mode === m);
    for (const sec of document.querySelectorAll('.panel-sec')) {
      sec.classList.toggle('current', (sec as HTMLElement).dataset.mode === m);
    }
    cb.onMode(m);
  }

  for (const btn of modeButtons) {
    btn.addEventListener('click', () => applyMode(btn.dataset.mode as Mode));
  }

  sizeSlider.addEventListener('input', () => {
    sizeValue.textContent = sizeSlider.value;
    cb.onSize(Number(sizeSlider.value));
  });

  pointSlider.addEventListener('input', () => {
    pointValue.textContent = Number(pointSlider.value).toFixed(1);
    cb.onPointScale(Number(pointSlider.value));
  });

  dtypeSelect.addEventListener('change', () => cb.onDtype(dtypeSelect.value as 'fp16' | 'q4f16'));
  cameraSelect.addEventListener('change', () => cb.onCamera(cameraSelect.value));

  fovSlider.addEventListener('input', () => {
    fovValue.textContent = `${fovSlider.value}°`;
    cb.onFov(Number(fovSlider.value));
  });

  function toggleFreeze() {
    frozen = !frozen;
    freezeBtn.classList.toggle('active', frozen);
    frozenTag.hidden = !frozen;
    cb.onFreeze(frozen);
  }
  freezeBtn.addEventListener('click', toggleFreeze);

  function togglePanel(open?: boolean) {
    const willOpen = open ?? !panel.classList.contains('open');
    panel.classList.toggle('open', willOpen);
    panel.setAttribute('aria-hidden', String(!willOpen));
  }
  panelBtn.addEventListener('click', () => togglePanel());
  panelClose.addEventListener('click', () => togglePanel(false));

  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    cb.onStart();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const keyToMode: Record<string, Mode> = { '1': 'rgb', '2': 'depth', '3': 'cloud', '4': 'bev' };
    if (keyToMode[e.key]) applyMode(keyToMode[e.key]);
    else if (e.key === 'f' || e.key === 'F') toggleFreeze();
    else if (e.key === '?' || e.key === '/') togglePanel();
    else if (e.key === 'Escape') togglePanel(false);
  });

  return {
    setMode: applyMode,
    setInferFps(fps) {
      fpsInfer.textContent = fps == null ? '–' : fps.toFixed(1);
    },
    setRenderFps(fps) {
      fpsRender.textContent = fps.toFixed(0);
    },
    setInferBadge(device) {
      if (device == null) {
        badgeInfer.textContent = 'INFER · …';
        badgeInfer.dataset.state = 'loading';
      } else {
        badgeInfer.textContent = device === 'webgpu' ? 'INFER · WEBGPU' : 'INFER · WASM';
        badgeInfer.dataset.state = device === 'webgpu' ? 'good' : 'fallback';
      }
    },
    setRenderBadge(isWebGPU) {
      badgeRender.textContent = isWebGPU ? 'RENDER · WEBGPU' : 'RENDER · WEBGL2';
      badgeRender.dataset.state = isWebGPU ? 'good' : 'fallback';
    },
    setBootStatus(text) {
      bootStatus.textContent = text;
    },
    setBootProgress(pct) {
      bootProgress.style.width = pct == null ? '0%' : `${Math.min(100, Math.max(0, pct)).toFixed(1)}%`;
    },
    setBootError(text) {
      bootError.hidden = text.length === 0;
      bootError.textContent = text;
      if (text) startBtn.disabled = false;
    },
    hideBoot() {
      boot.classList.add('hidden');
    },
    setCameras(cams) {
      cameraSelect.innerHTML = '';
      for (const cam of cams) {
        const opt = document.createElement('option');
        opt.value = cam.id;
        opt.textContent = cam.label;
        cameraSelect.appendChild(opt);
      }
    },
    setSizeValue(px) {
      sizeSlider.value = String(px);
      sizeValue.textContent = String(px);
    },
    isFrozen: () => frozen,
    currentMode: () => mode
  };
}
