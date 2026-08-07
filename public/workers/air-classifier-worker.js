/* RoboEye T17 · classic worker required by the TFLite WASM importScripts loader. */
let classifier = null;
let labels = [];
let busy = false;
let topK = 5;

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function fetchPinned(url, expectedBytes, expectedSha256, name) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} khi tải ${name}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== expectedBytes) throw new Error(`${name} sai kích thước: ${bytes.byteLength}/${expectedBytes}`);
    const digest = await sha256Hex(bytes);
    if (digest !== expectedSha256) throw new Error(`${name} sai SHA-256: ${digest}`);
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

async function init(message) {
  try {
    importScripts(
      `${message.tfliteBase}tf-core.min.js`,
      `${message.tfliteBase}tf-backend-cpu.min.js`,
      `${message.tfliteBase}tf-tflite.min.js`
    );
    tflite.setWasmPath(message.tfliteBase);
    await tf.setBackend('cpu');
    await tf.ready();
    postMessage({ type: 'progress', progress: 5 });
    const [modelBytes, labelBytes] = await Promise.all([
      fetchPinned(message.modelUrl, message.expectedBytes, message.expectedSha256, 'model QuickDraw'),
      fetchPinned(message.labelsUrl, message.expectedLabelsBytes, message.expectedLabelsSha256, 'nhãn QuickDraw')
    ]);
    labels = new TextDecoder().decode(labelBytes).trim().split('\n');
    if (labels.length !== 345) throw new Error(`Danh sách nhãn phải có 345 lớp, nhận ${labels.length}`);
    topK = message.topK;
    postMessage({ type: 'progress', progress: 85 });
    classifier = await tflite.loadTFLiteModel(modelBytes.buffer, { numThreads: 1 });
    // TFLite lazily prepares kernels on the first predict. Consume that result
    // internally so the user's first completed drawing is a real inference.
    const warmupInput = tf.zeros([1, 28, 28, 1]);
    const warmupOutput = classifier.predict(warmupInput);
    await warmupOutput.data();
    warmupInput.dispose();
    warmupOutput.dispose();
    postMessage({ type: 'ready', device: 'wasm' });
  } catch (error) {
    console.error('[airsketch-classifier:init]', error);
    postMessage({ type: 'error', stage: 'load', message: error instanceof Error ? error.message : String(error) });
  }
}

async function classify(message) {
  if (!classifier || busy) return;
  busy = true;
  const startedAt = performance.now();
  let input = null;
  let output = null;
  try {
    const rgba = new Uint8ClampedArray(message.rgba);
    const pixels = new Float32Array(message.width * message.height);
    for (let i = 0; i < pixels.length; i++) pixels[i] = rgba[i * 4] / 255;
    input = tf.tensor4d(pixels, [1, message.height, message.width, 1]);
    output = classifier.predict(input);
    const scores = await output.data();
    const predictions = Array.from(scores, (score, index) => ({ label: labels[index], score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    postMessage({ type: 'prediction', predictions, inferMs: performance.now() - startedAt, revision: message.revision });
  } catch (error) {
    console.error('[airsketch-classifier:infer]', error);
    postMessage({ type: 'error', stage: 'infer', message: error instanceof Error ? error.message : String(error), revision: message.revision });
  } finally {
    input?.dispose();
    output?.dispose();
    busy = false;
  }
}

self.onmessage = (event) => {
  if (event.data.type === 'init') void init(event.data);
  else void classify(event.data);
};
