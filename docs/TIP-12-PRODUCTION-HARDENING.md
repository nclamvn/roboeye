# TIP-12 — Production Hardening

## HEADER

- Project: RoboEye Edge Perception Studio
- Depends on: TIP-09, TIP-10
- Priority: P0
- Working directory: `/Users/os/Downloads/roboeye`

## TASK

Add production gates and browser resilience while preserving the static, client-only architecture.

## ACCEPTANCE CRITERIA

- REQ-P01: A pull-request/main CI workflow installs a supported browser and runs typecheck, unit, security, build and browser contract tests.
- REQ-P02: A separate main/scheduled/manual job runs the pinned real-depth smoke.
- REQ-P03: The built artifact contains an explicit CSP and portable static-host security headers restricting camera to self and disabling unrelated powerful features.
- REQ-P04: A generated versioned service worker precaches the built app shell, removes old RoboEye caches and runtime-caches same-origin assets/models.
- REQ-P05: Runtime diagnostics keep at most 100 sanitized events locally, send no request and export a JSON snapshot only after a user click.
- REQ-P06: Depth error messages identify load versus inference; inference releases busy state while load/worker crash offers a visible retry.
- REQ-P07: Unit/browser tests cover the new policy and the complete existing QA gates remain green.

## CONSTRAINTS

- Do not add a server or third-party telemetry SDK.
- Do not weaken the TIP-09 dependency security gate.
- Do not cache camera frames, labels or query text in diagnostics.
- Do not make remote detection models part of the app-shell precache.
