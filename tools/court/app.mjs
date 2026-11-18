import { validateSession, validateReview, exportReview, reviewKey, imageRect, imagePoint,
  trailAtFrame, nearLineReviews, formatTime, validateMethods, sameSource,
  validatePublicManifest, staticAssetUrl, validateEvidence, referenceAtFrame, frameIndex, presentationFrameIndex, canReuseDecodedFrame } from './core.mjs';
import { proposeEvidenceReviews, createFrameCapture } from './contact.mjs';

const $ = id => document.getElementById(id);
// Keep the research tools available without making them the watching surface.
const settings = $('court-settings'), settingsContent = $('settings-content');
for (const selector of ['.workspace-heading', '#source-tools', '.local-badge', '.layer-controls', '.observation-strip', '.method-toolbar', '.baseline-warning', '.line-toolbar', '#line-list', '#status', '.review-rail', 'footer', '#bookmark']) {
  const node = document.querySelector(selector); if (node) settingsContent.append(node);
}
document.querySelector('.transport-row').append($('capture-current'));
$('show-lines').checked = false;
const contactDetails = document.createElement('details'); contactDetails.id = 'contact-details';
const contactSummary = document.createElement('summary'); contactSummary.textContent = 'Chi tiết ảnh'; contactDetails.append(contactSummary);
for (const id of ['contact-frame-meta', 'contact-reason']) contactDetails.append($(id));
const cropDetail = document.createElement('p'); cropDetail.id = 'contact-crop-detail'; contactDetails.append(cropDetail);
contactDetails.append(document.querySelector('.contact-footnote')); $('contact-review').append(contactDetails);
const video = $('court-video'), canvas = $('court-overlay'), ctx = canvas.getContext('2d');
const stage = $('stage'), magnifier = $('magnifier'), mag = magnifier.getContext('2d');
const controls = ['play', 'step-back', 'step-forward', 'bookmark', 'draw-line', 'confirm-lines', 'reset-lines', 'export-review', 'import-review'];
let session = null, lines = [], bookmarks = [], reviews = [], selected = null;
let rect = null, pendingPoint = null, drawing = false, replayEnd = null, ready = false;
let fallback = null, lastRenderedTime = 0, presentedTime = 0, presentedIndex = null, replayToken = 0, seekRevision = 0, seeking = false;
let inspectionPoint = null, inspectionFrame = null, hoverLineId = null, selectedLineId = null;
let methodCatalog = null, activeDetector = 'classical', methodRevision = 0, switching = false;
const demoMeta = document.querySelector('meta[name="court-data"]')?.content;
let demoManifest = null, activeClip = null, activeBundle = null, selectedCase = null, sourceRevision = 0;
let caseTarget = null, mediaDeadline = null, blobEpoch = 0, demoResume = null;
const bundles = new Map();
let contactCapture = null, contactSourceSha = null, contactGeneration = 0, contactSelection = 0;
let contactThumbAbort = null, contactSelectAbort = null, contactItems = [], contactSelected = null;
let contactSlots = [], contactDisplayed = null, contactROI = null, contactInspection = 0;
let contactThumbJob = null, contactContextBusy = false, contactClipPlayback = null;
let eventEvidence = null, eventEvidenceUrl = null, eventEvidencePromise = null, eventEvidenceState = 'unavailable', clipDownloadAbort = null;
let contactReturnFocus = null;
const contactImageUrls = new Set(), contactDownloadUrls = new Set();
const contactContextUrls = new Set();
const stats = { renderCount: 0, duplicateSkips: 0, videoFrameCallbacks: 0, renderDomWrites: 0, lineRasterizations: 0, timingUnqualified: 0, discardedCallbacks: 0, reusedDecodedSeeks: 0 };
window.courtPlaybackStats = stats;
let visualRevision = 0, lastRenderKey = null, videoCallbackId = null, lineRevision = 0, lastLineKey = null;
const lineCanvas = document.createElement('canvas'), lineContext = lineCanvas.getContext('2d');

function writeText(id, text) { if ($(id).textContent !== text) { $(id).textContent = text; stats.renderDomWrites++; } }
function repaint(time = presentedTime) { visualRevision++; render(video.requestVideoFrameCallback ? presentedTime : time); }

function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function clearOverlay() {
  $('capture-current').disabled = true;
  lastRenderKey = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.dataset.ballVisible = 'false'; canvas.dataset.frameIndex = ''; canvas.dataset.observation = 'missing';
  canvas.dataset.referenceVisible = 'false'; canvas.dataset.referenceFrame = '';
  canvas.dataset.ballX = ''; canvas.dataset.ballY = '';
  canvas.dataset.boxVisible = 'false'; canvas.dataset.boxX = ''; canvas.dataset.boxY = ''; canvas.dataset.boxWidth = ''; canvas.dataset.boxHeight = '';
  canvas.dataset.selectedBoxVisible = 'false'; canvas.dataset.selectedEventKind = '';
  for (const key of ['selectedBoxX', 'selectedBoxY', 'selectedBoxWidth', 'selectedBoxHeight']) canvas.dataset[key] = '';
  canvas.dataset.sourceSha = '';
  canvas.dataset.trailFrames = ''; canvas.dataset.suspectPointVisible = 'false';
  canvas.dataset.suspectFrame = ''; canvas.dataset.suspectX = ''; canvas.dataset.suspectY = '';
  canvas.dataset.manualPointVisible = 'false'; canvas.dataset.manualPointFrame = '';
  writeText('tracking-status', ready ? 'Mất dấu' : 'Đang mở video');
  $('tracking-status').dataset.state = 'missing';
  stage.dataset.timingQualified = 'false';
  writeText('frame-label', 'Đang chờ khung đã giải mã');
  writeText('timecode', '--:-- / --:--');
  writeText('observation-label', 'Chưa xác minh được khung đang hiển thị');
  writeText('reference-status', 'Chưa xác minh khung; không hiển thị tham chiếu.');
  writeText('proof-a-status', 'Đang chờ khung'); writeText('proof-b-status', 'Đang chờ khung');
  mag.clearRect(0, 0, magnifier.width, magnifier.height);
  for (const id of ['proof-a', 'proof-b']) {
    const proof = $(id); proof.getContext('2d').clearRect(0, 0, proof.width, proof.height);
    proof.dataset.frameIndex = ''; proof.dataset.clipId = ''; proof.dataset.observation = 'missing';
    proof.dataset.ballVisible = 'false'; proof.dataset.referenceVisible = 'false'; proof.dataset.ballX = ''; proof.dataset.ballY = '';
  }
}
function fail(message) {
  disposeContacts();
  clearTimeout(mediaDeadline);
  if (demoManifest) {
    sourceRevision++; caseTarget = null; stage.dataset.casePending = 'false';
    stage.dataset.mediaLoading = 'false'; stage.dataset.mediaPhase = 'error'; activeBundle?.videoAbort?.abort(); cancelVideoFrame();
  }
  ready = false; replayToken++; replayEnd = null; video.pause(); clearOverlay(); controls.forEach(id => $(id).disabled = true);
  stage.dataset.ready = 'false'; $('stage-message').hidden = false;
  $('detector').disabled = true;
  $('stage-message').replaceChildren(Object.assign(document.createElement('p'), { textContent: message }));
  $('observation-label').textContent = 'Không có quan sát đang hợp lệ'; status(message, true);
}

function saveEdits() {
  if (!session) return;
  try {
    localStorage.setItem(reviewKey(session.source), JSON.stringify(exportReview(session, lines, bookmarks)));
    $('save-state').textContent = 'Đã lưu bản xem lại trên trình duyệt này';
  } catch {
    $('save-state').textContent = 'Chưa lưu được. Anh có thể xuất bản xem lại.';
  }
}

function updateReviewList() {
  if (!session) return;
  const automatic = demoManifest ? [] : nearLineReviews(session, lines);
  reviews = [...automatic, ...bookmarks].sort((a, b) => a.frame - b.frame);
  $('review-count').textContent = String(reviews.length);
  $('review-list').replaceChildren(); $('timeline-marks').replaceChildren();
  if (!reviews.length) {
    const empty = document.createElement('p'); empty.className = 'empty-review';
    empty.textContent = 'Chưa có gợi ý gần vạch. Anh có thể đánh dấu bất kỳ pha nào để đối chiếu.';
    $('review-list').append(empty);
  }
  for (const item of reviews) {
    const button = document.createElement('button'); button.className = 'review-item'; button.dataset.frame = String(item.frame);
    button.setAttribute('aria-current', String(selected?.id === item.id));
    const top = document.createElement('span'), label = document.createElement('span'), time = document.createElement('time'), detail = document.createElement('small');
    label.textContent = item.kind === 'human-bookmark' ? 'Pha anh đánh dấu' : 'Ứng viên gần vạch trên ảnh';
    time.textContent = formatTime(item.timeSeconds, true); top.append(label, time);
    detail.textContent = item.kind === 'human-bookmark' ? 'Chưa đủ bằng chứng' : (item.confirmedLine ? 'Vạch đã chọn · chưa xác minh chạm sân' : 'Vạch gợi ý · cần đối chiếu');
    button.append(top, detail); button.addEventListener('click', () => replay(item)); $('review-list').append(button);
    const marker = document.createElement('i'); marker.className = 'timeline-mark'; marker.style.left = `${item.frame / session.source.frameCount * 100}%`; $('timeline-marks').append(marker);
  }
}

function updateLines() {
  $('line-list').replaceChildren();
  lines.forEach((line, index) => {
    const item = document.createElement('span'); item.className = `line-item${line.confirmed ? ' confirmed' : ''}`;
    item.tabIndex = 0; item.setAttribute('role', 'button'); item.setAttribute('aria-label', `Chọn để xem vạch ${index + 1}`);
    item.dataset.lineId = line.id;
    item.addEventListener('pointerenter', () => { hoverLineId = line.id; repaint(lastRenderedTime); });
    item.addEventListener('pointerleave', () => { hoverLineId = null; repaint(lastRenderedTime); });
    item.addEventListener('focus', () => { hoverLineId = line.id; repaint(lastRenderedTime); });
    item.addEventListener('blur', () => { hoverLineId = null; repaint(lastRenderedTime); });
    const select = () => { selectedLineId = selectedLineId === line.id ? null : line.id; repaint(lastRenderedTime); };
    item.addEventListener('click', event => { if (!event.target.closest('button')) select(); });
    item.addEventListener('keydown', event => { if (event.target === item && ['Enter', ' '].includes(event.key)) { event.preventDefault(); select(); } });
    const swatch = document.createElement('i'); swatch.className = 'line-swatch';
    const label = document.createElement('span'); label.textContent = `${index + 1} · ${line.confirmed ? 'Đã chọn' : 'Gợi ý'}`;
    const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', `Xóa vạch ${index + 1}`);
    remove.addEventListener('click', () => { lines = lines.filter(value => value.id !== line.id); hoverLineId = null; if (selectedLineId === line.id) selectedLineId = null; saveEdits(); refreshEdits(); });
    item.append(swatch, label, remove); $('line-list').append(item);
  });
  $('confirm-lines').disabled = !ready || !lines.some(line => !line.confirmed);
  canvas.dataset.lineCount = String(lines.length);
}
function refreshEdits() { lineRevision++; updateLines(); updateReviewList(); repaint(video.currentTime); }

function setDrawing(value) {
  drawing = value; pendingPoint = null; stage.dataset.drawing = String(value);
  $('draw-line').setAttribute('aria-pressed', String(value)); $('draw-guide').hidden = !value;
  if (value) { video.pause(); replayEnd = null; replayToken++; $('show-lines').checked = true; status('Vẽ trên mép vạch nhìn thấy: chọn điểm đầu, rồi điểm cuối. Không suy ra vị trí bị khuất.'); }
  repaint(video.currentTime);
}

function seekFrame(index, keepReplay = false) {
  if (!ready) return false;
  const bounded = Math.max(0, Math.min(session.source.frameCount - 1, index));
  return seekTime((bounded + 0.01) / session.source.fps, keepReplay);
}

function seekTime(time, keepReplay = false) {
  if (!ready || !Number.isFinite(time)) return false;
  if (!keepReplay) cancelContactClip(false);
  if (!keepReplay) { replayEnd = null; replayToken++; }
  const targetIndex = frameIndex(time, session.source);
  const reuse = canReuseDecodedFrame(targetIndex, session.source, {
    ready, paused: video.paused, seeking, nativeSeeking: video.seeking, readyState: video.readyState,
    timingQualified: stage.dataset.timingQualified === 'true', presentedIndex,
    displayedIndex: canvas.dataset.frameIndex === '' ? null : Number(canvas.dataset.frameIndex),
    displayedSourceSha: canvas.dataset.sourceSha, nativeTime: video.currentTime,
  });
  if (reuse) {
    // Native Chromium can rewind a paused, looping EOF frame on an identical
    // currentTime write. Reuse actual qualified pixels, not a future estimate.
    stats.reusedDecodedSeeks++; repaint(presentedTime); return true;
  }
  beginSeek(); video.currentTime = time; return false;
}

function replay(item) {
  if (!ready) return;
  selected = item; inspectionPoint = null; delete canvas.dataset.probeX; delete canvas.dataset.probeY;
  setDrawing(false); video.pause(); const token = ++replayToken;
  const start = Math.max(0, item.frame - Math.round(session.source.fps * 0.7));
  replayEnd = Math.min(session.source.durationSeconds - 0.01 / session.source.fps, (item.frame + Math.round(session.source.fps * 0.75)) / session.source.fps);
  video.playbackRate = 0.25; $('speed').value = '0.25'; const reused = seekFrame(start, true); updateReviewList();
  const playWhenReady = () => { if (token === replayToken && replayEnd !== null) video.play().catch(() => status('Bấm Phát để xem lại đoạn đã chọn.')); };
  if (reused) playWhenReady(); else video.addEventListener('seeked', playWhenReady, { once: true });
  status('Đang xem lại chậm một đoạn quanh mốc. Đây là gợi ý trên ảnh, chưa phải kết luận điểm chạm.');
}

function render(time = presentedTime) {
  if (!ready || !session || !rect || switching || seeking || video.seeking || video.readyState < 2) { clearOverlay(); return; }
  if (video.videoWidth !== session.source.width || video.videoHeight !== session.source.height
    || (demoManifest && (stage.dataset.videoVerifiedSha !== session.source.sha256 || video.currentSrc !== activeBundle?.videoObjectUrl))) { clearOverlay(); return; }
  lastRenderedTime = time;
  const frame = presentedIndex === null ? null : session.frames[presentedIndex]?.index === presentedIndex ? session.frames[presentedIndex] : null;
  if (demoManifest && caseTarget?.revision === sourceRevision && caseTarget.frame !== frame?.index) { clearOverlay(); return; }
  // Visual clearing does not erase the current decoded/presentation latch.
  // Restore its qualification only after source, decode, seek and arm guards.
  stage.dataset.timingQualified = String(frame !== null);
  if (frame && demoManifest && activeClip?.role === 'user-original') {
    ensureContacts(); $('capture-current').disabled = false;
  }
  if (demoManifest && frame && stage.dataset.mediaLoading === 'true') {
    clearTimeout(mediaDeadline); stage.dataset.mediaLoading = 'false'; stage.dataset.mediaPhase = 'ready'; stage.dataset.ready = 'true';
    $('stage-message').hidden = true; controls.forEach(control => $(control).disabled = false); $('detector').disabled = false;
    updateLines();
    if (!caseTarget) status(activeClip?.role === 'user-original'
      ? 'Video gốc đã kiểm SHA. Dấu bám chỉ là ứng viên; chưa có nhãn đối chứng.'
      : 'Video tennis đã kiểm SHA. Replay kết quả trên Mac; chọn một ca để đối chiếu.');
  }
  const renderKey = `${session.source.sha256}:${activeDetector}:${frame?.index ?? `unqualified-${time.toFixed(6)}`}:${visualRevision}:${canvas.width}:${canvas.height}`;
  if (renderKey === lastRenderKey) { stats.duplicateSkips++; return; }
  lastRenderKey = renderKey; stats.renderCount++;
  stats.lastRenderedIndex = frame?.index ?? null;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  paintLineLayer(dpr);
  ctx.drawImage(lineCanvas, 0, 0, canvas.width / dpr, canvas.height / dpr);
  ctx.save(); ctx.translate(rect.x, rect.y); ctx.scale(rect.scale, rect.scale);
  ctx.beginPath(); ctx.rect(0, 0, session.source.width, session.source.height); ctx.clip();
  canvas.dataset.highlightLineId = $('show-lines').checked ? (hoverLineId ?? selectedLineId ?? '') : '';
  const visibleBall = frame?.status === 'observed' && frame.ball && $('show-ball').checked;
  if (visibleBall) {
    if ($('show-trail').checked) {
      const points = trailAtFrame(session.frames, frame.index).slice(-6);
      canvas.dataset.trailFrames = Array.from({ length: points.length }, (_, offset) => frame.index - points.length + offset + 1).join(',');
      if (points.length > 1) {
        ctx.strokeStyle = '#53c6e8'; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.5 / rect.scale;
        ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(...point) : ctx.moveTo(...point)); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    const ball = frame.ball, box = clippedBallBox(ball);
    ctx.strokeStyle = '#53c6e8'; ctx.lineWidth = 2 / rect.scale;
    if (box) ctx.strokeRect(...box);
    ctx.fillStyle = '#53c6e8'; ctx.beginPath(); ctx.arc(ball.x, ball.y, 1.8 / rect.scale, 0, Math.PI * 2); ctx.fill();
  } else canvas.dataset.trailFrames = '';
  if (!$('show-trail').checked) canvas.dataset.trailFrames = '';
  const selectedEvent = video.paused && !$('contact-review').hidden && contactSelected
    && contactSelected.sourceSha256 === session.source.sha256 && frame?.index === contactSelected.frame ? contactSelected : null;
  const suspectPoint = selectedEvent?.kind === 'suspected-contact' ? selectedEvent.point : null;
  const selectedBall = selectedEvent && activeBundle?.sessions[selectedEvent.arms?.[0]]?.frames[frame.index];
  const selectedBox = selectedBall?.status === 'observed' && selectedBall.ball
    && Math.hypot(selectedBall.ball.x - selectedEvent.point?.[0], selectedBall.ball.y - selectedEvent.point?.[1]) < .001 ? clippedBallBox(selectedBall.ball) : null;
  if (selectedBox) { ctx.strokeStyle = '#e7bd38'; ctx.lineWidth = 2 / rect.scale; ctx.strokeRect(...selectedBox); }
  canvas.dataset.selectedBoxVisible = String(Boolean(selectedBox)); canvas.dataset.selectedEventKind = selectedEvent?.kind ?? '';
  for (const [offset, key] of ['selectedBoxX', 'selectedBoxY', 'selectedBoxWidth', 'selectedBoxHeight'].entries()) canvas.dataset[key] = selectedBox ? String(selectedBox[offset]) : '';
  if (suspectPoint) {
    const [x, y] = suspectPoint, radius = 11 / rect.scale, arm = 7 / rect.scale;
    ctx.strokeStyle = '#e7bd38'; ctx.lineWidth = 2 / rect.scale; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.moveTo(x - arm, y); ctx.lineTo(x + arm, y); ctx.moveTo(x, y - arm); ctx.lineTo(x, y + arm); ctx.stroke();
  }
  canvas.dataset.suspectPointVisible = String(Boolean(suspectPoint)); canvas.dataset.suspectFrame = suspectPoint ? String(frame.index) : '';
  canvas.dataset.suspectX = suspectPoint ? String(suspectPoint[0]) : ''; canvas.dataset.suspectY = suspectPoint ? String(suspectPoint[1]) : '';
  if (pendingPoint) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(...pendingPoint, 4 / rect.scale, 0, Math.PI * 2); ctx.fill(); }
  const reference = activeBundle && frame ? referenceAtFrame(activeBundle.evidence, frame.index) : null;
  const referenceVisible = Boolean(reference && $('show-reference').checked);
  if (referenceVisible) {
    const [x, y] = reference, r = 7 / rect.scale;
    ctx.strokeStyle = '#53c6e8'; ctx.lineWidth = 2 / rect.scale; ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke();
  }
  const manualPointVisible = Boolean(inspectionPoint && video.paused && inspectionFrame?.sourceSha === session.source.sha256 && inspectionFrame.index === frame?.index);
  canvas.dataset.manualPointVisible = String(manualPointVisible); canvas.dataset.manualPointFrame = manualPointVisible ? String(frame.index) : '';
  if (manualPointVisible) {
    const [x, y] = inspectionPoint, gap = 3 / rect.scale, length = 10 / rect.scale;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1 / rect.scale; ctx.beginPath();
    ctx.moveTo(x - length, y); ctx.lineTo(x - gap, y); ctx.moveTo(x + gap, y); ctx.lineTo(x + length, y);
    ctx.moveTo(x, y - length); ctx.lineTo(x, y - gap); ctx.moveTo(x, y + gap); ctx.lineTo(x, y + length); ctx.stroke();
  }
  ctx.restore();
  canvas.dataset.ballVisible = String(Boolean(visibleBall)); canvas.dataset.frameIndex = frame ? String(frame.index) : '';
  canvas.dataset.observation = frame?.status ?? 'missing';
  canvas.dataset.ballX = visibleBall ? String(frame.ball.x) : ''; canvas.dataset.ballY = visibleBall ? String(frame.ball.y) : '';
  const visibleBox = visibleBall ? clippedBallBox(frame.ball) : null;
  canvas.dataset.boxVisible = String(Boolean(visibleBox));
  for (const [offset, key] of ['boxX', 'boxY', 'boxWidth', 'boxHeight'].entries()) canvas.dataset[key] = visibleBox ? String(visibleBox[offset]) : '';
  canvas.dataset.sourceSha = session.source.sha256;
  canvas.dataset.referenceVisible = String(referenceVisible); canvas.dataset.referenceFrame = referenceVisible ? String(frame.index) : '';
  writeText('tracking-status', !$('show-ball').checked ? 'Đã tắt' : visibleBall ? 'Bám bóng' : 'Mất dấu');
  $('tracking-status').dataset.state = !$('show-ball').checked ? 'off' : visibleBall ? 'tracking' : 'missing';
  $('seek').value = String(Math.min(time, session.source.durationSeconds));
  writeText('timecode', `${formatTime(frame?.timeSeconds ?? time, true)} / ${formatTime(session.source.durationSeconds, true)}`);
  writeText('frame-label', frame ? `Khung ${frame.index + 1} / ${session.source.frameCount}` : 'Ngoài phạm vi phân tích');
  writeText('observation-label', !frame ? 'Chưa xác minh được thời gian khung; không hiển thị dấu.' : frame.status === 'observed' ? `Ứng viên chưa xác thực · ${session.method.kind === 'learned-ball' ? 'model thử nghiệm' : 'CV thử nghiệm'}` : (frame.status === 'ambiguous' ? 'Nhiều ứng viên · không giữ dấu cũ' : 'Chưa có quan sát bóng tin cậy'));
  if (demoManifest) writeText('reference-status', reference ? `Tham chiếu hình ảnh ở đúng khung ${frame.index + 1}; không phải điểm chạm sân.` : 'Khung này chưa có tham chiếu; không lấy nhãn ở khung bên cạnh.');
  if (settings.open) drawMagnifier(frame);
  if (frame && caseTarget?.revision === sourceRevision && caseTarget.frame === frame.index) {
    stage.dataset.casePending = 'false'; caseTarget = null;
    status('Đã dừng đúng khung có tham chiếu. Vàng: ứng viên. Hình thoi xanh: tham chiếu hình ảnh, không phải tiếp xúc sân.');
  }
}

function clippedBallBox(ball) {
  const box = ball?.box;
  if (!session || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) return null;
  const left = Math.max(0, box[0]), top = Math.max(0, box[1]);
  const right = Math.min(session.source.width, box[0] + box[2]), bottom = Math.min(session.source.height, box[1] + box[3]);
  return right > left && bottom > top ? [left, top, right - left, bottom - top] : null;
}

function paintLineLayer(dpr) {
  const key = `${session.source.sha256}:${canvas.width}:${canvas.height}:${lineRevision}:${hoverLineId ?? selectedLineId}:${$('show-lines').checked}`;
  if (key === lastLineKey) return;
  lastLineKey = key; stats.lineRasterizations++;
  lineCanvas.width = canvas.width; lineCanvas.height = canvas.height;
  const lc = lineContext; lc.setTransform(dpr, 0, 0, dpr, 0, 0); lc.translate(rect.x, rect.y); lc.scale(rect.scale, rect.scale);
  lc.beginPath(); lc.rect(0, 0, session.source.width, session.source.height); lc.clip();
  if (!$('show-lines').checked) return;
  const active = hoverLineId ?? selectedLineId;
  for (const [index, line] of lines.entries()) {
    const highlighted = line.id === active;
    lc.strokeStyle = highlighted ? '#ffdc7d' : line.confirmed ? '#eff9ff' : '#53c6e8';
    lc.lineWidth = (highlighted ? 4 : line.confirmed ? 2 : 1.5) / rect.scale;
    lc.setLineDash(line.confirmed ? [] : [6 / rect.scale, 5 / rect.scale]);
    lc.beginPath(); lc.moveTo(...line.a); lc.lineTo(...line.b); lc.stroke();
    if (highlighted) {
      const text = `Vạch ${index + 1}`, x = (line.a[0] + line.b[0]) / 2, y = (line.a[1] + line.b[1]) / 2;
      lc.font = `600 ${12 / rect.scale}px -apple-system, sans-serif`; const width = lc.measureText(text).width;
      lc.fillStyle = '#172330'; lc.fillRect(x - 5 / rect.scale, y - 19 / rect.scale, width + 10 / rect.scale, 24 / rect.scale);
      lc.fillStyle = '#ffdc7d'; lc.fillText(text, x, y - 3 / rect.scale);
    }
  }
}

function drawMagnifier(frame) {
  mag.clearRect(0, 0, magnifier.width, magnifier.height);
  if (video.readyState < 2 || !session) return;
  if (activeBundle) { drawPairedProof(frame); return; }
  const selectedBall = selected ? session.frames[selected.frame]?.ball : null;
  const manualPoint = inspectionFrame?.sourceSha === session.source.sha256 && inspectionFrame.index === frame?.index ? inspectionPoint : null;
  const point = pendingPoint ?? manualPoint ?? (frame?.ball ? [frame.ball.x, frame.ball.y] : selectedBall ? [selectedBall.x, selectedBall.y] : [session.source.width / 2, session.source.height / 2]);
  const cropWidth = Math.min(session.source.width, 150), cropHeight = Math.min(session.source.height, 90);
  const left = Math.max(0, Math.min(session.source.width - cropWidth, point[0] - cropWidth / 2));
  const top = Math.max(0, Math.min(session.source.height - cropHeight, point[1] - cropHeight / 2));
  magnifier.dataset.cropX = String(left); magnifier.dataset.cropY = String(top);
  magnifier.dataset.cropWidth = String(cropWidth); magnifier.dataset.cropHeight = String(cropHeight);
  mag.imageSmoothingEnabled = false;
  mag.drawImage(video, left, top, cropWidth, cropHeight, 0, 0, magnifier.width, magnifier.height);
  if (frame?.status === 'observed' && frame.ball && $('show-ball').checked) {
    const x = (frame.ball.x - left) / cropWidth * magnifier.width, y = (frame.ball.y - top) / cropHeight * magnifier.height;
    mag.strokeStyle = '#e7bd38'; mag.lineWidth = 3; mag.beginPath(); mag.arc(x, y, 13, 0, 2 * Math.PI); mag.stroke();
  }
}

function drawPairedProof(frame) {
  const reference = frame ? referenceAtFrame(activeBundle.evidence, frame.index) : null;
  const chosen = selectedCase?.clipId === activeClip.id ? referenceAtFrame(activeBundle.evidence, selectedCase.frame) : null;
  const manualPoint = inspectionFrame?.sourceSha === session.source.sha256 && inspectionFrame.index === frame?.index ? inspectionPoint : null;
  const point = manualPoint ?? reference ?? chosen ?? (frame?.ball ? [frame.ball.x, frame.ball.y] : [session.source.width / 2, session.source.height / 2]);
  const cropWidth = Math.min(session.source.width, 120), cropHeight = Math.min(session.source.height, 80);
  const left = Math.max(0, Math.min(session.source.width - cropWidth, point[0] - cropWidth / 2));
  const top = Math.max(0, Math.min(session.source.height - cropHeight, point[1] - cropHeight / 2));
  for (const [key, id] of [['classical', 'a'], ['specialist', 'b']]) {
    const proof = $(`proof-${id}`), pc = proof.getContext('2d');
    pc.clearRect(0, 0, proof.width, proof.height); pc.imageSmoothingEnabled = false;
    pc.drawImage(video, left, top, cropWidth, cropHeight, 0, 0, proof.width, proof.height);
    const observation = frame ? activeBundle.sessions[key].frames[frame.index] : null;
    const x = value => (value - left) / cropWidth * proof.width, y = value => (value - top) / cropHeight * proof.height;
    if (observation?.status === 'observed' && observation.ball && $('show-ball').checked) {
      pc.strokeStyle = '#e7bd38'; pc.lineWidth = 3; pc.beginPath(); pc.arc(x(observation.ball.x), y(observation.ball.y), 12, 0, Math.PI * 2); pc.stroke();
    }
    if (reference && $('show-reference').checked) {
      const px = x(reference[0]), py = y(reference[1]), r = 9;
      pc.strokeStyle = '#53c6e8'; pc.lineWidth = 2; pc.beginPath(); pc.moveTo(px, py - r); pc.lineTo(px + r, py); pc.lineTo(px, py + r); pc.lineTo(px - r, py); pc.closePath(); pc.stroke();
    }
    proof.dataset.frameIndex = frame ? String(frame.index) : ''; proof.dataset.clipId = activeClip.id;
    proof.dataset.observation = observation?.status ?? 'missing';
    proof.dataset.referenceVisible = String(Boolean(reference && $('show-reference').checked));
    proof.dataset.ballVisible = String(Boolean(observation?.status === 'observed' && observation.ball && $('show-ball').checked));
    proof.dataset.ballX = observation?.status === 'observed' && observation.ball ? String(observation.ball.x) : '';
    proof.dataset.ballY = observation?.status === 'observed' && observation.ball ? String(observation.ball.y) : '';
    proof.dataset.cropX = String(left); proof.dataset.cropY = String(top);
    writeText(`proof-${id}-status`, observation?.status === 'observed' ? 'Có ứng viên' : 'Chưa có dấu');
  }
}

function resize() {
  const size = stage.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(size.width * dpr); canvas.height = Math.round(size.height * dpr);
  rect = session ? imageRect(size.width, size.height, session.source.width, session.source.height) : null;
  repaint(lastRenderedTime);
}

function onFrame(time, index = session ? frameIndex(time, session.source) : null) {
  presentedTime = time; presentedIndex = index;
  stage.dataset.timingQualified = String(index !== null);
  if (contactClipPlayback && index !== null && index >= contactClipPlayback.endFrame) {
    const stop = contactClipPlayback.endFrame; cancelContactClip(false, 'stopped'); replayEnd = null; video.pause();
    if (index === stop) repaint(time); else seekFrame(stop);
    $('contact-clip-state').textContent = 'Đã dừng cuối đoạn.'; stage.dataset.contactReplay = 'stopped'; return;
  }
  if (replayEnd !== null && time >= replayEnd) {
    const stop = replayEnd; replayEnd = null; video.pause(); beginSeek(); video.currentTime = stop;
    status('Đã dừng ở cuối đoạn xem lại. Dùng ← / → để đối chiếu từng khung.'); render(stop); return;
  }
  render(time);
}
function scheduleVideoFrame() {
  if (videoCallbackId !== null || seeking || video.seeking) return;
  const revision = seekRevision, source = sourceRevision;
  const id = video.requestVideoFrameCallback((_now, metadata) => {
    if (videoCallbackId !== id) { stats.discardedCallbacks++; return; }
    videoCallbackId = null; stats.videoFrameCallbacks++;
    if (source === sourceRevision && revision === seekRevision && !seeking && !video.seeking) {
      const index = presentationFrameIndex(metadata.mediaTime, session.source);
      stats.lastVideoMediaTime = metadata.mediaTime; stats.lastPresentationIndex = index;
      stats.lastTimestampResidualUs = (metadata.mediaTime - Math.round(metadata.mediaTime * session.source.fps) / session.source.fps) * 1e6;
      if (index === null) stats.timingUnqualified++;
      onFrame(metadata.mediaTime, index);
    }
    if (ready) scheduleVideoFrame();
  });
  videoCallbackId = id;
}
function cancelVideoFrame() {
  if (videoCallbackId !== null) video.cancelVideoFrameCallback?.(videoCallbackId);
  videoCallbackId = null;
}
function fallbackFrame() { onFrame(video.currentTime); if (!video.paused && ready) fallback = requestAnimationFrame(fallbackFrame); }
function beginSeek() {
  seeking = true; seekRevision++; cancelVideoFrame(); clearOverlay();
  $('observation-label').textContent = 'Đang giải mã khung đã chọn…';
}

function showMethodMetadata() {
  $('coverage-label').textContent = `${session.summary.observedFrames} / ${session.source.frameCount} khung có ứng viên`;
  $('analysis-label').textContent = `${(session.summary.analysisMs / 1000).toFixed(2)} giây · phân tích trước`;
  const model = session.method.model;
  $('model-label').textContent = model ? `${model.id} · SHA ${model.artifactSha256.slice(0, 12)}` : `${session.method.id} · không có model học`;
  $('method-label').textContent = model ? 'Model bóng chuyên biệt · phân tích local trước, chưa phải trọng tài realtime.' : 'CV thử nghiệm · phân tích trước, không phải AI trọng tài realtime.';
  $('method-limits').replaceChildren();
  session.method.limitations.forEach(text => { const item = document.createElement('li'); item.textContent = text; $('method-limits').append(item); });
  stage.dataset.detector = activeDetector; stage.dataset.methodKind = session.method.kind;
}

function matchesMethod(value, descriptor) {
  if (!descriptor || value.method.id !== descriptor.id || value.method.kind !== descriptor.kind) return false;
  if (value.method.kind === 'classical-cv') return !descriptor.model;
  return ['id', 'artifactSha256', 'sourceUrl', 'license', 'revision', 'configSha256', 'preprocessId'].every(key => value.method.model[key] === descriptor.model[key]);
}

async function loadMethods() {
  const response = await fetch('/api/methods', { cache: 'no-store' });
  if (response.status === 404) {
    // A still-running M1 server serves new UI files but has no catalogue route.
    const key = session.method.kind === 'learned-ball' ? 'specialist' : 'classical';
    methodCatalog = { schemaVersion: 'roboeye-court-methods-v1', sourceSha256: session.source.sha256, defaultDetector: key,
      methods: [{ key, id: session.method.id, kind: session.method.kind, description: session.method.description, model: session.method.model ?? null }] };
  } else {
    if (!response.ok) throw new Error(`Không lấy được danh sách A/B (${response.status}).`);
    methodCatalog = validateMethods(await response.json(), session.source);
  }
  activeDetector = methodCatalog.defaultDetector;
  if (!matchesMethod(session, methodCatalog.methods.find(item => item.key === activeDetector))) throw new Error('Arm mặc định không khớp metadata phương pháp.');
  configureMethods();
}

function configureMethods() {
  $('detector').replaceChildren();
  for (const item of methodCatalog.methods) {
    const option = document.createElement('option'); option.value = item.key;
    option.textContent = item.key === 'classical' ? 'A · Baseline màu / chuyển động' : 'B · Model bóng chuyên biệt (thử nghiệm)';
    $('detector').append(option);
  }
  $('detector').value = activeDetector;
  $('detector-note').textContent = methodCatalog.methods.length > 1 ? 'Cùng video, không chạy lại khi chuyển' : 'Một phương pháp đã được chuẩn bị';
  document.querySelector('.phase-badge').textContent = demoManifest ? 'Replay · Ảnh đối chiếu' : methodCatalog.methods.length > 1 || session.method.kind === 'learned-ball' ? 'M2 · Đối chiếu local' : 'M1 · Thử nghiệm local';
}

async function switchDetector(key) {
  cancelContactClip();
  if (!ready || !methodCatalog?.methods.some(method => method.key === key)) return;
  if (key === activeDetector) {
    if (switching) {
      methodRevision++; switching = false; stage.dataset.switching = 'false';
      controls.forEach(id => $(id).disabled = false); refreshEdits();
      if (video.requestVideoFrameCallback) scheduleVideoFrame();
      status('Đã huỷ chuyển arm; tiếp tục dùng phương pháp đang hiển thị.');
    }
    return;
  }
  const revision = ++methodRevision;
  const frozenIndex = presentedIndex;
  switching = true; replayToken++; replayEnd = null; seekRevision++;
  cancelVideoFrame();
  video.pause(); if (frozenIndex !== null) seekFrame(frozenIndex, true);
  clearOverlay(); stage.dataset.switching = 'true';
  controls.forEach(id => $(id).disabled = true);
  status('Đang đổi phương pháp trên cùng video. Đã xoá quan sát của arm trước.');
  try {
    let next;
    if (activeBundle) next = activeBundle.sessions[key];
    else {
      const response = await fetch(`/api/session?detector=${encodeURIComponent(key)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Không lấy được arm đã chọn (${response.status}).`);
      next = validateSession(await response.json());
    }
    if (revision !== methodRevision) return;
    if (!sameSource(next.source, session.source)) throw new Error('A/B không cùng video hoặc timeline.');
    if (!matchesMethod(next, methodCatalog.methods.find(method => method.key === key))) throw new Error('Model/checksum không khớp arm đã công bố.');
    const humanLines = lines.filter(line => line.provenance === 'user-image' || line.confirmed);
    const ids = new Set(humanLines.map(line => line.id));
    lines = [...humanLines, ...next.lineSuggestions.filter(line => !ids.has(line.id)).map(line => ({ ...line, a: [...line.a], b: [...line.b] }))];
    session = next; activeDetector = key; selected = null; hoverLineId = null; selectedLineId = null;
    drawing = false; pendingPoint = null; stage.dataset.drawing = 'false'; $('draw-guide').hidden = true; $('draw-line').setAttribute('aria-pressed', 'false');
    showMethodMetadata();
    status('Đã đổi phương pháp; vạch và mốc do anh chọn được giữ. Mọi ứng viên vẫn chưa phải bằng chứng điểm chạm.');
  } catch (error) {
    if (revision !== methodRevision) return;
    $('detector').value = activeDetector;
    status(`Không đổi arm: ${error.message} Vẫn đang dùng phương pháp đã hiển thị trước đó.`, true);
  } finally {
    if (revision === methodRevision) {
      switching = false; stage.dataset.switching = 'false';
      controls.forEach(id => $(id).disabled = false); refreshEdits();
      if (video.requestVideoFrameCallback) scheduleVideoFrame();
    }
  }
}
$('detector').addEventListener('change', () => switchDetector($('detector').value));
$('loop-playback').addEventListener('change', () => { if (demoManifest) video.loop = $('loop-playback').checked; });

$('play').addEventListener('click', () => {
  cancelContactClip(false);
  replayEnd = null; replayToken++;
  if (video.paused) { if (video.ended) seekFrame(0); video.play().catch(() => status('Không phát được video. Thử tải lại trang.', true)); }
  else video.pause();
});
$('step-back').addEventListener('click', () => { video.pause(); seekFrame((presentedIndex ?? 0) - 1); });
$('step-forward').addEventListener('click', () => { video.pause(); seekFrame((presentedIndex ?? 0) + 1); });
$('seek').addEventListener('input', () => { seekTime(Number($('seek').value)); });
$('speed').addEventListener('change', () => { video.playbackRate = Number($('speed').value); });
for (const id of ['show-ball', 'show-trail', 'show-lines', 'show-reference']) $(id).addEventListener('change', () => repaint(video.currentTime));
$('draw-line').addEventListener('click', () => { setDrawing(!drawing); if (drawing) settings.close(); });
canvas.addEventListener('pointerdown', event => {
  if (!ready || seeking || video.seeking) return;
  const bounds = canvas.getBoundingClientRect(), point = imagePoint(event.clientX - bounds.left, event.clientY - bounds.top, rect);
  if (!point) return;
  if (!drawing) {
    video.pause();
    if (presentedIndex === null || stage.dataset.timingQualified !== 'true') return;
    inspectionFrame = { sourceSha: session.source.sha256, index: presentedIndex };
    inspectionPoint = point; canvas.dataset.probeX = String(point[0]); canvas.dataset.probeY = String(point[1]);
    repaint(lastRenderedTime); status('Đang phóng vùng anh chọn trên ảnh gốc. Dấu cộng chỉ là điểm soi ảnh, không phải bóng được nhận diện.'); return;
  }
  if (!pendingPoint) { pendingPoint = point; repaint(video.currentTime); return; }
  if (Math.hypot(point[0] - pendingPoint[0], point[1] - pendingPoint[1]) < 2) { status('Chọn điểm cuối cách điểm đầu ít nhất 2 pixel.'); return; }
  if (lines.length >= 100) { status('Tối đa 100 vạch trong một bản xem lại.', true); setDrawing(false); return; }
  lines.push({ id: `user-${crypto.randomUUID()}`, a: pendingPoint, b: point, provenance: 'user-image', confirmed: true });
  setDrawing(false); saveEdits(); refreshEdits(); status('Đã lưu vạch anh chọn trên ảnh. Chưa phải hiệu chuẩn hay bằng chứng điểm chạm.');
});
$('confirm-lines').addEventListener('click', () => {
  lines = lines.map(line => ({ ...line, confirmed: true })); saveEdits(); refreshEdits();
  status('Đã chọn các đoạn vạch làm tham chiếu trên ảnh. Anh có thể xoá đoạn nhầm lưới hoặc nền.');
});
$('reset-lines').addEventListener('click', () => {
  setDrawing(false); lines = session.lineSuggestions.map(line => ({ ...line, a: [...line.a], b: [...line.b] }));
  saveEdits(); refreshEdits(); status('Đã trở về vạch gợi ý ban đầu. Mốc đánh dấu vẫn được giữ.');
});
$('bookmark').addEventListener('click', () => {
  const frame = presentedIndex === null ? null : session.frames[presentedIndex]; if (!frame) return;
  if (bookmarks.some(item => item.frame === frame.index)) { status('Khung này đã được anh đánh dấu.'); return; }
  if (bookmarks.length >= 500) { status('Tối đa 500 mốc xem lại.', true); return; }
  bookmarks.push({ id: `mark-${crypto.randomUUID()}`, frame: frame.index, timeSeconds: frame.timeSeconds, kind: 'human-bookmark', decision: 'insufficient-evidence' });
  saveEdits(); updateReviewList(); status('Đã đánh dấu pha. Mốc do anh chọn, không phải kết luận tự động.');
});
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); }
  catch { status('Trình duyệt không cho mở toàn màn hình; video vẫn xem được trong trang.'); }
});
$('export-review').addEventListener('click', () => {
  const data = exportReview(session, lines, bookmarks), blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `roboeye-court-review-${session.source.sha256.slice(0, 12)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); status('Đã xuất vạch và mốc xem lại. File không chứa video hay kết luận In/Out.');
});
$('import-review').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file || !session) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('File vượt giới hạn 2 MiB.');
    const imported = validateReview(JSON.parse(await file.text()), session.source);
    lines = imported.lines; bookmarks = imported.bookmarks; selected = null; setDrawing(false); saveEdits(); refreshEdits();
    status('Đã nhập bản xem lại đúng video. Vẫn chưa có bằng chứng để kết luận In/Out.');
  } catch (error) { status(`Không nhập: ${error.message} Bản đang mở được giữ nguyên.`, true); }
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented) return;
  if (settings.open) return;
  if (event.key === 'Escape' && ready) { setDrawing(false); return; }
  if (event.target.closest('input,select,textarea,button,summary,a,[role="button"]') || !ready || event.altKey || event.metaKey || event.ctrlKey) return;
  if (event.key === ' ') { event.preventDefault(); $('play').click(); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); $('step-back').click(); }
  if (event.key === 'ArrowRight') { event.preventDefault(); $('step-forward').click(); }
});
video.addEventListener('play', () => {
  inspectionPoint = null; inspectionFrame = null; delete canvas.dataset.probeX; delete canvas.dataset.probeY;
  repaint(presentedTime);
  $('play').setAttribute('aria-label', 'Dừng video'); $('play-icon').innerHTML = '<path d="M7 5h4v14H7zm7 0h4v14h-4z"/>';
  if (!video.requestVideoFrameCallback) { cancelAnimationFrame(fallback); fallback = requestAnimationFrame(fallbackFrame); }
});
video.addEventListener('pause', () => {
  $('play').setAttribute('aria-label', 'Phát video'); $('play-icon').innerHTML = '<path d="m9 5 11 7-11 7z"/>'; cancelAnimationFrame(fallback); repaint(presentedTime);
});
video.addEventListener('timeupdate', () => { if (!video.requestVideoFrameCallback) onFrame(video.currentTime); });
video.addEventListener('seeking', beginSeek);
video.addEventListener('seeked', () => {
  seeking = false;
  if (video.paused || !video.requestVideoFrameCallback) {
    presentedTime = video.currentTime; presentedIndex = frameIndex(video.currentTime, session.source);
    stage.dataset.timingQualified = String(presentedIndex !== null); render(presentedTime);
  } else {
    // A looping/playing clock may already be ahead of the displayed frame.
    // Only the fresh current-generation presentation callback can qualify it.
    presentedIndex = null; clearOverlay();
  }
  if (ready && video.requestVideoFrameCallback) scheduleVideoFrame();
});
function qualifyPausedDemoFrame() {
  if (!demoManifest || !ready || !video.paused || seeking || video.seeking || switching || video.readyState < 2
    || video.currentSrc !== activeBundle?.videoObjectUrl || stage.dataset.videoVerifiedSha !== activeClip?.sourceSha256) return;
  const index = frameIndex(video.currentTime, session.source);
  if (caseTarget?.revision === sourceRevision && caseTarget.frame !== index) return;
  presentedTime = video.currentTime; presentedIndex = index; render(presentedTime);
  if (video.requestVideoFrameCallback) scheduleVideoFrame();
}
video.addEventListener('loadeddata', qualifyPausedDemoFrame);
video.addEventListener('canplay', qualifyPausedDemoFrame);
video.addEventListener('error', () => { if (demoManifest && stage.dataset.mediaPhase === 'fetching') return; fail(demoManifest ? 'Không giải mã được video đã kiểm SHA. Tải lại trang hoặc chọn clip khác.' : 'Không đọc được video. Kiểm tra file nguồn còn tồn tại, rồi khởi động lại server Court.'); });
window.addEventListener('pagehide', () => {
  disposeContacts();
  replayToken++; replayEnd = null; methodRevision++; switching = false; stage.dataset.switching = 'false';
  cancelVideoFrame();
  if (ready) { $('detector').value = activeDetector; controls.forEach(id => $(id).disabled = false); updateLines(); }
  video.pause(); cancelAnimationFrame(fallback);
  if (demoManifest) {
    demoResume = { clipId: activeClip?.id, frame: presentedIndex, caseItem: selectedCase };
    sourceRevision++; ready = false; stage.dataset.ready = 'false'; clearTimeout(mediaDeadline); clearOverlay();
    retireVideoBlobs();
  }
});
window.addEventListener('pageshow', () => {
  if (demoResume?.clipId) { const resume = demoResume; demoResume = null; mountDemoClip(resume.clipId, { frame: resume.frame, autoplay: false, caseItem: resume.caseItem }).catch(error => fail(error.message)); }
  else if (ready && video.requestVideoFrameCallback) scheduleVideoFrame();
});
new ResizeObserver(resize).observe(stage);

async function load() {
  if (demoMeta) { await loadDemo(); return; }
  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Không lấy được phiên phân tích (${response.status}).`);
    session = validateSession(await response.json());
    await loadMethods();
    lines = session.lineSuggestions.map(line => ({ ...line, a: [...line.a], b: [...line.b] }));
    try {
      const previous = localStorage.getItem(reviewKey(session.source));
      if (previous) { const imported = validateReview(JSON.parse(previous), session.source); lines = imported.lines; bookmarks = imported.bookmarks; }
    } catch { status('Bản lưu cũ không hợp lệ; đã mở lại vạch gợi ý của đúng video.', true); }
    $('source-chip').textContent = session.source.name;
    $('source-label').textContent = `${session.source.width} × ${session.source.height} · ${session.source.fps} fps · SHA ${session.source.sha256.slice(0, 12)}`;
    showMethodMetadata();
    stage.style.aspectRatio = `${session.source.width}/${session.source.height}`;
    $('seek').max = String(session.source.durationSeconds);
    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth !== session.source.width || video.videoHeight !== session.source.height || Math.abs(video.duration - session.source.durationSeconds) > 0.1) {
        fail('Video không khớp phân tích. Khởi động lại server để tạo lại dữ liệu đúng nguồn.'); return;
      }
      ready = true; stage.dataset.ready = 'true'; $('stage-message').hidden = true;
      $('detector').disabled = methodCatalog.methods.length < 2;
      controls.forEach(id => $(id).disabled = false); refreshEdits(); resize();
  status('Bám tự động chưa đạt kiểm chứng. Nhấp video để soi ảnh, chọn vạch để đối chiếu; không dùng các ứng viên để phân xử.');
      if (video.requestVideoFrameCallback) scheduleVideoFrame();
    }, { once: true });
    video.src = `/api/video?source=${session.source.sha256}`; video.load();
  } catch (error) { session = null; fail(`${error.message} Kiểm tra terminal Court rồi tải lại trang.`); }
}

async function jsonAsset(url, maxBytes = 32 * 1024 * 1024, expectedSha = null) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Không tải được dữ liệu demo (${response.status}).`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Dữ liệu demo vượt giới hạn.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new Error('Dữ liệu demo vượt giới hạn.');
  if (expectedSha) {
    const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== expectedSha) throw new Error('Checksum dự đoán không khớp bản đóng băng.');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function allCases() {
  return [...bundles.values()].flatMap(bundle => bundle.evidence.cases.map(item => ({ ...item, clipId: bundle.clip.id, title: bundle.clip.title })));
}
const categoryText = { 'both-correct': 'Cả hai cùng đúng', recovered: 'B mới tìm được', regressed: 'B đi lùi: A đúng, B bỏ sót', 'both-miss': 'Cả hai cùng bỏ sót' };

function updateCases() {
  const filter = $('case-filter').value, order = { regressed: 0, recovered: 1, 'both-miss': 2, 'both-correct': 3 };
  $('evidence-cases').replaceChildren();
  if (activeClip?.role === 'user-original') return;
  const cases = allCases().filter(item => filter === 'all' || item.category === filter).sort((a, b) => order[a.category] - order[b.category] || a.clipId.localeCompare(b.clipId) || a.frame - b.frame);
  for (const item of cases) {
    const button = document.createElement('button'); button.className = `evidence-case ${item.category}`;
    button.dataset.category = item.category; button.dataset.frame = String(item.frame); button.dataset.clipId = item.clipId;
    button.setAttribute('aria-current', String(selectedCase?.id === item.id && selectedCase?.clipId === item.clipId));
    const label = document.createElement('span'); label.textContent = categoryText[item.category];
    const detail = document.createElement('small'); detail.textContent = `${item.title} · khung ${item.frame + 1}`;
    button.append(label, detail); button.addEventListener('click', () => showCase(item)); $('evidence-cases').append(button);
  }
}

async function showCase(item) {
  selectedCase = item;
  status('Đang mở đúng khung được chọn; chưa xác nhận ảnh đã giải mã.');
  if (activeClip?.id !== item.clipId || !ready || stage.dataset.mediaLoading === 'true') await mountDemoClip(item.clipId, { frame: item.frame, autoplay: false, caseItem: item });
  else {
    video.pause(); inspectionPoint = null; selected = null;
    caseTarget = { revision: sourceRevision, frame: item.frame }; stage.dataset.requestedFrame = String(item.frame); stage.dataset.casePending = 'true';
    seekFrame(item.frame);
  }
  updateCases();
}

const MAX_DEMO_VIDEO_BYTES = 8 * 1024 * 1024;
async function verifiedVideoBlob(bundle) {
  if (bundle.videoBlob) return bundle.videoBlob;
  if (!bundle.videoPromise) {
    const epoch = blobEpoch, controller = new AbortController(); bundle.videoAbort = controller;
    bundle.videoPromise = (async () => {
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(bundle.videoUrl, { cache: 'force-cache', signal: controller.signal });
        if (!response.ok || Number(response.headers.get('content-length')) > MAX_DEMO_VIDEO_BYTES) throw new Error('Video công khai không hợp lệ hoặc vượt 8 MiB.');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Trình duyệt không đọc được video công khai theo giới hạn.');
        const chunks = []; let length = 0;
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.byteLength;
          if (length > MAX_DEMO_VIDEO_BYTES) { await reader.cancel(); throw new Error('Video công khai vượt giới hạn 8 MiB.'); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
        if (hash !== bundle.clip.sourceSha256) throw new Error('Checksum video không khớp nguồn đối chứng. Không mở ảnh chưa xác minh.');
        if (epoch !== blobEpoch) throw new Error('Phiên video đã bị đóng; không nhận kết quả cũ.');
        bundle.videoBlob = new Blob([bytes], { type: 'video/mp4' }); bundle.videoVerifiedSha = hash;
        return bundle.videoBlob;
      } finally { clearTimeout(timeout); }
    })();
  }
  return bundle.videoPromise;
}

function retireVideoBlobs(exceptId = null) {
  if (exceptId === null) blobEpoch++;
  for (const [id, bundle] of bundles) {
    if (id !== exceptId && bundle.videoObjectUrl) { URL.revokeObjectURL(bundle.videoObjectUrl); bundle.videoObjectUrl = null; }
    if (exceptId === null) { bundle.videoAbort?.abort(); bundle.videoBlob = null; bundle.videoPromise = null; bundle.videoVerifiedSha = null; }
  }
}

async function mountDemoClip(id, { frame = null, autoplay = true, caseItem = null } = {}) {
  const bundle = bundles.get(id); if (!bundle) throw new Error('Clip không thuộc gói demo.');
  disposeContacts();
  const revision = ++sourceRevision; methodRevision++; replayToken++; seekRevision++;
  ready = false; switching = false; seeking = false; replayEnd = null;
  video.pause(); cancelVideoFrame();
  cancelAnimationFrame(fallback); clearOverlay(); controls.forEach(control => $(control).disabled = true); $('detector').disabled = true;
  video.removeAttribute('src'); video.load(); retireVideoBlobs(id);
  stage.dataset.mediaLoading = 'true'; stage.dataset.mediaPhase = 'fetching'; stage.dataset.videoVerifiedSha = '';
  stage.dataset.casePending = String(frame !== null); stage.dataset.requestedFrame = frame === null ? '' : String(frame);
  caseTarget = frame === null ? null : { revision, frame };
  $('stage-message').hidden = false; $('stage-message').replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Đang tải và kiểm SHA video công khai…' }));
  status(frame === null ? 'Đang tải video đã cấp phép và kiểm nguồn.' : 'Đang mở đúng khung được chọn; chưa xác nhận ảnh đã giải mã.');
  clearTimeout(mediaDeadline); mediaDeadline = setTimeout(() => { if (revision === sourceRevision) fail('Chưa mở được khung đã chọn trong 30 giây. Tải lại trang hoặc chọn clip khác.'); }, 30_000);
  stage.dataset.ready = 'false'; stage.dataset.switching = 'false'; stage.dataset.clipId = id;
  activeClip = bundle.clip; activeBundle = bundle; selectedCase = caseItem; selected = null; inspectionPoint = null; inspectionFrame = null;
  stage.dataset.clipRole = activeClip.role ?? 'benchmark'; stage.dataset.evidenceScope = activeClip.role === 'user-original' ? 'unlabelled-original' : 'tennis-benchmark';
  updatePublicScope();
  presentedTime = 0; presentedIndex = null; lastRenderedTime = 0;
  hoverLineId = null; selectedLineId = null; pendingPoint = null; drawing = false; stage.dataset.drawing = 'false'; $('draw-guide').hidden = true;
  delete canvas.dataset.probeX; delete canvas.dataset.probeY;
  activeDetector = ['classical', 'specialist'].includes(activeDetector) ? activeDetector : 'specialist';
  session = bundle.sessions[activeDetector];
  methodCatalog = { defaultDetector: activeDetector, methods: Object.entries(bundle.sessions).map(([key, value]) => ({ key, id: value.method.id, kind: value.method.kind, description: value.method.description, model: value.method.model ?? null })) };
  configureMethods(); lines = session.lineSuggestions.map(line => ({ ...line, a: [...line.a], b: [...line.b] })); bookmarks = [];
  try { const saved = localStorage.getItem(reviewKey(session.source)); if (saved) { const edits = validateReview(JSON.parse(saved), session.source); lines = edits.lines; bookmarks = edits.bookmarks; } } catch {}
  $('clip-select').value = id; $('source-chip').textContent = activeClip.title;
  $('source-label').textContent = `${session.source.width} × ${session.source.height} · ${session.source.fps} fps · SHA ${session.source.sha256.slice(0, 12)}`;
  showMethodMetadata(); stage.style.aspectRatio = `${session.source.width}/${session.source.height}`;
  $('seek').max = String(session.source.durationSeconds); video.loop = $('loop-playback').checked; video.playbackRate = 0.5; $('speed').value = '0.5';
  let blob;
  try { blob = await verifiedVideoBlob(bundle); }
  catch (error) { if (revision === sourceRevision) fail(error.message); return; }
  if (revision !== sourceRevision) return;
  if (!bundle.videoObjectUrl) bundle.videoObjectUrl = URL.createObjectURL(blob);
  stage.dataset.videoVerifiedSha = bundle.videoVerifiedSha; stage.dataset.mediaPhase = 'verified';
  video.dataset.originalVideoUrl = bundle.videoUrl; video.dataset.mediaSource = 'verified-blob';
  video.addEventListener('loadedmetadata', () => {
    if (revision !== sourceRevision) return;
    if (video.videoWidth !== session.source.width || video.videoHeight !== session.source.height || Math.abs(video.duration - session.source.durationSeconds) > .1) { fail('Clip công khai không khớp dự đoán đã đóng băng.'); return; }
    ready = true; stage.dataset.mediaPhase = 'decoding';
    refreshEdits(); resize();
    if (video.requestVideoFrameCallback) scheduleVideoFrame();
    if (frame !== null) seekFrame(frame);
    else if (autoplay) video.play().catch(() => status('Bấm Phát để xem replay chậm 0,5×.'));
  }, { once: true });
  video.src = bundle.videoObjectUrl; video.load(); updateCases();
}

async function loadDemo() {
  try {
    const manifestUrl = new URL(demoMeta, document.baseURI).href;
    if (new URL(manifestUrl).origin !== location.origin) throw new Error('Manifest phải cùng nguồn trang demo.');
    demoManifest = validatePublicManifest(await jsonAsset(manifestUrl), manifestUrl);
    const entries = await Promise.all(demoManifest.clips.map(async clip => {
      const [a, b, labels] = await Promise.all([jsonAsset(staticAssetUrl(clip.sessions.classical, manifestUrl), undefined, clip.sessionSha256?.classical), jsonAsset(staticAssetUrl(clip.sessions.specialist, manifestUrl), undefined, clip.sessionSha256?.specialist), jsonAsset(staticAssetUrl(clip.evidence, manifestUrl))]);
      const sessions = { classical: validateSession(a), specialist: validateSession(b) };
      if (!sameSource(a.source, b.source) || a.source.sha256 !== clip.sourceSha256 || a.method.kind !== 'classical-cv' || b.method.kind !== 'learned-ball') throw new Error('A/B không cùng clip đã công bố.');
      for (const field of ['width', 'height', 'fps', 'frameCount', 'durationSeconds']) if (clip[field] !== undefined && (typeof clip[field] !== 'number' || !Number.isFinite(clip[field]) || Math.abs(clip[field] - a.source[field]) > 1e-5)) throw new Error('Metadata clip không khớp nguồn A/B.');
      const evidence = validateEvidence(labels, a.source, sessions);
      if (clip.role === 'user-original' && (evidence.cases.length !== 0 || evidence.labels.some(label => label.status !== 'unknown' || label.point !== null))) throw new Error('Video gốc chưa có nhãn; không được gán điểm hoặc kết luận đối chứng.');
      return { clip, sessions, evidence, videoUrl: staticAssetUrl(clip.video, manifestUrl) };
    }));
    entries.forEach(entry => bundles.set(entry.clip.id, entry));
    const counts = { visible: 0, unknown: 0, verifiedAbsent: 0, bothCorrect: 0, recovered: 0, regressed: 0, bothMiss: 0 };
    const keys = { 'both-correct': 'bothCorrect', recovered: 'recovered', regressed: 'regressed', 'both-miss': 'bothMiss' };
    entries.forEach(entry => { entry.evidence.labels.forEach(label => counts[label.status === 'visible' ? 'visible' : label.status === 'unknown' ? 'unknown' : 'verifiedAbsent']++); entry.evidence.cases.forEach(item => counts[keys[item.category]]++); });
    for (const key of ['visible', 'unknown', 'verifiedAbsent']) if (counts[key] !== demoManifest.summary[key]) throw new Error('Tổng số nhãn không khớp gói demo.');
    for (const key of ['bothCorrect', 'recovered', 'regressed', 'bothMiss']) if (counts[key] !== demoManifest.summary.paired[key]) throw new Error('Tổng ca đối chứng không khớp gói demo.');
    if (demoManifest.benchmarkSummary) {
      const benchmarkCounts = { visible: 0, unknown: 0, verifiedAbsent: 0 };
      entries.filter(entry => entry.clip.role === 'benchmark').forEach(entry => entry.evidence.labels.forEach(label => benchmarkCounts[label.status === 'visible' ? 'visible' : label.status === 'unknown' ? 'unknown' : 'verifiedAbsent']++));
      for (const field of Object.keys(benchmarkCounts)) if (benchmarkCounts[field] !== demoManifest.benchmarkSummary[field]) throw new Error('Phạm vi nhãn tennis không khớp benchmark riêng.');
    }
    document.body.classList.add('public-mode'); $('source-tools').hidden = false;
    $('paired-proof').hidden = false; $('magnifier').hidden = true;
    $('show-lines').checked = false;
    document.querySelector('.local-badge').textContent = 'Demo công khai · không mở camera';
    document.querySelector('.case-note').textContent = '35 mốc do AI đối chiếu thị giác, chưa có nghiệm thu nhãn bởi người. Giữ cả 3 ca đi lùi.';
    $('demo-provenance').hidden = false;
    $('demo-attribution').hidden = false; $('demo-attribution').href = staticAssetUrl('attribution.json', manifestUrl);
    document.querySelector('.rail-heading h2').textContent = 'Mốc của bạn';
    document.querySelector('.rail-explanation').textContent = 'Đánh dấu để xem lại, không tạo thêm nhãn đối chứng.';
    const benchmark = demoManifest.benchmarkSummary ?? demoManifest.summary;
    $('labelled-count').textContent = String(benchmark.visible); $('score-a').textContent = String(benchmark.classical.tp); $('score-b').textContent = String(benchmark.specialist.tp);
    $('score-scope').textContent = `${benchmark.unknown} khung tennis chưa gán nhãn · ${benchmark.verifiedAbsent} ca xác nhận vắng bóng. Chưa đo báo nhầm khi không có bóng.`;
    const grouped = demoManifest.schemaVersion === 'roboeye-court-public-v2';
    const groups = grouped ? Object.fromEntries([['user-original', 'Video chính'], ['benchmark', 'Tennis đối chứng (tham khảo)']].map(([role, label]) => { const group = document.createElement('optgroup'); group.label = label; $('clip-select').append(group); return [role, group]; })) : null;
    for (const clip of demoManifest.clips) { const option = document.createElement('option'); option.value = clip.id; option.textContent = clip.title; (groups ? groups[clip.role] : $('clip-select')).append(option); }
    activeDetector = 'specialist';
    await mountDemoClip(demoManifest.defaultClip);
  } catch (error) { session = null; ready = false; fail(`${error.message} Không hiển thị bằng chứng khi gói demo không hợp lệ.`); }
}

// Stills use a separate, source-verified decoder. Main playback is only sought
// by an explicit review click; queued thumbnail work never touches its clock.
function contactMessage(message, error = false) {
  $('contact-status').textContent = message; $('contact-status').classList.toggle('error', error);
}
function revokeContactUrls(urls) { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
function contactUrl(blob) { const url = URL.createObjectURL(blob); contactImageUrls.add(url); return url; }
function disposeContacts() {
  cancelContactClip(); clipDownloadAbort?.abort();
  contactGeneration++; contactSelection++; contactInspection++;
  contactThumbAbort?.abort(); contactSelectAbort?.abort(); contactCapture?.dispose();
  contactCapture = null; contactSourceSha = null; contactSelected = null; contactDisplayed = null;
  contactThumbJob = null; contactContextBusy = false;
  contactItems = []; contactSlots = []; contactROI = null;
  revokeContactUrls(contactImageUrls); revokeContactUrls(contactDownloadUrls);
  revokeContactUrls(contactContextUrls);
  $('contact-filmstrip').replaceChildren(); $('contact-context').replaceChildren(); $('contact-timeline').replaceChildren();
  $('featured-review').hidden = true; $('featured-review').dataset.itemId = '';
  $('contact-review').hidden = true;
  for (const key of Object.keys($('contact-review').dataset)) delete $('contact-review').dataset[key];
  $('contact-review').dataset.state = 'disposed';
  $('contact-workspace').dataset.captureState = 'disposed'; $('contact-workspace').dataset.sourceSha = '';
  $('contact-workspace').dataset.sidecarState = ''; stage.dataset.clipDownloadState = 'idle';
  $('contact-frame-title').textContent = 'Chưa chọn ảnh gốc';
  $('contact-frame-meta').textContent = ''; $('contact-reason').textContent = '';
  $('contact-crop-note').textContent = 'Nhấp ảnh để chọn vùng soi.'; cropDetail.textContent = '';
  contactMessage('Chưa có ảnh đang hợp lệ. Chọn video gốc và chụp lại từ nguồn đã kiểm SHA.');
  $('contact-clip-state').textContent = ''; $('play-contact-clip').disabled = true;
  $('download-contact-clip').hidden = true; $('download-contact-clip').disabled = true;
  for (const id of ['contact-inspector', 'contact-crop']) {
    const node = $(id); node.getContext('2d').clearRect(0, 0, node.width, node.height);
    for (const key of Object.keys(node.dataset)) delete node.dataset[key];
  }
  $('contact-roi-marker').hidden = true;
  for (const id of ['capture-current', 'download-raw', 'download-sheet']) $(id).disabled = true;
}
function ensureContacts() {
  if (contactCapture || !activeBundle?.videoBlob || activeClip?.role !== 'user-original') return;
  const generation = contactGeneration, source = session.source;
  contactSourceSha = source.sha256;
  $('contact-workspace').dataset.captureState = 'initializing'; $('contact-workspace').dataset.sourceSha = source.sha256;
  try {
    contactCapture = createFrameCapture({ blob: activeBundle.videoBlob, source, maxCacheFrames: 7 });
    const result = proposeEvidenceReviews(activeBundle.sessions);
    contactItems = result.proposals.map(item => ({ ...item }));
    loadEventEvidence();
    paintContactItems();
    $('contact-workspace').dataset.captureState = 'ready';
    contactMessage(contactItems.length
      ? `${contactItems.length} mốc cần xem lại. Chưa xác nhận chạm sân; khoảng mất dấu không được nối.`
      : 'Chưa đủ chuỗi điểm để gợi ý. Anh có thể dừng và chụp một khung để soi ảnh.');
    queueContactThumbnails(generation);
  } catch (error) {
    $('contact-workspace').dataset.captureState = 'error'; contactMessage(error.message, true);
  }
}
function paintContactItems() {
  const strip = $('contact-filmstrip');
  // Keep button identity, keyboard focus and horizontal position while individual
  // images finish. Async thumbnail completion must not rebuild the filmstrip.
  const nodes = new Map([...strip.querySelectorAll('.contact-item')].map(node => [node.dataset.itemId, node]));
  const retained = new Set(contactItems.map(item => item.id));
  for (const [id, node] of nodes) if (!retained.has(id)) node.remove();
  if (contactItems.length) strip.querySelector('.contact-empty')?.remove();
  if (!contactItems.length) {
    if (strip.querySelector('.contact-empty')) return;
    const empty = document.createElement('p'); empty.className = 'contact-empty';
    empty.textContent = 'Không tạo mốc chạm sân khi thiếu bằng chứng. Dùng “Chụp khung này” để xem ảnh thật.';
    strip.append(empty);
  }
  contactItems.forEach((item, index) => {
    let button = nodes.get(item.id);
    if (!button) {
      button = document.createElement('button'); button.className = `contact-item${item.kind === 'human-capture' ? ' manual' : ''}`;
      button.dataset.itemId = item.id;
      const placeholder = document.createElement('span'); placeholder.className = 'contact-thumb-placeholder'; button.append(placeholder);
      const title = document.createElement('span'); title.className = 'contact-item-title';
      title.textContent = `Khung ${item.frame + 1} · ${(item.frame / session.source.fps).toFixed(2)} s`;
      const note = document.createElement('span'); note.className = 'contact-item-note';
      note.textContent = item.kind === 'human-capture' ? 'Anh chụp · chưa kết luận' : item.kind === 'edge-loss-review' ? 'Mất dấu · Chưa rõ' : 'Nghi điểm rơi · chưa xác nhận';
      button.append(title, note); button.addEventListener('click', () => selectContact(item));
    }
    Object.assign(button.dataset, { kind: item.kind, frameIndex: String(item.frame), sourceSha: contactSourceSha,
      thumbState: item.thumbUrl ? 'ready' : item.thumbError ? 'error' : item.thumbLoading ? 'loading' : 'pending', thumbAttempts: String(item.thumbAttempts ?? 0) });
    button.setAttribute('aria-current', String(contactSelected?.id === item.id));
    if (item.thumbUrl) {
      if (button.firstElementChild?.getAttribute('src') !== item.thumbUrl) {
        const img = new Image(); img.src = item.thumbUrl; img.alt = `Ảnh gốc khung ${item.frame + 1}`; button.firstElementChild.replaceWith(img);
      }
    } else button.firstElementChild.textContent = item.thumbError ? 'Chưa chụp được ảnh' : 'Đang lấy ảnh thật…';
    if (strip.children[index] !== button) strip.insertBefore(button, strip.children[index] ?? null);
  });
  paintContactTimeline();
}
function paintContactTimeline() {
  const timeline = $('contact-timeline'), items = contactItems.filter(item => ['suspected-contact', 'edge-loss-review'].includes(item.kind));
  const featured = items.filter(item => item.kind === 'edge-loss-review').at(-1);
  $('featured-review').hidden = !featured;
  if (featured) {
    $('featured-review').dataset.itemId = featured.id;
    $('featured-review').textContent = `Xem pha ${(featured.frame / session.source.fps).toFixed(2).replace('.', ',')} s`;
    $('featured-review').setAttribute('aria-label', `Xem pha mất dấu ${(featured.frame / session.source.fps).toFixed(2).replace('.', ',')} giây, chưa rõ kết quả`);
  }
  const nodes = new Map([...timeline.children].map(node => [node.dataset.itemId, node]));
  for (const [id, node] of nodes) if (!items.some(item => item.id === id)) node.remove();
  for (const item of items) {
    let button = nodes.get(item.id);
    if (!button) {
      button = document.createElement('button'); button.className = `contact-event${item.kind === 'edge-loss-review' ? ' edge-loss' : ''}`;
      Object.assign(button.dataset, { itemId: item.id, frameIndex: String(item.frame), sourceSha: item.sourceSha256, kind: item.kind });
      button.textContent = `${item.kind === 'edge-loss-review' ? '?' : '+'} ${(item.frame / session.source.fps).toFixed(2)} s`;
      button.title = `${item.kind === 'edge-loss-review' ? 'Mất dấu · Chưa rõ' : 'Nghi điểm rơi'} · khung ${item.frame + 1} · chưa xác nhận chạm sân`;
      button.setAttribute('aria-label', button.title); button.addEventListener('click', () => selectContact(item)); timeline.append(button);
    }
    button.style.left = `${Math.min(94, Math.max(6, item.frame / session.source.frameCount * 100))}%`;
    button.setAttribute('aria-current', String(contactSelected?.id === item.id));
  }
  timeline.hidden = items.length === 0;
}
$('featured-review').addEventListener('click', () => {
  const item = contactItems.find(item => item.id === $('featured-review').dataset.itemId && item.kind === 'edge-loss-review');
  if (item?.sourceSha256 === contactSourceSha) selectContact(item);
});
async function queueContactThumbnails(generation = contactGeneration) {
  if (generation !== contactGeneration || !contactCapture || contactContextBusy || contactThumbJob) return;
  const abort = new AbortController(), controller = contactCapture, job = { generation, abort };
  contactThumbAbort = abort; contactThumbJob = job;
  try {
    while (generation === contactGeneration && !abort.signal.aborted && !contactContextBusy) {
      const item = contactItems.find(value => !value.thumbUrl && (value.thumbAttempts ?? 0) < 2);
      if (!item) return;
      item.thumbAttempts = (item.thumbAttempts ?? 0) + 1; item.thumbLoading = true; item.thumbError = false; paintContactItems();
      try {
        const frame = await controller.captureThumbnail(item.frame, { signal: abort.signal, maxWidth: 192 });
        if (generation !== contactGeneration || abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        item.thumbUrl = contactUrl(frame.blob);
      } catch (error) {
        if (error.name === 'AbortError' || abort.signal.aborted || generation !== contactGeneration) {
          // Selection preemption is not a failed extraction and uses no retry.
          item.thumbAttempts--; return;
        }
        item.thumbError = item.thumbAttempts >= 2;
        if (item.thumbError) contactMessage('Một ảnh gợi ý chưa chụp được sau 2 lần. Chọn mốc để thử ảnh gốc.', true);
      } finally {
        item.thumbLoading = false;
        if (generation === contactGeneration) paintContactItems();
      }
    }
  } finally {
    if (contactThumbJob === job) {
      contactThumbJob = null;
      // A context can finish while a cancelled thumbnail settles. Resume only
      // this source's remaining bounded work, never an old selection/source.
      if (generation === contactGeneration && !contactContextBusy
        && contactItems.some(item => !item.thumbUrl && (item.thumbAttempts ?? 0) < 2)) queueMicrotask(() => queueContactThumbnails(generation));
    }
  }
}
async function seedContactThumbnail(item, slot, generation, selection) {
  if (item.thumbUrl || slot.status !== 'captured') return;
  // A successfully qualified native still can repair its own failed thumbnail
  // without another decoder seek, another retry, or a fabricated replacement.
  const thumbnail = document.createElement('canvas'); thumbnail.width = Math.min(192, slot.frame.width);
  thumbnail.height = Math.max(1, Math.round(slot.frame.height * thumbnail.width / slot.frame.width));
  thumbnail.getContext('2d').drawImage(slot.image, 0, 0, thumbnail.width, thumbnail.height);
  const blob = await new Promise(resolve => thumbnail.toBlob(resolve, 'image/png'));
  if (!blob || generation !== contactGeneration || selection !== contactSelection || item.thumbUrl) return;
  item.thumbUrl = contactUrl(blob); item.thumbError = false; paintContactItems();
}
async function selectContact(item) {
  if (!contactCapture || item.sourceSha256 !== contactSourceSha) return;
  cancelContactClip(); clipDownloadAbort?.abort();
  const generation = contactGeneration, selection = ++contactSelection;
  contactReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  contactInspection++; contactThumbAbort?.abort(); contactSelectAbort?.abort();
  contactContextBusy = true;
  revokeContactUrls(contactContextUrls);
  const abort = new AbortController(); contactSelectAbort = abort;
  contactSelected = item; contactDisplayed = null; contactSlots = []; contactROI = null;
  $('contact-review').hidden = false;
  Object.assign($('contact-review').dataset, { state: 'loading', sourceSha: contactSourceSha, frameIndex: '', centerIndex: String(item.frame), kind: item.kind });
  const window = contactWindow(item);
  Object.assign($('contact-review').dataset, { reviewStartFrame: String(item.reviewInterval?.startFrame ?? item.frame), reviewEndFrame: String(item.reviewInterval?.endFrame ?? item.frame),
    clipStartFrame: window ? String(window.startFrame) : '', clipEndFrame: window ? String(window.endFrame) : '' });
  $('contact-context').replaceChildren(); $('contact-roi-marker').hidden = true;
  for (const id of ['contact-inspector', 'contact-crop']) { const node = $(id); node.getContext('2d').clearRect(0, 0, node.width, node.height); for (const key of Object.keys(node.dataset)) delete node.dataset[key]; }
  $('download-raw').disabled = true; $('download-sheet').disabled = true;
  $('play-contact-clip').disabled = !window; $('contact-clip-state').textContent = ''; stage.dataset.clipDownloadState = 'idle';
  updateClipDownload();
  $('contact-decision').textContent = item.kind === 'edge-loss-review' ? 'Mất dấu · Chưa rõ' : 'Chưa đủ bằng chứng';
  $('contact-frame-title').textContent = `Đang lấy khung ${item.frame + 1}…`;
  $('contact-frame-meta').textContent = `SHA ${contactSourceSha.slice(0, 12)} · frameIndex ${item.frame} (từ 0)`;
  $('contact-reason').textContent = item.kind === 'human-capture'
    ? 'Khung do anh chủ động chụp, không phải điểm chạm được hệ thống phát hiện.'
    : item.kind === 'edge-loss-review'
      ? `Mất dấu gần mép ảnh: các điểm thật trước đó chưa chứng minh bóng đã chạm sàn hay ra ngoài. ${item.reason}`
      : `Gợi ý chuyển hướng từ ${item.arms.map(arm => arm === 'specialist' ? 'B' : 'A').join('+')}. ${item.reason} Không xác nhận bóng chạm sàn.`;
  paintContactItems(); video.pause(); seekFrame(item.frame);
  repaint(presentedTime);
  contactMessage('Đang lấy 5 khung thật quanh mốc bằng decoder độc lập…');
  try {
    const slots = await contactCapture.captureContext(item.frame, { signal: abort.signal });
    if (generation !== contactGeneration || selection !== contactSelection || abort.signal.aborted) return;
    const decodedSlots = await Promise.all(slots.map(async slot => {
      if (slot.status !== 'captured') return slot;
      if (generation !== contactGeneration || selection !== contactSelection || abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const url = URL.createObjectURL(slot.frame.blob); contactContextUrls.add(url);
      const image = new Image(); image.src = url; await image.decode();
      return { ...slot, url, image };
    }));
    if (generation !== contactGeneration || selection !== contactSelection || abort.signal.aborted) return;
    contactSlots = decodedSlots;
    paintContactContext();
    const center = contactSlots.find(slot => slot.offset === 0 && slot.status === 'captured');
    if (!center) throw Error('Chưa lấy được đúng ảnh trung tâm. Không dùng ảnh lân cận thay thế.');
    showContactStill(center);
    $('contact-review').dataset.state = 'ready';
    await seedContactThumbnail(item, center, generation, selection);
    if (generation !== contactGeneration || selection !== contactSelection || abort.signal.aborted) return;
    contactMessage('Ảnh gốc đã sẵn sàng. Chọn ảnh kề hoặc nhấp vào bóng/vạch để soi pixel; chưa kết luận chạm sân.');
  } catch (error) {
    if (error.name === 'AbortError' || generation !== contactGeneration || selection !== contactSelection) return;
    $('contact-review').dataset.state = 'error'; contactMessage(error.message, true);
  } finally {
    if (generation === contactGeneration && selection === contactSelection) {
      contactContextBusy = false; queueContactThumbnails(generation);
    }
  }
}
function paintContactContext() {
  $('contact-context').replaceChildren();
  for (const slot of contactSlots) {
    const button = document.createElement('button'); button.className = 'context-slot';
    Object.assign(button.dataset, { offset: String(slot.offset), requestedIndex: String(slot.requestedIndex), frameIndex: slot.index === null ? '' : String(slot.index), status: slot.status });
    button.disabled = slot.status !== 'captured';
    if (slot.image) {
      const preview = document.createElement('canvas'); preview.width = slot.frame.width; preview.height = slot.frame.height;
      preview.getContext('2d').drawImage(slot.image, 0, 0); button.append(preview);
      button.addEventListener('click', () => showContactStill(slot));
    } else { const empty = document.createElement('span'); empty.className = 'context-empty'; empty.textContent = slot.status === 'out-of-range' ? 'Ngoài video' : 'Không lấy được ảnh'; button.append(empty); }
    const title = document.createElement('span'); title.className = 'context-slot-title';
    title.textContent = `${slot.offset > 0 ? '+' : ''}${slot.offset} · ${slot.index === null ? 'trống' : `Khung ${slot.index + 1}`}`;
    button.append(title); $('contact-context').append(button);
  }
}
function showContactStill(slot) {
  if (slot.status !== 'captured' || slot.frame.sourceSha256 !== contactSourceSha) return;
  contactDisplayed = slot; contactInspection++;
  const target = $('contact-inspector'); target.width = slot.frame.width; target.height = slot.frame.height;
  target.getContext('2d').drawImage(slot.image, 0, 0);
  Object.assign(target.dataset, { sourceSha: contactSourceSha, frameIndex: String(slot.index), humanFrame: String(slot.index + 1) });
  $('contact-review').dataset.frameIndex = String(slot.index);
  $('contact-frame-title').textContent = `Khung ${slot.index + 1} · ${slot.frame.timeSeconds.toFixed(2)} s`;
  $('contact-frame-meta').textContent = `Ảnh gốc ${slot.frame.width} × ${slot.frame.height} · SHA ${contactSourceSha.slice(0, 12)} · frameIndex ${slot.index} (từ 0)`;
  for (const element of $('contact-context').children) element.setAttribute('aria-current', String(element.dataset.frameIndex === String(slot.index)));
  const suggestion = contactSelected.point;
  contactROI = suggestion && slot.index === contactSelected.frame ? { x: suggestion[0], y: suggestion[1], provenance: contactSelected.pointProvenance ?? 'unverified-model-proposal' }
    : { x: slot.frame.width / 2, y: slot.frame.height / 2, provenance: 'image-center-not-ball' };
  paintContactCrop(); $('download-raw').disabled = false; $('download-sheet').disabled = false;
}
function paintContactCrop() {
  if (!contactDisplayed || !contactROI) return;
  const frame = contactDisplayed.frame, width = Math.min(144, frame.width), height = Math.min(96, frame.height);
  const x = Math.max(0, Math.min(frame.width - width, Math.round(contactROI.x - width / 2)));
  const y = Math.max(0, Math.min(frame.height - height, Math.round(contactROI.y - height / 2)));
  const crop = $('contact-crop'), context = crop.getContext('2d'); context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, crop.width, crop.height); context.drawImage(contactDisplayed.image, x, y, width, height, 0, 0, crop.width, crop.height);
  Object.assign(crop.dataset, { sourceSha: contactSourceSha, frameIndex: String(frame.index), cropX: String(x), cropY: String(y), cropWidth: String(width), cropHeight: String(height), provenance: contactROI.provenance });
  const marker = $('contact-roi-marker'); marker.hidden = false;
  Object.assign(marker.style, { left: `${x / frame.width * 100}%`, top: `${y / frame.height * 100}%`, width: `${width / frame.width * 100}%`, height: `${height / frame.height * 100}%` });
  $('contact-crop-note').textContent = 'Nhấp ảnh để chọn vùng soi.';
  cropDetail.textContent = contactROI.provenance === 'unverified-model-proposal'
    ? 'Vùng quanh ứng viên chưa xác thực. Nhấp ảnh để chọn bóng hoặc vạch. Phóng pixel, không AI làm nét.'
    : 'Vùng kiểm tra ảnh, không phải vị trí bóng được xác nhận. Phóng pixel gốc, không AI làm nét.';
}
$('contact-inspector').addEventListener('click', event => {
  if (!contactDisplayed) return;
  const bounds = event.currentTarget.getBoundingClientRect(), frame = contactDisplayed.frame;
  contactROI = { x: Math.max(0, Math.min(frame.width - 1, (event.clientX - bounds.left) / bounds.width * frame.width)), y: Math.max(0, Math.min(frame.height - 1, (event.clientY - bounds.top) / bounds.height * frame.height)), provenance: 'manual-image-probe' };
  contactInspection++; paintContactCrop();
});
$('capture-current').addEventListener('click', () => {
  if (!contactCapture || presentedIndex === null || stage.dataset.timingQualified !== 'true' || canvas.dataset.frameIndex !== String(presentedIndex) || session.source.sha256 !== contactSourceSha) return;
  video.pause();
  const item = { id: `manual-${contactGeneration}-${presentedIndex}`, frame: presentedIndex, sourceSha256: contactSourceSha, kind: 'human-capture', arms: [activeDetector] };
  if (inspectionFrame?.sourceSha === contactSourceSha && inspectionFrame.index === presentedIndex && inspectionPoint) {
    item.point = [...inspectionPoint]; item.pointProvenance = 'manual-image-probe';
  } else if (session.frames[presentedIndex]?.status === 'observed' && session.frames[presentedIndex].ball) {
    item.point = [session.frames[presentedIndex].ball.x, session.frames[presentedIndex].ball.y]; item.pointProvenance = 'unverified-model-proposal';
  }
  const existing = contactItems.find(value => value.id === item.id);
  if (existing) {
    existing.point = item.point; existing.pointProvenance = item.pointProvenance;
    selectContact(existing); return;
  }
  const manual = contactItems.filter(value => value.kind === 'human-capture');
  if (manual.length >= 4) { const retired = manual[0]; if (retired.thumbUrl) { URL.revokeObjectURL(retired.thumbUrl); contactImageUrls.delete(retired.thumbUrl); } contactItems = contactItems.filter(value => value !== retired); }
  contactItems.push(item); selectContact(item);
});
function contactDownload(blob, suffix, expected) {
  if (!contactDisplayed || expected !== `${contactGeneration}:${contactSelection}:${contactInspection}`) return;
  const url = URL.createObjectURL(blob); contactDownloadUrls.add(url);
  const link = document.createElement('a'); link.href = url;
  link.download = `court-${contactSourceSha.slice(0, 12)}-khung-${String(contactDisplayed.index + 1).padStart(4, '0')}-${suffix}.png`;
  link.click(); setTimeout(() => { URL.revokeObjectURL(url); contactDownloadUrls.delete(url); }, 1500);
}
function contactWindow(item) {
  if (!item || !session || item.sourceSha256 !== session.source.sha256) return null;
  const window = item.clipWindow ?? (item.kind === 'human-capture' ? {
    startFrame: Math.max(0, item.frame - Math.round(session.source.fps)),
    endFrame: Math.min(session.source.frameCount - 1, item.frame + Math.round(session.source.fps)),
  } : null);
  return window && Number.isInteger(window.startFrame) && Number.isInteger(window.endFrame)
    && window.startFrame >= 0 && window.endFrame < session.source.frameCount
    && window.startFrame <= item.frame && window.endFrame >= item.frame ? window : null;
}
function cancelContactClip(pause = true, state = 'idle') {
  const playback = contactClipPlayback; contactClipPlayback = null;
  if (playback) {
    replayToken++;
    if (playback.sourceSha === session?.source.sha256) { if (pause) video.pause(); video.loop = playback.previousLoop; }
  }
  stage.dataset.contactReplay = state;
  if (state !== 'stopped') {
    stage.dataset.contactReplayStartFrame = ''; stage.dataset.contactReplayEndFrame = ''; stage.dataset.contactReplaySourceSha = '';
  }
}
$('play-contact-clip').addEventListener('click', () => {
  const window = contactWindow(contactSelected); if (!ready || !window) return;
  cancelContactClip(); video.pause(); replayEnd = null; const token = ++replayToken;
  const playback = { ...window, sourceSha: contactSourceSha, generation: contactGeneration, selection: contactSelection, previousLoop: video.loop, token };
  contactClipPlayback = playback; video.loop = false;
  Object.assign(stage.dataset, { contactReplay: 'seeking', contactReplayStartFrame: String(window.startFrame), contactReplayEndFrame: String(window.endFrame), contactReplaySourceSha: contactSourceSha });
  $('contact-clip-state').textContent = 'Phát đoạn trước / sau mốc.';
  video.playbackRate = .5; $('speed').value = '0.5';
  const reused = seekFrame(window.startFrame, true);
  const playWhenReady = () => {
    if (contactClipPlayback !== playback || token !== replayToken || playback.generation !== contactGeneration || playback.selection !== contactSelection || session?.source.sha256 !== playback.sourceSha) return;
    stage.dataset.contactReplay = 'playing'; video.play().catch(() => {
      cancelContactClip(); $('contact-clip-state').textContent = 'Bấm phát để xem đoạn.';
    });
  };
  if (reused) playWhenReady(); else video.addEventListener('seeked', playWhenReady, { once: true });
});
function validateEventEvidence(value, source, clip, proposals) {
  if (value?.schemaVersion !== 'roboeye-court-event-evidence-v1' || !sameSource(value.source, source)
    || value.sessionHashBinding !== 'inputCachedSessionSha256'
    || !['classical', 'specialist'].every(key => /^[a-f0-9]{64}$/.test(value.sessionSha256?.[key]) && value.sessionSha256[key] === clip.inputCachedSessionSha256?.[key])
    || !Array.isArray(value.events) || value.events.length !== proposals.length) throw Error('Clip bằng chứng không khớp nguồn đã đóng băng.');
  const seen = new Set();
  for (const item of value.events) {
    const proposal = proposals.find(proposal => proposal.id === item.id), asset = item.clip;
    if (!proposal || seen.has(item.id) || item.index !== proposal.index || item.kind !== proposal.kind
      || item.decision !== 'insufficient-evidence'
      || !['startFrame', 'endFrame'].every(key => item.clipWindow?.[key] === proposal.clipWindow?.[key] && item.reviewInterval?.[key] === proposal.reviewInterval?.[key])
      || asset?.contentType !== 'video/mp4' || !Number.isInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 8 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || asset.sourceStartFrame !== proposal.clipWindow.startFrame || asset.sourceEndFrame !== proposal.clipWindow.endFrame
      || asset.frameCount !== asset.sourceEndFrame - asset.sourceStartFrame + 1
      || asset.width !== source.width || asset.height !== source.height || asset.fps !== source.fps
      || !Number.isFinite(asset.durationSeconds) || Math.abs(asset.durationSeconds - asset.frameCount / source.fps) > 1e-5) throw Error('Không dùng clip sai mốc hoặc sai cửa sổ ảnh.');
    staticAssetUrl(asset.path, eventEvidenceUrl); seen.add(item.id);
  }
  return value;
}
function loadEventEvidence() {
  if (!demoManifest || activeClip?.role !== 'user-original') return;
  if (eventEvidencePromise) { $('contact-workspace').dataset.sidecarState = eventEvidenceState; updateClipDownload(); return; }
  const advertised = demoManifest.eventEvidence;
  if (!advertised) { $('contact-workspace').dataset.sidecarState = 'unavailable'; return; }
  if (advertised.path !== './events/manifest.json' || !/^[a-f0-9]{64}$/.test(advertised.sha256)) {
    $('contact-workspace').dataset.sidecarState = 'error'; return;
  }
  const source = session.source, clip = activeClip, proposals = contactItems.filter(item => item.kind !== 'human-capture');
  eventEvidenceUrl = staticAssetUrl(advertised.path, new URL(demoMeta, document.baseURI).href);
  eventEvidenceState = 'loading'; $('contact-workspace').dataset.sidecarState = 'loading';
  eventEvidencePromise = jsonAsset(eventEvidenceUrl, 1024 * 1024, advertised.sha256)
    .then(value => { eventEvidence = validateEventEvidence(value, source, clip, proposals); eventEvidenceState = 'ready'; return eventEvidence; })
    .catch(() => { eventEvidence = null; eventEvidenceState = 'error'; return null; })
    .finally(() => {
      if (contactSourceSha === source.sha256) { $('contact-workspace').dataset.sidecarState = eventEvidence ? 'ready' : 'error'; updateClipDownload(); }
    });
}
function selectedClipAsset() {
  if (!eventEvidence || eventEvidence.source.sha256 !== contactSourceSha || contactSelected?.kind === 'human-capture') return null;
  return eventEvidence.events.find(item => item.id === contactSelected?.id && item.index === contactSelected.frame && item.kind === contactSelected.kind)?.clip ?? null;
}
function updateClipDownload() {
  const asset = selectedClipAsset(); $('download-contact-clip').hidden = !asset; $('download-contact-clip').disabled = !asset;
}
$('download-contact-clip').addEventListener('click', async () => {
  const asset = selectedClipAsset(); if (!asset) return;
  clipDownloadAbort?.abort(); const abort = new AbortController(); clipDownloadAbort = abort;
  const generation = contactGeneration, selection = contactSelection, item = contactSelected, sourceSha = contactSourceSha;
  $('download-contact-clip').disabled = true; $('contact-clip-state').textContent = 'Đang kiểm clip…'; stage.dataset.clipDownloadState = 'verifying';
  try {
    const response = await fetch(staticAssetUrl(asset.path, eventEvidenceUrl), { signal: abort.signal, cache: 'no-store' });
    if (!response.ok || Number(response.headers.get('content-length')) > asset.bytes) throw Error('Không tải được đúng clip.');
    const reader = response.body.getReader(), chunks = []; let length = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength;
      if (length > asset.bytes || length > 8 * 1024 * 1024) { await reader.cancel(); throw Error('Clip vượt giới hạn đã khai báo.'); }
      chunks.push(chunk.value);
    }
    if (length !== asset.bytes) throw Error('Clip thiếu dữ liệu.');
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    if (sha !== asset.sha256) throw Error('Clip không khớp SHA.');
    if (abort.signal.aborted || generation !== contactGeneration || selection !== contactSelection || contactSelected !== item || sourceSha !== contactSourceSha) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' })); contactDownloadUrls.add(url);
    const link = document.createElement('a'); link.href = url;
    link.download = `court-${sourceSha.slice(0, 12)}-khung-${String(item.frame + 1).padStart(4, '0')}-clip.mp4`; link.click();
    setTimeout(() => { URL.revokeObjectURL(url); contactDownloadUrls.delete(url); }, 1500);
    stage.dataset.clipDownloadState = 'ready'; $('contact-clip-state').textContent = 'Đã tải clip MP4.';
  } catch (error) {
    if (abort.signal.aborted || generation !== contactGeneration || selection !== contactSelection) return;
    stage.dataset.clipDownloadState = 'error'; $('contact-clip-state').textContent = 'Clip chưa dùng được. Vẫn có thể xem lại đoạn.';
  } finally {
    if (generation === contactGeneration && selection === contactSelection) updateClipDownload();
  }
});
$('download-raw').addEventListener('click', () => {
  if (contactDisplayed) contactDownload(contactDisplayed.frame.blob, 'raw', `${contactGeneration}:${contactSelection}:${contactInspection}`);
});
$('download-sheet').addEventListener('click', () => {
  if (!contactDisplayed) return;
  const expected = `${contactGeneration}:${contactSelection}:${contactInspection}`, sheet = document.createElement('canvas');
  sheet.width = 1280; sheet.height = 1120; const c = sheet.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, sheet.width, sheet.height); c.fillStyle = '#172c3d'; c.font = 'bold 29px Arial';
  c.fillText(`ROBOEYE COURT · Khung ${contactDisplayed.index + 1}`, 32, 47);
  c.font = '17px Arial'; c.fillText('CHƯA ĐỦ BẰNG CHỨNG · Không xác nhận chạm sân hoặc In/Out', 32, 82);
  c.font = '14px monospace'; c.fillText(`sourceSha256: ${contactSourceSha}`, 32, 112);
  c.fillText(`frameIndex (từ 0): ${contactDisplayed.index} · time: ${contactDisplayed.frame.timeSeconds.toFixed(2)} s · mốc gốc: ${contactSelected.frame}`, 32, 137);
  c.font = '16px Arial'; c.fillText(contactSelected.kind === 'human-capture' ? 'Nguồn mốc: anh chủ động chụp, không phải phát hiện chạm sân.'
    : contactSelected.kind === 'edge-loss-review' ? 'Nguồn mốc: mất dấu gần mép ảnh, chưa rõ chạm sàn hay ra ngoài.'
      : `Nguồn mốc: ứng viên chuyển hướng ${contactSelected.arms.join('+')}; điểm bám chưa xác thực.`, 32, 165);
  c.drawImage(contactDisplayed.image, 32, 190, 854, 480);
  c.drawImage($('contact-crop'), 910, 190, 338, 225);
  c.font = '15px Arial'; c.fillText('Vùng soi pixel thật, không AI làm nét', 910, 443);
  c.fillText(`ROI ${$('contact-crop').dataset.cropX},${$('contact-crop').dataset.cropY}`, 910, 468);
  c.font = '18px Arial'; c.fillText('Năm khung theo thứ tự quanh mốc; ô ngoài biên giữ trống.', 32, 713);
  contactSlots.forEach((slot, index) => {
    const x = 32 + index * 246; c.fillStyle = '#e8edf1'; c.fillRect(x, 738, 230, 130);
    if (slot.image) c.drawImage(slot.image, x, 738, 230, 130);
    c.fillStyle = '#172c3d'; c.font = '16px Arial'; c.fillText(`${slot.offset > 0 ? '+' : ''}${slot.offset} · ${slot.index === null ? 'Ngoài video' : `Khung ${slot.index + 1}`}`, x, 894);
    if (!slot.image) { c.font = '13px Arial'; c.fillText(slot.status === 'out-of-range' ? 'Không có ảnh' : 'Chụp ảnh thất bại', x + 8, 809); }
  });
  c.font = '16px Arial'; c.fillText('Ảnh gốc không vẽ lớp model. Gợi ý ảnh-space không chứng minh bóng đã tiếp xúc mặt sân.', 32, 951);
  c.fillText('Không nội suy điểm, không nối khoảng mất dấu. Mốc này chỉ dùng để xem lại bằng mắt.', 32, 982);
  c.font = '14px monospace'; c.fillText(`inspection: ${contactROI.provenance} · native ${contactDisplayed.frame.width}x${contactDisplayed.frame.height}`, 32, 1020);
  sheet.toBlob(blob => { if (blob) contactDownload(blob, 'doi-chieu', expected); }, 'image/png');
});
function closeContactReview() {
  cancelContactClip(); clipDownloadAbort?.abort();
  contactSelection++; contactInspection++; contactSelectAbort?.abort(); contactContextBusy = false;
  contactSelected = null; contactDisplayed = null; contactSlots = []; contactROI = null;
  revokeContactUrls(contactContextUrls); $('contact-context').replaceChildren();
  $('contact-review').hidden = true;
  for (const key of Object.keys($('contact-review').dataset)) delete $('contact-review').dataset[key];
  $('contact-review').dataset.state = 'closed';
  $('download-raw').disabled = true; $('download-sheet').disabled = true;
  $('play-contact-clip').disabled = true; $('download-contact-clip').disabled = true; $('download-contact-clip').hidden = true;
  $('contact-clip-state').textContent = ''; stage.dataset.clipDownloadState = 'idle';
  $('contact-roi-marker').hidden = true;
  paintContactItems(); repaint(presentedTime); queueContactThumbnails();
  if (contactReturnFocus?.isConnected) contactReturnFocus.focus({ preventScroll: true });
}
$('close-contact').addEventListener('click', closeContactReview);
$('open-settings').addEventListener('click', () => {
  video.pause(); settings.showModal(); repaint(presentedTime);
});
$('close-settings').addEventListener('click', () => settings.close());
settings.addEventListener('close', () => {
  mag.clearRect(0, 0, magnifier.width, magnifier.height);
  for (const id of ['proof-a', 'proof-b']) {
    const node = $(id); node.getContext('2d').clearRect(0, 0, node.width, node.height);
    for (const key of Object.keys(node.dataset)) delete node.dataset[key];
  }
  writeText('proof-a-status', 'Mở tùy chọn để xem'); writeText('proof-b-status', 'Mở tùy chọn để xem');
  $('open-settings').focus({ preventScroll: true }); repaint(presentedTime);
});
document.addEventListener('keydown', event => {
  if (!event.defaultPrevented && event.key === 'Escape' && !settings.open && !$('contact-review').hidden) closeContactReview();
});

function updatePublicScope() {
  if (!demoManifest || !activeClip || !activeBundle) return;
  const original = activeClip.role === 'user-original';
  $('contact-workspace').hidden = !original;
  $('original-scope').hidden = !original; $('public-evidence').hidden = original; $('reference-control').hidden = original;
  document.body.classList.toggle('original-mode', original);
  document.querySelector('h1').textContent = original ? 'Video Pickleball gốc.' : 'Một khung hình. Hai cách bám.';
  document.querySelector('.workspace-heading p').textContent = original ? 'Xem ứng viên và khoảng mất dấu; chưa đủ bằng chứng để phân xử.' : 'Tennis đối chứng. Xem cả tiến bộ lẫn bỏ sót, không phán In/Out.';
  document.querySelector('.source-tools>span').textContent = original ? 'Video Pickleball gốc · replay kết quả trên Mac' : 'Video tennis · replay kết quả trên Mac';
  document.querySelector('.baseline-warning').textContent = original ? 'Model B huấn luyện tennis, chưa được kiểm chứng cho Pickleball. Không kết luận In/Out.' : 'Thử nghiệm tennis, chưa xác nhận pickleball. Xanh: tham chiếu hình ảnh, không phải điểm chạm sân.';
  $('demo-provenance').textContent = original ? 'Demo bằng chứng từ video ghi sẵn, không xử lý trực tiếp và chưa phải trọng tài tự động. Video gốc được cho phép công khai, chưa có nhãn đối chứng bóng hoặc điểm chạm. Số khung có ứng viên không phải độ chính xác.' : 'Đối chiếu tâm bóng trong 8 pixel ảnh gốc. Nhãn do trợ lý đọc ảnh, chưa được người nghiệm thu; khung chưa rõ không tính là vắng bóng.';
  if (original) {
    const n = activeBundle.sessions.classical.source.frameCount;
    $('original-unknown').textContent = `${n} khung chưa có nhãn đối chứng. Chưa biết độ chính xác.`;
    $('original-coverage').textContent = `Khung có ứng viên: A ${activeBundle.sessions.classical.summary.observedFrames}/${n}; B ${activeBundle.sessions.specialist.summary.observedFrames}/${n}.`;
    $('reference-status').textContent = 'Video gốc chưa có nhãn tham chiếu.';
  }
}
$('clip-select').addEventListener('change', () => mountDemoClip($('clip-select').value).catch(error => fail(error.message)));
$('case-filter').addEventListener('change', updateCases);
load();
