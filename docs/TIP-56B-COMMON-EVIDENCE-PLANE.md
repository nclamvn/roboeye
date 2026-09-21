# TIP-56B — Common Evidence Plane

**Status:** ACCEPTED / BUILDING
**Scale:** Medium / benchmark contract + scorer + uploaded-video export seam
**Owner approval:** explicit implementation request, 2026-09-21

## Header

- **TIP-ID:** TIP-56B
- **Project:** RoboEye DriveSense
- **Module:** detector/tracker evidence and model-promotion gate
- **Depends on:** TIP-47A, TIP-49L-B, TIP-56A
- **Priority:** P0 before any detector/tracker promotion

## Intent

Create one deterministic evidence plane in which the current RT-DETRv2/custom
tracker control and future challengers are evaluated on exactly the same source
videos, decoded source frames, preprocessing contract and reviewed labels.

The plane measures evidence; it never automatically selects or promotes a
model. Existing uploaded-video processing must be able to export a candidate
run without embedding video pixels or local paths.

## Requirements

| ID | Requirement | Acceptance evidence |
|---|---|---|
| REQ-56B-01 | A closed, versioned contract binds corpus, source SHA, dimensions, exact source-frame plan, reviewed truth, candidate artifacts/configs and commercial gate | Parser/type tests |
| REQ-56B-02 | Every candidate covers the identical journey and frame plan; an empty frame is recorded rather than omitted | Missing/reordered/mismatched-frame rejection tests |
| REQ-56B-03 | Matching is deterministic, one-to-one and vehicle-family aware at a fixed IoU threshold | Synthetic comparison fixture |
| REQ-56B-04 | Report detection precision/recall, class accuracy, ID switches, fragmentation and track continuity without using candidate track IDs as truth IDs | Scorer assertions |
| REQ-56B-05 | Report primary-target correctness, misses, false selections and track churn | Primary-target scenario tests |
| REQ-56B-06 | Report request-to-result, capture-to-display, evidence age and memory distributions with explicit coverage/nulls | Performance/coverage tests |
| REQ-56B-07 | Commercially blocked/evaluation-only candidates may be measured but can never become promotion-eligible; no automatic winner exists | Promotion-gate tests |
| REQ-56B-08 | DriveSense uploaded-video report exports the current control in adapter shape, with exact sampled frame index/time and no video bytes/path | Pure export tests + build |
| REQ-56B-09 | A CLI evaluates a local envelope deterministically and can write a JSON report | Fixture CLI smoke test |
| REQ-56B-10 | Existing application behavior remains unchanged | Full typecheck/unit/build/security gates |

## Contract decisions

- One top-level `protocol` fixes `minimumIou`, label policy, sample-plan ID and
  preprocessing ID for all candidates.
- Truth IDs are independent reviewed object IDs. Candidate track IDs never
  enter truth.
- Each candidate run repeats source SHA/dimensions and every planned frame.
- Telemetry fields may be `null` only where the platform cannot observe them;
  the report publishes coverage instead of converting absence to zero.
- The scorer produces per-candidate and per-journey metrics plus a Pareto input,
  but `automaticWinner` is always `null`.
- Synthetic fixtures prove algorithms/contracts only. Reviewed local clips are
  required before quality comparison; physical range truth remains TIP-56D.

## Constraints

- Do not download or promote RF-DETR/YOLO26 weights in this TIP.
- Do not add video bytes, filesystem paths, faces, number plates or free-form
  device identifiers to the benchmark envelope.
- Do not change the warning thresholds, detection model or tracker used by the
  product runtime.
- Do not reuse publisher FPS/mAP as DriveSense evidence.
- Reuse existing Hungarian assignment, uploaded-video samples and replay tracks.

## Acceptance scenarios

1. **Given** two candidate runs on one locked synthetic journey, **when** the
   scorer runs, **then** it reports different detection, continuity, primary and
   runtime metrics deterministically without choosing a winner.
2. **Given** a candidate omits or changes a planned frame/source SHA/dimension,
   **when** parsing occurs, **then** the envelope fails closed.
3. **Given** a candidate has a blocked or evaluation-only commercial gate,
   **when** it scores better, **then** promotion eligibility remains false.
4. **Given** unsupported telemetry is `null`, **when** metrics are summarized,
   **then** values remain null with measured coverage; zero is never fabricated.
5. **Given** an analysed uploaded video, **when** the report is exported,
   **then** it includes adapter-shaped control frames tied to source frame
   index/time and contains no video data or local path.
6. **Given** the completed implementation, **when** project gates run, **then**
   typecheck, focused/full tests, build and security audit pass.

## Decisions log

- Full RRI/Blueprint checkpoints are skipped because TIP-56A already approved
  the architecture and the owner explicitly requested this bounded node.
- Physical distance metrics are excluded: they require TIP-56D truth and must
  not contaminate the detector/tracker decision.
- Challenger adapters are contract-shaped only in this TIP; model acquisition
  and execution require a later explicit promotion experiment.
