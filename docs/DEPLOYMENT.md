# RoboEye 1.2 Deployment and Release Runbook

## Supported runtime

- Build: Node 20.19+ and `npm ci`.
- Browser: current Chrome or Edge with camera permission.
- Origin: HTTPS in production; localhost is accepted for local verification.
- Product version source of truth: `package.json`; build emits matching `dist/release.json`.

## Online static release

```bash
npm ci
npm run qa
npm run smoke
npm run release:verify
```

Deploy the resulting `dist/` directory. Online mode downloads requested depth or detection models from Hugging Face and uses browser-local cache afterward.

Detection uses pinned q8 model revisions on WASM by default. The release workflow
must initialize and run one real inference for both RT-DETR and OWL-ViT before it
may upload the Pages artifact. `?detectwebgpu=1` is an explicit experimental path,
not the production default.

For a sub-path host, set the public base before building:

```bash
ROBOEYE_BASE=/roboeye/ ROBOEYE_COMMIT=<git-sha> npm run build
node scripts/verify-release.mjs
```

## Offline depth release

```bash
npm run build:offline
npm run preview
```

The command verifies the committed depth fixture manifest, builds with offline mode enabled and stages q8 files under `dist/models/onnx-community/depth-anything-v2-small/`. `dist/offline.json` records the exact revision and checksums. The artifact forces WASM q8 and disables detection because detection model snapshots are not included.

Serve the folder from localhost or HTTPS; opening `index.html` directly with `file://` cannot provide camera/service-worker behavior.

## GitHub Pages HTTPS

1. Push the repository and open **Settings → Pages**.
2. Choose **GitHub Actions** as the source.
3. Run **Release and Pages** manually for a candidate, or push a matching tag such as `v1.2.0`.
4. The workflow validates QA and real-depth smoke, builds with `/<repository>/` base, uploads the Pages artifact and deploys it.
5. A `v*` tag also creates a GitHub Release containing the versioned static archive.

These account/repository mutations are intentionally not automated from the local project session.

## Security headers

- Netlify/Cloudflare Pages-style hosts can consume `dist/_headers`.
- Vercel uses the repository `vercel.json`.
- GitHub Pages ignores `_headers`; the meta CSP still applies, but response-only policies such as `frame-ancestors` and `Permissions-Policy` need a supporting host or reverse proxy.
- Camera is restricted to the same origin where response headers are supported; microphone, geolocation, payment and USB are disabled.

## Service worker and rollback

- Each app version uses a `roboeye-app-<version>` cache. Activation deletes older RoboEye app-shell caches.
- Same-origin assets and packaged models are runtime-cached; remote Hugging Face requests remain under Transformers.js/browser cache behavior.
- Roll back by redeploying a previously verified `dist` archive. Its service worker activates its own versioned cache.
- If testing multiple builds with the same version, use DevTools **Application → Service Workers → Update** or unregister before visual comparison.

## Diagnostics and incident handoff

Ask the operator to click **Xuất chẩn đoán** and attach the JSON. It contains app version/commit, online state and bounded operational events only. It never contains camera pixels, detection labels or query text and is never uploaded automatically.
