import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const output = resolve(process.argv[2] ?? resolve(ROOT, 'tests/.road-cache/openvino/FP16'));
const files = [
  {
    name: 'road-segmentation-adas-0001.xml', bytes: 554615,
    sha256: 'f22818f4f0bf6c305ef39b06ae275ecf522b4ed156d6fd8529f2c09bc996739b',
    url: 'https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1/road-segmentation-adas-0001/FP16/road-segmentation-adas-0001.xml',
  },
  {
    name: 'road-segmentation-adas-0001.bin', bytes: 368616,
    sha256: '58c57ee0a9b72ee9c76b0fd898ee6608bcc299c5d8d0af90a5d59d4df9e79317',
    url: 'https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1/road-segmentation-adas-0001/FP16/road-segmentation-adas-0001.bin',
  },
];

await mkdir(output, { recursive: true });
for (const file of files) {
  const response = await fetch(file.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${file.name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== file.bytes || sha256 !== file.sha256) throw new Error(`${file.name}: nguồn không khớp contract`);
  await writeFile(resolve(output, file.name), bytes, { flag: 'wx' });
  console.log(`Fetched ${file.name} (${bytes.length} bytes, SHA-256 ${sha256})`);
}
