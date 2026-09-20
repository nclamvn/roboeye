# Completion Report — TIP-STAB-02

**STATUS:** DONE

## Outcome

The recovered RoboEye source is now on `origin/main` with a reproducible local
and GitHub CI gate. DriveSense D6/D7 no longer depends on a private video, a
manually running localhost server, a macOS-only temporary path, or an unshipped
RoadStructure model artifact.

No release, tag or GitHub Pages deployment was performed in this TIP.

## Implementation

- Added a deterministic browser-generated WebM fixture.
- Made the D6/D7 suites own isolated Vite server lifecycles.
- Added DriveSense control E2E to package QA and the GitHub `quality` job.
- Made Vite readiness parsing tolerant of ANSI output and both localhost forms.
- Replaced hard-coded macOS temporary paths with `node:os.tmpdir()`.
- Separated UI/control contracts from model-quality gates:
  - D6/D7 use deterministic road/detection/range workers;
  - model quality, model integrity and real inference remain separate,
    fail-closed benchmark/smoke gates.

## Commits and remote evidence

- `dd7053d` — reproducible DriveSense controls and CI wiring.
- `fecf5ee` — cross-platform Vite readiness detection.
- `b579522` — portable artifact paths.
- `d674258` — isolated deterministic DriveSense control contracts.
- Final CI: [run 35495168800](https://github.com/nclamvn/roboeye/actions/runs/35495168800),
  SHA `d674258fdcf65c87686e65b759576e0154819a4a`, all mandatory jobs passed.

## Root-cause record

Three red runs were retained as diagnostic evidence rather than hidden:

1. [35489454291](https://github.com/nclamvn/roboeye/actions/runs/35489454291):
   Linux Vite output contained ANSI escape codes not accepted by the readiness
   parser.
2. [35489991377](https://github.com/nclamvn/roboeye/actions/runs/35489991377):
   D6/D7 wrote evidence to a macOS-only `/private/tmp` path.
3. [35490306174](https://github.com/nclamvn/roboeye/actions/runs/35490306174):
   a layout/control test accidentally initialized the real, intentionally
   unshipped RoadStructure model and therefore failed closed on a clean runner.

## Verification summary

- Local `npm run qa`: PASS.
- Unit: 217 passed, 0 failed, 0 skipped.
- DriveSense controls: 7 video-anchor cases plus the complete toggle contract,
  zero page errors.
- TypeScript/build/security: PASS; 0 critical advisories and two time-bounded,
  reviewed `sharp` advisories.
- GitHub `quality`: PASS, including DriveSense control E2E and release verify.
- GitHub `real-depth-smoke`: PASS.
- GitHub `real-airsketch-smoke`: PASS, including model quality.
- Conditional detection benchmark: correctly skipped for a normal push event.

## Product boundary

This completion verdict proves repository reproducibility, control orchestration
and release-gate health. It does not certify metric-distance accuracy,
RoadStructure quality, lane-departure safety or commercial road use. The current
road candidate remains research-only and non-promotable until its independent
quality and artifact gates pass.

## Next contractor recommendation

Proceed to a separately scoped release-alignment TIP only after the owner
explicitly authorizes versioning/deployment. Product work should otherwise
resume from evidence-backed distance and RoadStructure quality gates, not from
new UI features.
