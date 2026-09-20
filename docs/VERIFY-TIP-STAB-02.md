# Verify Report — TIP-STAB-02

Date: 2026-09-20

## Requirement coverage

8/8 requirements implemented = 100%.

| Requirement | Evidence | Result |
|---|---|---|
| CI-01 generated non-private video | `tests/helpers/video-fixture.mjs` | PASS |
| CI-02 isolated Vite lifecycle | both D6/D7 tests use `startDev`/`stopPreview` | PASS |
| CI-03 package and GitHub gate | `test:drive-controls-e2e` runs in QA and CI | PASS |
| CI-04 local QA before push | 217 unit tests plus all browser gates passed | PASS |
| CI-05 normal verified push | `main` and `origin/main` reached `d674258` without force | PASS |
| CI-06 GitHub success | run `35495168800`, three mandatory jobs green | PASS |
| CI-07 release remains separate | no tag, release or Pages deploy in TIP scope | PASS |
| CI-08 audit reports | Completion and Verify reports present | PASS |

## CI job evidence

| Job | Result | Evidence |
|---|---|---|
| `quality` | PASS | typecheck, 217 unit tests, build, security, Detection, RoboHand, Drive controls, release E2E/verify |
| `real-depth-smoke` | PASS | real depth/model smoke on a clean Linux runner |
| `real-airsketch-smoke` | PASS | real model smoke and AirSketch quality |
| `detection-benchmark` | SKIPPED | conditional job; a normal push does not request benchmark fixtures |

Run: [GitHub CI 35495168800](https://github.com/nclamvn/roboeye/actions/runs/35495168800)

## Test-boundary audit

- D6 proves that the compact lane HUD stays inside the actual contained video
  rectangle across desktop, phone, ultrawide, fullscreen and portrait source.
- D7 proves toggle visibility, state transitions and resource arbitration.
- D6/D7 use deterministic synthetic video and worker contracts. They make no
  assertion about neural-model accuracy.
- Real model smoke and quality gates remain independent. Missing/unapproved
  RoadStructure weights still fail closed and cannot be promoted by D6/D7.

## Technical health

- Local unit tests: 217 passed, 0 failed, 0 skipped.
- Local full QA: PASS.
- TypeScript: PASS, 0 errors.
- Production build: PASS, Vite 7.3.6, 71 modules.
- Security: PASS, 0 critical; 2 reviewed high advisories with explicit expiry.
- `git diff --check`: PASS.
- Verified implementation SHA: `d674258fdcf65c87686e65b759576e0154819a4a`.

## Overall status

**READY** as a reproducible CI/release baseline.

Deferred by design:

1. Release/tag/GitHub Pages alignment.
2. Detection benchmark on its fixture-authorized event.
3. Metric-distance accuracy acceptance.
4. RoadStructure artifact promotion and lane-quality acceptance.
5. Any road-safety or commercial-readiness claim.
