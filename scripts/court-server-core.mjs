import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, mkdir, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_SESSION_BYTES = 32 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const DETECTORS = new Set(['classical', 'specialist']);
const MODEL_FIELDS = ['id', 'artifactSha256', 'sourceUrl', 'license', 'revision', 'configSha256', 'preprocessId'];
const finite = n => typeof n === 'number' && Number.isFinite(n);
const within = (n, min, max) => finite(n) && n >= min && n <= max;
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function validateModelMetadata(model) {
  if (!model || !MODEL_FIELDS.every(key => typeof model[key] === 'string' && model[key].length > 0 && model[key].length <= 2000)
    || !HASH.test(model.artifactSha256) || !HASH.test(model.configSha256)) throw Error('Thiếu metadata/checksum model bóng chuyên biệt.');
  let url; try { url = new URL(model.sourceUrl); } catch { throw Error('Nguồn model không hợp lệ.'); }
  if (url.protocol !== 'https:') throw Error('Nguồn model phải là URL HTTPS có provenance.');
  return Object.fromEntries(MODEL_FIELDS.map(key => [key, model[key]]));
}

export function validateSession(session, sourceSha, expectedModel = null) {
  const fail = () => { throw Error('Phân tích không hợp lệ hoặc không khớp video. Chạy lại bộ phân tích local.'); };
  if (!session || session.schemaVersion !== 'roboeye-court-session-v1') fail();
  const s = session.source;
  if (!s || !HASH.test(s.sha256) || s.sha256 !== sourceSha || typeof s.name !== 'string'
    || !s.name || s.name.length > 500 || s.name !== basename(s.name)
    || !Number.isInteger(s.width) || !within(s.width, 1, 8192)
    || !Number.isInteger(s.height) || !within(s.height, 1, 8192)
    || !within(s.fps, 0.01, 300) || !within(s.durationSeconds, 0.001, 300)
    || !Number.isInteger(s.frameCount) || !within(s.frameCount, 1, 20000)
    || Math.abs(s.durationSeconds - s.frameCount / s.fps) > 1e-5) fail();
  if (!session.method || !['classical-cv', 'learned-ball'].includes(session.method.kind)
    || !['id', 'description', 'version'].every(key => typeof session.method[key] === 'string')
    || !Array.isArray(session.method.limitations) || !session.method.limitations.every(x => typeof x === 'string')
    || session.decision?.status !== 'insufficient-evidence' || typeof session.decision.reason !== 'string') fail();
  if (session.method.kind === 'learned-ball') {
    let actual; try { actual = validateModelMetadata(session.method.model); } catch { fail(); }
    if (expectedModel && MODEL_FIELDS.some(key => actual[key] !== expectedModel[key])) fail();
  } else if (expectedModel || session.method.model != null) fail();
  if (!Array.isArray(session.frames) || session.frames.length !== s.frameCount) fail();
  const counts = { observed: 0, ambiguous: 0, missing: 0 };
  const validBall = b => b && within(b.x, 0, s.width) && within(b.y, 0, s.height)
    && within(b.radius, 0.000001, Math.max(s.width, s.height)) && within(b.confidence, 0, 1)
    && Array.isArray(b.box) && b.box.length === 4 && b.box.every(finite)
    && within(b.box[0], 0, s.width) && within(b.box[1], 0, s.height)
    && within(b.box[2], 0.000001, s.width) && within(b.box[3], 0.000001, s.height)
    && b.box[0] + b.box[2] <= s.width + 1 && b.box[1] + b.box[3] <= s.height + 1
    && b.x >= b.box[0] - 1e-5 && b.x <= b.box[0] + b.box[2] + 1e-5
    && b.y >= b.box[1] - 1e-5 && b.y <= b.box[1] + b.box[3] + 1e-5;
  for (let index = 0; index < session.frames.length; index++) {
    const f = session.frames[index];
    if (!f || f.index !== index || !within(f.timeSeconds, 0, s.durationSeconds)
      || Math.abs(f.timeSeconds - index / s.fps) > 1e-5
      || !Object.hasOwn(counts, f.status) || typeof f.reason !== 'string'
      || !Array.isArray(f.candidates) || f.candidates.length > 100 || !f.candidates.every(validBall)
      || (f.status === 'observed' ? !validBall(f.ball) : f.ball !== null)) fail();
    counts[f.status]++;
  }
  if (!Array.isArray(session.lineSuggestions) || session.lineSuggestions.length > 100) fail();
  const ids = new Set();
  const point = p => Array.isArray(p) && p.length === 2 && within(p[0], 0, s.width) && within(p[1], 0, s.height);
  for (const line of session.lineSuggestions) {
    if (!line || typeof line.id !== 'string' || ids.has(line.id) || !point(line.a) || !point(line.b)
      || line.confirmed !== false || line.provenance !== 'image-hough') fail();
    ids.add(line.id);
  }
  const summary = session.summary;
  if (!summary || summary.observedFrames !== counts.observed || summary.ambiguousFrames !== counts.ambiguous
    || summary.missingFrames !== counts.missing || !within(summary.analysisMs, 0, 3_600_000)) fail();
  return session;
}

export function parseByteRange(header, size) {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size < 1) throw Error('range');
  let start, end;
  if (!match[1]) {
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count) || count < 1) throw Error('range');
    start = Math.max(0, size - count); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw Error('range');
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

async function readBounded(path, maxBytes) {
  const file = await stat(path);
  if (!file.isFile() || file.size < 1 || file.size > maxBytes) throw Error('Tệp local không hợp lệ hoặc vượt giới hạn.');
  return readFile(path);
}

export async function prepareCourtSession({ videoPath, pythonPath, analyzerPath, cacheRoot, analysisPath,
  detector = 'classical', weightsPath, modelMetadata, dependencyPaths = [], device = 'cpu' }) {
  if (!DETECTORS.has(detector)) throw Error('Detector phải là classical hoặc specialist.');
  const model = detector === 'specialist' ? validateModelMetadata(modelMetadata) : null;
  if (model && (!weightsPath || await hashFile(weightsPath) !== model.artifactSha256)) throw Error('Model local không khớp artifact SHA-256 đã pin.');
  if (!['cpu', 'mps', 'auto'].includes(device)) throw Error('Device phải là cpu, mps hoặc auto.');
  const videoStat = await stat(videoPath);
  if (!videoStat.isFile() || videoStat.size < 1 || videoStat.size > MAX_VIDEO_BYTES) throw Error('Video phải là tệp có dung lượng tối đa 500 MiB.');
  const sourceSha = await hashFile(videoPath);
  const analyzerSha = await hashFile(analyzerPath);
  const dependencies = await Promise.all(dependencyPaths.map(async path => ({ path: resolve(path), sha256: await hashFile(path) })));
  const fingerprint = sha256(JSON.stringify({ detector, analyzerSha, dependencies, model, device: model ? device : null }));
  const target = analysisPath ? resolve(analysisPath) : model
    ? resolve(cacheRoot, sourceSha, 'specialist', fingerprint, 'session.json') : resolve(cacheRoot, sourceSha, 'session.json');
  const receiptPath = `${target}.receipt.json`;
  let cacheUsed = false, session;
  try {
    const bytes = await readBounded(target, MAX_SESSION_BYTES);
    const receipt = JSON.parse((await readBounded(receiptPath, 4096)).toString('utf8'));
    const legacy = !model && receipt.schemaVersion === 'roboeye-court-cache-v1';
    if ((!legacy && (receipt.schemaVersion !== 'roboeye-court-cache-v2' || receipt.fingerprint !== fingerprint)) || receipt.sourceSha256 !== sourceSha
      || receipt.analyzerSha256 !== analyzerSha || receipt.analysisSha256 !== sha256(bytes)) throw Error('cache mismatch');
    session = validateSession(JSON.parse(bytes.toString('utf8')), sourceSha, model);
    if (session.method.kind !== (model ? 'learned-ball' : 'classical-cv')) throw Error('Wrong detector cache');
    cacheUsed = true;
  } catch {
    if (analysisPath) throw Error('Phân tích chỉ định thiếu receipt hợp lệ hoặc không khớp video/bộ phân tích hiện tại.');
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.pending`;
    try {
      await run(pythonPath, [analyzerPath, '--video', videoPath, '--output', temporary,
        ...(model ? ['--weights', resolve(weightsPath), '--device', device] : [])], {
        timeout: model ? 300_000 : 180_000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL', windowsHide: true,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      });
      const bytes = await readBounded(temporary, MAX_SESSION_BYTES);
      session = validateSession(JSON.parse(bytes.toString('utf8')), sourceSha, model);
      if (session.method.kind !== (model ? 'learned-ball' : 'classical-cv')) throw Error('Wrong detector output');
      if (await hashFile(videoPath) !== sourceSha || await hashFile(analyzerPath) !== analyzerSha) throw Error('Nguồn hoặc bộ phân tích đã thay đổi trong khi chạy.');
      if (model && await hashFile(weightsPath) !== model.artifactSha256) throw Error('Weights đã thay đổi trong khi chạy.');
      for (const dependency of dependencies) if (await hashFile(dependency.path) !== dependency.sha256) throw Error('Dependency đã thay đổi trong khi chạy.');
      await rename(temporary, target);
      await writeFile(receiptPath, `${JSON.stringify({ schemaVersion: model ? 'roboeye-court-cache-v2' : 'roboeye-court-cache-v1', sourceSha256: sourceSha,
        analyzerSha256: analyzerSha, analysisSha256: sha256(bytes), ...(model ? { fingerprint, detector, model, device, dependencies } : {}) }, null, 2)}\n`);
    } catch (error) {
      const { unlink } = await import('node:fs/promises');
      await unlink(temporary).catch(() => {});
      if (error.killed) throw Error(`Phân tích vượt ${model ? 300 : 180} giây, đã dừng. Không tự thử lại.`);
      throw Error('Không thể phân tích video local. Kiểm tra Python/OpenCV, định dạng video và giới hạn 5 phút/20.000 frame.', { cause: error });
    }
  }
  if (await hashFile(videoPath) !== sourceSha) throw Error('Video đã thay đổi trong khi mở phiên.');
  return { session, cacheUsed, analysisPath: target, videoIdentity: { size: videoStat.size, mtimeMs: videoStat.mtimeMs, ino: videoStat.ino, dev: videoStat.dev } };
}

export function createCourtServer({ root, videoPath, session, sessions, defaultDetector = 'classical', videoIdentity, port = 4198 }) {
  const prepared = sessions ?? { [session?.method?.kind === 'learned-ball' ? 'specialist' : 'classical']: session };
  if (!DETECTORS.has(defaultDetector) || !prepared[defaultDetector]) throw Error('Detector mặc định chưa được chuẩn bị.');
  session = prepared[defaultDetector];
  const source = session?.source;
  for (const [key, value] of Object.entries(prepared)) {
    if (!DETECTORS.has(key)) throw Error('Detector không nằm trong allowlist.');
    validateSession(value, source?.sha256);
    if (['width', 'height', 'fps', 'frameCount', 'durationSeconds'].some(field => value.source[field] !== source[field])) throw Error('A/B phải dùng cùng nguồn và timeline.');
    if (value.method.kind !== (key === 'classical' ? 'classical-cv' : 'learned-ball')) throw Error('Nhãn arm không khớp phương pháp.');
  }
  const sessionBytes = Object.fromEntries(Object.entries(prepared).map(([key, value]) => [key, Buffer.from(JSON.stringify(value))]));
  const methods = { schemaVersion: 'roboeye-court-methods-v1', sourceSha256: source.sha256, defaultDetector,
    methods: Object.entries(prepared).map(([key, value]) => ({ key, id: value.method.id, kind: value.method.kind,
      description: value.method.description, model: value.method.model ?? null })) };
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']], ['/court.html', ['index.html', 'text/html; charset=utf-8']],
    ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']], ['/core.mjs', ['core.mjs', 'text/javascript; charset=utf-8']],
    ['/contact.mjs', ['contact.mjs', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ]);
  const send = (res, status, body, headers = {}, head = false) => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, ...headers });
    res.end(head ? undefined : bytes);
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const actualPort = server.address()?.port ?? port;
      const hosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
      if (!hosts.has(request.headers.host) || (request.headers.origin && !new Set([`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`]).has(request.headers.origin))) {
        send(response, 403, { error: 'Chỉ hỗ trợ phiên local cùng nguồn.' }); return;
      }
      const head = request.method === 'HEAD';
      if (request.method !== 'GET' && !head) { send(response, 405, { error: 'Chỉ cho phép GET/HEAD.' }, { Allow: 'GET, HEAD' }); return; }
      if (!request.url || /%2f|%5c|%2e|\\/i.test(request.url.split('?')[0]) || request.url.includes('..')) {
        send(response, 404, { error: 'Không có tài nguyên này.' }, {}, head); return;
      }
      const url = new URL(request.url, `http://127.0.0.1:${actualPort}`);
      if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      if (url.pathname === '/api/health') { send(response, 200, { status: 'ready', localOnly: true, sourceSha256: session.source.sha256, detectors: Object.keys(prepared), defaultDetector }, {}, head); return; }
      if (url.pathname === '/api/methods') { send(response, 200, methods, {}, head); return; }
      if (url.pathname === '/api/session') {
        const detector = url.searchParams.get('detector') ?? defaultDetector;
        if (!DETECTORS.has(detector) || !sessionBytes[detector]) { send(response, 400, { error: 'Detector chưa được chuẩn bị; không thay thế ngầm bằng arm khác.' }, {}, head); return; }
        send(response, 200, sessionBytes[detector], {}, head); return;
      }
      if (url.pathname === '/api/video') {
        const now = await stat(videoPath);
        if (!now.isFile() || now.size !== videoIdentity.size || now.mtimeMs !== videoIdentity.mtimeMs || now.ino !== videoIdentity.ino || now.dev !== videoIdentity.dev) {
          send(response, 409, { error: 'Video đã thay đổi. Khởi động lại phiên để phân tích đúng nguồn.' }, {}, head); return;
        }
        let range;
        try { range = parseByteRange(request.headers.range, now.size); }
        catch { send(response, 416, { error: 'Byte range không hợp lệ.' }, { 'Content-Range': `bytes */${now.size}` }, head); return; }
        const start = range?.start ?? 0, end = range?.end ?? now.size - 1;
        response.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${now.size}` } : {}) });
        if (head) { response.end(); return; }
        const stream = createReadStream(videoPath, { start, end });
        stream.on('error', () => response.destroy());
        response.on('close', () => stream.destroy());
        stream.pipe(response); return;
      }
      const asset = files.get(url.pathname);
      if (!asset) { send(response, 404, { error: 'Không có tài nguyên này.' }, {}, head); return; }
      const bytes = await readFile(resolve(root, 'tools/court', asset[0]));
      send(response, 200, bytes, { 'Content-Type': asset[1] }, head);
    } catch {
      if (!response.headersSent) send(response, 500, { error: 'Tài nguyên local không khả dụng. Kiểm tra và khởi động lại phiên.' });
      else response.destroy();
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 15_000;
  return server;
}
