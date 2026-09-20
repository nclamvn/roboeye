# TIP-50R-D3 — Continuity-aware road-mark paths

## Header

- TIP-ID: TIP-50R-D3
- Project: RoboEye / DriveSense
- Module: RoadStructure vectorization
- Depends on: TIP-50R-D2
- Priority: P0

## Context

- Working directory: `/Users/os/Documents/Codex/2026-08-05/new-chat/roboeye-live`
- Key files: `src/drive/road-vectorizer.ts`,
  `scripts/benchmark-road-reviewed.ts`, `tests/unit/road-vectorizer.test.ts`
- D2 proved that row-local nearest-mark selection switches identity across
  dashed gaps and yields zero accepted lane matches.
- Test1/Test2 have been observed and are frozen as test evidence. They are not a
  legal tuning or validation split for D3.

## Task

Replace the default row-local selector with deterministic continuity-aware path
association. Generate geometrically plausible lane hypotheses across separated
mark components, score support without reading annotations, fit a bounded curve,
and fail closed when the evidence is weak or ambiguous. Preserve the D2
vectorizer as an explicit `v1` path for reproduction.

## Requirements

| ID | Requirement | Priority |
|---|---|---|
| REQ-D3-01 | Keep the D2 algorithm callable as `v1`; make continuity-aware association the explicit `v2` default | P0 |
| REQ-D3-02 | Bridge dashed gaps using whole-path support rather than independent per-row selection | P0 |
| REQ-D3-03 | Enforce perspective direction, bounded slope/curvature, finite geometry and left/right side constraints | P0 |
| REQ-D3-04 | Expose support span, residual and confidence diagnostics for each side | P0 |
| REQ-D3-05 | Reject empty, short, horizontal, implausible or ambiguous evidence instead of fabricating a corridor | P0 |
| REQ-D3-06 | Validate on deterministic synthetic masks containing dashes, curves, adjacent-lane distractors, gaps and clutter | P0 |
| REQ-D3-07 | Version the benchmark runner and prevent a D3 replay from being represented as a new held-out result | P0 |
| REQ-D3-08 | Do not connect the result to RoadGraph/HUD or make realtime/commercial claims | P0 |
| REQ-D3-09 | Make line distance invariant to equivalent polyline sampling density and point order | P0 |

## Acceptance criteria

1. Given a dashed curved ego corridor plus adjacent marks and horizontal clutter,
   when v2 vectorizes the four-class mask, then both ego paths stay continuous,
   typed and within the synthetic geometry tolerance.
2. Given evidence with insufficient vertical span or implausible direction, when
   v2 runs, then it emits no unsupported line.
3. Given the original D2 algorithm, when the benchmark runner requests `v1`,
   then the runner uses v1 and reports its version; `v2` is likewise explicit.
4. Given any output, then points are finite, normalized and confidence evidence
   is machine-readable.
5. Unit, typecheck, build, security and whitespace gates pass.

## Constraints

- No reviewed annotation coordinate may enter hypothesis generation or tuning.
- No new dependency.
- No temporal persistence beyond one frame; RoadGraph temporal fusion remains
  TIP-50R-E.
- A post-hoc D3 run on Test1/Test2 is development evidence only and cannot clear
  the promotion gate.

## Decisions log

| Decision | Chosen | Rationale |
|---|---|---|
| Validation | Deterministic synthetic masks | No independent third source is available; prevents pretending same-source frames are held out |
| Association | Global path hypotheses + robust quadratic refinement | Bridges dashes and penalizes component switching without adding a dependency |
| Temporal behavior | Deferred to TIP-50R-E | Keeps perception extraction separate from stateful safety logic |
| Blueprint checkpoint | Skipped | Homeowner explicitly invoked TIP-50R-D3 and the parent RoadStructure blueprint/task graph is already approved |
| Metric amendment | Point-to-segment symmetric distance | D3 visual verification exposed that D2 point-to-point distance rejected equivalent curves solely because they had different sample counts |
