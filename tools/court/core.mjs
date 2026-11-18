/** Court review geometry and evidence contracts. All positions are image pixels. */
export const SESSION_SCHEMA = 'roboeye-court-session-v1';
export const REVIEW_SCHEMA = 'roboeye-court-review-v1';
export const INCONCLUSIVE = 'insufficient-evidence';
const number = x => typeof x === 'number' && Number.isFinite(x);
const integer = x => Number.isInteger(x);
const string = (x, max = 300) => typeof x === 'string' && x.length > 0 && x.length <= max;
const check = (condition, message) => { if (!condition) throw new Error(message); };

export function imageRect(width, height, imageWidth, imageHeight) {
  if (![width, height, imageWidth, imageHeight].every(x => number(x) && x > 0)) return null;
  const scale = Math.min(width / imageWidth, height / imageHeight);
  return { x: (width - imageWidth * scale) / 2, y: (height - imageHeight * scale) / 2,
    width: imageWidth * scale, height: imageHeight * scale, scale };
}

export function imagePoint(x, y, rect) {
  if (!rect || !number(x) || !number(y) || x < rect.x || y < rect.y || x > rect.x + rect.width || y > rect.y + rect.height) return null;
  return [(x - rect.x) / rect.scale, (y - rect.y) / rect.scale];
}

export function frameIndex(timeSeconds, source) {
  if (!number(timeSeconds) || timeSeconds < 0 || timeSeconds >= source.durationSeconds) return null;
  const index = Math.floor(timeSeconds * source.fps + 1e-6);
  return index >= 0 && index < source.frameCount ? index : null;
}

/** rVFC mediaTime is an exact frame PTS, commonly rounded to whole microseconds.
 * This is NOT arbitrary playback/seek time: only match a nominal CFR frame
 * inside the documented 1 microsecond quantization budget, otherwise abstain.
 */
export function presentationFrameIndex(mediaTime, source) {
  if (!number(mediaTime) || mediaTime < 0 || !number(source.fps) || source.fps <= 0) return null;
  const index = Math.round(mediaTime * source.fps);
  if (index < 0 || index >= source.frameCount) return null;
  const floatingAllowance = 16 * Number.EPSILON * Math.max(1, Math.abs(mediaTime));
  return Math.abs(mediaTime - index / source.fps) <= 1e-6 + floatingAllowance ? index : null;
}

/** Reuse an already displayed paused frame, never infer one from clock alone. */
export function canReuseDecodedFrame(targetIndex, source, state) {
  return integer(targetIndex) && targetIndex >= 0 && targetIndex < source.frameCount
    && state.ready === true && state.paused === true && state.seeking === false && state.nativeSeeking === false
    && number(state.readyState) && state.readyState >= 2 && state.timingQualified === true
    && state.presentedIndex === targetIndex && state.displayedIndex === targetIndex
    && state.displayedSourceSha === source.sha256 && frameIndex(state.nativeTime, source) === targetIndex;
}

export function frameAtTime(session, timeSeconds) {
  const index = frameIndex(timeSeconds, session.source);
  const frame = index === null ? null : session.frames[index];
  return frame?.index === index ? frame : null;
}

export function trailAtFrame(frames, index, length = 12) {
  const points = [];
  for (let k = index; k >= 0 && points.length < length; k--) {
    const frame = frames[k];
    if (!frame || frame.status !== 'observed' || frame.ball === null) break;
    points.unshift([frame.ball.x, frame.ball.y]);
  }
  return points;
}

export function segmentDistance(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / denominator)) : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

export function nearLineReviews(session, lines, threshold = Math.max(session.source.width, session.source.height) * 0.018) {
  const reviews = [];
  for (const frame of session.frames) {
    if (frame.status !== 'observed' || !frame.ball || !lines.length) continue;
    let nearest = null, distance = Infinity;
    for (const line of lines) {
      const d = segmentDistance([frame.ball.x, frame.ball.y], line.a, line.b);
      if (d < distance) { distance = d; nearest = line; }
    }
    if (distance > threshold) continue;
    const item = { id: `near-${frame.index}`, frame: frame.index, timeSeconds: frame.timeSeconds,
      kind: 'image-proximity', lineId: nearest.id, confirmedLine: nearest.confirmed === true,
      decision: INCONCLUSIVE };
    const previous = reviews.at(-1);
    if (previous && frame.timeSeconds - previous.timeSeconds < 0.6) continue;
    reviews.push(item);
  }
  return reviews;
}

function validPoint(point, source) {
  return Array.isArray(point) && point.length === 2 && number(point[0]) && number(point[1]) && point[0] >= 0 && point[1] >= 0 && point[0] <= source.width && point[1] <= source.height;
}

function validateLine(line, source, draftOnly = false) {
  check(line && string(line.id, 100) && validPoint(line.a, source) && validPoint(line.b, source), 'Vạch có tọa độ không hợp lệ.');
  check(Math.hypot(line.a[0] - line.b[0], line.a[1] - line.b[1]) >= 2, 'Vạch quá ngắn.');
  check(['image-hough', 'user-image'].includes(line.provenance) && typeof line.confirmed === 'boolean', 'Nguồn vạch không hợp lệ.');
  if (draftOnly) check(line.provenance === 'image-hough' && !line.confirmed, 'Vạch tự động phải là bản nháp.');
  return { id: line.id, a: [...line.a], b: [...line.b], provenance: line.provenance, confirmed: line.confirmed };
}

function validateBall(ball, source) {
  check(ball && validPoint([ball.x, ball.y], source) && number(ball.radius) && ball.radius > 0 && ball.radius <= Math.max(source.width, source.height), 'Vị trí bóng không hợp lệ.');
  check(number(ball.confidence) && ball.confidence >= 0 && ball.confidence <= 1, 'Điểm tin cậy không hợp lệ.');
  const b = ball.box;
  check(Array.isArray(b) && b.length === 4 && b.every(number) && b[0] >= 0 && b[1] >= 0 && b[2] > 0 && b[3] > 0 && b[0] + b[2] <= source.width && b[1] + b[3] <= source.height
    && ball.x >= b[0] && ball.y >= b[1] && ball.x <= b[0] + b[2] && ball.y <= b[1] + b[3], 'Hộp bóng nằm ngoài ảnh hoặc không chứa điểm quan sát.');
}

const MODEL_FIELDS = ['id', 'artifactSha256', 'sourceUrl', 'license', 'revision', 'configSha256', 'preprocessId'];
function validateModel(model) {
  check(model && MODEL_FIELDS.every(key => string(model[key], 2000)) && /^[a-f0-9]{64}$/.test(model.artifactSha256) && /^[a-f0-9]{64}$/.test(model.configSha256), 'Thiếu checksum/provenance model bóng.');
  let url; try { url = new URL(model.sourceUrl); } catch { throw new Error('Nguồn model không hợp lệ.'); }
  check(url.protocol === 'https:', 'Nguồn model không hợp lệ.');
}

export function sameSource(a, b) {
  return Boolean(a && b && ['sha256', 'width', 'height', 'fps', 'frameCount', 'durationSeconds'].every(key => a[key] === b[key]));
}

export function validateMethods(value, source) {
  check(value?.schemaVersion === 'roboeye-court-methods-v1' && value.sourceSha256 === source.sha256 && Array.isArray(value.methods)
    && value.methods.length >= 1 && value.methods.length <= 2, 'Danh sách A/B không khớp nguồn video.');
  for (const method of value.methods) {
    check(method && ['classical', 'specialist'].includes(method.key) && string(method.id) && string(method.description, 2000)
      && method.kind === (method.key === 'classical' ? 'classical-cv' : 'learned-ball'), 'Nhãn A/B không khớp phương pháp.');
    if (method.kind === 'learned-ball') validateModel(method.model);
    else check(method.model === null, 'Baseline màu không được mang nhãn model học.');
  }
  check(new Set(value.methods.map(method => method.key)).size === value.methods.length && value.methods.some(method => method.key === value.defaultDetector), 'Detector mặc định không hợp lệ.');
  return value;
}

export function validateSession(value) {
  check(value && value.schemaVersion === SESSION_SCHEMA, 'Không đúng định dạng phiên Court.');
  const s = value.source;
  check(s && string(s.name, 500) && /^[a-f0-9]{64}$/.test(s.sha256), 'Thiếu dấu vân tay nguồn video.');
  check(integer(s.width) && s.width > 0 && s.width <= 8192 && integer(s.height) && s.height > 0 && s.height <= 8192, 'Kích thước video không hợp lệ.');
  check(number(s.fps) && s.fps > 0 && s.fps <= 300 && integer(s.frameCount) && s.frameCount > 0 && s.frameCount <= 20000 && number(s.durationSeconds) && s.durationSeconds > 0 && s.durationSeconds <= 300, 'Video vượt phạm vi M1.');
  check(Math.abs(s.durationSeconds - s.frameCount / s.fps) <= 1e-5, 'Thời lượng không khớp số khung.');
  check(['classical-cv', 'learned-ball'].includes(value.method?.kind) && string(value.method.id) && string(value.method.version) && string(value.method.description, 2000) && Array.isArray(value.method.limitations) && value.method.limitations.every(x => string(x, 2000)), 'Thiếu mô tả phương pháp.');
  if (value.method.kind === 'learned-ball') validateModel(value.method.model);
  else check(value.method.model == null, 'Baseline màu không được mang nhãn model học.');
  check(value.decision?.status === INCONCLUSIVE && string(value.decision.reason, 2000), 'M1 không có quyền kết luận In/Out.');
  check(Array.isArray(value.frames) && value.frames.length === s.frameCount, 'Thiếu hoặc thừa dữ liệu khung hình.');
  for (const [index, frame] of value.frames.entries()) {
    check(frame?.index === index && number(frame.timeSeconds) && Math.abs(frame.timeSeconds - index / s.fps) <= 1e-5, 'Timestamp của khung không khớp video.');
    check(['observed', 'ambiguous', 'missing'].includes(frame.status) && string(frame.reason, 2000), 'Trạng thái quan sát không hợp lệ.');
    check(Array.isArray(frame.candidates) && frame.candidates.length <= 100, 'Quá nhiều ứng viên bóng.');
    frame.candidates.forEach(ball => validateBall(ball, s));
    if (frame.status === 'observed') validateBall(frame.ball, s);
    else check(frame.ball === null, 'Khung mất dấu không được giữ bóng cũ.');
  }
  check(Array.isArray(value.lineSuggestions) && value.lineSuggestions.length <= 100, 'Danh sách vạch không hợp lệ.');
  const lines = value.lineSuggestions.map(line => validateLine(line, s, true));
  check(new Set(lines.map(line => line.id)).size === lines.length, 'ID vạch bị trùng.');
  const totals = { observed: 0, ambiguous: 0, missing: 0 };
  value.frames.forEach(frame => totals[frame.status]++);
  check(value.summary && value.summary.observedFrames === totals.observed && value.summary.ambiguousFrames === totals.ambiguous && value.summary.missingFrames === totals.missing && number(value.summary.analysisMs) && value.summary.analysisMs >= 0, 'Thống kê không khớp quan sát.');
  return value;
}

export function reviewKey(source) { return `roboeye-court-review-v1:${source.sha256}`; }

export function exportReview(session, lines, bookmarks) {
  return validateReview({ schemaVersion: REVIEW_SCHEMA, source: { ...session.source },
    method: { ...session.method }, lines, bookmarks,
    decision: { status: INCONCLUSIVE, reason: 'Chỉ lưu vạch trên ảnh và mốc xem lại; chưa xác minh điểm chạm sân.' } }, session.source);
}

export function validateReview(value, source) {
  check(value && value.schemaVersion === REVIEW_SCHEMA, 'Không đúng định dạng bản xem lại.');
  check(value.source?.sha256 === source.sha256 && value.source.width === source.width && value.source.height === source.height && value.source.frameCount === source.frameCount && value.source.fps === source.fps, 'Bản xem lại không thuộc video đang mở.');
  check(value.decision?.status === INCONCLUSIVE && string(value.decision.reason, 2000), 'Không nhập kết luận In/Out chưa kiểm chứng.');
  check(Array.isArray(value.lines) && value.lines.length <= 100 && Array.isArray(value.bookmarks) && value.bookmarks.length <= 500, 'Bản xem lại vượt giới hạn.');
  const lines = value.lines.map(line => validateLine(line, source));
  const bookmarks = value.bookmarks.map(item => {
    check(item && string(item.id, 100) && integer(item.frame) && item.frame >= 0 && item.frame < source.frameCount && item.kind === 'human-bookmark', 'Mốc xem lại không hợp lệ.');
    return { id: item.id, frame: item.frame, timeSeconds: item.frame / source.fps, kind: 'human-bookmark', decision: INCONCLUSIVE };
  });
  check(new Set(lines.map(line => line.id)).size === lines.length && new Set(bookmarks.map(item => item.id)).size === bookmarks.length, 'ID bị trùng.');
  return { schemaVersion: REVIEW_SCHEMA, source: { ...source }, method: value.method,
    lines, bookmarks, decision: { status: INCONCLUSIVE, reason: value.decision.reason } };
}

export function formatTime(seconds, precise = false) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60)}:${(precise ? (safe % 60).toFixed(2) : String(Math.floor(safe % 60))).padStart(precise ? 5 : 2, '0')}`;
}

export function staticAssetUrl(path, manifestUrl) {
  check(string(path, 500) && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'), 'Đường dẫn demo phải tương đối và nằm trong gói công khai.');
  const base = new URL('.', manifestUrl), url = new URL(path, manifestUrl);
  check(url.origin === base.origin && url.pathname.startsWith(base.pathname) && !url.search && !url.hash, 'Không tải tài nguyên ngoài gói demo.');
  return url.href;
}

export function validatePublicManifest(value, manifestUrl) {
  const v2 = value?.schemaVersion === 'roboeye-court-public-v2';
  check((v2 || value?.schemaVersion === 'roboeye-court-public-v1') && Array.isArray(value.clips) && value.clips.length === (v2 ? 4 : 3), 'Gói demo không đúng số nguồn được cấp phép cho phiên bản.');
  for (const clip of value.clips) {
    check(clip && string(clip.id, 100) && /^[A-Za-z0-9_-]+$/.test(clip.id) && string(clip.title, 300) && /^[a-f0-9]{64}$/.test(clip.sourceSha256), 'Thiếu nhận dạng nguồn clip demo.');
    for (const path of [clip.video, clip.sessions?.classical, clip.sessions?.specialist, clip.evidence]) staticAssetUrl(path, manifestUrl);
    if (clip.sessionSha256) check(['classical', 'specialist'].every(key => /^[a-f0-9]{64}$/.test(clip.sessionSha256[key])), 'Checksum dự đoán demo không hợp lệ.');
  }
  check(new Set(value.clips.map(clip => clip.id)).size === value.clips.length && value.clips.some(clip => clip.id === value.defaultClip), 'Clip mặc định hoặc ID bị sai.');
  validatePublicSummary(value.summary);
  if (v2) {
    const originals = value.clips.filter(clip => clip.role === 'user-original');
    const benchmarkIds = value.clips.filter(clip => clip.role === 'benchmark').map(clip => clip.id).sort();
    check(originals.length === 1 && originals[0].id === 'pickleball-original' && value.defaultClip === 'pickleball-original'
      && JSON.stringify(benchmarkIds) === JSON.stringify(['tennist-01', 'tennist-02', 'tennist-03']), 'V2 chỉ có một video gốc và ba nguồn tennis đối chứng đã khai báo.');
    const original = originals[0], auth = value.publicationAuthorization;
    check(auth?.kind === 'explicit-user-publication' && auth.scope === 'public-original-video' && auth.authorized === true
      && /^[a-f0-9]{64}$/.test(auth.sourceSha256) && auth.sourceSha256 === original.sourceSha256, 'Thiếu quyền công khai gắn đúng SHA video gốc.');
    check(integer(original.frameCount) && original.frameCount > 0 && original.frameCount <= 20000, 'Thiếu số khung của video gốc.');
    validatePublicSummary(value.benchmarkSummary);
    const a = value.summary, b = value.benchmarkSummary;
    check(a.visible === b.visible && a.verifiedAbsent === b.verifiedAbsent && a.unknown === b.unknown + original.frameCount
      && ['classical', 'specialist', 'paired'].every(key => Object.keys(b[key]).every(field => a[key][field] === b[key][field])), 'Không được gộp video gốc chưa gán nhãn vào điểm số tennis.');
  } else check(value.clips.every(clip => clip.id !== 'pickleball-original' && (clip.role == null || clip.role === 'benchmark')), 'Video gốc chỉ được công khai trong V2 có quyền tương ứng.');
  return value;
}

function validatePublicSummary(s) {
  check(s && [s.visible, s.unknown, s.verifiedAbsent, s.classical?.tp, s.classical?.fn, s.classical?.fp, s.specialist?.tp, s.specialist?.fn, s.specialist?.fp,
    s.paired?.bothCorrect, s.paired?.recovered, s.paired?.regressed, s.paired?.bothMiss].every(n => integer(n) && n >= 0), 'Thống kê demo không hợp lệ.');
  check(s.classical.tp + s.classical.fn === s.visible && s.specialist.tp + s.specialist.fn === s.visible
    && Object.values(s.paired).reduce((total, n) => total + n, 0) === s.visible
    && s.paired.bothCorrect + s.paired.regressed === s.classical.tp
    && s.paired.bothCorrect + s.paired.recovered === s.specialist.tp, 'Thống kê A/B và cặp đối chứng không khớp.');
}

export function referenceAtFrame(evidence, index) {
  if (!evidence || !integer(index)) return null;
  const label = evidence.labels[index];
  return label?.frame === index && label.status === 'visible' ? label.point : null;
}

export function pairedCategory(a, b, point, radius = 8) {
  const correct = frame => frame?.status === 'observed' && frame.ball && Math.hypot(frame.ball.x - point[0], frame.ball.y - point[1]) <= radius;
  const ac = Boolean(correct(a)), bc = Boolean(correct(b));
  return ac ? (bc ? 'both-correct' : 'regressed') : (bc ? 'recovered' : 'both-miss');
}

export function validateEvidence(value, source, sessions = null) {
  check(value?.schemaVersion === 'roboeye-court-evidence-v1' && value.sourceSha256 === source.sha256
    && value.matchingRadiusPixels === 8 && Array.isArray(value.labels) && value.labels.length === source.frameCount && Array.isArray(value.cases), 'Tham chiếu không khớp video hoặc cổng 8 pixel.');
  let visible = 0;
  for (const [index, label] of value.labels.entries()) {
    check(label?.frame === index && ['visible', 'absent', 'unknown'].includes(label.status), 'Nhãn tham chiếu không đúng khung.');
    if (label.status === 'visible') { check(validPoint(label.point, source), 'Điểm tham chiếu ngoài ảnh.'); visible++; }
    else check(label.point === null, 'Khung chưa rõ không được mang điểm tham chiếu.');
  }
  check(value.cases.length === visible && new Set(value.cases.map(item => item.frame)).size === visible && new Set(value.cases.map(item => item.id)).size === visible, 'Danh sách phải giữ tất cả ca có tham chiếu nhìn thấy.');
  for (const item of value.cases) {
    check(item && string(item.id, 150) && integer(item.frame) && item.frame >= 0 && item.frame < source.frameCount
      && value.labels[item.frame].status === 'visible' && ['both-correct', 'recovered', 'regressed', 'both-miss'].includes(item.category), 'Ca đối chứng không hợp lệ.');
    if (sessions) check(pairedCategory(sessions.classical.frames[item.frame], sessions.specialist.frames[item.frame], value.labels[item.frame].point) === item.category, 'Nhãn cặp A/B không khớp dự đoán đã đóng băng.');
  }
  return value;
}
