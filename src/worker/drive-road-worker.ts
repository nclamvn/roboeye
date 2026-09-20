import * as ort from 'onnxruntime-web/webgpu';
import { ROAD_MODEL, roadInput, roadLabels } from '../drive/road-runtime';
import { vectorizeRoadMaskV2 } from '../drive/road-vectorizer';

const base = new URL(import.meta.env.BASE_URL, self.location.href).href;
ort.env.wasm.wasmPaths = `${base}ort/`;
ort.env.wasm.numThreads = 1;
let session: ort.InferenceSession | null = null, busy = false;
const post = (message: Record<string, unknown>, transfer: Transferable[] = []) => self.postMessage(message, { transfer });
self.onmessage = async ({ data: m }) => {
  if (busy) { post({ type: 'error', message: 'Worker làn đang bận.' }); return; }
  busy = true;
  try {
    if (m.type === 'init') {
      if (!import.meta.env.DEV) throw Error('Model nghiên cứu chỉ dùng trong UI local.');
      const response = await fetch(`${base}__local-road/model.onnx`, { credentials: 'omit' });
      if (!response.ok) throw Error('Thiếu model local. Chạy npm run fixtures:road-ui -- /đường/dẫn/model.onnx rồi Thử lại.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== ROAD_MODEL.bytes) throw Error('Model làn sai kích thước.');
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
      if (hash !== ROAD_MODEL.sha256) throw Error('Model làn sai SHA-256.');
      // WASM is the verified backend for this converted, compact model.
      session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      if (session.inputNames.join(',') !== ROAD_MODEL.input || session.outputNames.join(',') !== ROAD_MODEL.output) throw Error('Sai contract model làn.');
      post({ type: 'ready' });
    } else if (m.type === 'frame') {
      if (!session) throw Error('Model làn chưa sẵn sàng.');
      const start = performance.now(), { width, height } = ROAD_MODEL, pixels = width * height;
      const input = new ort.Tensor('float32', roadInput(new Uint8ClampedArray(m.rgba), pixels), [1, 3, height, width]);
      let outputs: ort.InferenceSession.OnnxValueMapType | undefined;
      try {
        const inferStart=performance.now();
        outputs = await session.run({ [ROAD_MODEL.input]: input });
        const inferenceMs=performance.now()-inferStart;
        const output = outputs[ROAD_MODEL.output];
        if (output.type !== 'float32' || output.dims.join(',') !== `1,4,${height},${width}`) throw Error('Sai output model làn.');
        const labels = roadLabels(output.data as Float32Array, pixels);
        const vectorStart=performance.now(), vector = vectorizeRoadMaskV2(labels, width, height);
        const vectorMs=performance.now()-vectorStart;
        // Display actual pixels, not a hull that incorrectly fills over vehicles.
        const mw = width / 4, mh = height / 4, mask = new Uint8ClampedArray(mw * mh * 4);
        for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
          const label = labels[(y * 4 + 2) * width + x * 4 + 2], p = (y * mw + x) * 4;
          if (label === 1) mask.set([83, 211, 183, 42], p);
          else if (label === 2) mask.set([235, 191, 114, 155], p);
          else if (label === 3) mask.set([236, 250, 253, 135], p);
        }
        post({ type: 'result', id: m.id, vector, inferenceMs, vectorMs, latencyMs: performance.now() - start, mask: mask.buffer }, [mask.buffer]);
      } finally {
        input.dispose();
        if (outputs) for (const output of Object.values(outputs)) output.dispose();
      }
    } else throw Error('Thông điệp làn không hợp lệ.');
  } catch (error) { post({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  finally { busy = false; }
};
