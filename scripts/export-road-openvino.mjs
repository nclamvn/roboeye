import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
function args(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] == null) throw new Error(`Tham số không hợp lệ: ${argv[index] ?? ''}`);
    output[argv[index].slice(2)] = argv[index + 1];
  }
  return output;
}
async function exact(path, bytes, sha256) {
  const content = await readFile(path);
  if (content.length !== bytes || createHash('sha256').update(content).digest('hex') !== sha256) throw new Error(`${path}: bytes/hash sai`);
}
const options = args(process.argv.slice(2));
const sourceDir = resolve(options['source-dir'] ?? resolve(ROOT, 'tests/.road-cache/openvino/FP16'));
const output = resolve(options.output ?? resolve(ROOT, 'tests/.road-cache/openvino/road-segmentation-adas-0001.onnx'));
const converter = resolve(process.env.ROAD_OPENVINO2ONNX_BIN ?? resolve(ROOT, 'tests/.road-tools/bin/openvino2onnx'));
const xml = resolve(sourceDir, 'road-segmentation-adas-0001.xml');
const bin = resolve(sourceDir, 'road-segmentation-adas-0001.bin');
await exact(xml, 554615, 'f22818f4f0bf6c305ef39b06ae275ecf522b4ed156d6fd8529f2c09bc996739b');
await exact(bin, 368616, '58c57ee0a9b72ee9c76b0fd898ee6608bcc299c5d8d0af90a5d59d4df9e79317');
await access(converter);
await access(output).then(() => { throw new Error(`Từ chối ghi đè output đã tồn tại: ${output}`); }, () => {});
const exitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(converter, [xml, output, '-v', '17', '-s', '-vv', 'INFO'], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => resolveExit(code));
});
if (exitCode !== 0) throw new Error(`openvino2onnx exit ${exitCode}`);
const python = resolve(dirname(converter), 'python');
const canonicalizer = resolve(ROOT, 'scripts/canonicalize-road-onnx.py');
const canonicalExit = await new Promise((resolveExit, reject) => {
  const child = spawn(python, [canonicalizer, output], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => resolveExit(code));
});
if (canonicalExit !== 0) throw new Error(`canonicalizer exit ${canonicalExit}`);
await exact(output, 864661, 'be0ceeb002af577936e9b439b7194dc8df6c8e5bc84ecb9bbfcab68695c86d17');
console.log(JSON.stringify({ output, bytes: 864661, sha256: 'be0ceeb002af577936e9b439b7194dc8df6c8e5bc84ecb9bbfcab68695c86d17', opset: 17, canonical: true }, null, 2));
