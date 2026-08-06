export function installMockWorkers() {
  window.__allowMockDetection = false;
  window.__failMockDepthLoadOnce = false;
  window.__failMockDetectionLoadOnce = false;
  window.__lastDetectionInit = null;
  window.__lastDetectionFrame = null;
  window.__detectionInitCount = 0;
  window.__lastAirClassify = null;

  class MockWorker {
    constructor(url) {
      const workerUrl = String(url);
      this.kind = workerUrl.includes('detect-worker') ? 'detection'
        : workerUrl.includes('air-hand-worker') ? 'air-hand'
          : workerUrl.includes('air-classifier-worker') ? 'air-classifier'
            : 'depth';
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
      if (this.kind === 'air-hand') {
        if (message.type === 'init') this.emit({ type: 'ready' });
        else if (message.type === 'frame') this.emit({ type: 'landmarks', landmarks: null, handedness: null, inferMs: 9 });
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
