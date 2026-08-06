# Security · RoboEye

Last reviewed: 06/08/2026

## Current finding

`npm audit` reports two high entries that collapse to one reviewed advisory: `GHSA-f88m-g3jw-g9cj` in `sharp <0.35.0`, inherited through `@huggingface/transformers 3.8.1 → sharp 0.34.5`.

The advisory states that systems processing untrusted input with affected sharp versions are exposed. The patched sharp line is 0.35.x. At review time, the current Transformers.js package still declares sharp 0.34.x, so npm reports no supported automatic fix.

Primary evidence:

- GitHub reviewed advisory: https://github.com/advisories/GHSA-f88m-g3jw-g9cj
- Transformers.js repository: https://github.com/huggingface/transformers.js
- Sharp repository: https://github.com/lovell/sharp

## RoboEye exposure assessment

RoboEye is a static browser application, not a Node image-processing service:

- Transformers.js exposes separate conditional entries for Node and browser.
- Vite selects `dist/transformers.web.js`; sharp is ignored in that web build.
- RoboEye creates `RawImage` from browser-owned RGBA buffers.
- The production `dist/` contains no `sharp`, `libvips`, native addon or `VipsForeignLoad` marker.
- Application source does not import sharp.

Therefore the known exploit precondition—vulnerable sharp processing untrusted input—is not present in the deployed browser artifact. The vulnerable transitive package is still installed in the local Node dependency tree, so this is an **accepted risk**, not a fix.

## Decision

Do not force `sharp 0.35.x` outside the Transformers.js supported range and do not upgrade the ML stack major solely to suppress the audit output. Either action would create an unverified compatibility/Node-version change without removing sharp from the upstream dependency declaration.

Accepted-risk record: `security/accepted-risks.json`.

- Review deadline: **06/09/2026**.
- Acceptance becomes invalid if RoboEye adds server-side/CLI image processing, imports sharp, or ships a bundle containing sharp/libvips markers.
- Re-review immediately when Transformers.js publishes a release that supports patched sharp.

## Security gate

Run after a production build:

```bash
npm run build
npm run security:audit
```

The gate fails when:

- an unexpected high/critical advisory appears;
- the accepted risk expires while still observed;
- the advisory/package/severity no longer matches the reviewed record;
- Transformers.js changes its conditional browser export;
- application source imports sharp;
- sharp/libvips/native markers enter the deployed JavaScript.

The gate prints `PASS` only when all conditions remain true. It continues to print the accepted advisory and its review deadline.

## Browser and release controls (v1.2.0)

- `index.html` carries a CSP that limits scripts/workers/assets to the static app plus the approved Hugging Face model origins.
- `_headers` and `vercel.json` define CSP, `camera=(self)`, disabled microphone/geolocation/payment/USB, no sniffing and frame denial for supporting static hosts.
- GitHub Pages does not apply repository `_headers`; the HTML CSP remains active there, while `frame-ancestors` and `Permissions-Policy` require a host with response-header support.
- The service worker only intercepts GET requests on RoboEye's own origin. It does not proxy or cache remote telemetry.
- Runtime diagnostics are bounded to 80 local events, sanitize values to primitives and exclude camera buffers, object labels and detection query text. Export requires a user click.
- Offline release contains the pinned depth q8 model only. Detection remains disabled because no approved offline detection manifest exists.
