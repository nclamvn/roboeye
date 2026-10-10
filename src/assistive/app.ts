import './styles.css';
import { LIMITS, exportRecording, importRecording, type FramePacket, type Recording, type Label } from './contract';
import { SCENARIOS, syntheticScenario, COLLECTION_PLAN, evaluateRecording, type ScenarioId } from './corpus';
import { toDisplay, rangesAt, type RangeReason } from './range';
import { MetadataRecorder, ReplayCursor, CameraLease } from './recording';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;
const button = (id: string) => el<HTMLButtonElement>(id);
const video = el<HTMLVideoElement>('camera-video'), canvas = el<HTMLCanvasElement>('replay-canvas'), ctx = canvas.getContext('2d')!;
const seek = el<HTMLInputElement>('seek'), consent = el<HTMLInputElement>('consent'), scenario = el<HTMLSelectElement>('scenario');
const recorder = new MetadataRecorder(), lease = new CameraLease();
let loaded: Recording | null = null, cursor: ReplayCursor | null = null;
let cameraOpen = false, cameraPending = false, epoch = 0, playing = false, startedPlayback = 0, playbackOffset = 0;
let recordingOrigin = 0, lastCapture = -Infinity, cameraFrameId = 0, cameraTimer: ReturnType<typeof setInterval> | null = null;
let dataGeneration = 0, importSequence = 0;
const names: Record<Label, string> = { person: 'Người', chair: 'Ghế', bottle: 'Chai', phone: 'Điện thoại', book: 'Sách', wall: 'Tường', vehicle: 'Xe', unknown: 'Vật chưa định danh' };
const reasons: Record<RangeReason, string> = { supported: 'Tính từ vùng hỗ trợ 3D', 'no-depth': 'Không có depth', 'relative-only': 'Depth tương đối, không có thang mét', 'no-intrinsics': 'Thiếu intrinsics camera', stale: 'Bằng chứng quá cũ', 'clock-future': 'Sai đồng hồ', 'rgb-depth-skew': 'RGB và depth lệch thời điểm', 'depth-reused': 'Depth đã dùng, không phải phép đo mới', 'no-foreground': 'Chưa tách vật khỏi nền', 'low-support': 'Thiếu điểm depth đủ tin cậy', 'ambiguous-support': 'Vùng hỗ trợ mâu thuẫn', 'outside-domain': 'Ngoài vùng kiểm thử 0,5–5 m' };
function status(text: string, error = false) { el('status').textContent = text; el('status').dataset.error = String(error); }
function controls() {
  button('open-camera').disabled = cameraOpen || cameraPending;
  button('stop-camera').disabled = !cameraOpen && !cameraPending;
  button('record').disabled = !cameraOpen || !consent.checked || recorder.state === 'recording' || recorder.count > 0;
  button('stop-record').disabled = recorder.state !== 'recording';
  button('export').disabled = recorder.state === 'recording' || (!loaded && recorder.count === 0);
  button('play').disabled = cameraOpen || cameraPending || !cursor || cursor.durationMs === 0;
  seek.disabled = cameraOpen || cameraPending || !cursor || cursor.durationMs === 0;
  el('record-badge').hidden = recorder.count === 0 && recorder.state !== 'recording';
  el('record-badge').textContent = `${recorder.state === 'recording' ? 'Ghi' : 'Dừng'} · ${recorder.count}/600`;
  button('play').textContent = playing ? 'Tạm dừng' : 'Phát';
  button('play').setAttribute('aria-label', playing ? 'Tạm dừng replay' : 'Phát replay');
}
function pause() { playing = false; controls(); }
function draw() {
  if (cameraOpen || cameraPending) return;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const f = cursor?.recording.frames[cursor.index];
  if (!f) { el('range-value').textContent = 'Chọn tình huống'; el('range-note').textContent = 'Không có mô hình đo khoảng cách trong camera ở bước này.'; el('time').textContent = '0,0 s'; return; }
  const rotated = f.display.rotation === 90 || f.display.rotation === 270;
  const width = 960, height = Math.round(960 * (rotated ? f.display.crop.width / f.display.crop.height : f.display.crop.height / f.display.crop.width));
  if (canvas.height !== height) canvas.height = height;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#28323f'; ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 0; y < height; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  const ranges = rangesAt(cursor!.recording.frames, cursor!.index);
  for (const [index, t] of f.targets.entries()) {
    const corners = [[t.box.x, t.box.y], [t.box.x + t.box.width, t.box.y], [t.box.x + t.box.width, t.box.y + t.box.height], [t.box.x, t.box.y + t.box.height]].map(([u, v]) => toDisplay(u, v, f.display));
    ctx.strokeStyle = ['#91baff', '#e2c0ff', '#ffce85'][index % 3]; ctx.lineWidth = 3;
    ctx.beginPath(); corners.forEach(([x, y], i) => i ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height)); ctx.closePath(); ctx.stroke();
    const x = Math.max(10, Math.min(...corners.map(p => p[0])) * width), y = Math.max(60, Math.min(...corners.map(p => p[1])) * height - 12);
    ctx.font = '24px Inter, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(names[t.label], x, y);
    for (const i of t.sampleIndices) { const s = f.depth!.samples[i], [x, y] = toDisplay(s.u, s.v, f.display); ctx.beginPath(); ctx.arc(x * width, y * height, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffe0a0'; ctx.fill(); }
  }
  const r = ranges[0];
  el('range-value').textContent = r?.metres !== null && r?.metres !== undefined ? `≈${r.metres.toFixed(2).replace('.', ',')} m` : 'Chưa có phép đo';
  el('range-note').textContent = r ? `${reasons[r.reason]} · ${f.provider === 'fixture' ? 'mô phỏng, không phải đo thực' : 'nguồn khai báo, chưa kiểm chứng vật lý'}` : 'Metadata camera không chứa nhận diện hoặc depth.';
  el('time').textContent = `${((f.rgb.capturedAtMs - cursor!.recording.frames[0].rgb.capturedAtMs) / 1000).toFixed(1).replace('.', ',')} s`;
}
function details() {
  const dl = el('evidence'); dl.replaceChildren(); if (!loaded) return;
  const metrics = evaluateRecording(loaded);
  for (const [label, value] of [
    ['Nguồn phiên', loaded.origin === 'synthetic-fixture' ? 'Mô phỏng toán học' : 'Nguồn do file/adapter khai báo'],
    ['Frame', String(loaded.frames.length)], ['Quan sát có giá trị tính toán', `${metrics.supportedObservations}/${metrics.targetObservations}`],
    ['Mẫu đo thực holdout', String(metrics.measuredHoldoutLabels)], ['Sai số MAE thực', metrics.maeM === null ? 'Chưa có dữ liệu đo thực' : `${metrics.maeM.toFixed(3)} m (nhãn khai báo)`],
    ['Latency điện thoại / âm thanh', 'Chưa đo'], ['Nghiệm thu vật lý', 'Chưa đạt / chưa kiểm chứng'],
  ]) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; dl.append(dt, dd); }
}
function load(r: Recording) {
  dataGeneration++; pause(); loaded = r; cursor = new ReplayCursor(r); seek.max = String(cursor.durationMs); seek.value = '0';
  video.hidden = true; canvas.hidden = false;
  el('source-badge').textContent = r.origin === 'synthetic-fixture' ? 'Mô phỏng · không phải camera' : 'Replay metadata · nguồn chưa xác thực';
  details(); controls(); draw();
}
function stopCamera(message?: string) {
  epoch++; lease.stop(); cameraOpen = false; cameraPending = false;
  if (cameraTimer) clearInterval(cameraTimer); cameraTimer = null;
  video.pause(); video.srcObject = null; video.hidden = true; canvas.hidden = false;
  recorder.stop(); const recorded = recorder.snapshot();
  if (recorded?.frames.length) load(recorded); else { controls(); draw(); }
  if (message) status(message);
}
function cameraTick() {
  if (!cameraOpen) return;
  const now = performance.now();
  if (recorder.state === 'recording') {
    recorder.tick(now - recordingOrigin);
    if (recorder.state === 'recording' && now - lastCapture >= 190 && video.readyState >= 2 && video.videoWidth > 0) {
      const time = now - recordingOrigin; lastCapture = now;
      const frame: FramePacket = { schema: 'assistive-frame-v1', id: cameraFrameId++, clock: 'session-monotonic-ms', provider: 'browser-camera',
        // Browser callback availability time, not sensor-exposure timestamp.
        rgb: { capturedAtMs: time, readyAtMs: time, width: video.videoWidth, height: video.videoHeight, timestampBasis: 'browser-availability' },
        display: { crop: { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight }, rotation: 0, mirrored: false },
        intrinsics: null, cameraToWorld: null, depth: null, targets: [] };
      recorder.append(frame);
    }
    if (recorder.state !== 'recording') status('Đã chạm giới hạn ghi; camera vẫn mở. Xuất JSON hoặc xóa phiên.');
    controls();
  }
}
async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia || !isSecureContext) { status('Camera cần HTTPS hoặc localhost và trình duyệt hỗ trợ.', true); return; }
  stopCamera(); pause(); const generation = ++epoch; cameraPending = true; controls(); status('Đang chờ quyền camera. Có thể bấm Dừng camera để hủy.');
  try {
    const stream = await lease.acquire(() => navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }));
    if (!stream || generation !== epoch) return;
    video.srcObject = stream; video.hidden = false; canvas.hidden = true;
    await video.play(); if (generation !== epoch) return;
    cameraOpen = true; cameraPending = false;
    stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (generation === epoch) stopCamera('Camera đã bị ngắt; cần mở lại thủ công.'); }, { once: true }));
    el('source-badge').textContent = 'Camera RGB · chưa depth';
    el('range-value').textContent = 'Camera hoạt động'; el('range-note').textContent = 'Chưa nối nhận diện/depth native. Bước này không tạo số mét.';
    cameraTimer = setInterval(cameraTick, 100);
    controls(); status('Camera không được ghi hình. Chọn đồng ý rồi Bắt đầu ghi nếu muốn xuất metadata.');
  } catch (error) {
    if (generation !== epoch) return;
    stopCamera(); status(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Quyền camera bị từ chối. Bật quyền trong trình duyệt rồi mở lại.' : 'Không mở được camera. Kiểm tra thiết bị/quyền và thử lại.', true);
  }
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function clearSession(message: string) {
  stopCamera(); dataGeneration++; importSequence++; recorder.clear(); loaded = null; cursor = null; consent.checked = false; pause(); details();
  ctx.clearRect(0, 0, canvas.width, canvas.height); el('range-value').textContent = 'Đã xóa'; el('range-note').textContent = 'Camera đóng. Không còn metadata trong tab.';
  el('source-badge').textContent = 'Chưa có nguồn'; seek.value = '0'; el('time').textContent = '0,0 s'; controls(); status(message);
}
SCENARIOS.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.title; scenario.append(o); });
button('load-fixture').onclick = () => { stopCamera(); el('scenario-note').textContent = SCENARIOS.find(s => s.id === scenario.value)!.note; load(syntheticScenario(scenario.value as ScenarioId)); status('Dữ liệu mô phỏng để kiểm thử phần mềm. Không chứng minh camera đã đo được mét.'); };
button('open-camera').onclick = openCamera;
button('stop-camera').onclick = () => stopCamera('Đã đóng camera và dừng ghi.');
button('record').onclick = () => {
  try { recorder.start(consent.checked, 'browser-camera'); dataGeneration++; recordingOrigin = performance.now(); lastCapture = -Infinity; cameraFrameId = 0; controls(); status('Đang ghi metadata trong RAM, không ghi hình.'); }
  catch (error) { status(error instanceof Error ? error.message : 'Không bắt đầu ghi được.', true); }
};
button('stop-record').onclick = () => { recorder.stop(); loaded = recorder.snapshot(); details(); controls(); status('Đã dừng ghi; dữ liệu chỉ nằm trong tab cho đến khi xuất JSON.'); };
consent.onchange = () => { if (!consent.checked) { dataGeneration++; importSequence++; recorder.clear(); loaded = null; cursor = null; seek.value = '0'; pause(); details(); draw(); if (!cameraOpen) el('source-badge').textContent = 'Chưa có nguồn'; status('Đã thu hồi đồng ý và xóa metadata trong tab. File đã xuất trước đó không tự xóa.'); } controls(); };
button('clear').onclick = () => clearSession('Đã xóa dữ liệu trong tab. Các file đã tải về cần xóa riêng.');
button('export').onclick = async () => {
  try { const r = cameraOpen ? recorder.snapshot() : loaded ?? recorder.snapshot(); if (!r) return; const generation = dataGeneration, exported = await exportRecording(r); if (generation !== dataGeneration) return; download(exported, 'assistive-recording.json'); status('Đã xuất JSON metadata; không chứa hình/video hay dữ liệu vị trí.'); }
  catch (error) { status(error instanceof Error ? error.message : 'Không xuất được JSON.', true); }
};
el<HTMLInputElement>('import').onchange = async (event) => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; const generation = epoch, sequence = ++importSequence; if (!file) return;
  try {
    if (file.size > LIMITS.bytes) throw Error('JSON vượt 2 MiB.');
    const recording = await importRecording(await file.text());
    if (generation !== epoch || sequence !== importSequence) return;
    stopCamera(); recorder.clear(); consent.checked = false; load(recording); el('scenario-note').textContent = 'File nhập chỉ có kiểm tra cấu trúc/checksum; không xác thực cảm biến hoặc số đo thực.';
    status('Đã nhập replay. Không mở camera hay cấp quyền ghi.');
  } catch (error) { if (generation === epoch && sequence === importSequence) status(error instanceof Error ? error.message : 'Không đọc được file JSON.', true); }
  finally { input.value = ''; }
};
button('play').onclick = () => {
  if (!cursor) return;
  if (playing) { pause(); return; }
  if (Number(seek.value) >= cursor.durationMs) seek.value = '0';
  playbackOffset = Number(seek.value); startedPlayback = performance.now(); playing = true; controls();
};
seek.oninput = () => { pause(); cursor?.seek(Number(seek.value)); draw(); };
button('export-plan').onclick = () => download({ schema: 'assistive-collection-plan-v1', status: 'not-collected', positions: COLLECTION_PLAN }, 'assistive-collection-plan.json');
for (const p of COLLECTION_PLAN) { const li = document.createElement('li'); li.textContent = `${p.id}: ${p.plannedMetres} m · ${p.condition} · ${p.split} · chưa đo`; el('collection-plan').append(li); }
el('build-id').textContent = `TIP-64A · ${__ROBOEYE_COMMIT__} · ${__ROBOEYE_SOURCE_FINGERPRINT__.slice(0, 12)} · Không có dữ liệu nghiệm thu điện thoại thật`;
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); if (cameraOpen || cameraPending) stopCamera('Đã đóng camera khi ẩn tab; không tự mở lại.'); } });
window.addEventListener('pagehide', () => clearSession('Đã đóng camera và xóa phiên khi rời trang. Chọn nguồn để bắt đầu lại.'));
function animate() {
  if (playing && cursor) { const elapsed = playbackOffset + performance.now() - startedPlayback; cursor.seek(elapsed); seek.value = String(Math.min(cursor.durationMs, elapsed)); draw(); if (elapsed >= cursor.durationMs) pause(); }
  requestAnimationFrame(animate);
}
controls(); draw(); requestAnimationFrame(animate);
