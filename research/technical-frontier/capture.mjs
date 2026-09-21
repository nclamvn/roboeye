// TIP-56A: capture public technical sources as inert evidence.
// Retrieved bytes are never executed. URLs are discovery pointers; hashes and
// local snapshots are the audit evidence for this research pass.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url);
const sources = [
  ['yolo26', 'https://docs.ultralytics.com/models/yolo26/', 'Ultralytics', 'html'],
  ['rfdetr', 'https://raw.githubusercontent.com/roboflow/rf-detr/develop/README.md', 'Roboflow-RF-DETR', 'txt'],
  ['rtdetr', 'https://raw.githubusercontent.com/lyuwenyu/RT-DETR/main/README.md', 'RT-DETR-authors', 'txt'],
  ['rtdetr-license', 'https://raw.githubusercontent.com/lyuwenyu/RT-DETR/main/LICENSE', 'RT-DETR-authors', 'txt'],
  ['bytetrack', 'https://raw.githubusercontent.com/FoundationVision/ByteTrack/main/README.md', 'FoundationVision-ByteTrack', 'txt'],
  ['bytetrack-license', 'https://raw.githubusercontent.com/FoundationVision/ByteTrack/main/LICENSE', 'FoundationVision-ByteTrack', 'txt'],
  ['metric3d', 'https://raw.githubusercontent.com/YvanYin/Metric3D/main/README.md', 'Metric3D-authors', 'txt'],
  ['metric3d-license', 'https://raw.githubusercontent.com/YvanYin/Metric3D/main/LICENSE', 'Metric3D-authors', 'txt'],
  ['unidepth', 'https://raw.githubusercontent.com/lpiccinelli-eth/UniDepth/main/README.md', 'ETH-UniDepth', 'txt'],
  ['depthpro', 'https://raw.githubusercontent.com/apple/ml-depth-pro/main/README.md', 'Apple-DepthPro', 'txt'],
  ['depthpro-license', 'https://raw.githubusercontent.com/apple/ml-depth-pro/main/LICENSE', 'Apple-DepthPro', 'txt'],
  ['da2', 'https://raw.githubusercontent.com/DepthAnything/Depth-Anything-V2/main/README.md', 'DepthAnything', 'txt'],
  ['yolopv2', 'https://raw.githubusercontent.com/CAIC-AD/YOLOPv2/main/README.md', 'CAIC-AD-YOLOPv2', 'txt'],
  ['yolopv2-license', 'https://raw.githubusercontent.com/CAIC-AD/YOLOPv2/main/LICENSE', 'CAIC-AD-YOLOPv2', 'txt'],
  ['openvino-road', 'https://docs.openvino.ai/2024/notebooks/hello-segmentation-with-output.html', 'OpenVINO', 'html'],
  ['ort-web', 'https://onnxruntime.ai/docs/tutorials/web/', 'Microsoft-ONNXRuntime', 'html'],
  ['ort-license', 'https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE', 'Microsoft-ONNXRuntime', 'txt'],
  ['webcodecs', 'https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API', 'MDN', 'html'],
  ['video-frame-callback', 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback', 'MDN', 'html'],
  ['deepstream-tracker', 'https://docs.nvidia.com/metropolis/deepstream/9.0/text/DS_plugin_gst-nvtracker.html', 'NVIDIA-DeepStream', 'html'],
  ['opencv-calibration', 'https://raw.githubusercontent.com/opencv/opencv/4.x/doc/py_tutorials/py_calib3d/py_calibration/py_calibration.markdown', 'OpenCV', 'txt'],
  ['bdd100k', 'https://raw.githubusercontent.com/bdd100k/bdd100k/master/README.md', 'Berkeley-BDD100K', 'txt'],
  ['kitti', 'https://www.cvlibs.net/datasets/kitti/', 'KITTI', 'html'],
  ['comma2k19', 'https://raw.githubusercontent.com/commaai/comma2k19/master/README.md', 'comma.ai', 'txt'],
  ['nhtsa-hmi', 'https://www.nhtsa.gov/sites/nhtsa.dot.gov/files/documents/812360_humanfactorsdesignguidance.pdf', 'NHTSA', 'pdf'],
];

await mkdir(new URL('snapshots/', root), { recursive: true });
const captures = [];
for (const [id, url, source, ext] of sources) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(60_000),
      headers: { 'User-Agent': 'RoboEye-TIP-56A-evidence-capture' },
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const snapshot = `${id}.${ext}`;
    await writeFile(new URL(`snapshots/${snapshot}`, root), bytes);
    captures.push({
      id, url, source, snapshot, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    captures.push({ id, url, source, error: String(error) });
  }
}
const nhtsa = captures.find((item) => item.id === 'nhtsa-hmi' && !item.error);
if (nhtsa) {
  const pdfUrl = new URL('snapshots/nhtsa-hmi.pdf', root);
  const textUrl = new URL('snapshots/nhtsa-hmi.txt', root);
  await promisify(execFile)('pdftotext', ['-layout', fileURLToPath(pdfUrl), fileURLToPath(textUrl)]);
  nhtsa.text_snapshot = 'nhtsa-hmi.txt';
  nhtsa.text_sha256 = createHash('sha256').update(await readFile(textUrl)).digest('hex');
}
await writeFile(new URL('captures.json', root), `${JSON.stringify(captures, null, 2)}\n`);
const snapshotFiles = captures.flatMap((item) => item.error ? [] : [
  [item.sha256, item.snapshot],
  ...(item.text_snapshot ? [[item.text_sha256, item.text_snapshot]] : []),
]);
await writeFile(new URL('snapshots.sha256', root), `${snapshotFiles.map(([hash, file]) => `${hash}  snapshots/${file}`).join('\n')}\n`);
console.log(captures.map(({ id, bytes, error }) => ({ id, bytes, error })));
