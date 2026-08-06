import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const commit = (process.env.ROBOEYE_COMMIT || process.env.GITHUB_SHA || 'local').slice(0, 12);
const offlineBuild = process.env.ROBOEYE_OFFLINE === '1';

function releaseArtifacts() {
  let base = '/';
  return {
    name: 'roboeye-release-artifacts',
    configResolved(config: { base: string }) {
      base = config.base.endsWith('/') ? config.base : `${config.base}/`;
    },
    generateBundle(_: unknown, bundle: Record<string, { fileName: string }>) {
      const precache = [base, `${base}manifest.webmanifest`, `${base}icons/roboeye.svg`, ...Object.values(bundle)
        .map((item) => `${base}${item.fileName}`)
        .filter((path) => !path.endsWith('.map'))];
      const sw = `const VERSION=${JSON.stringify(pkg.version)};
const CACHE='roboeye-app-'+VERSION+${JSON.stringify(offlineBuild ? '-offline' : '')};
const PRECACHE=${JSON.stringify(precache)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('roboeye-app-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{if(!response.ok)throw new Error('navigation network failed');const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));return response;}).catch(()=>caches.match(request,{ignoreSearch:true,ignoreVary:true}).then(hit=>hit||caches.match(${JSON.stringify(base)},{ignoreSearch:true,ignoreVary:true}))));
    return;
  }
  event.respondWith(caches.match(request,{ignoreVary:true}).then(hit=>hit||fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;})));
});`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
      this.emitFile({
        type: 'asset',
        fileName: 'release.json',
        source: JSON.stringify({ name: 'roboeye', version: pkg.version, commit, base, offlineDepth: offlineBuild }, null, 2)
      });
    }
  };
}

export default defineConfig({
  // Cho phép build dưới sub-path, ví dụ GitHub Pages: ROBOEYE_BASE=/roboeye/ npm run build
  base: process.env.ROBOEYE_BASE || '/',
  define: {
    __ROBOEYE_VERSION__: JSON.stringify(pkg.version),
    __ROBOEYE_COMMIT__: JSON.stringify(commit),
    __ROBOEYE_OFFLINE__: JSON.stringify(offlineBuild)
  },
  plugins: [releaseArtifacts()],
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
