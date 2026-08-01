import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500
  },
  worker: {
    format: 'es'
  },
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  }
});
