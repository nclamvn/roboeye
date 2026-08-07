// Copy runtime WASM của ONNX Runtime và MediaPipe vào public/ để app tự host,
// không phụ thuộc CDN jsdelivr lúc chạy (PRD mục 9: sinh viên mạng yếu vẫn chạy).
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = `${root}node_modules/@huggingface/transformers/dist/`;
const dst = `${root}public/ort/`;
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (f.startsWith('ort-wasm')) {
    copyFileSync(src + f, dst + f);
    n++;
  }
}
console.log(`[copy-ort] đã copy ${n} file ORT runtime vào public/ort/`);

const mpSrc = `${root}node_modules/@mediapipe/tasks-vision/wasm/`;
const mpDst = `${root}public/mediapipe/wasm/`;
mkdirSync(mpDst, { recursive: true });
let mpCount = 0;
for (const f of readdirSync(mpSrc)) {
  copyFileSync(mpSrc + f, mpDst + f);
  mpCount++;
}
copyFileSync(`${root}node_modules/@mediapipe/tasks-vision/vision_bundle.js`, `${root}public/mediapipe/vision_bundle.js`);
mpCount++;
console.log(`[copy-ort] đã copy ${mpCount} file MediaPipe runtime vào public/mediapipe/`);

const tfliteSrc = `${root}node_modules/@tensorflow/tfjs-tflite/wasm/`;
const tfliteDst = `${root}public/tflite/`;
mkdirSync(tfliteDst, { recursive: true });
let tfliteCount = 0;
for (const f of readdirSync(tfliteSrc)) {
  copyFileSync(tfliteSrc + f, tfliteDst + f);
  tfliteCount++;
}
copyFileSync(`${root}node_modules/@tensorflow/tfjs-core/dist/tf-core.min.js`, `${tfliteDst}tf-core.min.js`);
copyFileSync(`${root}node_modules/@tensorflow/tfjs-backend-cpu/dist/tf-backend-cpu.min.js`, `${tfliteDst}tf-backend-cpu.min.js`);
copyFileSync(`${root}node_modules/@tensorflow/tfjs-tflite/dist/tf-tflite.min.js`, `${tfliteDst}tf-tflite.min.js`);
tfliteCount += 3;
console.log(`[copy-ort] đã copy ${tfliteCount} file TFLite runtime vào public/tflite/`);
