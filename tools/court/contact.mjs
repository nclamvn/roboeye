import { presentationFrameIndex, sameSource } from './core.mjs';

/** Frozen before inspecting M4 outcomes. Image-space proposal gates, not a
 * trained bounce classifier or a contact probability. Never loosen per video.
 */
export const CONTACT_POLICY = Object.freeze({
  version: 'court-five-observation-turn-v1', contextRadius: 2,
  minExcursionPixels: 4, minExcursionDiagonalFraction: 0.004,
  maxStepDiagonalFraction: 0.15, minSideConsistencyCosine: 0.3,
  minVerticalVelocity: 1, verticalTurnDegrees: 45, directionTurnDegrees: 80,
  mergeFrames: 2, mergePixels: 8, mergeDiagonalFraction: 0.015, maxProposals: 10,
});
const finite = Number.isFinite;
const ensure = (condition, message) => { if (!condition) throw Error(message); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const length = vector => Math.hypot(...vector);
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cosine = (a, b) => length(a) && length(b) ? dot(a, b) / (length(a) * length(b)) : -1;

function validSource(source) {
  return source && /^[a-f0-9]{64}$/.test(source.sha256) && Number.isInteger(source.width) && source.width > 0
    && Number.isInteger(source.height) && source.height > 0 && finite(source.fps) && source.fps > 0
    && Number.isInteger(source.frameCount) && source.frameCount > 0 && source.frameCount <= 20000
    && finite(source.durationSeconds) && Math.abs(source.durationSeconds - source.frameCount / source.fps) < 1e-5;
}

function observedPoint(frame, index, source) {
  const ball = frame?.ball;
  return frame?.index === index && frame.status === 'observed' && ball && finite(ball.x) && finite(ball.y)
    && ball.x >= 0 && ball.x < source.width && ball.y >= 0 && ball.y < source.height
    && finite(frame.timeSeconds) && Math.abs(frame.timeSeconds - index / source.fps) <= 1e-5
    ? [ball.x, ball.y] : null;
}

export function proposeContactWindows(sessions) {
  ensure(sessions && Object.keys(sessions).every(key => ['classical', 'specialist'].includes(key)), 'Nguồn A/B cho gợi ý không hợp lệ.');
  const entries = Object.entries(sessions).filter(([, session]) => session);
  ensure(entries.length > 0 && entries.length <= 2 && validSource(entries[0][1].source), 'Thiếu nhận dạng nguồn cho gợi ý.');
  const source = entries[0][1].source;
  const policy = CONTACT_POLICY, diagonal = Math.hypot(source.width, source.height);
  const excursion = Math.max(policy.minExcursionPixels, diagonal * policy.minExcursionDiagonalFraction);
  const diagnostics = { inspectedCentres: 0, completeSupport: 0, rejectedMissing: 0,
    rejectedSmallMotion: 0, rejectedJump: 0, rejectedInconsistent: 0, rejectedNoTurn: 0,
    rawProposals: 0, mergedProposals: 0, truncatedProposals: 0, perArm: {} };
  const candidates = [];
  for (const [arm, session] of entries) {
    ensure(sameSource(source, session.source) && session.frames?.length === source.frameCount, 'Không gộp gợi ý từ video hoặc timeline khác.');
    const armCounts = { completeSupport: 0, proposals: 0 };
    diagnostics.perArm[arm] = armCounts;
    for (let index = 2; index < source.frameCount - 2; index++) {
      diagnostics.inspectedCentres++;
      const indices = [index - 2, index - 1, index, index + 1, index + 2];
      const points = indices.map(i => observedPoint(session.frames[i], i, source));
      if (points.some(point => point === null)) { diagnostics.rejectedMissing++; continue; }
      diagnostics.completeSupport++; armCounts.completeSupport++;
      const steps = points.slice(1).map((point, i) => subtract(point, points[i]));
      const before = subtract(points[2], points[0]), after = subtract(points[4], points[2]);
      if (steps.some(step => length(step) > diagonal * policy.maxStepDiagonalFraction)) { diagnostics.rejectedJump++; continue; }
      if (length(before) < excursion || length(after) < excursion) { diagnostics.rejectedSmallMotion++; continue; }
      if (cosine(steps[0], steps[1]) < policy.minSideConsistencyCosine || cosine(steps[2], steps[3]) < policy.minSideConsistencyCosine) {
        diagnostics.rejectedInconsistent++; continue;
      }
      const turnDegrees = Math.acos(Math.max(-1, Math.min(1, cosine(before, after)))) * 180 / Math.PI;
      const vertical = before[1] / 2 >= policy.minVerticalVelocity && after[1] / 2 <= -policy.minVerticalVelocity
        && turnDegrees >= policy.verticalTurnDegrees;
      const direction = turnDegrees >= policy.directionTurnDegrees;
      if (!vertical && !direction) { diagnostics.rejectedNoTurn++; continue; }
      const reason = vertical ? 'Đổi từ đi xuống sang đi lên trên ảnh, có 5 quan sát liền kề.'
        : 'Đổi hướng rõ trên ảnh, có 5 quan sát liền kề.';
      candidates.push({ arm, index, indices, points, reason, turnDegrees: Math.round(turnDegrees * 1000) / 1000,
        kind: vertical ? 'image-vertical-reversal' : 'image-direction-change' });
      armCounts.proposals++;
    }
  }
  diagnostics.rawProposals = candidates.length;
  candidates.sort((a, b) => a.index - b.index || a.arm.localeCompare(b.arm));
  const proposals = [], mergePixels = Math.max(policy.mergePixels, diagonal * policy.mergeDiagonalFraction);
  for (const candidate of candidates) {
    const near = [];
    for (let i = proposals.length - 1; i >= 0 && candidate.index - proposals[i].index <= policy.mergeFrames; i--) near.push(proposals[i]);
    const same = near.find(proposal => Math.hypot(proposal.point[0] - candidate.points[2][0], proposal.point[1] - candidate.points[2][1]) <= mergePixels);
    const support = { arm: candidate.arm, indices: candidate.indices, points: candidate.points, reason: candidate.reason,
      turnDegrees: candidate.turnDegrees, kind: candidate.kind };
    if (same) {
      same.supports.push(support); same.arms = [...new Set([...same.arms, candidate.arm])];
      same.supportFrames = [...new Set([...same.supportFrames, ...candidate.indices])].sort((a, b) => a - b);
      diagnostics.mergedProposals++;
      continue;
    }
    const proposal = { id: `contact-${candidate.index}-${candidate.arm}`, sourceSha256: source.sha256,
      index: candidate.index, frame: candidate.index, timeSeconds: candidate.index / source.fps,
      kind: 'suspected-contact', point: candidate.points[2], arms: [candidate.arm], supports: [support],
      supportFrames: candidate.indices, reason: candidate.reason, decision: 'insufficient-evidence', conflicts: [] };
    for (const conflict of near) {
      conflict.conflicts.push(proposal.id); proposal.conflicts.push(conflict.id);
    }
    proposals.push(proposal);
  }
  diagnostics.truncatedProposals = Math.max(0, proposals.length - policy.maxProposals);
  return { policyVersion: policy.version, sourceSha256: source.sha256,
    proposals: proposals.slice(0, policy.maxProposals), diagnostics,
    limitation: 'Chỉ là gợi ý đổi hướng trên ảnh: có thể là chạm vợt, đỉnh quỹ đạo hoặc bám sai. Không chứng minh chạm sàn hay In/Out.' };
}

export const proposeContactReviews = proposeContactWindows;

/** M8 development policy: an observed image-edge approach followed by explicit
 * detector loss is worth replaying, not evidence of floor contact or an Out.
 * Frozen generically before running the new rule; the motivating clip is known.
 */
export const EVIDENCE_REVIEW_POLICY = Object.freeze({
  version: 'court-image-edge-loss-review-v1', lookbackSeconds: 0.5,
  maxSupportGapSeconds: 0.16, minObservations: 3, bottomBandFraction: 0.1,
  minDownwardPixels: 12, minDownwardHeightFraction: 0.08,
  minExcursionDiagonalFraction: 0.025, minDownwardPixelsPerFrame: 1,
  maxStepDiagonalFraction: 0.15, minDirectionCosine: 0.7,
  missingSeconds: 0.28, replayPaddingSeconds: 1, maxProposals: 10,
});

const frameCountForSeconds = (seconds, fps) => Math.max(1, Math.ceil(seconds * fps - 1e-9));
function validFrameClock(frame, index, source) {
  return frame?.index === index && finite(frame.timeSeconds)
    && Math.abs(frame.timeSeconds - index / source.fps) <= 1e-5
    && ['observed', 'missing', 'ambiguous'].includes(frame.status)
    && (frame.status === 'observed' || frame.ball === null);
}
function reviewWindows(startFrame, endFrame, source) {
  const padding = frameCountForSeconds(EVIDENCE_REVIEW_POLICY.replayPaddingSeconds, source.fps);
  return { reviewInterval: { startFrame, endFrame },
    clipWindow: { startFrame: Math.max(0, startFrame - padding), endFrame: Math.min(source.frameCount - 1, endFrame + padding) } };
}

export function proposeEvidenceReviews(sessions) {
  // Reuse the unchanged baseline source checks and image-turn proposals.
  const baseline = proposeContactWindows(sessions), entries = Object.entries(sessions).filter(([, s]) => s);
  const source = entries[0][1].source, policy = EVIDENCE_REVIEW_POLICY;
  const diagonal = Math.hypot(source.width, source.height);
  const missingCount = frameCountForSeconds(policy.missingSeconds, source.fps);
  const lookback = frameCountForSeconds(policy.lookbackSeconds, source.fps);
  const maxGap = frameCountForSeconds(policy.maxSupportGapSeconds, source.fps);
  const diagnostics = { baseline: baseline.diagnostics, edgeLoss: { inspectedObserved: 0,
    rejectedIncompleteLoss: 0, rejectedSupport: 0, rejectedNotEdge: 0, rejectedSmallMotion: 0,
    rejectedDirection: 0, rejectedJump: 0, rawProposals: 0, mergedProposals: 0, truncatedProposals: 0 } };
  const edge = [], counts = diagnostics.edgeLoss;
  for (const [arm, session] of entries) {
    for (let index = 0; index < source.frameCount; index++) {
      const point = observedPoint(session.frames[index], index, source);
      if (!point) continue;
      counts.inspectedObserved++;
      const end = index + missingCount;
      // Reaching the end of the file is not sustained, decoded detector loss.
      if (end >= source.frameCount || !Array.from({ length: missingCount }, (_, i) => index + i + 1)
        .every(i => validFrameClock(session.frames[i], i, source) && session.frames[i].status === 'missing')) {
        counts.rejectedIncompleteLoss++; continue;
      }
      if (point[1] < source.height * (1 - policy.bottomBandFraction)) { counts.rejectedNotEdge++; continue; }
      const indices = [index], points = [point];
      for (let i = index - 1; i >= Math.max(0, index - lookback); i--) {
        if (indices[0] - i > maxGap) break;
        const previous = observedPoint(session.frames[i], i, source);
        if (previous) { indices.unshift(i); points.unshift(previous); }
      }
      if (indices.length < policy.minObservations) { counts.rejectedSupport++; continue; }
      const displacement = subtract(point, points[0]);
      if (displacement[1] < Math.max(policy.minDownwardPixels, source.height * policy.minDownwardHeightFraction)
        || length(displacement) < diagonal * policy.minExcursionDiagonalFraction) { counts.rejectedSmallMotion++; continue; }
      const velocities = points.slice(1).map((p, i) => subtract(p, points[i]).map(v => v / (indices[i + 1] - indices[i])));
      if (velocities.some(v => length(v) > diagonal * policy.maxStepDiagonalFraction)) { counts.rejectedJump++; continue; }
      if (velocities.some(v => v[1] < policy.minDownwardPixelsPerFrame)
        || velocities.slice(1).some((v, i) => cosine(v, velocities[i]) < policy.minDirectionCosine)) {
        counts.rejectedDirection++; continue;
      }
      const missingFrames = Array.from({ length: missingCount }, (_, i) => index + 1 + i);
      const reason = 'Các quan sát thật đi xuống gần mép dưới ảnh, sau đó bộ nhận diện mất dấu. Cần xem lại, chưa biết bóng chạm sàn hay ra ngoài.';
      const support = { arm, indices, points, kind: 'image-bottom-edge-approach',
        velocitiesPixelsPerFrame: velocities, missingFrames, reason };
      edge.push({ id: `edge-loss-${index}-${arm}`, sourceSha256: source.sha256,
        index, frame: index, timeSeconds: index / source.fps, point, kind: 'edge-loss-review', contact: null,
        arms: [arm], supports: [support], supportFrames: indices, missingFrames,
        reason, decision: 'insufficient-evidence', conflicts: [], ...reviewWindows(indices[0], end, source) });
    }
  }
  counts.rawProposals = edge.length;
  edge.sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  const merged = [], mergePixels = Math.max(CONTACT_POLICY.mergePixels, diagonal * CONTACT_POLICY.mergeDiagonalFraction);
  for (const item of edge) {
    const near = merged.filter(p => Math.abs(p.index - item.index) <= CONTACT_POLICY.mergeFrames);
    const previous = near.find(p => length(subtract(p.point, item.point)) <= mergePixels);
    if (!previous) {
      for (const conflict of near) { conflict.conflicts.push(item.id); item.conflicts.push(conflict.id); }
      merged.push(item); continue;
    }
    previous.arms = [...new Set([...previous.arms, ...item.arms])]; previous.supports.push(...item.supports);
    previous.supportFrames = [...new Set([...previous.supportFrames, ...item.supportFrames])].sort((a, b) => a - b);
    previous.missingFrames = [...new Set([...previous.missingFrames, ...item.missingFrames])].sort((a, b) => a - b);
    Object.assign(previous, reviewWindows(Math.min(previous.reviewInterval.startFrame, item.reviewInterval.startFrame),
      Math.max(previous.reviewInterval.endFrame, item.reviewInterval.endFrame), source)); counts.mergedProposals++;
  }
  const base = baseline.proposals.map(p => ({ ...p, contact: null,
    ...reviewWindows(Math.min(...p.supportFrames), Math.max(...p.supportFrames), source) }));
  // Retain every already bounded M4 proposal before allocating room to new cues.
  const room = Math.max(0, policy.maxProposals - base.length);
  counts.truncatedProposals = Math.max(0, merged.length - room);
  return { policyVersion: policy.version, sourceSha256: source.sha256,
    proposals: [...base, ...merged.slice(0, room)].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id)),
    diagnostics,
    limitation: `${baseline.limitation} Mất dấu gần mép ảnh không phải mép sân: không tạo điểm chạm, không kết luận In/Out.` };
}

/** Deterministic geometry ONLY for independently verified floor contacts and
 * effective court zones. Current model centres/review proposals cannot satisfy
 * this contract. A caller's verification/provenance must itself be audited;
 * this mathematical gate does not verify a human or instrument's assertion.
 */
export function judgeVerifiedContact({ source, contact, boundary } = {}) {
  const insufficient = reason => ({ decision: 'insufficient-evidence', reason, contactTruth: null });
  if (!validSource(source)) return insufficient('invalid-source');
  const pointInSource = p => Array.isArray(p) && p.length === 2 && p.every(finite)
    && p[0] >= 0 && p[0] < source.width && p[1] >= 0 && p[1] < source.height;
  const provenance = (p, kinds) => p && kinds.includes(p.kind) && typeof p.id === 'string' && p.id.trim().length > 0;
  if (!contact || contact.verified !== true || contact.kind !== 'verified-floor-contact'
    || contact.sourceSha256 !== source.sha256 || contact.coordinateSpace !== 'source-image-floor-plane'
    || !pointInSource(contact.point) || !Number.isInteger(contact.frameIndex) || contact.frameIndex < 0
    || contact.frameIndex >= source.frameCount || !finite(contact.uncertaintyRadiusPixels) || contact.uncertaintyRadiusPixels < 0
    || !provenance(contact.provenance, ['human-reviewed-contact', 'instrumented-contact-measurement'])) {
    return insufficient('missing-independent-floor-contact');
  }
  if (!boundary || boundary.verified !== true || boundary.kind !== 'verified-effective-court-zone'
    || boundary.sourceSha256 !== source.sha256 || boundary.coordinateSpace !== contact.coordinateSpace
    || typeof boundary.calibrationId !== 'string' || !boundary.calibrationId.trim()
    || boundary.calibrationId !== contact.calibrationId || typeof boundary.applicableZoneId !== 'string'
    || !boundary.applicableZoneId.trim() || boundary.applicableZoneId !== contact.applicableZoneId
    || !finite(boundary.uncertaintyPixels) || boundary.uncertaintyPixels < 0
    || !provenance(boundary.provenance, ['human-reviewed-boundary', 'instrumented-court-calibration'])) {
    return insufficient('missing-compatible-verified-boundary');
  }
  const range = boundary.validFrameRange;
  if (!range || !Number.isInteger(range.startFrame) || !Number.isInteger(range.endFrame)
    || range.startFrame < 0 || range.endFrame >= source.frameCount || range.startFrame > range.endFrame
    || contact.frameIndex < range.startFrame || contact.frameIndex > range.endFrame) return insufficient('outside-calibrated-frame-range');
  const bounds = boundary.calibratedImageBounds, margin = contact.uncertaintyRadiusPixels + boundary.uncertaintyPixels;
  if (!bounds || ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(finite)
    || bounds.left < 0 || bounds.top < 0 || bounds.right > source.width || bounds.bottom > source.height
    || bounds.left >= bounds.right || bounds.top >= bounds.bottom
    || contact.point[0] - margin < bounds.left || contact.point[0] + margin > bounds.right
    || contact.point[1] - margin < bounds.top || contact.point[1] + margin > bounds.bottom) return insufficient('outside-calibrated-image-range');
  const polygon = boundary.polygon;
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 8 || !polygon.every(p => pointInSource(p)
    && p[0] >= bounds.left && p[0] <= bounds.right && p[1] >= bounds.top && p[1] <= bounds.bottom)) return insufficient('invalid-effective-zone');
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const area = polygon.reduce((sum, p, i) => sum + cross(p, polygon[(i + 1) % polygon.length]), 0);
  if (Math.abs(area) < 1e-8) return insufficient('invalid-effective-zone');
  const orientation = Math.sign(area), distances = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], edge = subtract(polygon[(i + 1) % polygon.length], a), norm = length(edge);
    if (norm < 1e-8) return insufficient('invalid-effective-zone');
    for (let j = 0; j < polygon.length; j++) {
      if (j === i || j === (i + 1) % polygon.length) continue;
      // Strict convexity also rejects self-intersections/collinear/duplicate vertices.
      if (orientation * cross(edge, subtract(polygon[j], a)) <= 1e-8) return insufficient('non-convex-effective-zone');
    }
    distances.push(orientation * cross(edge, subtract(contact.point, a)) / norm);
  }
  if (distances.every(distance => distance > margin)) return { decision: 'in', reason: 'verified-footprint-strictly-inside-effective-zone',
    sourceSha256: source.sha256, frameIndex: contact.frameIndex, applicableZoneId: boundary.applicableZoneId, marginPixels: margin };
  if (distances.some(distance => distance < -margin)) return { decision: 'out', reason: 'verified-footprint-entirely-beyond-one-effective-edge',
    sourceSha256: source.sha256, frameIndex: contact.frameIndex, applicableZoneId: boundary.applicableZoneId, marginPixels: margin };
  return insufficient('footprint-touches-or-overlaps-boundary-uncertainty');
}

export function contextSlots(index, source) {
  ensure(validSource(source) && Number.isInteger(index) && index >= 0 && index < source.frameCount, 'Khung chọn nằm ngoài nguồn.');
  return [-2, -1, 0, 1, 2].map(offset => ({ offset, requestedIndex: index + offset,
    index: index + offset >= 0 && index + offset < source.frameCount ? index + offset : null,
    status: index + offset >= 0 && index + offset < source.frameCount ? 'pending' : 'out-of-range' }));
}

function abortError(message = 'Đã huỷ tác vụ chụp của lựa chọn cũ.') {
  return new DOMException(message, 'AbortError');
}

export function createFrameCapture({ blob, source, maxCacheFrames = 7, timeoutMs = 4000 } = {}) {
  ensure(typeof document !== 'undefined' && blob instanceof Blob && blob.size > 0 && blob.size <= 8 * 1024 ** 2,
    'Cần Blob video đã xác minh, tối đa 8 MiB, trong trình duyệt.');
  ensure(validSource(source) && source.width * source.height <= 4096 * 2160, 'Nguồn chụp không hợp lệ hoặc ảnh quá lớn.');
  ensure(Number.isInteger(maxCacheFrames) && maxCacheFrames >= 1 && maxCacheFrames <= 10, 'Giới hạn cache ảnh không hợp lệ.');
  ensure(finite(timeoutMs) && timeoutMs >= 250 && timeoutMs <= 10000, 'Giới hạn thời gian chụp không hợp lệ.');
  const ownedSource = Object.freeze({ ...source });
  const video = document.createElement('video');
  video.preload = 'auto'; video.muted = true; video.playsInline = true; video.loop = false;
  video.setAttribute('aria-hidden', 'true'); video.tabIndex = -1;
  video.dataset.courtCaptureDecoder = 'true';
  // A tiny composited element allows paused rVFC delivery without ever seeking
  // or flashing the main player. No controls, no sound, no animation/play().
  Object.assign(video.style, { position: 'fixed', width: '1px', height: '1px', top: '0', left: '0', opacity: '0.001', pointerEvents: 'none' });
  document.body.append(video);
  let disposed = false, generation = 0, objectUrl = null, activeAbort = null;
  let lastQualified = null, queue = Promise.resolve(), cacheBytes = 0;
  const cache = new Map(), MAX_CACHE_BYTES = 12 * 1024 ** 2;
  const initAbort = new AbortController();
  const counts = { captures: 0, cacheHits: 0, decoderSeeks: 0, unqualifiedCallbacks: 0,
    reusedDecodedFrames: 0, cancelledJobs: 0 };

  function check(epoch, signal) {
    if (disposed || generation !== epoch || signal?.aborted) throw abortError();
  }

  const initialized = (async () => {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const actualSha = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    ensure(actualSha === ownedSource.sha256, 'Blob không khớp SHA của nguồn; không chụp nhầm video.');
    if (disposed) throw abortError();
    ensure(typeof video.requestVideoFrameCallback === 'function' && typeof video.cancelVideoFrameCallback === 'function',
      'Trình duyệt chưa hỗ trợ xác minh khung đã giải mã để chụp.');
    objectUrl = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      let timer;
      const finish = error => {
        clearTimeout(timer); video.removeEventListener('loadedmetadata', loaded); video.removeEventListener('error', failed);
        initAbort.signal.removeEventListener('abort', aborted); error ? reject(error) : resolve();
      };
      const loaded = () => finish();
      const failed = () => finish(Error('Không giải mã được video để chụp ảnh.'));
      const aborted = () => finish(abortError());
      timer = setTimeout(() => finish(Error('Quá hạn mở decoder chụp độc lập.')), timeoutMs);
      video.addEventListener('loadedmetadata', loaded, { once: true }); video.addEventListener('error', failed, { once: true });
      initAbort.signal.addEventListener('abort', aborted, { once: true });
      video.src = objectUrl; video.load();
    });
    ensure(video.videoWidth === ownedSource.width && video.videoHeight === ownedSource.height
      && finite(video.duration) && Math.abs(video.duration - ownedSource.durationSeconds) <= Math.max(0.05, 1 / ownedSource.fps),
      'Decoder không khớp kích thước/thời lượng của nguồn đã xác minh.');
  })();
  // Initialization is lazy-observed by capture(), but must not cause an unhandled
  // rejection if the user switches source before any thumbnail request starts.
  initialized.catch(() => {});

  function seekDecoded(index, epoch, signal) {
    check(epoch, signal);
    if (lastQualified?.index === index && video.readyState >= 2 && !video.seeking) {
      counts.reusedDecodedFrames++;
      return Promise.resolve(lastQualified);
    }
    lastQualified = null; video.pause(); counts.decoderSeeks++;
    return new Promise((resolve, reject) => {
      let timer, callbackId = null, seeked = false, qualified = null, settled = false;
      const finish = error => {
        if (settled) return; settled = true;
        clearTimeout(timer);
        if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
        video.removeEventListener('seeked', onSeeked); video.removeEventListener('error', onError);
        signal.removeEventListener('abort', onAbort);
        if (error) { lastQualified = null; reject(error); }
        else { lastQualified = qualified; resolve(qualified); }
      };
      const maybeFinish = () => {
        try { check(epoch, signal); } catch (error) { finish(error); return; }
        if (seeked && qualified && !video.seeking && video.readyState >= 2) finish();
      };
      const onFrame = (_, metadata) => {
        callbackId = null;
        if (settled) return;
        try { check(epoch, signal); } catch (error) { finish(error); return; }
        const decodedIndex = presentationFrameIndex(metadata.mediaTime, ownedSource);
        if (decodedIndex === index && metadata.width === ownedSource.width && metadata.height === ownedSource.height) {
          qualified = { index, mediaTime: metadata.mediaTime };
        } else { qualified = null; counts.unqualifiedCallbacks++; }
        maybeFinish();
        if (!settled) callbackId = video.requestVideoFrameCallback(onFrame);
      };
      const onSeeked = () => { seeked = true; maybeFinish(); };
      const onError = () => finish(Error('Decoder lỗi khi chụp khung yêu cầu.'));
      const onAbort = () => finish(abortError());
      timer = setTimeout(() => finish(Error(`Chưa xác minh được đúng khung ${index}; không dùng ảnh thay thế.`)), timeoutMs);
      video.addEventListener('seeked', onSeeked, { once: true }); video.addEventListener('error', onError, { once: true });
      signal.addEventListener('abort', onAbort, { once: true });
      callbackId = video.requestVideoFrameCallback(onFrame);
      // Seek inside the target frame's nominal interval. Only an actual matching
      // rVFC mediaTime (not currentTime or seeked alone) can qualify extraction.
      try { video.currentTime = (index + 0.25) / ownedSource.fps; }
      catch (error) { finish(error); }
    });
  }

  function remember(key, frame) {
    cache.set(key, frame); cacheBytes += frame.blob.size;
    while (cache.size > maxCacheFrames || cacheBytes > MAX_CACHE_BYTES) {
      const first = cache.keys().next().value; cacheBytes -= cache.get(first).blob.size; cache.delete(first);
    }
  }

  function capture(index, { signal, maxWidth } = {}) {
    const epoch = generation;
    const run = async () => {
      check(epoch, signal);
      ensure(Number.isInteger(index) && index >= 0 && index < ownedSource.frameCount, 'Không chụp ngoài biên nguồn hoặc nhân đôi khung lân cận.');
      const width = maxWidth == null ? ownedSource.width : Math.min(ownedSource.width, maxWidth);
      ensure(Number.isInteger(width) && width >= 1, 'Kích thước thumbnail không hợp lệ.');
      const height = Math.max(1, Math.round(ownedSource.height * width / ownedSource.width));
      const key = `${index}:${width}`;
      const abort = new AbortController(); activeAbort = abort;
      const onAbort = () => abort.abort(); signal?.addEventListener('abort', onAbort, { once: true });
      try {
        await initialized; check(epoch, signal); check(epoch, abort.signal);
        const cached = cache.get(key);
        if (cached) { cache.delete(key); cache.set(key, cached); counts.cacheHits++; return cached; }
        const decoded = await seekDecoded(index, epoch, abort.signal);
        check(epoch, signal); check(epoch, abort.signal);
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false });
        ensure(context, 'Không mở được canvas chụp ảnh.');
        context.drawImage(video, 0, 0, width, height);
        const imageBlob = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Quá hạn tạo PNG; không xuất ảnh cũ.')), timeoutMs);
          canvas.toBlob(value => { clearTimeout(timer); value ? resolve(value) : reject(Error('Không tạo được PNG từ khung thật.')); }, 'image/png');
        });
        check(epoch, signal); check(epoch, abort.signal);
        const result = Object.freeze({ sourceSha256: ownedSource.sha256, index, timeSeconds: index / ownedSource.fps,
          decodedMediaTime: decoded.mediaTime, width, height, sourceWidth: ownedSource.width, sourceHeight: ownedSource.height,
          blob: imageBlob, provenance: 'decoded-source-pixels', decision: 'insufficient-evidence' });
        remember(key, result); counts.captures++;
        return result;
      } catch (error) { if (error.name === 'AbortError') counts.cancelledJobs++; throw error; }
      finally { signal?.removeEventListener('abort', onAbort); if (activeAbort === abort) activeAbort = null; }
    };
    const result = queue.then(run); queue = result.catch(() => {}); return result;
  }

  async function captureContext(index, { signal } = {}) {
    const epoch = generation, slots = contextSlots(index, ownedSource), result = [];
    for (const slot of slots) {
      check(epoch, signal);
      if (slot.index === null) { result.push(slot); continue; }
      try {
        const frame = await capture(slot.index, { signal }); check(epoch, signal);
        result.push({ ...slot, status: 'captured', frame });
      } catch (error) {
        if (error.name === 'AbortError' || generation !== epoch || disposed || signal?.aborted) throw abortError();
        result.push({ ...slot, status: 'failed', error: error.message });
      }
    }
    return result;
  }

  function cancel() { generation++; activeAbort?.abort(); lastQualified = null; }
  function dispose() {
    if (disposed) return; disposed = true; cancel(); initAbort.abort();
    video.pause(); video.removeAttribute('src'); video.load(); video.remove();
    if (objectUrl !== null) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    cache.clear(); cacheBytes = 0;
  }
  return Object.freeze({ capture, captureContext,
    captureThumbnail: (index, { signal, maxWidth = 192 } = {}) => capture(index, { signal, maxWidth }),
    cancel, dispose,
    diagnostics: () => ({ ...counts, sourceSha256: ownedSource.sha256, disposed, cacheEntries: cache.size, pngCacheBytes: cacheBytes,
      maxCacheFrames, maxPngCacheBytes: MAX_CACHE_BYTES }) });
}

export const createCaptureController = createFrameCapture;
