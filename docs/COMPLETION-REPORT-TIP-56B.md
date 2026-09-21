# Completion Report — TIP-56B

**Status:** COMPLETE / VERIFIED for software evidence-plane scope
**Date:** 2026-09-21

## Files changed

### Created

- `src/drive/evidence-plane.ts` — closed contract, parser, assembler, scorer and
  uploaded-video control adapter.
- `scripts/assemble-drive-evidence-plane.ts` — binds one reviewed local journey
  to control/challenger exports.
- `scripts/evaluate-drive-evidence-plane.ts` — deterministic JSON evaluator.
- `tests/fixtures/drive-evidence-plane-synthetic.json` — two-candidate contract
  fixture with misses, false positive, class error, ID switch and fragmentation.
- `tests/unit/drive-evidence-plane.test.ts` — seven focused scenarios.
- `docs/TIP-56B-COMMON-EVIDENCE-PLANE.md` — accepted TIP contract.
- `docs/evidence/TIP-56B-LOCAL-WORKFLOW.md` — old/new video workflow.
- `docs/VERIFY-TIP-56B.md` — Contractor verification.

### Modified

- `src/drive/app.ts` — analysed uploaded-video reports now carry an
  `evidencePlaneCandidate` control fragment.
- `package.json` — added assemble and benchmark commands.
- `docs/TASK-GRAPH-DRIVESENSE-PRODUCT.md` — TIP-56B state and next gate.

## Acceptance results

- **REQ-56B-01..10:** 10/10 implemented.
- Focused TIP scenarios: **7/7 pass**.
- Full unit suite: **241/241 pass**.
- TypeScript typecheck and production build: pass.
- Security audit: pass; 0 critical, two pre-existing accepted-risk `sharp`
  advisories remain on their existing review deadlines.
- CLI assemble → evaluate smoke: pass; two candidates, one journey, four exact
  samples each, `comparability.status=pass`, `automaticWinner=null`.

## Issues discovered

- Browser file analysis exposes exact sample ordinal and media timestamp, but
  not a trustworthy original compressed-video frame number. The contract uses
  `sampleIndex + sourceTimeMs` to avoid inventing decoder evidence.
- Current offline reports cannot observe capture-to-display age or portable JS
  memory. These fields remain `null` and their coverage is reported as zero.
- No RF-DETR/YOLO26 artifact was downloaded and no reviewed Vietnam vehicle
  truth was fabricated. Therefore this TIP proves the comparison plane, not a
  real challenger result.

## Deviations from initial wording

- `sourceFrameIndex` was renamed to `sampleIndex`. Reason: the current browser
  seek path controls timestamped samples but does not expose a reliable original
  frame ordinal. Impact: comparability is preserved and semantics are more
  honest.

## Suggestions for Contractor

- Reuse the original videos if the original bytes still exist; bind SHA-256 and
  independently review vehicle boxes/primary targets at the exported timestamps.
- Add one challenger adapter at a time. RF-DETR Nano is the cleaner first
  licensing experiment; YOLO26n requires an explicit AGPL/Enterprise decision.
- Keep physical metre scoring in TIP-56D rather than adding it to this 2D
  detector/tracker plane.
