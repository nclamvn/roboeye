/* RoboEye T16 · classic worker required by MediaPipe's importScripts loader. */
let landmarker = null;
let busy = false;

async function init(message) {
  try {
    postMessage({ type: 'loading', stage: 'runtime' });
    importScripts(message.visionBundleUrl);
    if (!self.Vision) throw new Error('MediaPipe Vision bundle không tạo global Vision');
    const vision = await self.Vision.FilesetResolver.forVisionTasks(message.wasmBase);

    postMessage({ type: 'loading', stage: 'model' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    const response = await fetch(message.modelUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status} khi tải hand model`);
    const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
    if (modelAssetBuffer.byteLength !== message.expectedBytes) {
      throw new Error(`Hand model sai kích thước: ${modelAssetBuffer.byteLength}/${message.expectedBytes}`);
    }
    const digest = await crypto.subtle.digest('SHA-256', modelAssetBuffer);
    const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    if (sha256 !== message.expectedSha256) {
      throw new Error(`Hand model sai SHA-256: ${sha256}`);
    }

    postMessage({ type: 'loading', stage: 'graph' });
    landmarker = await self.Vision.HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.55
    });
    postMessage({ type: 'ready' });
  } catch (error) {
    postMessage({ type: 'error', stage: 'load', message: error instanceof Error ? error.message : String(error) });
  }
}

function infer(message) {
  const bitmap = message.bitmap;
  if (!landmarker || busy) {
    bitmap.close();
    return;
  }
  busy = true;
  const startedAt = performance.now();
  try {
    const result = landmarker.detectForVideo(bitmap, message.timestamp);
    const landmarks = result.landmarks[0]?.map((point) => ({ x: point.x, y: point.y, z: point.z })) ?? null;
    const handedness = result.handedness[0]?.[0]?.categoryName ?? null;
    postMessage({
      type: 'landmarks',
      landmarks,
      handedness,
      inferMs: performance.now() - startedAt,
      // Preserve the frame time so the main thread can compensate the worker
      // transit/inference gap before drawing the cursor and ink.
      capturedAt: message.timestamp
    });
  } catch (error) {
    postMessage({ type: 'error', stage: 'infer', message: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap.close();
    busy = false;
  }
}

self.onmessage = (event) => {
  if (event.data.type === 'init') void init(event.data);
  else infer(event.data);
};
