// Shell UI: sidebar HIVE, phím tắt, meters, badges, panel giải thích.
// DOM thuần, không framework (mục 7 PRD).

import type { Mode, InferDevice } from '../types';
import type { DetBox, DetectionEngine } from '../detection-types';
import { OWL_QUERY_PRESETS, type OwlQueryPresetId } from '../detection-presets';
import type { AirGesture, SketchPrediction } from '../airsketch-types';
import { localizeSketchLabel } from '../airsketch-labels';
import { assessSketchConfidence } from '../airsketch-confidence';

export interface ShellCallbacks {
  onMode(mode: Mode): void;
  onSize(px: number): void;
  onPointScale(mult: number): void;
  onDtype(dtype: 'fp16' | 'q4f16'): void;
  onCamera(deviceId: string): void;
  onFov(deg: number): void;
  onFreeze(frozen: boolean): void;
  onDetect(on: boolean): void;
  onEngine(engine: DetectionEngine): void;
  onQueries(list: string[]): void;
  onExport(fmt: 'coco' | 'yolo' | '3d'): void;
  onSelectObject(idx: number): void;
  onDeleteObject(idx: number): void;
  onRelabelObject(idx: number, label: string): void;
  onStart(): void;
  onDemoStart(): void;
  onRetryDepth(): void;
  onDiagnostics(): void;
  onAirSketch(on: boolean): void;
  onAirUndo(): void;
  onAirClear(): void;
  onAirAddPrediction(index: number): void;
  onAirSpeak(): void;
  onAirClearPhrase(): void;
}

export interface ShellOptions {
  version: string;
  demoMode: boolean;
  offlineMode: boolean;
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
  setBevStatus(route: 'idle' | 'blocked' | 'arrived' | 'moving', pathSteps: number | null): void;
  drawDetections(boxes: DetBox[], rect: { x: number; y: number; w: number; h: number }, show: boolean, selected: number): void;
  showLabelTools(on: boolean): void;
  renderObjects(objs: DetBox[], selected: number): void;
  setObjStatus(text: string): void;
  setNetwork(online: boolean): void;
  showRuntimeNotice(text: string, retry: boolean): void;
  hideRuntimeNotice(): void;
  startTour(): void;
  isFrozen(): boolean;
  currentMode(): Mode;
  setAirSketchActive(on: boolean): void;
  setAirSketchStatus(text: string): void;
  setAirSketchPredictions(predictions: SketchPrediction[]): void;
  setAirSketchPhrase(words: string[]): void;
  setAirSketchCursor(point: { x: number; y: number } | null, gesture?: AirGesture, progress?: number): void;
}

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Thiếu phần tử ${sel}`);
  return el;
};

export function createShell(cb: ShellCallbacks, options: ShellOptions): ShellAPI {
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
  const badgeNetwork = $('#badge-network');
  const freezeBtn = $<HTMLButtonElement>('#freeze-btn');
  const frozenTag = $('#frozen-tag');
  const alertChip = $('#alert-chip');
  const bevStatus = $('#bev-status');
  const bevStatusText = $('#bev-status-text');
  const detToggle = $<HTMLInputElement>('#detect-toggle');
  const detOverlay = document.getElementById('det-overlay') as unknown as SVGSVGElement;
  const detCount = $('#det-count');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const labelTools = $('#label-tools');
  const engineSelect = $<HTMLSelectElement>('#engine-select');
  const queryCtl = $('#query-ctl');
  const queryPreset = $<HTMLSelectElement>('#query-preset');
  const queryInput = $<HTMLInputElement>('#query-input');
  const objPanel = $('#obj-panel');
  const objList = $('#obj-list');
  const objStatus = $('#obj-status');
  const sidebar = $('#sidebar');
  const mobileControlsBtn = $<HTMLButtonElement>('#mobile-controls-btn');
  const diagnosticsBtn = $<HTMLButtonElement>('#diagnostics-btn');
  const runtimeNotice = $('#runtime-notice');
  const runtimeNoticeText = $('#runtime-notice-text');
  const runtimeRetryBtn = $<HTMLButtonElement>('#runtime-retry-btn');
  const runtimeDismissBtn = $<HTMLButtonElement>('#runtime-dismiss-btn');
  const tour = $('#tour');
  const tourIndex = $('#tour-index');
  const tourTitle = $('#tour-title');
  const tourCopy = $('#tour-copy');
  const tourNext = $<HTMLButtonElement>('#tour-next');
  const tourSkip = $<HTMLButtonElement>('#tour-skip');

  $('#app-version').textContent = `v${options.version}`;
  $('#boot-version').textContent = `v${options.version}`;
  if (options.offlineMode) {
    $('#boot-sub').textContent = 'Bản offline dùng model depth q8 đã đóng gói. Camera và dữ liệu luôn ở lại trên máy này.';
    dtypeSelect.selectedOptions[0].textContent = 'q8 · offline';
    dtypeSelect.disabled = true;
    detToggle.disabled = true;
    detToggle.parentElement?.setAttribute('title', 'Bản offline depth không đóng gói model detection');
  }

  engineSelect.addEventListener('change', () => {
    const e = engineSelect.value as DetectionEngine;
    queryCtl.hidden = e !== 'owlvit';
    cb.onEngine(e);
  });
  let queryTimer = 0;
  queryPreset.addEventListener('change', () => {
    if (queryPreset.value === 'custom') return;
    const preset = OWL_QUERY_PRESETS[queryPreset.value as OwlQueryPresetId];
    queryInput.value = preset.queries.join(', ');
    cb.onQueries([...preset.queries]);
  });
  queryInput.addEventListener('input', () => {
    queryPreset.value = 'custom';
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
  const demoStartBtn = $<HTMLButtonElement>('#demo-start-btn');
  const viewport = $('#viewport');
  const airSketchBtn = $<HTMLButtonElement>('#airsketch-btn');
  const airDock = $('#airsketch-dock');
  const airStatus = $('#air-status');
  const airGuess = $('#air-guess');
  const airPredictions = $('#air-predictions');
  const airPhrase = $('#air-phrase');
  const airCursor = $('#airsketch-cursor');
  let airSketchActive = false;

  const tourSteps: Array<{ mode: Mode; title: string; copy: string }> = [
    { mode: 'rgb', title: 'Camera là điểm xuất phát', copy: 'Đây là tín hiệu thô duy nhất robot nhận được. Camera không rời khỏi thiết bị này.' },
    { mode: 'depth', title: 'Mỗi pixel có xa và gần', copy: 'Depth Anything biến ảnh phẳng thành độ sâu tương đối: sáng gần, tối xa.' },
    { mode: 'cloud', title: 'Ảnh phẳng trở thành không gian', copy: 'Point cloud chiếu màu và depth thành các điểm 3D. Kéo chuột để nhìn khỏi vị trí camera.' },
    { mode: 'bev', title: 'Không gian trở thành đường đi', copy: 'BEV ép point cloud xuống mặt sàn. Click lên lưới để robot ảo tìm đường A* tránh vật cản.' }
  ];
  let tourStep = 0;

  function applyMode(m: Mode) {
    mode = m;
    for (const btn of modeButtons) btn.classList.toggle('active', btn.dataset.mode === m);
    bevStatus.hidden = m !== 'bev';
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

  mobileControlsBtn.addEventListener('click', () => {
    const open = sidebar.classList.toggle('mobile-open');
    mobileControlsBtn.setAttribute('aria-expanded', String(open));
  });
  diagnosticsBtn.addEventListener('click', () => cb.onDiagnostics());
  airSketchBtn.addEventListener('click', () => cb.onAirSketch(!airSketchActive));
  $<HTMLButtonElement>('#air-close-btn').addEventListener('click', () => cb.onAirSketch(false));
  $<HTMLButtonElement>('#air-undo-btn').addEventListener('click', () => cb.onAirUndo());
  $<HTMLButtonElement>('#air-clear-btn').addEventListener('click', () => cb.onAirClear());
  $<HTMLButtonElement>('#air-add-btn').addEventListener('click', () => cb.onAirAddPrediction(0));
  $<HTMLButtonElement>('#air-speak-btn').addEventListener('click', () => cb.onAirSpeak());
  $<HTMLButtonElement>('#air-clear-phrase-btn').addEventListener('click', () => cb.onAirClearPhrase());
  runtimeRetryBtn.addEventListener('click', () => cb.onRetryDepth());
  runtimeDismissBtn.addEventListener('click', () => { runtimeNotice.hidden = true; });

  function renderTour() {
    const step = tourSteps[tourStep];
    tourIndex.textContent = `${String(tourStep + 1).padStart(2, '0')} / ${String(tourSteps.length).padStart(2, '0')}`;
    tourTitle.textContent = step.title;
    tourCopy.textContent = step.copy;
    tourNext.textContent = tourStep === tourSteps.length - 1 ? 'Hoàn tất' : 'Tiếp tục';
    applyMode(step.mode);
  }

  function closeTour() {
    tour.hidden = true;
  }

  tourNext.addEventListener('click', () => {
    if (tourStep === tourSteps.length - 1) closeTour();
    else {
      tourStep++;
      renderTour();
    }
  });
  tourSkip.addEventListener('click', closeTour);

  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    demoStartBtn.disabled = true;
    cb.onStart();
  });
  demoStartBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    demoStartBtn.disabled = true;
    cb.onDemoStart();
  });
  if (options.demoMode) {
    demoStartBtn.classList.add('recommended');
    startBtn.classList.add('boot-btn-secondary');
  }

  window.addEventListener('keydown', (e) => {
    // Chỉ chặn phím tắt khi focus ở ô nhập chữ hoặc dropdown, cho phép ở checkbox/range/button
    const t = e.target;
    const isText = t instanceof HTMLInputElement && ['text', 'number', 'search'].includes(t.type);
    if (isText || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    const keyToMode: Record<string, Mode> = { '1': 'rgb', '2': 'depth', '3': 'cloud', '4': 'bev' };
    if (keyToMode[e.key]) applyMode(keyToMode[e.key]);
    else if (e.key === 'f' || e.key === 'F') toggleFreeze();
    else if (e.key === '?' || e.key === '/') togglePanel();
    else if (e.key === 'Escape' && airSketchActive) cb.onAirSketch(false);
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
      if (text) demoStartBtn.disabled = false;
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
    setBevStatus(route, pathSteps) {
      if (route === 'idle') bevStatusText.textContent = 'Chạm lưới để đặt đích';
      else if (route === 'blocked') bevStatusText.textContent = 'Không có đường tới đích';
      else if (route === 'arrived') bevStatusText.textContent = 'Đã tới đích';
      else bevStatusText.textContent = `${pathSteps ?? '–'} bước · đang replan`;
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
        r.setAttribute('class', i === selected ? 'det-lock det-lock-selected' : 'det-lock');
        r.setAttribute('x', sx0.toFixed(1));
        r.setAttribute('y', sy0.toFixed(1));
        r.setAttribute('width', w.toFixed(1));
        r.setAttribute('height', h.toFixed(1));
        detOverlay.appendChild(r);
        const label = `${b.label.toUpperCase()} · ${(b.score * 100).toFixed(0)}%`;
        const badgeHeight = 20;
        // A small object can still have a long Vietnamese label. Let the
        // badge extend from its frame edge, bounded by the video viewport,
        // rather than clipping the label to the box width.
        const badgeWidth = Math.min(rect.x + rect.w - sx0, Math.max(66, label.length * 6.7 + 16));
        // The badge sits on the top edge of its own lock frame. If a box is
        // close to the camera's top edge, keep it inside rather than clipping.
        const badgeY = Math.max(rect.y, sy0 - badgeHeight);
        const bg = document.createElementNS(SVGNS, 'rect');
        bg.setAttribute('class', 'det-label-bg det-lock-badge');
        bg.setAttribute('x', sx0.toFixed(1));
        bg.setAttribute('y', badgeY.toFixed(1));
        bg.setAttribute('width', badgeWidth.toFixed(1));
        bg.setAttribute('height', String(badgeHeight));
        bg.setAttribute('rx', '2');
        detOverlay.appendChild(bg);
        const t = document.createElementNS(SVGNS, 'text');
        t.setAttribute('class', 'det-lock-label');
        t.setAttribute('x', (sx0 + 8).toFixed(1));
        t.setAttribute('y', (badgeY + 13.5).toFixed(1));
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
    setNetwork(online) {
      badgeNetwork.textContent = online ? 'MẠNG · ONLINE' : 'MẠNG · OFFLINE';
      badgeNetwork.dataset.state = online ? 'good' : 'fallback';
    },
    showRuntimeNotice(text, retry) {
      runtimeNoticeText.textContent = text;
      runtimeRetryBtn.hidden = !retry;
      runtimeNotice.hidden = false;
    },
    hideRuntimeNotice() {
      runtimeNotice.hidden = true;
    },
    startTour() {
      tourStep = 0;
      tour.hidden = false;
      renderTour();
      tourNext.focus();
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
        // Giữ nguyên node giữa hai click để sự kiện dblclick không bị renderObjects
        // thay thế sau click đầu tiên. Chọn object vẫn thực hiện ở phần còn lại của row.
        name.addEventListener('click', (e) => e.stopPropagation());
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
    setAirSketchActive(on) {
      airSketchActive = on;
      airSketchBtn.classList.toggle('active', on);
      airSketchBtn.setAttribute('aria-pressed', String(on));
      airDock.hidden = !on;
      viewport.classList.toggle('airsketch-active', on);
      airCursor.hidden = true;
    },
    setAirSketchStatus(text) {
      airStatus.textContent = text;
    },
    setAirSketchPredictions(predictions) {
      airPredictions.replaceChildren();
      const confidence = assessSketchConfidence(predictions);
      airGuess.dataset.confidence = confidence;
      airGuess.textContent = !predictions[0]
        ? 'Vẽ một vật thể'
        : confidence === 'uncertain'
          ? 'Chưa đủ chắc chắn'
          : localizeSketchLabel(predictions[0].label);
      predictions.forEach((prediction, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.label = prediction.label;
        button.dataset.score = String(prediction.score);
        const name = document.createElement('span');
        name.textContent = localizeSketchLabel(prediction.label);
        const score = document.createElement('small');
        score.textContent = `${Math.round(prediction.score * 100)}%`;
        button.append(name, score);
        button.setAttribute('aria-label', `Thêm ${name.textContent} vào câu`);
        button.addEventListener('click', () => cb.onAirAddPrediction(index));
        airPredictions.appendChild(button);
      });
    },
    setAirSketchPhrase(words) {
      airPhrase.textContent = words.length ? words.join(' · ') : 'Chưa có từ nào';
      airPhrase.classList.toggle('empty', words.length === 0);
    },
    setAirSketchCursor(point, gesture = 'hover', progress = 0) {
      airCursor.hidden = !airSketchActive || point == null;
      if (!point) return;
      airCursor.style.left = `${point.x * 100}%`;
      airCursor.style.top = `${point.y * 100}%`;
      airCursor.style.setProperty('--hold-progress', `${Math.round(progress * 360)}deg`);
      airCursor.dataset.gesture = gesture;
    },
    isFrozen: () => frozen,
    currentMode: () => mode
  };
}
