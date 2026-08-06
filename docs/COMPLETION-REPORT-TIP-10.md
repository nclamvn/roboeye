# COMPLETION REPORT — TIP-10

**STATUS:** DONE

## FILES CHANGED

- Added `tests/fixtures/depth-q8.manifest.json`: exact Hugging Face revision, byte size and SHA-256 for the real depth q8 fixture.
- Added `scripts/prepare-test-models.mjs`: atomic, idempotent download and verify-only cache gate.
- Added `tests/helpers/browser.mjs`: browser discovery through env override, Playwright cache and common macOS/Linux paths.
- Added `tests/detection-e2e.mjs`: deterministic browser contract test for detection wiring and annotation workflow.
- Modified `tests/smoke.mjs`: portable browser resolution; preserved real q8 inference lane.
- Modified `package.json`: fixture, detection E2E and automatic presmoke commands.
- Fixed `src/styles.css`: detection label tools now remain hidden before opt-in.
- Fixed `src/ui/shell.ts`: double-click relabel no longer loses its target after the first click.
- Updated `README.md` and `docs/VERIFY.md`: reproducible operator commands and honest lane boundaries.

## TEST RESULTS

- REQ-Q01: PASS — three required model files pin revision `4472b7362082ad9968fee890ca0f1e5aca36b93d`, byte size and SHA-256.
- REQ-Q02: PASS — clean prepare downloaded and verified 3 files; repeat prepare downloaded 0; corrupted `config.json` failed verify-only.
- REQ-Q03: PASS — `npm run smoke` ran `presmoke` automatically, verified all three fixture files and rebuilt `dist`.
- REQ-Q04: PASS — local Playwright Chromium was discovered without a hard-coded container path.
- REQ-Q05: PASS — detection contract E2E passed 13 checks.
- REQ-Q06: PASS — command, source and output explicitly label the lane as mock contract, not model-quality evidence.
- REQ-Q07: PASS — typecheck, unit, security, build, detection E2E and real-depth smoke are reported separately.

## ISSUES DISCOVERED AND FIXED

- P1: author CSS overrode the `hidden` attribute, exposing label tools before detection opt-in.
- P1: object selection re-rendered a label after the first click, preventing the documented double-click relabel action.

## DEVIATIONS FROM SPEC

- None. Model binaries remain ignored and were not committed.

## SUGGESTIONS FOR CHỦ THẦU

- Accept TIP-10 as READY.
- Keep the mock detection lane fast and deterministic; use a separate future lane for live detection-model compatibility and performance.
