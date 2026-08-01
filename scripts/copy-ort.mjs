// Copy runtime WASM của onnxruntime-web vào public/ort/ để app tự host,
// không phụ thuộc CDN jsdelivr lúc chạy (PRD mục 9: sinh viên mạng yếu vẫn chạy).
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = `${root}node_modules/@huggingface/transformers/dist/`;
const dst = `${root}public/ort/`;
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (f.startsWith('ort-wasm')) {
    cpSync(src + f, dst + f);
    n++;
  }
}
console.log(`[copy-ort] đã copy ${n} file ORT runtime vào public/ort/`);
