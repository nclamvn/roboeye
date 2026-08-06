# TIP-13 — Product Packaging and Versioned Release

## HEADER

- Project: RoboEye Edge Perception Studio
- Depends on: TIP-12
- Priority: P0
- Target version: 1.2.0

## TASK

Package RoboEye as a first-time-operator product with a 60-second guided demo, responsive instrument layout, offline depth artifact and HTTPS/tagged release workflow.

## ACCEPTANCE CRITERIA

- REQ-R01: package metadata, visible UI version and generated `release.json` agree on 1.2.0.
- REQ-R02: the boot card communicates privacy, first-download expectation and the four-stage perception sequence, with normal-start and demo-start actions.
- REQ-R03: demo start opens the camera and, after the first depth frame, provides keyboard-accessible next/skip controls through all four modes.
- REQ-R04: 375, 768 and 1440 px browser checks show no horizontal overflow; mobile controls remain reachable.
- REQ-R05: `npm run build:offline` verifies the pinned q8 fixture, builds current code and stages the depth snapshot plus machine-readable offline metadata without tracking binaries.
- REQ-R06: official GitHub Actions deploy a base-path-correct artifact to Pages and publish a versioned archive on `v*` tags.
- REQ-R07: release verification checks required files/version/security metadata; browser E2E proves tour, diagnostics, service-worker offline reload and responsive layouts.

## CONSTRAINTS

- Reuse the HIVE design system and existing DOM architecture.
- The guided tour may explain and switch modes but must not fabricate perception results.
- Keep detection opt-in and online unless a future pinned detection manifest is approved.
- Preserve reduced-motion, focus-visible and honest relative-depth messaging.
