import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSession } from './court-server-core.mjs';
import { preparePinnedEventEvidence, eventAssetRows, FROZEN_EVENT_MANIFEST_SHA } from './court-public-events.mjs';

export const SOURCE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const PUBLIC_DIST = resolve(SOURCE_ROOT, '../roboeye-court-public/dist');
export const FROZEN_GOLD_SHA = '6b332e632c20fa39af785043e4070aa47ee9a56a173d2c23ca09abeb97bcf0b7';
export const FROZEN_RGB_SHA = 'f6aa09a613846e7361951dd5d4df376d3ef74b7cb8bf3219c9ffe7774ca85507';
export const ORIGINAL_PUBLIC_SOURCE = Object.freeze({
  id: 'pickleball-original', sha256: '767842eec2a34d478f8d4a5f3680c18f6eac889147f81fa332f7a02730542474',
  classical: { sha256: 'a1803cbbfa30e5f5180739a8819c5fe5cad4c941186aaefb2ff72cbfb182090f',
    file: '.court-cache/767842eec2a34d478f8d4a5f3680c18f6eac889147f81fa332f7a02730542474/session.json' },
  specialist: { sha256: 'f49a19b09088d82a2b1ac2ea956f956cef059dce38d25455377a614ed2e9b07e',
    file: '.court-cache/767842eec2a34d478f8d4a5f3680c18f6eac889147f81fa332f7a02730542474/specialist/46932bb5bc5d99a1c972a2e3fc72f4bad03635c369099889567f6e763574a0d4/session.json' },
});
export const MEDIA_ALLOWLIST = Object.freeze([
  { id: 'tennist-01', filename: 'OCT01.mp4', sha256: '82337e2c228455da4e431c8dd07672c3452018ab781603d9e0fe5d1b8c8e403b', title: 'Ngoài trời · góc cao chéo sân' },
  { id: 'tennist-02', filename: 'OST01.mp4', sha256: '5654c81889eb979495112d52cb50cb064934d35c250196cbb4b7a3f80919f42d', title: 'Ngoài trời · góc cao dọc sân' },
  { id: 'tennist-03', filename: 'ICS01.mp4', sha256: '109c2a048f61d85f707255413efac3728cbff228e783bef825bac1c0d41799ff', title: 'Trong nhà · góc ngang sân' },
]);
const FROZEN_SESSION_SHAS = Object.freeze({
  'tennist-01': { classical: '28d3916a565e17ddbeeeb3c2f683e224a8d08a3fe1d7c260b35f8c61cb8920e1', specialist: '821ff5a635ba3f4d3d46f78b90dfdc88a2fd31b9325885bc818dde28acf04f26' },
  'tennist-02': { classical: '424c8db77f4c1de7dad5996cdd5df2044fc718e690ae14a9eeb3bdf52d655e98', specialist: '1ba11b23993489f27cc6bc84b19602587eeda7e82b5bfa30f0362cb64caf4e27' },
  'tennist-03': { classical: '3f30019a545b00e2efce8f8d7760e746f76e6037b55cc3a0f79a101b47166478', specialist: 'ab98f09109d1a8cd61843db62539aa38543f0b553076e1039701ff7a6e99b80f' },
});
const UI_FILES = ['index.html', 'app.mjs', 'core.mjs', 'contact.mjs', 'style.css'];
const PRIVATE_MARKERS = [
  '/Users/', '/var/folders/', '/private/var/', 'file://', '1794900295688',
  '767842eec2a34d478f8d4a5f3680c18f6eac889147f81fa332f7a02730542474',
];
const EXPECTED = {
  visible: 35, unknown: 234, verifiedAbsent: 0,
  classical: { tp: 19, fn: 16, fp: 0 }, specialist: { tp: 28, fn: 7, fp: 0 },
  paired: { bothCorrect: 16, recovered: 12, regressed: 3, bothMiss: 4 },
};
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function originalPublicationAuthorization() {
  return { kind: 'explicit-user-publication', sourceSha256: ORIGINAL_PUBLIC_SOURCE.sha256, scope: 'public-original-video', authorized: true };
}

function allowAuthorizedOriginal(authorization) {
  if (authorization === null || authorization === undefined) return false;
  if (!same(authorization, originalPublicationAuthorization())) throw Error('Invalid explicit original-video publication authority');
  return true;
}

export function rejectPrivateContent(content, label = 'public output', authorization = null) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const allowed = allowAuthorizedOriginal(authorization);
  if (PRIVATE_MARKERS.some(marker => !(allowed && marker === ORIGINAL_PUBLIC_SOURCE.sha256) && text.includes(marker)) || /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{25,}|"(?:apiKey|accessToken|secretKey)"\s*:|https?:\/\/[^/\s"']+:[^/\s"']+@)/i.test(text)) {
    throw Error(`${label}: private path, media identity or credential marker rejected`);
  }
  return content;
}

export async function readAllowlistedFile(root, path, expectedSha) {
  const base = resolve(root), target = resolve(base, path);
  const rel = relative(base, target);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw Error('Source escapes allowlisted directory');
  let cursor = base;
  if ((await lstat(cursor)).isSymbolicLink()) throw Error('Symlink source root denied');
  for (const piece of rel.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, piece);
    if ((await lstat(cursor)).isSymbolicLink()) throw Error('Symlink source denied');
  }
  if (!(await stat(target)).isFile() || await realpath(target) !== target) throw Error('Source is not a regular canonical file');
  const bytes = await readFile(target);
  if (expectedSha && sha256(bytes) !== expectedSha) throw Error(`Source SHA mismatch: ${path}`);
  return bytes;
}

export function deriveClipEvidence(clip, labels, classical, specialist) {
  if (labels.length !== clip.frameCount || classical.frames.length !== labels.length || specialist.frames.length !== labels.length) throw Error('Incomplete source/label/frame coverage');
  const counts = { visible: 0, unknown: 0, verifiedAbsent: 0,
    classical: { tp: 0, fn: 0, fp: 0 }, specialist: { tp: 0, fn: 0, fp: 0 },
    paired: { bothCorrect: 0, recovered: 0, regressed: 0, bothMiss: 0 } };
  const publicLabels = [], cases = [];
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    if (label.index !== index || !['visible', 'absent', 'unknown'].includes(label.status)) throw Error('Invalid or unordered reference labels');
    if (label.status === 'visible') {
      if (!Array.isArray(label.point) || label.point.length !== 2 || !label.point.every(Number.isFinite)
        || label.point[0] < 0 || label.point[0] >= clip.width || label.point[1] < 0 || label.point[1] >= clip.height) throw Error('Reference point outside source pixels');
    } else if (label.point !== null) throw Error('Absent/unknown reference must have no point');
    publicLabels.push({ frame: index, status: label.status, point: label.point,
      ...(label.annotationImage ? { annotationImageSha256: label.annotationImage.sha256 } : {}) });
    if (label.status === 'unknown') { counts.unknown++; continue; }
    counts[label.status === 'visible' ? 'visible' : 'verifiedAbsent']++;
    const compared = {};
    for (const [name, session] of [['classical', classical], ['specialist', specialist]]) {
      const observation = session.frames[index];
      const point = observation.status === 'observed' ? [observation.ball.x, observation.ball.y] : null;
      const errorPixels = point && label.point ? Math.hypot(point[0] - label.point[0], point[1] - label.point[1]) : null;
      const correct = label.status === 'visible' && errorPixels !== null && errorPixels <= 8;
      if (label.status === 'visible') {
        if (correct) counts[name].tp++;
        else { counts[name].fn++; if (point) counts[name].fp++; }
      } else if (point) counts[name].fp++;
      compared[name] = { status: observation.status, point, correct, errorPixels };
    }
    if (label.status === 'visible') {
      const key = compared.classical.correct ? (compared.specialist.correct ? 'bothCorrect' : 'regressed')
        : (compared.specialist.correct ? 'recovered' : 'bothMiss');
      counts.paired[key]++;
      const category = { bothCorrect: 'both-correct', recovered: 'recovered', regressed: 'regressed', bothMiss: 'both-miss' }[key];
      cases.push({ id: `${clip.id}-f${index}`, frame: index, category, referencePoint: label.point, ...compared });
    }
  }
  return { counts, labels: publicLabels, cases };
}

async function checkedJson(root, path, expectedSha) {
  return JSON.parse((await readAllowlistedFile(root, path, expectedSha)).toString('utf8'));
}

function addCounts(total, part) {
  for (const key of ['visible', 'unknown', 'verifiedAbsent']) total[key] += part[key];
  for (const arm of ['classical', 'specialist', 'paired']) for (const key of Object.keys(total[arm])) total[arm][key] += part[arm][key];
}

export async function preparePublicData({ root = SOURCE_ROOT, videoRoot = resolve(root, '.court-cache/m2/benchmark'), includeUserOriginal = false,
  includeEventEvidence = false, eventEvidenceRoot, originalVideo = resolve(PUBLIC_DIST, 'demo/videos/pickleball-original.mp4') } = {}) {
  if (typeof includeUserOriginal !== 'boolean') throw Error('Original publication opt-in must be an explicit boolean');
  if (typeof includeEventEvidence !== 'boolean') throw Error('Event evidence opt-in must be an explicit boolean');
  if (includeEventEvidence && !includeUserOriginal) throw Error('Event evidence publication requires original publication opt-in');
  const evidenceRoot = resolve(root, 'docs/evidence/court-m2');
  const rgb = await checkedJson(evidenceRoot, 'rgb-manifest.json', FROZEN_RGB_SHA);
  const gold = await checkedJson(evidenceRoot, 'gold-sealed-r2.json', FROZEN_GOLD_SHA);
  const score = await checkedJson(evidenceRoot, 'ab-report.json');
  const preparation = await checkedJson(evidenceRoot, 'preparation-receipt.json');
  if (gold.rgbManifestSha256 !== FROZEN_RGB_SHA || score.rgbManifestSha256 !== FROZEN_RGB_SHA || score.goldSha256 !== FROZEN_GOLD_SHA
    || gold.matching.radiusPixels !== 8 || rgb.license.id !== 'CC-BY-4.0' || rgb.clips.length !== 3 || gold.clips.length !== 3) throw Error('Frozen provenance/license contract mismatch');
  const total = structuredClone(EXPECTED);
  for (const key of ['visible', 'unknown', 'verifiedAbsent']) total[key] = 0;
  for (const arm of ['classical', 'specialist', 'paired']) for (const key of Object.keys(total[arm])) total[arm][key] = 0;
  const clips = [], files = new Map();
  const authorization = includeUserOriginal ? originalPublicationAuthorization() : null;
  const annotationProvenance = 'Tham chiếu thị giác do trợ lý AI đánh dấu và đối chiếu trên ảnh gốc trước inference; không có nghiệm thu nhãn bởi con người. Tâm bóng/vệt nhòe trên ảnh, không phải điểm chạm sân. Chỉ 35 khung có điểm; 234 khung chưa đủ nhãn không được tính âm tính.';
  for (const allowed of MEDIA_ALLOWLIST) {
    const clip = rgb.clips.find(item => item.id === allowed.id);
    const goldClip = gold.clips.find(item => item.id === allowed.id);
    if (!clip || !goldClip || clip.videoFile !== `videos/${allowed.filename}` || clip.videoSha256 !== allowed.sha256) throw Error('Video is outside fixed licensed allowlist');
    const videoBytes = await readAllowlistedFile(videoRoot, clip.videoFile, allowed.sha256);
    const provenance = preparation.sources.find(item => item.id === allowed.id);
    if (!provenance || provenance.sha256 !== allowed.sha256 || provenance.bytes !== videoBytes.length) throw Error('Media attribution/source identity mismatch');
    const sessions = {};
    for (const [arm, key] of [['A', 'classical'], ['B', 'specialist']]) {
      const receipt = score.predictionReceipts[arm][clip.id];
      if (receipt.sha256 !== FROZEN_SESSION_SHAS[clip.id][key]) throw Error('Prediction receipt differs from frozen six-session allowlist');
      const sessionBytes = await readAllowlistedFile(evidenceRoot, `arms/${arm}/${clip.id}.json`, FROZEN_SESSION_SHAS[clip.id][key]);
      const session = JSON.parse(sessionBytes.toString('utf8'));
      validateSession(session, allowed.sha256);
      for (const field of ['width', 'height', 'fps', 'frameCount', 'durationSeconds']) if (Math.abs(session.source[field] - clip[field]) > 1e-5) throw Error('Prediction source geometry/timeline mismatch');
      if (session.method.kind !== (arm === 'A' ? 'classical-cv' : 'learned-ball')) throw Error('Arm method identity mismatch');
      rejectPrivateContent(session, 'analysis session');
      sessions[key] = session;
      files.set(`demo/sessions/${key}/${clip.id}.json`, sessionBytes);
    }
    const derived = deriveClipEvidence(clip, goldClip.labels, sessions.classical, sessions.specialist);
    for (const [key, arm] of [['classical', 'A'], ['specialist', 'B']]) {
      const reported = score.arms[arm].clips[clip.id].counts;
      if (derived.counts[key].tp !== reported.TP || derived.counts[key].fn !== reported.FN || derived.counts[key].fp !== reported.FP) throw Error('Independent pixel scoring disagrees with fixed report');
    }
    addCounts(total, derived.counts);
    const evidence = { schemaVersion: 'roboeye-court-evidence-v1', sourceSha256: allowed.sha256, matchingRadiusPixels: 8,
      labels: derived.labels, cases: derived.cases, summary: derived.counts, annotationProvenance,
      annotationImageHashesScope: 'SHA-256 of the 12 preselected native PNGs per clip from sealed M2 annotation; no PNG image files published. Original video SHA binds the complete source stream.',
      goldSha256: FROZEN_GOLD_SHA };
    rejectPrivateContent(evidence);
    files.set(`demo/evidence/${clip.id}.json`, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`));
    files.set(`demo/videos/${clip.id}.mp4`, videoBytes);
    clips.push({ id: clip.id, title: allowed.title, video: `./videos/${clip.id}.mp4`, sourceSha256: allowed.sha256,
      sessions: { classical: `./sessions/classical/${clip.id}.json`, specialist: `./sessions/specialist/${clip.id}.json` },
      sessionSha256: FROZEN_SESSION_SHAS[clip.id],
      evidence: `./evidence/${clip.id}.json`, width: clip.width, height: clip.height, fps: clip.fps,
      frameCount: clip.frameCount, durationSeconds: clip.durationSeconds,
      sourceUrl: provenance.url, attribution: rgb.license.attribution, license: { id: 'CC-BY-4.0', url: rgb.license.url } });
  }
  if (!same(total, EXPECTED)) throw Error('Release counts differ from immutable M2 slice; do not rewrite claims or select winners');
  const manifest = { schemaVersion: 'roboeye-court-public-v1', defaultClip: clips[0].id, clips, summary: total,
    provenance: 'Phát lại kết quả inference thật trên Mac M1 Max. Ba video tennis độc lập với clip pickleball riêng tư. Điểm tham chiếu thưa do trợ lý đánh dấu trước inference; không phải chứng nhận pickleball, realtime hay In/Out.',
    attribution: rgb.license.attribution, annotationProvenance, falseAlarmRateOnAbsentFrames: null,
    limits: ['Chưa có khung đối chứng xác nhận không có bóng; không kết luận tỷ lệ báo nhầm bằng 0.',
      'Các điểm trên 234 khung unknown chưa được chấm đúng/sai. Không dùng unknown làm TN.',
      'Cả 12 ca hồi phục và 3 ca hồi quy đều được giữ, cùng 16 ca cả hai đúng và 4 ca cả hai bỏ sót.',
      'Đây là replay offline, không chạy model hoặc camera trên thiết bị người xem, không phân xử In/Out.'],
    evidence: { rgbManifestSha256: FROZEN_RGB_SHA, goldSha256: FROZEN_GOLD_SHA, matchingRadiusPixels: 8,
      scoring: 'Independent exporter: native Euclidean centre distance <=8 px. Wrong visible accepted point counts both FP and FN. Unknown excluded.' } };
  if (includeUserOriginal) {
    const original = ORIGINAL_PUBLIC_SOURCE;
    const originalPath = resolve(originalVideo);
    const videoBytes = await readAllowlistedFile(dirname(originalPath), originalPath.split('/').at(-1), original.sha256);
    rejectPrivateContent(videoBytes.toString('utf8'), 'authorized original binary metadata', authorization);
    const sessions = {}, sessionSha256 = {}, inputCachedSessionSha256 = {};
    for (const arm of ['classical', 'specialist']) {
      const raw = await checkedJson(root, original[arm].file, original[arm].sha256);
      validateSession(raw, original.sha256);
      if (raw.source.width !== 854 || raw.source.height !== 480 || raw.source.fps !== 25 || raw.source.frameCount !== 337
        || raw.source.durationSeconds !== 13.48 || raw.method.kind !== (arm === 'classical' ? 'classical-cv' : 'learned-ball')) throw Error('Authorized original cached source/method differs from fixed contract');
      const sanitized = structuredClone(raw); sanitized.source.name = 'pickleball-original.mp4';
      rejectPrivateContent(sanitized, 'authorized original session', authorization);
      const bytes = Buffer.from(`${JSON.stringify(sanitized)}\n`);
      files.set(`demo/sessions/${arm}/${original.id}.json`, bytes);
      sessions[arm] = sanitized; sessionSha256[arm] = sha256(bytes); inputCachedSessionSha256[arm] = original[arm].sha256;
    }
    const labels = Array.from({ length: 337 }, (_, frame) => ({ frame, status: 'unknown', point: null }));
    const originalEvidence = { schemaVersion: 'roboeye-court-evidence-v1', sourceSha256: original.sha256, matchingRadiusPixels: 8,
      labels, cases: [], annotationProvenance: 'Clip pickleball người dùng cung cấp: chưa có nhãn điểm đã duyệt. Toàn bộ 337 khung là unknown, không có ca đối chứng hoặc điểm chạm sân.',
      summary: { visible: 0, unknown: 337, verifiedAbsent: 0, classical: { tp: 0, fn: 0, fp: 0 }, specialist: { tp: 0, fn: 0, fp: 0 }, paired: { bothCorrect: 0, recovered: 0, regressed: 0, bothMiss: 0 } },
      falseAlarmRateOnAbsentFrames: null, publicationAuthorization: authorization };
    files.set(`demo/evidence/${original.id}.json`, Buffer.from(`${JSON.stringify(originalEvidence, null, 2)}\n`));
    files.set(`demo/videos/${original.id}.mp4`, videoBytes);
    manifest.clips.forEach(clip => { clip.role = 'benchmark'; });
    manifest.clips.unshift({ id: original.id, role: 'user-original', title: 'Pickleball · video gốc',
      video: `./videos/${original.id}.mp4`, sourceSha256: original.sha256, sessionSha256, inputCachedSessionSha256,
      sessions: { classical: `./sessions/classical/${original.id}.json`, specialist: `./sessions/specialist/${original.id}.json` },
      evidence: `./evidence/${original.id}.json`, width: 854, height: 480, fps: 25, frameCount: 337, durationSeconds: 13.48,
      attribution: 'Người dùng cung cấp và cho phép công khai đúng video này. Không áp giấy phép CC BY của bộ TenniST cho clip gốc.',
      license: { id: 'user-authorized-publication', scope: 'public-original-video' }, publicationAuthorization: authorization });
    manifest.schemaVersion = 'roboeye-court-public-v2'; manifest.defaultClip = original.id;
    manifest.publicationAuthorization = authorization;
    manifest.benchmarkSummary = structuredClone(manifest.summary);
    manifest.summary = { ...structuredClone(manifest.summary), unknown: manifest.summary.unknown + 337 };
    manifest.provenance = 'Video pickleball gốc được người dùng cho phép công khai; mặc định phát lại kết quả A/B đã chạy trên Mac, không suy ra In/Out. Ba video tennis và 35 nhãn thưa là đối chứng riêng, không phải độ chính xác pickleball.';
    manifest.annotationProvenance = 'Video pickleball gốc: 337 khung unknown, chưa có nhãn đã duyệt. Ba benchmark tennis: 35 điểm tham chiếu thị giác do trợ lý đánh dấu trước inference, 234 khung unknown. Không có nhãn điểm chạm sân.';
    manifest.limits.unshift('Các số 19/35 và 28/35 chỉ thuộc ba benchmark tennis, tuyệt đối không áp cho video pickleball gốc.');
    if (includeEventEvidence) {
      const prepared = await preparePinnedEventEvidence({ root, eventEvidenceRoot, original, sessions, readAllowlistedFile, sha256, rejectPrivateContent, authorization });
      for (const [path, bytes] of prepared.files) files.set(path, bytes);
      manifest.eventEvidence = prepared.pin;
    }
  }
  rejectPrivateContent(manifest, 'public manifest', authorization);
  files.set('demo/manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  files.set('demo/attribution.txt', Buffer.from(`${includeUserOriginal ? 'Pickleball original: exact video publicly distributed by explicit user authorization. This is not a CC BY license grant for that video. Its337 frames are unlabelled; benchmark statistics do not apply.\n\n' : ''}${rgb.license.attribution}\nDataset: ${rgb.license.sourceUrl}\nLicense: CC BY 4.0 (${rgb.license.url})\nUnmodified original TenniST videos; analysis overlays and sparse assistant visual references added by RoboEye.\nModel/code: WASB-SBDT, NTT Communications, BMVC 2023, MIT repository license. No weights are included in this release.\nReference labels are not human-validated ground contact or In/Out truth.\n`));
  files.set('demo/attribution.json', Buffer.from(`${JSON.stringify({
    schemaVersion: 'roboeye-court-attribution-v1',
    dataset: { title: 'Tennis Shot Side-View and Top-View Data Set for Player Analysis in Tennis', version: 2,
      doi: '10.17632/75m8vz7jr2.2', attribution: rgb.license.attribution, sourceUrl: rgb.license.sourceUrl,
      license: { id: 'CC-BY-4.0', url: rgb.license.url }, mediaModified: false,
      addedByRoboEye: 'Overlays, replay UI, actual Mac prediction sessions and sparse assistant visual reference labels.' },
    modelCode: { title: 'WASB-SBDT', author: 'NTT Communications Corporation; retained Microsoft HRNet attribution',
      sourceUrl: 'https://github.com/nttcom/WASB-SBDT', license: 'MIT repository license; no weight override stated',
      weightsIncluded: false, notice: './model-license.txt' },
    ...(includeUserOriginal ? { userOriginal: { id: ORIGINAL_PUBLIC_SOURCE.id, publicationAuthorization: authorization,
      license: 'Explicit publication permission, not CC BY', approvedPointLabels: 0 } } : {}),
    annotation: manifest.annotationProvenance,
    limits: 'Tennis-only sparse visual comparison, not human-validated ground contact, no In/Out or real-time certification.'
  }, null, 2)}\n`));
  const licenseBytes = await readAllowlistedFile(resolve(root, 'scripts'), 'court-wasb.LICENSE');
  files.set('demo/model-license.txt', licenseBytes);
  files.set('README.txt', Buffer.from(`RoboEye Court: public, static replay demonstration\n\nThis package replays previously computed Mac inference, not live camera AI.\n${includeUserOriginal ? 'The exact pickleball original is published by explicit user authorization.\nIts337 frames have no approved point labels and must not inherit tennis scores.\nIt is NOT covered by the TenniST CC BY license below.\n' : 'The private pickleball source is not included.\n'}Three original TenniST V2 tennis videos are licensed CC BY 4.0; source URLs,\nauthors and unchanged video SHA-256 are in demo/manifest.json and attribution.txt.\n\nAll35 sparse assistant visual reference points, all3 regressions and all234\nunknown benchmark frames are retained. There are no verified no-ball negative\nexamples, so a no-ball false-alarm rate is unmeasured. These references are not\nindependent human ground-contact labels or pickleball/In-Out certification.\n\nWASB-SBDT: https://github.com/nttcom/WASB-SBDT\nPublished model/code license notes: demo/model-license.txt. No weights are shipped.\nOriginal tennis videos: https://data.mendeley.com/datasets/75m8vz7jr2/2\nUI authored for RoboEye. Publishing this runnable demo does not grant a separate\nopen-source license to the UI; applicable third-party licenses remain in force.\n\nrelease-inventory.json lists every shipped file except itself, with size and SHA.\nUnrelated RoboEye modules, local paths and credentials are not included.\n`));
  return { manifest, files };
}

async function safeOutputRoot(directory) {
  const target = resolve(directory);
  if (target !== PUBLIC_DIST && !target.startsWith(resolve(SOURCE_ROOT, '.court-cache') + sep)) throw Error('Output must be isolated Court dist or scoped ignored QA cache');
  let cursor = target;
  while (true) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw Error('Symlink output denied'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  await mkdir(target, { recursive: true });
  const space = await statfs(target);
  if (space.bavail * space.bsize < 10 * 1024 ** 3) throw Error('Less than 10 GiB free; stop export');
  return target;
}

export async function inventoryDirectory(directory, { publicationAuthorization = null, includeEventEvidence = false } = {}) {
  const allowOriginal = allowAuthorizedOriginal(publicationAuthorization);
  if (typeof includeEventEvidence !== 'boolean' || includeEventEvidence && !allowOriginal) throw Error('Derivative inventory requires explicit original/event opt-ins');
  const derivativeAssets = includeEventEvidence ? eventAssetRows(JSON.parse((await readAllowlistedFile(directory, 'demo/events/manifest.json', FROZEN_EVENT_MANIFEST_SHA)).toString('utf8')))
    .map(asset => ({ ...asset, path: `demo/events/${asset.path}` })) : [];
  const entries = [];
  const visit = async (base, prefix = '') => {
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) throw Error('Symlink in release inventory denied');
      if (entry.isDirectory()) await visit(resolve(base, entry.name), `${path}/`);
      else if (entry.isFile() && path !== 'release-inventory.json') {
        const bytes = await readFile(resolve(base, entry.name));
        const derivative = derivativeAssets.find(asset => asset.path === path);
        if (derivative && (sha256(bytes) !== derivative.sha256 || bytes.length !== derivative.bytes)) throw Error('Pinned derivative changed in release');
        if (/\.(?:pt|pth|onnx|mlmodel|zip|tar|png|jpe?g)$/i.test(path) && !derivative) throw Error('Checkpoint/archive/screenshot must not enter public release');
        rejectPrivateContent(path, 'inventory filename');
        if (!path.endsWith('.mp4') && !path.endsWith('.png')) rejectPrivateContent(bytes.toString('utf8'), path, publicationAuthorization);
        entries.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
      } else if (!entry.isFile()) throw Error('Unexpected release file kind');
    }
  };
  await visit(directory);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const media = entries.filter(entry => entry.path.endsWith('.mp4'));
  const allowedMedia = allowOriginal ? [...MEDIA_ALLOWLIST, ORIGINAL_PUBLIC_SOURCE] : MEDIA_ALLOWLIST;
  const allowedClips = derivativeAssets.filter(asset => asset.path.endsWith('.mp4'));
  if (media.length !== allowedMedia.length + allowedClips.length || media.some(entry => !allowedMedia.some(allowed => entry.path === `demo/videos/${allowed.id}.mp4` && entry.sha256 === allowed.sha256)
    && !allowedClips.some(allowed => allowed.path === entry.path && allowed.sha256 === entry.sha256))) throw Error('Release media outside fixed licensed/explicitly authorized allowlist');
  for (const asset of derivativeAssets) if (!entries.some(entry => entry.path === asset.path && entry.sha256 === asset.sha256 && entry.bytes === asset.bytes)) throw Error('Incomplete pinned derivative release set');
  return entries;
}

export async function exportCourtPublic({ root = SOURCE_ROOT, videoRoot, output = PUBLIC_DIST, includeUserOriginal = false, includeEventEvidence = false, eventEvidenceRoot, originalVideo } = {}) {
  const target = await safeOutputRoot(output);
  const { manifest, files } = await preparePublicData({ root, videoRoot, includeUserOriginal, includeEventEvidence, eventEvidenceRoot, originalVideo });
  const authorization = manifest.publicationAuthorization ?? null;
  for (const file of UI_FILES) {
    let bytes = await readAllowlistedFile(resolve(root, 'tools/court'), file);
    if (file === 'index.html') {
      let html = bytes.toString('utf8').replace(/<meta\s+name=["']court-data["'][^>]*>/g, '');
      html = html.replace('</head>', '  <meta name="court-data" content="./demo/manifest.json">\n</head>')
        .replace('href="/style.css"', 'href="./style.css"').replace('src="/app.mjs"', 'src="./app.mjs"').replace('class="brand" href="/"', 'class="brand" href="./"');
      bytes = Buffer.from(html);
    }
    rejectPrivateContent(bytes.toString('utf8'), file);
    files.set(file, bytes);
  }
  const expectedPaths = new Set([...files.keys(), 'release-inventory.json']);
  const scanExisting = async (base, prefix = '') => {
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) throw Error('Symlink output entry denied');
      if (entry.isDirectory()) await scanExisting(resolve(base, entry.name), `${path}/`);
      else if (!expectedPaths.has(path)) throw Error(`Unexpected existing output file; no broad cleanup performed: ${path}`);
    }
  };
  await scanExisting(target);
  for (const [path, bytes] of files) {
    const destination = resolve(target, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  const inventory = await inventoryDirectory(target, { publicationAuthorization: authorization, includeEventEvidence });
  if (!same(inventory.map(entry => entry.path).sort(), [...files.keys()].sort())) throw Error('Release inventory differs from strict export set');
  const receipt = { schemaVersion: 'roboeye-court-release-inventory-v1', scope: 'Every release file except this inventory itself',
    source: { rgbManifestSha256: FROZEN_RGB_SHA, goldSha256: FROZEN_GOLD_SHA },
    summary: manifest.summary, fileCount: inventory.length, totalBytes: inventory.reduce((sum, file) => sum + file.bytes, 0), files: inventory,
    privacy: includeEventEvidence ? 'Three fixed CC BY4 tennis originals, one exact user-authorized pickleball original, and twelve exact source-derived M8 evidence assets only. No unrelated private media, weights, arbitrary screenshots, local paths, server or credentials.' : includeUserOriginal ? 'Three fixed CC BY4 tennis originals plus one exact user-authorized pickleball original only. No other private sources, weights, screenshots, local paths, server or credentials.'
      : 'Only the three fixed CC BY4 TenniST originals. No private source video, weights, screenshots, local paths, server or credentials.',
    ...(includeUserOriginal ? { publicationAuthorization: authorization, benchmarkSummary: manifest.benchmarkSummary } : {}),
    ...(includeEventEvidence ? { eventEvidence: { manifestSha256: FROZEN_EVENT_MANIFEST_SHA, assetCount: 12, purpose: 'Source-derived uncertain replay evidence, not contact/line-call truth' } } : {}),
    annotationFrameHashes: '36 selected source PNG hashes retained in evidence labels, not a claim of independent labels for all269 frames.' };
  rejectPrivateContent(receipt, 'release inventory', authorization);
  await writeFile(resolve(target, 'release-inventory.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let output = PUBLIC_DIST, includeUserOriginal = false, includeEventEvidence = false, originalVideo;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--include-user-original' && !includeUserOriginal) includeUserOriginal = true;
    else if (args[index] === '--include-event-evidence' && !includeEventEvidence) includeEventEvidence = true;
    else if (args[index] === '--original-video' && args[index + 1] && !originalVideo) originalVideo = args[++index];
    else if (args[index] === '--output' && args[index + 1] && output === PUBLIC_DIST) output = args[++index];
    else throw Error('Usage: node scripts/export-court-public.mjs [--output scoped-dist] [--include-user-original] [--original-video explicit-path] [--include-event-evidence]');
  }
  try { const result = await exportCourtPublic({ output, includeUserOriginal, includeEventEvidence, originalVideo }); console.log(JSON.stringify({ fileCount: result.fileCount, totalBytes: result.totalBytes, summary: result.summary })); }
  catch (error) { console.error(`Court public export refused: ${error.message}`); process.exitCode = 1; }
}
