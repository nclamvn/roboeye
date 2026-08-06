import { defineConfig } from 'vite';

export default defineConfig({
  // Cho phép build dưới sub-path, ví dụ GitHub Pages: ROBOEYE_BASE=/roboeye/ npm run build
  base: process.env.ROBOEYE_BASE || '/',
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
