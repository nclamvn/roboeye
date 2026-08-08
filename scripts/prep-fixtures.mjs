// Chuẩn bị fixtures cho smoke test trên fresh clone:
//   1. Tải 3 model ONNX về tests/.model-cache (khớp layout model ID)
//   2. Sinh tests/assets/scene.y4m từ scene.jpg bằng ffmpeg
// Cả hai đều gitignore (nặng) nên clone mới phải chạy script này trước khi smoke.
// Idempotent: bỏ qua file đã có. Cần curl + ffmpeg.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cache = `${root}tests/.model-cache`;

const MODELS = [
  {
    dir: 'onnx-community/depth-anything-v2-small',
    base: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main',
    files: ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']
  },
  {
    dir: 'onnx-community/rtdetr_v2_r18vd-ONNX',
    base: 'https://huggingface.co/onnx-community/rtdetr_v2_r18vd-ONNX/resolve/main',
    files: ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']
  },
  {
    dir: 'Xenova/owlvit-base-patch32',
    base: 'https://huggingface.co/Xenova/owlvit-base-patch32/resolve/main',
    files: [
      'config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
      'special_tokens_map.json', 'vocab.json', 'merges.txt', 'onnx/model_quantized.onnx'
    ]
  }
];

function curl(url, out) {
  execFileSync('curl', ['-sSL', '--fail', '--max-time', '600', '-o', out, url], { stdio: ['ignore', 'ignore', 'inherit'] });
}

let downloaded = 0;
for (const m of MODELS) {
  for (const f of m.files) {
    const out = `${cache}/${m.dir}/${f}`;
    if (existsSync(out) && statSync(out).size > 0) continue;
    mkdirSync(out.substring(0, out.lastIndexOf('/')), { recursive: true });
    process.stdout.write(`tải ${m.dir}/${f} ... `);
    curl(`${m.base}/${f}`, out);
    console.log(`${(statSync(out).size / 1e6).toFixed(1)} MB`);
    downloaded++;
  }
}
console.log(downloaded ? `đã tải ${downloaded} file model` : 'model cache đã đủ');

// scene.y4m từ scene.jpg
const jpg = `${root}tests/assets/scene.jpg`;
const y4m = `${root}tests/assets/scene.y4m`;
if (!existsSync(jpg)) {
  console.error('THIẾU tests/assets/scene.jpg (fixture ảnh nguồn). Không sinh được y4m.');
  process.exit(1);
}
if (existsSync(y4m) && statSync(y4m).size > 0) {
  console.log('scene.y4m đã có');
} else {
  let ffmpeg = 'ffmpeg';
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('THIẾU ffmpeg. Cài ffmpeg rồi chạy lại, hoặc tự sinh scene.y4m 960x720 yuv420p.');
    process.exit(1);
  }
  execFileSync(ffmpeg, ['-y', '-loop', '1', '-i', jpg, '-t', '1', '-r', '10', '-pix_fmt', 'yuv420p', '-s', '960x720', y4m], {
    stdio: ['ignore', 'ignore', 'inherit']
  });
  console.log(`đã sinh scene.y4m (${(statSync(y4m).size / 1e6).toFixed(1)} MB)`);
}
console.log('fixtures sẵn sàng — chạy: npm run build && npm run smoke');
