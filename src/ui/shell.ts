// Shell UI: sidebar HIVE, phím tắt, meters, badges, panel giải thích.
// DOM thuần, không framework (mục 7 PRD).

import type { Mode, InferDevice } from '../types';
import type { DetBox } from '../worker/detect-worker';

export interface ShellCallbacks {
  onMode(mode: Mode): void;
  onSize(px: number): void;
  onPointScale(mult: number): void;
  onDtype(dtype: 'fp16' | 'q4f16'): void;
  onCamera(deviceId: string): void;
  onFov(deg: number): void;
  onFreeze(frozen: boolean): void;
  onDetect(on: boolean): void;
  onEngine(engine: 'rtdetr' | 'owlvit'): void;
  onQueries(list: string[]): void;
  onExport(fmt: 'coco' | 'yolo' | '3d'): void;
  onSelectObject(idx: number): void;
  onDeleteObject(idx: number): void;
  onRelabelObject(idx: number, label: string): void;
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
  setAlert(nearest: number | null): void;
  drawDetections(boxes: DetBox[], rect: { x: number; y: number; w: number; h: number }, show: boolean, selected: number): void;
  showLabelTools(on: boolean): void;
  renderObjects(objs: DetBox[], selected: number): void;
  setObjStatus(text: string): void;
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
  const alertChip = $('#alert-chip');
  const detToggle = $<HTMLInputElement>('#detect-toggle');
  const detOverlay = document.getElementById('det-overlay') as unknown as SVGSVGElement;
  const detCount = $('#det-count');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const labelTools = $('#label-tools');
  const engineSelect = $<HTMLSelectElement>('#engine-select');
  const queryCtl = $('#query-ctl');
  const queryInput = $<HTMLInputElement>('#query-input');
  const objPanel = $('#obj-panel');
  const objList = $('#obj-list');
  const objStatus = $('#obj-status');

  engineSelect.addEventListener('change', () => {
    const e = engineSelect.value as 'rtdetr' | 'owlvit';
    queryCtl.hidden = e !== 'owlvit';
    cb.onEngine(e);
  });
  let queryTimer = 0;
  queryInput.addEventListener('input', () => {
    window.clearTimeout(queryTimer);
    queryTimer = window.setTimeout(() => {
      cb.onQueries(queryInput.value.split(',').map((s) => s.trim()).filter((s) => s.length > 0));
    }, 500);
  });
  $<HTMLButtonElement>('#exp-coco').addEventListener('click', () => cb.onExport('coco'));
  $<HTMLButtonElement>('#exp-yolo').addEventListener('click', () => cb.onExport('yolo'));
  $<HTMLButtonElement>('#exp-3d').addEventListener('click', () => cb.onExport('3d'));
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
  detToggle.addEventListener('change', () => cb.onDetect(detToggle.checked));
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
    // Chỉ chặn phím tắt khi focus ở ô nhập chữ hoặc dropdown, cho phép ở checkbox/range/button
    const t = e.target;
    const isText = t instanceof HTMLInputElement && ['text', 'number', 'search'].includes(t.type);
    if (isText || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
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
    setAlert(nearest) {
      if (nearest == null) {
        alertChip.hidden = true;
      } else {
        alertChip.hidden = false;
        alertChip.textContent = `VẬT CẢN GẦN · ${nearest.toFixed(1)} đv`;
      }
    },
    drawDetections(boxes, rect, show, selected) {
      detOverlay.style.display = show ? 'block' : 'none';
      detCount.hidden = !show;
      while (detOverlay.firstChild) detOverlay.removeChild(detOverlay.firstChild);
      if (!show) return;
      detCount.textContent = `${boxes.length} vật`;
      // Ảnh hiển thị mirror ngang (selfie) nên lật x: displayed = 1 - raw
      boxes.forEach((b, i) => {
        const sx0 = rect.x + (1 - b.x1) * rect.w;
        const sx1 = rect.x + (1 - b.x0) * rect.w;
        const sy0 = rect.y + b.y0 * rect.h;
        const sy1 = rect.y + b.y1 * rect.h;
        const w = Math.max(1, sx1 - sx0);
        const h = Math.max(1, sy1 - sy0);
        const r = document.createElementNS(SVGNS, 'rect');
        r.setAttribute('x', sx0.toFixed(1));
        r.setAttribute('y', sy0.toFixed(1));
        r.setAttribute('width', w.toFixed(1));
        r.setAttribute('height', h.toFixed(1));
        if (i === selected) r.setAttribute('stroke-width', '3');
        detOverlay.appendChild(r);
        const label = `${b.label} ${(b.score * 100).toFixed(0)}`;
        const bg = document.createElementNS(SVGNS, 'rect');
        bg.setAttribute('class', 'det-label-bg');
        bg.setAttribute('x', sx0.toFixed(1));
        bg.setAttribute('y', (sy0 - 14).toFixed(1));
        bg.setAttribute('width', (label.length * 6.5 + 6).toFixed(1));
        bg.setAttribute('height', '14');
        detOverlay.appendChild(bg);
        const t = document.createElementNS(SVGNS, 'text');
        t.setAttribute('x', (sx0 + 3).toFixed(1));
        t.setAttribute('y', (sy0 - 3).toFixed(1));
        t.textContent = label;
        detOverlay.appendChild(t);
      });
    },
    showLabelTools(on) {
      labelTools.hidden = !on;
      objPanel.hidden = !on;
    },
    setObjStatus(text) {
      objStatus.textContent = text;
    },
    renderObjects(objs, selected) {
      while (objList.firstChild) objList.removeChild(objList.firstChild);
      objs.forEach((o, i) => {
        const row = document.createElement('div');
        row.className = 'obj-row' + (i === selected ? ' sel' : '');
        row.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).classList.contains('obj-del')) return;
          cb.onSelectObject(i);
        });
        const name = document.createElement('span');
        name.className = 'obj-name';
        name.textContent = o.label;
        // Double click tên → sửa lớp
        name.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const input = document.createElement('input');
          input.className = 'obj-name-input';
          input.value = o.label;
          const commit = () => cb.onRelabelObject(i, input.value.trim() || o.label);
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
            if (ev.key === 'Escape') { input.value = o.label; input.blur(); }
          });
          input.addEventListener('blur', commit);
          row.replaceChild(input, name);
          input.focus();
          input.select();
        });
        const score = document.createElement('span');
        score.className = 'obj-score';
        score.textContent = `${(o.score * 100).toFixed(0)}`;
        const del = document.createElement('button');
        del.className = 'obj-del';
        del.textContent = '×';
        del.setAttribute('aria-label', 'Xoá');
        del.addEventListener('click', (e) => { e.stopPropagation(); cb.onDeleteObject(i); });
        row.appendChild(name);
        row.appendChild(score);
        row.appendChild(del);
        objList.appendChild(row);
      });
    },
    isFrozen: () => frozen,
    currentMode: () => mode
  };
}
