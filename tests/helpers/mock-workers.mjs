export function installMockWorkers() {
  window.__allowMockDetection = false;
  window.__failMockDepthLoadOnce = false;
  window.__failMockDetectionLoadOnce = false;
  window.__lastDetectionInit = null;
  window.__detectionInitCount = 0;

  class MockWorker {
    constructor(url) {
      this.kind = String(url).includes('detect-worker') ? 'detection' : 'depth';
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
      } else if (message.type === 'frame') {
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
