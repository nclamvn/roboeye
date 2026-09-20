const canvas = document.querySelector('#annotation-canvas');
const context = canvas.getContext('2d');
const frameStrip = document.querySelector('#frame-strip');
const emptyHint = document.querySelector('#empty-hint');
const saveState = document.querySelector('#save-state');
const classSelect = document.querySelector('#line-class');
const roleSelect = document.querySelector('#line-role');
const annotatedBy = document.querySelector('#annotated-by');

let task;
let annotations;
let image;
let frameIndex = 0;
let mode = 'line';
let pendingPoints = [];
let dirty = false;

const colours = {
  'lane-marking': '#43d8ff',
  curb: '#ff826c',
  median: '#f7c95d',
  barrier: '#ff4e8a',
  guardrail: '#b797ff',
  drivable: '#52e0a4',
};

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function setState(message, kind = '') {
  saveState.textContent = message;
  saveState.className = `badge ${kind}`.trim();
}

function markDirty() {
  dirty = true;
  annotations.status = 'draft';
  annotations.review = null;
  setState('CHƯA LƯU');
}

function currentFrame() {
  return annotations.frames[frameIndex];
}

function updateRoleState() {
  const isLane = classSelect.value === 'lane-marking';
  roleSelect.disabled = !isLane || mode === 'area';
  if (!isLane) roleSelect.value = 'unknown';
  classSelect.disabled = mode === 'area';
}

function canvasPoint(event) {
  const box = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
    y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
  };
}

function path(points, close = false) {
  if (!points.length) return;
  context.beginPath();
  for (const [index, point] of points.entries()) {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  if (close) context.closePath();
}

function drawPoints(points, colour) {
  context.fillStyle = colour;
  for (const point of points) {
    context.beginPath();
    context.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, Math.PI * 2);
    context.fill();
  }
}

function render() {
  if (!image) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const frame = currentFrame();
  for (const area of frame.areas) {
    path(area.points, true);
    context.fillStyle = 'rgb(82 224 164 / 18%)';
    context.fill();
    context.strokeStyle = colours.drivable;
    context.lineWidth = 3;
    context.stroke();
    drawPoints(area.points, colours.drivable);
  }
  for (const line of frame.lines) {
    path(line.points);
    context.strokeStyle = colours[line.class];
    context.lineWidth = line.role === 'ego-left' || line.role === 'ego-right' ? 5 : 3;
    context.stroke();
    drawPoints(line.points, colours[line.class]);
  }
  if (pendingPoints.length) {
    const colour = mode === 'area' ? colours.drivable : colours[classSelect.value];
    path(pendingPoints, mode === 'area' && pendingPoints.length > 2);
    context.strokeStyle = colour;
    context.lineWidth = 3;
    context.setLineDash([10, 7]);
    context.stroke();
    context.setLineDash([]);
    drawPoints(pendingPoints, colour);
  }
  const count = frame.lines.length + frame.areas.length;
  emptyHint.classList.toggle('hidden', count > 0 || pendingPoints.length > 0);
  const areaDone = annotations.frames.filter(item => item.areas.length > 0).length;
  const corridorDone = annotations.frames.filter(item => ['ego-left', 'ego-right'].every(role => item.lines.some(line => line.role === role))).length;
  document.querySelector('#shape-count').textContent = `${frame.lines.length} đường · ${frame.areas.length} vùng · tiến độ V ${areaDone}/${annotations.frames.length} · L ${corridorDone}/${annotations.frames.length}`;
  [...frameStrip.children].forEach((button, index) => {
    const item = annotations.frames[index];
    const hasArea = item.areas.length > 0;
    const hasCorridor = ['ego-left', 'ego-right'].every(role => item.lines.some(line => line.role === role));
    button.textContent = `${String(index + 1).padStart(2, '0')} · ${(task.frames[index].timeMs / 1000).toFixed(1)}s · V${hasArea ? '✓' : '—'} · L${hasCorridor ? '✓' : '—'}`;
    button.classList.toggle('active', index === frameIndex);
  });
}

function loadFrame(index) {
  frameIndex = index;
  pendingPoints = [];
  image = new Image();
  image.onload = () => {
    canvas.width = task.width;
    canvas.height = task.height;
    document.querySelector('#frame-meta').textContent = `FRAME ${index + 1}/${task.frames.length} · ${(task.frames[index].timeMs / 1000).toFixed(3)} s · ${task.width}×${task.height}`;
    render();
  };
  image.onerror = () => setState('LỖI ẢNH', 'error');
  image.src = `/frame/${index}?sha=${task.frames[index].imageSha256}`;
}

function finishShape() {
  const minimum = mode === 'area' ? 3 : 2;
  if (pendingPoints.length < minimum) {
    setState(`CẦN ${minimum} ĐIỂM`, 'error');
    return false;
  }
  const frame = currentFrame();
  const id = `${mode}-${frame.timeMs}-${Date.now().toString(36)}`;
  if (mode === 'area') frame.areas.push({ id, class: 'drivable', points: pendingPoints });
  else frame.lines.push({
    id,
    class: classSelect.value,
    role: classSelect.value === 'lane-marking' ? roleSelect.value : 'unknown',
    points: pendingPoints,
  });
  pendingPoints = [];
  markDirty();
  render();
  return true;
}

async function save(status) {
  try {
    if (pendingPoints.length && !finishShape()) throw new Error('Nét đang vẽ chưa đủ điểm để lưu');
    const name = annotatedBy.value.trim();
    if (!name) throw new Error('Cần tên vai người gán nhãn');
    annotations.annotatedBy = name;
    if (status === 'reviewed') {
      const reviewer = window.prompt('Tên vai người review (phải khác người gán nhãn):', 'local-reviewer')?.trim();
      if (!reviewer) return;
      if (reviewer === name) throw new Error('Người review phải khác người gán nhãn');
      const note = window.prompt('Ghi chú vòng review:', 'Đã kiểm tra ảnh thô, lớp, vai trò và hình học từng frame.')?.trim();
      if (!note) return;
      annotations.status = 'reviewed';
      annotations.review = { decision: 'accepted', reviewedBy: reviewer, reviewedAt: new Date().toISOString(), note };
    } else {
      annotations.status = 'draft';
      annotations.review = null;
    }
    setState('ĐANG LƯU');
    const receipt = await api('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(annotations),
    });
    annotations.revision = receipt.revision;
    dirty = false;
    setState(status === 'reviewed' ? 'REVIEWED' : 'ĐÃ LƯU', 'saved');
    return true;
  } catch (error) {
    setState('LƯU THẤT BẠI', 'error');
    window.alert(error.message);
    return false;
  }
}

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    pendingPoints = [];
    for (const item of document.querySelectorAll('[data-mode]')) item.classList.toggle('active', item === button);
    updateRoleState();
    render();
  });
}
classSelect.addEventListener('change', () => { updateRoleState(); render(); });
roleSelect.addEventListener('change', render);
canvas.addEventListener('click', event => {
  if (event.detail > 1) return;
  pendingPoints.push(canvasPoint(event));
  render();
});
canvas.addEventListener('dblclick', event => { event.preventDefault(); if (pendingPoints.length >= (mode === 'area' ? 3 : 2)) finishShape(); });
document.querySelector('#finish-shape').addEventListener('click', finishShape);
document.querySelector('#undo-point').addEventListener('click', () => { pendingPoints.pop(); render(); });
document.querySelector('#cancel-shape').addEventListener('click', () => { pendingPoints = []; render(); });
document.querySelector('#delete-shape').addEventListener('click', () => {
  const frame = currentFrame();
  if (mode === 'area') frame.areas.pop(); else frame.lines.pop();
  markDirty();
  render();
});
document.querySelector('#save-draft').addEventListener('click', () => save('draft'));
document.querySelector('#accept-review').addEventListener('click', () => save('reviewed'));
window.addEventListener('keydown', event => {
  if (event.key === 'Enter' && pendingPoints.length) finishShape();
  if (event.key === 'Escape') { pendingPoints = []; render(); }
  if (event.key === 'Backspace' && pendingPoints.length) { event.preventDefault(); pendingPoints.pop(); render(); }
});
window.addEventListener('beforeunload', event => { if (dirty) event.preventDefault(); });

try {
  [task, annotations] = await Promise.all([api('/api/task'), api('/api/annotations')]);
  annotatedBy.value = annotations.annotatedBy;
  document.querySelector('#task-id').textContent = task.taskId;
  document.querySelector('#clip-id').textContent = task.clipId;
  document.querySelector('#source-hash').textContent = task.sourceSha256;
  document.querySelector('#task-hash').textContent = task.taskSha256;
  task.frames.forEach((frame, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${String(index + 1).padStart(2, '0')} · ${(frame.timeMs / 1000).toFixed(1)}s · V— · L—`;
    button.addEventListener('click', async () => {
      if ((pendingPoints.length || dirty) && !await save('draft')) return;
      loadFrame(index);
    });
    frameStrip.append(button);
  });
  updateRoleState();
  setState(annotations.status === 'reviewed' ? 'REVIEWED' : 'BẢN NHÁP', annotations.status === 'reviewed' ? 'saved' : '');
  loadFrame(0);
} catch (error) {
  setState('KHỞI TẠO THẤT BẠI', 'error');
  window.alert(error.message);
}
