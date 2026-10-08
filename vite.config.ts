import { defineConfig, type Plugin } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
function checkoutCommit() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('.', import.meta.url), encoding: 'utf8' }).trim(); }
  catch { return 'unavailable'; }
}
const commit = (process.env.ROBOEYE_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || checkoutCommit()).slice(0, 12);
const offlineBuild = process.env.ROBOEYE_OFFLINE === '1';

function publicTree(directory: URL, prefix: string): string[] {
  const files:string[]=[];
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const url=new URL(`${entry.name}${entry.isDirectory()?'/':''}`,directory);
    const path=`${prefix}/${entry.name}`;
    if(entry.isDirectory())files.push(...publicTree(url,path));
    else files.push(path);
  }
  return files;
}

const sharpaAssets=publicTree(new URL('./public/assets/sharpa-wave/',import.meta.url),'assets/sharpa-wave');

// Static workers and WASM runtimes are fetched outside Rollup's asset graph.
// Their filenames can stay unchanged between builds, so hashing only emitted
// JS/CSS would let a service worker keep an incompatible runtime cache. Fold
// their bytes into the cache identity without eagerly precaching the large
// WASM payloads on every normal page visit.
function publicRuntimeFingerprint(): string {
  const hash=createHash('sha256');
  const roots=[
    new URL('./public/workers/',import.meta.url),
    new URL('./public/mediapipe/',import.meta.url),
    new URL('./public/ort/',import.meta.url),
    new URL('./public/tflite/',import.meta.url)
  ];
  const visit=(directory:URL,prefix:string)=>{
    for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const url=new URL(`${entry.name}${entry.isDirectory()?'/':''}`,directory);
      const path=`${prefix}/${entry.name}`;
      if(entry.isDirectory())visit(url,path);
      else{
        hash.update(path);
        hash.update(readFileSync(url));
      }
    }
  };
  roots.forEach((root)=>visit(root,root.pathname.split('/').filter(Boolean).at(-1)??'runtime'));
  return hash.digest('hex').slice(0,12);
}

const runtimeFingerprint=publicRuntimeFingerprint();
// Inject into the running JS, not fetched from a potentially newer release.json.
// Identifies source + lockfile + runtime bytes, including uncommitted changes.
function sourceFingerprint() {
  const hash = createHash('sha256').update(runtimeFingerprint).update(commit)
    .update(process.env.ROBOEYE_BASE || '/').update(String(offlineBuild));
  for (const path of [...publicTree(new URL('./src/', import.meta.url), 'src'),
    'package-lock.json', 'vite.config.ts', 'drive.html', 'index.html'].sort()) {
    hash.update(path).update(readFileSync(new URL(path, import.meta.url)));
  }
  return hash.digest('hex');
}
const runningSourceFingerprint = sourceFingerprint();

// Research weights are explicitly local-only, never copied into a release.
function localRoadModel(): Plugin {
  return {
    name: 'local-road-research-model', apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `${server.config.base}__local-road/model.onnx`) return next();
        if (request.method !== 'GET') { response.writeHead(405).end(); return; }
        try {
          const bytes = readFileSync(new URL('./tests/.road-cache/road-segmentation-adas-0001.onnx', import.meta.url));
          response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
          response.end(bytes);
        } catch { response.writeHead(404).end('Local research model not staged.'); }
      });
    },
  };
}

function releaseArtifacts() {
  let base = '/';
  return {
    name: 'roboeye-release-artifacts',
    configResolved(config: { base: string }) {
      base = config.base.endsWith('/') ? config.base : `${config.base}/`;
    },
    generateBundle(_: unknown, bundle: Record<string, { fileName: string }>) {
      const precache = [base, `${base}manifest.webmanifest`, `${base}icons/roboeye.svg`,
        ...sharpaAssets.map(path=>`${base}${path}`),...Object.values(bundle)
        .map((item) => `${base}${item.fileName}`)
        .filter((path) => !path.endsWith('.map'))];
      // Package version does not change on every TIP build. Fingerprint the
      // generated filenames so a same-version deploy can never reuse stale JS.
      const buildFingerprint=createHash('sha256')
        .update(precache.slice().sort().join('\n'))
        .update(runtimeFingerprint)
        .digest('hex').slice(0,12);
      const sw = `const VERSION=${JSON.stringify(pkg.version)};
const CACHE='roboeye-app-'+VERSION+'-'+${JSON.stringify(buildFingerprint)}+${JSON.stringify(offlineBuild ? '-offline' : '')};
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
        source: JSON.stringify({ name: 'roboeye', version: pkg.version, commit, base, offlineDepth: offlineBuild,
          buildFingerprint, sourceFingerprint: runningSourceFingerprint, runtimeFingerprint }, null, 2)
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
    __ROBOEYE_SOURCE_FINGERPRINT__: JSON.stringify(runningSourceFingerprint),
    __ROBOEYE_OFFLINE__: JSON.stringify(offlineBuild)
  },
  plugins: [releaseArtifacts(), localRoadModel()],
  build: {
    rollupOptions: { input: { index: 'index.html', drive: 'drive.html' } },
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
