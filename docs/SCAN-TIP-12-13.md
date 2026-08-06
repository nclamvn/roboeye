# SCAN REPORT — TIP-12/13 Production and Release

Date: 06/08/2026

## TECH STACK

- Language: TypeScript strict, ES2022; Node scripts in ESM.
- Framework: Vite 7 static SPA, DOM APIs, Web Workers.
- Perception: Transformers.js 3, ONNX Runtime Web, Three.js 0.185.
- Styling: one HIVE dark editorial CSS system; no component framework.
- State/data: in-memory runtime state; no server, database, auth or remote telemetry.
- Tests: Node test runner through `tsx`, Playwright-core browser E2E, real q8 smoke.

## EXISTING MODULES AND PATTERNS

- `src/main.ts`: camera, depth/detection workers and render orchestration.
- `src/ui/shell.ts`: all DOM interaction and presentation state.
- `src/worker/*`: latest-frame-wins model inference with WebGPU to WASM fallback.
- `scripts/security-audit.mjs`: fail-closed accepted-risk security policy.
- `scripts/prepare-test-models.mjs`: pinned q8 depth fixture with byte/SHA-256 verification.
- `tests/detection-e2e.mjs`: deterministic mock-worker application contract.
- `tests/smoke.mjs`: real depth q8 inference in a browser.

## GAPS DETECTED

- No CI/CD, GitHub Pages deployment or tagged-release workflow.
- No CSP/permissions/static-host security header contract.
- No service worker or versioned application-shell cache.
- Offline model preparation is a test fixture procedure, not a release command.
- Runtime errors are logged or shown only in boot/object status; depth inference error can leave main-thread busy state stuck.
- No bounded local diagnostics export for field troubleshooting.
- No product version in the UI or machine-readable build metadata.
- Boot screen has one start action but no guided first-run/demo journey.
- Desktop fixed sidebar has no mobile layout.
- No browser acceptance lane for version, onboarding, responsive layout, diagnostics or offline reload.

## CODE HEALTH

- Type safety: strict; no current TypeScript errors.
- Unit tests: 12 passing before TIP-12/13.
- Browser tests: detection contract 13 checks; real-depth smoke 14 checks.
- Security: 0 critical, 2 accepted high entries under TIP-09 policy until 06/09/2026.
- Product TODO/FIXME: 0.
- Estimated implementation surface: 37 source/script/test files, about 3,040 lines before this cycle.

## CONTRACTOR DECISIONS

- Treat the user's instruction to implement TIP-12/13 as approval of the previously proposed production/release direction; no additional blueprint checkpoint is needed.
- Keep RoboEye serverless and privacy-local. Diagnostics are bounded local records and never transmit.
- Package only the pinned depth q8 model in the offline release. Full detection snapshots remain excluded until live-model acceptance establishes their size/performance contract.
- GitHub Pages is the default HTTPS route; portable static-host headers are also supplied for hosts that support them.
- Preserve the HIVE monochrome identity. The onboarding signature is a real four-stage perception rail, not decorative generic feature cards.
