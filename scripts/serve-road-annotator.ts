import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import {
  createDraftRoadAnnotations,
  parseRoadAnnotationSet,
  parseRoadAnnotationTask,
  validateRoadAnnotationsAgainstTask,
} from '../src/drive/road-annotations';

function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith('--') || argv[index + 1] == null) throw Error(`Tham số không hợp lệ: ${key ?? ''}`);
    parsed[key.slice(2)] = argv[index + 1];
  }
  return parsed;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw Error('Content-Type phải là application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 2_000_000) throw Error('Payload vượt 2 MB');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const options = parseArgs(process.argv.slice(2));
if (!options['task-dir']) throw Error('Cách dùng: npm run annotate:road -- --task-dir /local/task [--port 4193]');
const taskDir = resolve(options['task-dir']);
const port = Number(options.port ?? 4193);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('--port không hợp lệ');
const taskPath = resolve(taskDir, 'task.json');
const annotationsPath = resolve(taskDir, 'annotations.json');
const taskBytes = await readFile(taskPath);
const taskSha256 = sha256(taskBytes);
const task = parseRoadAnnotationTask(JSON.parse(taskBytes.toString('utf8')));
for (const [index, frame] of task.frames.entries()) {
  const imagePath = resolve(taskDir, frame.imageFile);
  if (!imagePath.startsWith(`${taskDir}/`)) throw Error(`Frame ${index}: đường dẫn ra ngoài task directory`);
  const imageStat = await stat(imagePath);
  if (!imageStat.isFile()) throw Error(`Frame ${index}: ảnh không phải file`);
  if (sha256(await readFile(imagePath)) !== frame.imageSha256) throw Error(`Frame ${index}: SHA-256 ảnh không khớp`);
}
try {
  const existing = parseRoadAnnotationSet(JSON.parse(await readFile(annotationsPath, 'utf8')));
  validateRoadAnnotationsAgainstTask(task, taskSha256, existing);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  await writeFile(annotationsPath, `${JSON.stringify(createDraftRoadAnnotations(task, taskSha256), null, 2)}\n`, { flag: 'wx' });
}

const root = resolve(new URL('..', import.meta.url).pathname);
const publicFiles: Record<string, { path: string; type: string }> = {
  '/': { path: resolve(root, 'tools/road-annotator.html'), type: 'text/html; charset=utf-8' },
  '/road-annotator.js': { path: resolve(root, 'tools/road-annotator.js'), type: 'text/javascript; charset=utf-8' },
  '/road-annotator.css': { path: resolve(root, 'tools/road-annotator.css'), type: 'text/css; charset=utf-8' },
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (request.method === 'GET' && url.pathname === '/favicon.ico') {
      response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/task') {
      sendJson(response, 200, { ...task, taskSha256 });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/annotations') {
      sendJson(response, 200, parseRoadAnnotationSet(JSON.parse(await readFile(annotationsPath, 'utf8'))));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/annotations') {
      const annotations = parseRoadAnnotationSet(await readJson(request));
      validateRoadAnnotationsAgainstTask(task, taskSha256, annotations);
      const current = parseRoadAnnotationSet(JSON.parse(await readFile(annotationsPath, 'utf8')));
      if (annotations.revision !== current.revision) {
        throw Error(`Xung đột phiên bản: tab này là revision ${annotations.revision}, server đã ở revision ${current.revision}. Tải lại trước khi sửa tiếp.`);
      }
      const savedAnnotations = { ...annotations, revision: current.revision + 1 };
      const temporaryPath = resolve(taskDir, `.annotations-${process.pid}.tmp`);
      await writeFile(temporaryPath, `${JSON.stringify(savedAnnotations, null, 2)}\n`, { flag: 'wx' });
      await rename(temporaryPath, annotationsPath);
      sendJson(response, 200, { saved: true, status: savedAnnotations.status, frames: savedAnnotations.frames.length, revision: savedAnnotations.revision });
      return;
    }
    const frameMatch = request.method === 'GET' ? /^\/frame\/(\d+)$/.exec(url.pathname) : null;
    if (frameMatch) {
      const frame = task.frames[Number(frameMatch[1])];
      if (!frame) { response.writeHead(404).end(); return; }
      const imagePath = resolve(taskDir, frame.imageFile);
      if (extname(imagePath).toLowerCase() !== '.png' || !imagePath.startsWith(`${taskDir}/`)) throw Error('Đường dẫn ảnh không hợp lệ');
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', ETag: `"${frame.imageSha256}"` });
      response.end(await readFile(imagePath));
      return;
    }
    const publicFile = request.method === 'GET' ? publicFiles[url.pathname] : undefined;
    if (publicFile) {
      response.writeHead(200, {
        'Content-Type': publicFile.type,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(await readFile(publicFile.path));
      return;
    }
    response.writeHead(404).end();
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Road annotation workbench: http://127.0.0.1:${port}/\nTask: ${task.taskId}\nPrediction blind: yes\n`);
});
