export function installMockWorkers() {
  window.__allowMockDetection = false;
  window.__failMockDepthLoadOnce = false;
  window.__failMockDetectionLoadOnce = false;
  window.__lastDetectionInit = null;
  window.__detectionInits = [];
  window.__lastDetectionFrame = null;
  window.__detectionInitCount = 0;
  window.__lastAirClassify = null;
  // E2E can queue deterministic MediaPipe-shaped hand landmarks.  A frame is
  // consumed only when the application asks the hand worker to infer, so this
  // exercises the real main-thread landmark integration rather than a helper.
  window.__mockAirHandFrames = [];
  window.__mockWorkerKinds = [];

  const centeredRoadVector = {
    lines: [
      { id: 'mock-ego-left', class: 'lane-marking', role: 'ego-left', points: [
        { x: .46, y: .45 }, { x: .40, y: .65 }, { x: .34, y: .82 }, { x: .28, y: .98 }
      ] },
      { id: 'mock-ego-right', class: 'lane-marking', role: 'ego-right', points: [
        { x: .54, y: .45 }, { x: .60, y: .65 }, { x: .66, y: .82 }, { x: .72, y: .98 }
      ] }
    ],
    areas: [{ id: 'mock-drivable', class: 'drivable', points: [
      { x: .46, y: .45 }, { x: .54, y: .45 }, { x: .72, y: .98 }, { x: .28, y: .98 }
    ] }],
    diagnostics: {
      vectorizerVersion: 2, roadRows: 80, markRows: 48, horizonY: .42,
      paths: {
        left: { accepted: true, reason: 'accepted', supportRows: 24, span: .53, rmsPx: 1.2, confidence: .94 },
        right: { accepted: true, reason: 'accepted', supportRows: 24, span: .53, rmsPx: 1.2, confidence: .94 }
      }
    }
  };

  class MockWorker {
    constructor(url) {
      const workerUrl = String(url);
      this.kind = workerUrl.includes('drive-road-worker') ? 'drive-road'
        : workerUrl.includes('drive-range-worker') ? 'drive-range'
          : workerUrl.includes('detect-worker') ? 'detection'
            : workerUrl.includes('air-hand-worker') ? 'air-hand'
          : workerUrl.includes('air-classifier-worker') ? 'air-classifier'
            : 'depth';
      window.__mockWorkerKinds.push(this.kind);
      this.onmessage = null;
      this.onerror = null;
      this.terminated = false;
      this.engine = 'rtdetr';
    }

    emit(data, delay = 0) {
      setTimeout(() => {
        if (!this.terminated) this.onmessage?.({ data });
      }, delay);
    }

    postMessage(message) {
      if (this.terminated) return;
      if (this.kind === 'drive-road') {
        if (message.type === 'init') this.emit({ type: 'ready' });
        else if (message.type === 'frame') {
          this.emit({
            type: 'result', id: message.id, vector: centeredRoadVector,
            inferenceMs: 4, vectorMs: 1,
            mask: new Uint8ClampedArray(224 * 128 * 4).buffer
          });
        }
        return;
      }
      if (this.kind === 'drive-range') {
        if (message.type === 'init') {
          this.emit({ channel: 'drive-range-v1', type: 'ready', backend: message.backend, warmupMs: 1 });
        } else if (message.type === 'frame') {
          const depth = new Float32Array(message.width * message.height).fill(30);
          this.emit({
            channel: 'drive-range-v1', type: 'result', id: message.id, latencyMs: 5,
            map: { width: message.width, height: message.height, depth,
              unit: 'metres', distanceKind: 'optical-axis-z', provenance: 'learned-unverified',
              focal: null, shift: null, reprojectionRmse: null }
          });
        }
        return;
      }
      if (this.kind === 'air-hand') {
        if (message.type === 'init') this.emit({ type: 'ready', delegate: 'CPU' });
        else if (message.type === 'frame') {
          const landmarks = window.__mockAirHandFrames.shift() ?? null;
          const worldLandmarks = landmarks?.map((point) => ({
            x: (point.x - 0.5) * 0.18,
            y: (point.y - 0.72) * 0.18,
            z: point.z * 0.18
          })) ?? null;
          this.emit({
            type: 'landmarks',
            landmarks,
            worldLandmarks,
            handedness: landmarks ? 'Right' : null,
            handednessScore: landmarks ? 0.99 : 0,
            inferMs: 9,
            capturedAt: message.capturedAt ?? message.timestamp,
            captureStartedAt: message.captureStartedAt,
            sentAt: message.sentAt,
            delegate: 'CPU'
          });
        }
        return;
      }
      if (this.kind === 'air-classifier') {
        if (message.type === 'init') this.emit({ type: 'ready', device: 'wasm' }, 5);
        else if (message.type === 'classify') {
          window.__lastAirClassify = { width: message.width, height: message.height, bytes: message.rgba.byteLength };
          this.emit({
            type: 'prediction',
            revision: message.revision,
            inferMs: 42,
            predictions: [
              { label: 'house', score: 0.91 },
              { label: 'tree', score: 0.06 },
              { label: 'car', score: 0.03 }
            ]
          }, 8);
        }
        return;
      }
      if (this.kind === 'depth') {
        if (message.type === 'init') {
          if (window.__failMockDepthLoadOnce) {
            window.__failMockDepthLoadOnce = false;
            this.emit({ type: 'error', stage: 'load', message: 'fixture depth load error' });
          } else {
            this.emit({ type: 'ready', device: 'wasm', dtype: 'q8' });
          }
        } else if (message.type === 'frame') {
          const depth = new Uint8Array(message.width * message.height);
          for (let i = 0; i < depth.length; i++) depth[i] = i % 256;
          this.emit({
            type: 'depth',
            depth: depth.buffer,
            width: message.width,
            height: message.height,
            inferMs: 8
          });
        }
        return;
      }

      if (message.type === 'init') {
        window.__lastDetectionInit = message;
        window.__detectionInits.push(message);
        window.__detectionInitCount++;
        this.engine = message.engine;
        this.emit({ type: 'loading', engine: this.engine });
        if (window.__failMockDetectionLoadOnce) {
          window.__failMockDetectionLoadOnce = false;
          this.emit({ type: 'error', stage: 'load', message: 'fixture detection load error' }, 5);
          return;
        }
        this.emit({ type: 'ready', engine: this.engine, device: 'wasm' }, 5);
      } else if (message.type === 'engine') {
        this.engine = message.engine;
        this.emit({ type: 'loading', engine: this.engine });
        this.emit({ type: 'ready', engine: this.engine, device: 'wasm' }, 5);
      } else if (message.type === 'queries') {
        window.__lastDetectionQueries = message.value;
      } else if (message.type === 'frame') {
        window.__lastDetectionFrame = { width: message.width, height: message.height };
        if (!window.__allowMockDetection) {
          this.emit({ type: 'error', stage: 'infer', message: 'fixture infer error' });
        } else {
          this.emit({
            type: 'det',
            detMs: 12,
            capturedAt: message.capturedAt,
            boxes: [
              { label: 'person', score: 0.97, x0: 0.10, y0: 0.12, x1: 0.42, y1: 0.88 },
              { label: 'chair', score: 0.86, x0: 0.55, y0: 0.35, x1: 0.91, y1: 0.90 }
            ]
          });
        }
      }
    }

    terminate() {
      this.terminated = true;
    }

    addEventListener(type, callback) {
      if (type === 'message') this.onmessage = callback;
      if (type === 'error') this.onerror = callback;
    }

    removeEventListener(type, callback) {
      if (type === 'message' && this.onmessage === callback) this.onmessage = null;
      if (type === 'error' && this.onerror === callback) this.onerror = null;
    }
  }

  window.Worker = MockWorker;
}
