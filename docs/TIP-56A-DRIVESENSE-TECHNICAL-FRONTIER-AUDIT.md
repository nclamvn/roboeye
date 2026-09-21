# TIP-56A — Independent technical-frontier audit for DriveSense

**Status:** RESEARCH VERIFIED — no runtime/model promotion
**Date:** 2026-09-21
**Decision class:** architecture and evidence planning, not a road-safety release

## 1. Executive verdict

DriveSense is **directionally correct and technically modern as a browser-first
PoC**, especially in its local-first processing, pinned model contracts,
worker isolation, explicit degraded states and refusal to invent metres when
evidence is inadequate. It is not yet a state-of-the-art deployable driving
product because the evidence plane is behind the modelling plane.

The highest-return move is therefore **not a blind model replacement**. It is a
common, frame-synchronised benchmark and calibration plane that lets the current
stack and challengers compete on exactly the same Vietnam clips, device and
labels. Only the winner of that controlled comparison may enter the runtime.

The decisive gaps are:

1. camera intrinsics, distortion, crop and mount geometry are not yet bound to
   a validated physical-metre corpus;
2. detector, depth, tracker and displayed risk are not yet evaluated as one
   same-frame/same-track chain;
3. browser throughput is measured in parts, but capture-to-display frame age,
   decode/copy cost and sustained performance still lack a complete report;
4. lane/drivable-area work has sound contracts and annotation tooling, but the
   production UI currently exposes an image-space indication rather than a
   validated lane-departure estimate;
5. candidate licences and data rights can materially constrain a commercial
   product even when the model quality is attractive.

## 2. Independent method

The audit froze 18 representative entities across detection, tracking, metric
depth, camera geometry, road understanding, browser/edge runtime, datasets and
safety HMI. It captured official sources, hashed every snapshot, extracted only
verifiable evidence spans and ran destructive validation tests.

- 18/18 entities represented (declared scope coverage: 100%).
- 84 evidence-backed claims.
- Snapshot integrity: all SHA-256 checks pass.
- Deterministic build digest: `d84f263f90f9ef72`.
- Source/field/boundary bite suite: all applicable attacks were caught.

The audit compares technical direction and integration risk. Publisher latency
or accuracy numbers are **not** treated as DriveSense performance.

## 3. Current-stack assessment

Scale: 0 absent, 1 exploratory, 2 credible PoC, 3 product-oriented, 4 field-
validated in the declared operating domain. Scores are audit judgements, not
vendor metrics.

| Layer | Maturity | Verdict | Evidence-backed interpretation |
|---|---:|---|---|
| Architecture and failure semantics | 3.0/4 | Keep | Local-first, modular workers, pinned contracts, honest `unknown` and advisory-only external data are strong foundations. |
| Vehicle detection | 2.5/4 | Keep as baseline; challenge | RT-DETRv2 remains credible and deployable, but the family and market have newer candidates. Target-domain recall and latency decide, not novelty. |
| Multi-object tracking | 2.0/4 | Benchmark and harden | Kalman/ByteTrack-inspired logic is reasonable; no common HOTA/IDF1/ID-switch benchmark or explicit ego/camera-motion compensation yet. |
| Metric range | 1.5/4 | Correct concept, insufficient proof | Ground-plane geometry plus learned depth is the right hybrid family. Physical bumper-gap error, calibration drift and far/side-target validity remain unproven. |
| Lane and drivable area | 1.5/4 | Evaluation plane ahead of runtime | Registry, annotation and scoring foundations exist; the live indication is still image-space and must not be sold as physical lane departure. |
| Browser runtime | 2.5/4 | Keep for workbench/HMI | WebGPU, workers, bounded work and fallback are appropriate. Decode/copy/frame-age/thermal evidence must close before a realtime claim. |
| Driver HMI and safety policy | 2.5/4 | Keep minimal; validate nuisance | One primary threat, quiet normal state and fail-closed behaviour are good. Scenario-level false/nuisance-warning evaluation is still missing. |
| Commercial data architecture | 2.0/4 | Keep neutral contract | Provider-neutral advisory events and RFI gates are correct; Vietnam coverage, rights, retention, SLA and price remain honest nulls. |

## 4. Technology comparison and integration decision

### 4.1 Detection and tracking

- **Current RT-DETRv2:** retain as the control. It is Apache-2.0 and supports
  ONNX Runtime/TensorRT/OpenVINO. Do not replace it merely because RT-DETRv4,
  RF-DETR or YOLO26 is newer.
- **RF-DETR Nano:** preferred open challenger for the first bake-off. The core
  package/models have an Apache-2.0 path, but Plus components use a different
  licence. Its published T4 figures are only a hypothesis for DriveSense.
- **YOLO26n:** include as a performance challenger only with an explicit
  AGPL/Enterprise decision. Export breadth is attractive; licence architecture
  is part of the product decision, not paperwork after integration.
- **ByteTrack:** compare against the custom tracker on the same detections.
  Low-score association is a useful baseline for occlusion and fragmented
  tracks. Add ID switches, HOTA/IDF1, continuity and primary-target churn to the
  scorer. On a future Jetson path, NvSORT/NvDCF is a separate native-edge
  challenger, not a browser dependency.

**Decision:** no promotion until all detector/tracker pairs run on the same
locked clips, labels, device, preprocessing, thresholds and frame timestamps.

### 4.2 Distance and scene geometry

- Keep calibrated ground-plane geometry as the interpretable metric anchor.
- Keep Depth Anything V2 Small only inside its proven contract; its base model
  is relative depth, while metric output needs the correct fine-tune and local
  validation.
- Add **Metric3D v2 Small/ONNX** as a metric-geometry challenger after written
  clarification of model-package commercial terms.
- Use **Apple Depth Pro** as an offline quality ceiling/diagnostic challenger,
  not an assumed realtime browser component.
- Exclude **UniDepthV2** from the default commercial core because its published
  licence is non-commercial.

Fusion must be same-frame and uncertainty-aware: camera ray/ground contact,
class geometry, metric-depth evidence, track continuity and calibration health
may agree, conflict or abstain. A model output alone must never become a hard
metre label.

### 4.3 Lane and drivable area

- Integrate the already-understood OpenVINO four-class road/curb/mark model as
  a reproducible baseline if its model terms pass the release gate.
- Evaluate YOLOPv2 as a joint detection/drivable-area/lane challenger, but do
  not translate its V100/BDD100K result into Vietnam browser performance.
- Add temporal consistency, ego-lane boundary identity, curvature, horizon and
  barrier/curb evidence. Continue to show `unknown` when geometry is ambiguous.

BDD100K is useful for public benchmark breadth; KITTI is useful for calibrated
geometry research; comma2k19 is useful for synchronized camera/GPS/IMU/CAN
pipeline exercises. None replaces a rights-cleared Vietnam target corpus with
physical distance truth.

### 4.4 Runtime split

**Now:** browser remains the best local workbench, demo and HMI because ONNX
Runtime Web can use WebGPU/WASM and stays offline. Add WebCodecs-based sequential
decode for uploaded video, explicit frame timestamps, one bounded queue and
shared preprocessing so frames cannot silently drift between models.

**Later, after software gates:** preserve the contracts and HMI, but evaluate a
native Jetson service using TensorRT/DeepStream for sustained multi-stream
decode, inference and tracking. Native edge is a deployment option, not an
excuse to bypass the current evidence gates.

## 5. Keep, upgrade, reject

### Keep

- local-first processing and browser workbench;
- modular worker/contracts and pinned model manifests;
- latest-frame/bounded-work principles;
- hybrid geometric plus learned-depth design;
- one primary threat, quiet normal HUD and explicit degraded/unknown states;
- provider-neutral external events outside the local warning hot path.

### Upgrade before any stronger product claim

- camera calibration wizard with intrinsics, distortion, crop, mount and
  profile fingerprint;
- exact source-frame/track association across detection, depth and display;
- deterministic WebCodecs file pipeline and per-stage frame-age/copy metrics;
- same-corpus detection/tracking challenger harness;
- per-range-bin physical error, ordering error, coverage and abstention;
- road/lane temporal metrics and ego-boundary identity;
- event-level missed/false/nuisance-warning and primary-target churn reports.

### Reject as product shortcuts

- swapping models on vendor mAP/FPS alone;
- presenting raw monocular depth as verified bumper distance;
- using non-commercial weights/data in the commercial core without permission;
- adding a VLM/LLM to the realtime warning loop;
- presenting public-dataset or synthetic results as Vietnam field validation;
- declaring “realtime” without capture-to-display frame-age and sustained-run
  evidence.

## 6. Build sequence

### TIP-56B — Common Evidence Plane (next, software-only)

Freeze video manifest, decoded source-frame timestamps, reviewed 2D vehicle
labels and track IDs; score the current detector/tracker plus adapter-shaped
challengers on accuracy, continuity, primary-target churn, latency, frame age
and memory. The first implementation can use current uploaded clips and add no
hardware or model promotion.

### TIP-56C — Deterministic browser video pipeline

Introduce WebCodecs where supported, keep a bounded fallback, share the decoded
frame/preprocessing across tasks and export a reproducible performance report.

### TIP-56D — Metric-range truth and fusion bake-off

When physical truth is allowed, compare ground-plane-only, DA2 metric,
Metric3D and fusion by distance bin, lane/side geometry, occlusion, calibration
health and abstention. This is the gate for trustworthy metres.

### TIP-56E — Warning/HMI event validation

Evaluate one-primary-threat selection, late/missed warnings, nuisance alerts,
state flapping and degraded transitions. Normal operation stays visually quiet;
alert modality and staging are validated per scenario.

## 7. Contractor acceptance decision

**ACCEPT the current architecture as the control baseline.**
**REJECT any claim that distance, lane departure or realtime warning is already
field-validated.**
**AUTHORIZE TIP-56B as the next bounded build slice.**

The detailed source registry is in `research/technical-frontier/`. Hardware
purchase, public-road warning and commercial model promotion remain separate
product-owner gates.
