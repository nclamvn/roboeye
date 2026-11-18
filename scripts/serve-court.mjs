#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { prepareCourtSession, createCourtServer, sha256, validateModelMetadata } from './court-server-core.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2), options = {};
try {
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (Object.hasOwn(options, key)) throw Error('Tham số bị lặp.');
    if (key === '--compare') { options[key] = true; continue; }
    if (!['--video', '--port', '--python', '--analysis', '--detector', '--weights', '--model-manifest', '--device'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('Tham số không hợp lệ.');
    options[key] = args[++index];
  }
  if (!options['--video']) throw Error('Cách chạy: node scripts/serve-court.mjs --video /duong/dan/video.mp4 [--port 4198] [--detector classical|specialist] [--compare] [--device auto|cpu|mps]');
  const port = Number(options['--port'] ?? '4198');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Port phải trong khoảng 1024–65535.');
  const videoPath = resolve(options['--video']);
  const detector = options['--detector'] ?? 'classical';
  if (!['classical', 'specialist'].includes(detector)) throw Error('--detector phải là classical hoặc specialist.');
  if (options['--analysis'] && options['--compare']) throw Error('--analysis chỉ dùng cho một arm, không dùng cùng --compare.');
  const pythonPath = options['--python'] ?? resolve(root, 'native/ios/.build-xcode/scene-qa/venv/bin/python');
  const device = options['--device'] ?? 'auto';
  if (!['auto', 'cpu', 'mps'].includes(device)) throw Error('--device phải là auto, cpu hoặc mps.');
  console.log('RoboEye Court: chuẩn bị phân tích local, không tải video lên mạng…');
  const sessions = {}; let prepared;
  for (const arm of options['--compare'] ? ['classical', 'specialist'] : [detector]) {
    let weightsPath, modelMetadata, dependencyPaths = [];
    const analyzerPath = resolve(root, arm === 'classical' ? 'scripts/court_analyze.py' : 'scripts/court_ball_model.py');
    if (arm === 'specialist') {
      const manifestPath = resolve(options['--model-manifest'] ?? resolve(root, 'scripts/court-wasb-model.json'));
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      if (sha256(JSON.stringify(canonical(manifest.config))) !== manifest.configSha256) throw Error('Config model không khớp checksum manifest.');
      modelMetadata = validateModelMetadata({ id: manifest.id, artifactSha256: manifest.sha256, sourceUrl: manifest.sourceUrl,
        license: manifest.license, revision: manifest.revision, configSha256: manifest.configSha256, preprocessId: manifest.preprocessId });
      if (typeof manifest.weightFilename !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(manifest.weightFilename)) throw Error('Tên artifact model không hợp lệ.');
      weightsPath = resolve(options['--weights'] ?? resolve(root, '.court-cache/m2/models', manifest.weightFilename));
      dependencyPaths = [manifestPath, resolve(root, 'scripts/court_analyze.py'), resolve(root, 'scripts/court_wasb_hrnet.py')];
    }
    console.log(`Chuẩn bị arm ${arm}${arm === 'specialist' ? ' từ weights local đã pin' : ''}…`);
    const result = await prepareCourtSession({ videoPath, pythonPath, analyzerPath, cacheRoot: resolve(root, '.court-cache'),
      analysisPath: options['--analysis'], detector: arm, weightsPath, modelMetadata, dependencyPaths, device });
    sessions[arm] = result.session; prepared ??= result;
    console.log(`${arm}: ${result.session.source.frameCount} frame; ${result.cacheUsed ? 'cache đã kiểm hash' : 'phân tích mới'}.`);
  }
  const server = createCourtServer({ root, videoPath, sessions, defaultDetector: detector, videoIdentity: prepared.videoIdentity, port });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} đang được dùng. Chọn --port khác; không dừng dịch vụ khác.` : 'Không mở được máy chủ local.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log(`RoboEye Court ready: http://127.0.0.1:${port}/court.html`);
    console.log(`Mặc định ${detector}; ${Object.keys(sessions).length} arm đã chuẩn bị; chỉ xem lại, chưa kết luận In/Out.`);
  });
  const stop = () => { server.close(() => process.exit(0)); server.closeIdleConnections(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) {
  console.error(error.message.startsWith('ENOENT') ? 'Không tìm thấy video hoặc Python/OpenCV local. Kiểm tra đường dẫn --video/--python.' : error.message);
  process.exitCode = 1;
}
