# COMPLETION REPORT — TIP-12 Production Hardening

**STATUS:** DONE

## FILES CHANGED

- Added `.github/workflows/ci.yml`: PR/main quality lane and separate main/scheduled real-depth smoke.
- Added `src/depth-state.ts` and depth error stages: deterministic load versus inference recovery.
- Added `src/runtime-diagnostics.ts`: sanitized, bounded, local-only operational events.
- Added generated release/service-worker plugin in `vite.config.ts`.
- Added `public/_headers`, `vercel.json`, HTML CSP and restricted permissions policy contract.
- Added diagnostics/network/retry UI across `index.html`, `src/ui/shell.ts` and `src/main.ts`.
- Added unit tests for recovery and diagnostics plus release browser coverage.

## TEST RESULTS

- REQ-P01: PASS — CI definition includes Node 20, browser install, type, unit, security, build and both browser contracts.
- REQ-P02: PASS — real-depth smoke is isolated from PRs and runs on main, manual dispatch and weekly schedule.
- REQ-P03: PASS — normal artifact verifier found CSP, camera self-policy and disabled microphone/geolocation/payment/USB.
- REQ-P04: PASS — service worker precached hashed JS/CSS and served a new tab after the static server stopped.
- REQ-P05: PASS — unit/browser tests proved 80-event bound, primitive sanitization, local-only marker and click-to-download.
- REQ-P06: PASS — load failure exposes retry; inference recovery releases busy and remains ready.
- REQ-P07: PASS — 15/15 unit, 20/20 release browser, 14/14 real-depth smoke.

## ISSUES DISCOVERED

- P0 fixed: depth inference errors previously left `workerBusy=true`, freezing all later depth frames.
- P1 fixed: Vite's `Vary: Origin` made precached cross-origin-mode JS/CSS miss on offline navigation; same-origin cache matching now explicitly ignores `Vary` while preserving origin isolation.

## DEVIATIONS FROM SPEC

- None.

## SUGGESTIONS FOR CHỦ THẦU

- Keep GitHub Actions pinned to official actions and review their major versions during each release cycle.
- Review the existing TIP-09 accepted dependency risk before 06/09/2026.
