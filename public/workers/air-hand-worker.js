/* RoboEye T16 · classic worker required by MediaPipe's importScripts loader. */
let landmarker = null;
let busy = false;
let activeDelegate = 'CPU';
let createLandmarker = null;
let switchingDelegate = false;
let gpuFallbackAttempted = false;
let gpuSlowSamples = 0;
let gpuFallbackInferMs = 120;
let gpuFallbackSlowSamples = 2;

async function fallbackToCpu() {
  if (switchingDelegate || gpuFallbackAttempted || activeDelegate !== 'GPU' || !createLandmarker) return;
  switchingDelegate = true;
  gpuFallbackAttempted = true;
  const previous = landmarker;
  try {
    const replacement = await createLandmarker('CPU');
    landmarker = replacement;
    activeDelegate = 'CPU';
    previous?.close?.();
  } catch {
    // A slow but working GPU graph is safer than disabling tracking if the CPU
    // graph cannot be created on this browser.
    landmarker = previous;
  } finally {
    switchingDelegate = false;
    postMessage({ type: 'ready', delegate: activeDelegate });
  }
}

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
    createLandmarker = (delegate) => self.Vision.HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    gpuFallbackInferMs = Number.isFinite(message.gpuFallbackInferMs) ? message.gpuFallbackInferMs : 120;
    gpuFallbackSlowSamples = Number.isFinite(message.gpuFallbackSlowSamples) ? message.gpuFallbackSlowSamples : 2;
    const preferred = message.preferredDelegate === 'CPU' ? 'CPU' : 'GPU';
    try {
      landmarker = await createLandmarker(preferred);
      activeDelegate = preferred;
    } catch (preferredError) {
      if (preferred === 'CPU') throw preferredError;
      // Official MediaPipe web samples expose both delegates. GPU support in a
      // classic worker still varies by browser/driver, so failure is explicit
      // and recoverable rather than turning into a broken interaction mode.
      postMessage({ type: 'loading', stage: 'graph' });
      landmarker = await createLandmarker('CPU');
      activeDelegate = 'CPU';
    }
    postMessage({ type: 'ready', delegate: activeDelegate });
  } catch (error) {
    postMessage({ type: 'error', stage: 'load', message: error instanceof Error ? error.message : String(error) });
  }
}

function infer(message) {
  const bitmap = message.bitmap;
  if (!landmarker || busy || switchingDelegate) {
    bitmap.close();
    return;
  }
  busy = true;
  const startedAt = performance.now();
  try {
    const result = landmarker.detectForVideo(bitmap, message.timestamp);
    const landmarks = result.landmarks[0]?.map((point) => ({ x: point.x, y: point.y, z: point.z })) ?? null;
    const handedness = result.handedness[0]?.[0]?.categoryName ?? null;
    const inferMs = performance.now() - startedAt;
    if (activeDelegate === 'GPU' && !gpuFallbackAttempted) {
      gpuSlowSamples = inferMs >= gpuFallbackInferMs ? gpuSlowSamples + 1 : 0;
    }
    const shouldFallback = activeDelegate === 'GPU' && !gpuFallbackAttempted && gpuSlowSamples >= gpuFallbackSlowSamples;
    // Stop main-thread capture before acknowledging this result. The result
    // still clears latest-frame-wins busy state; the next ready message resumes
    // capture with the measured faster delegate.
    if (shouldFallback) postMessage({ type: 'loading', stage: 'graph' });
    postMessage({
      type: 'landmarks',
      landmarks,
      handedness,
      inferMs,
      // Preserve the frame time so the main thread can compensate the worker
      // transit/inference gap before drawing the cursor and ink.
      capturedAt: message.capturedAt ?? message.timestamp,
      captureStartedAt: message.captureStartedAt,
      sentAt: message.sentAt,
      delegate: activeDelegate
    });
    if (shouldFallback) void fallbackToCpu();
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
