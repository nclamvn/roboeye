# TIP-63 — Mobile Lite Ranging

2026-10-10. Approved by owner: implement the reviewed proposal, QA, commit/push and deploy existing production for morning phone tests. Sequential Contractor → Builder → Contractor; no subagents. Vibecode v6.2; Jev OFF.

## Scan / RRI / decisions

Reuse the clean 17d2085 checkout, existing worker lifecycle, tracker, bounded freshness, reports, camera-first UI, recordings and tests. TIP-63Q independently identified heavy paired inference, incompatible WASM latency/freshness, missing easy calibration and runtime-only acceptance. The user approves that architecture through “triển khai theo đúng đề xuất”. No second interview/approval pause: no paid service, hardware purchase, new domain or copyleft model promotion. Permissive licence/attribution texts are packaged.

Contractor chooses a shipping Apache-2.0 YOLOX-Nano branch instead of unvalidated AGPL YOLO26 weights. YOLO26 depth/runtime full baseline migration remain gated candidates, not falsely labelled implemented. New ORT 1.30 is isolated under an alias for the Nano worker; existing RT-DETR/depth baseline stays pinned. Native NPU access and zero-calibration absolute depth are not promised.

## Blueprint / task graph

63A: pinned official Nano ONNX, typed preprocessing/decode/NMS, isolated runtime, workload preflight and explicit model selection → 63B: reference-point ground-plane calibration, holdout gate, on-video capture/picking, source/crop invalidation and same-capture geometric metre publication → 63C: per-target measured coverage vs runtime-only verdict, bounded reports, software/real-model/responsive QA → commit current branch, push non-force, build on committed source, deploy existing Vercel project, verify HTTPS identity and feature/model assets.

Design: retain camera-first slate UI (#10212b/#dce8ee, white text, cyan selection, amber uncertainty). Inter remains body font. Calibration lives inside Analysis, not a permanent camera panel. No extra HUD paragraphs or animation; compact path/status with one actionable calibration control. Screenshot-review at 375/430/desktop widths.

## Requirements / acceptance

- R1: Official upstream 3,659,407-byte Nano artifact is SHA-pinned, licence/notice retained; model output and preprocessing match upstream. Real image smoke on WASM and WebGPU; fail-loud corrupt assets.
- R2: User can select auto/Nano/RT-DETR. Auto mobile starts light; rolling measured latency has probing/within-budget/too-slow states, never derives phone PASS from UA/API presence. Manual baseline remains available.
- R3: Calibration from ≥6 fit and ≥2 independent check points with measured forward metres; useful depth span, rank/support, monotonicity, holdout and sensitivity gates. No hard-coded phone FOV or imported trusted coefficients. Source/shape/zoom changes invalidate it. All estimates are approximate, within declared planar-road domain.
- R4: Valid geometry is evaluated on the detector's own captured boxes; no depth worker required, no fake scale, no TTL relaxation. Stale/cropped/unsupported measurements remain unknown with reason. Calibration must not be overwritten by AI.
- R5: UI can freeze a source frame, select points in original pixels, add fit/check metres, fit, export/import validated reference profile, clear it; explicit fixed-camera/flat-road/known-reference confirmation. Keeps camera/pointer accessibility and narrow-screen layout.
- R6: Export includes tier and range path, per-target time coverage and blackout, fresh observations, separate product verdict with independent eligibility/accuracy still null without labels. Runtime/attempt PASS alone cannot become product PASS.
- R7: Type/unit/build, baseline partner suite, new UI/real-model tests and exact release assets PASS before deploying. No physical phone QA inferred from Chrome emulation; no road-safety acceptance claimed.
- R8: Commit/push/deploy the tested source and return verified HTTPS link, concise testing actions and open physical-phone gates.

## Constraints / validation

No model promotion without actual graph/adapter tests, no invented metres, no weakening identity/ordinal/freshness, no clip upload, no storage of pixels/location/device IDs in reports. Old profiles and reports remain compatible. Paid/licence-constrained depth replacement, semantic masks, native mobile packaging and ≥95%/≤300 ms/30-minute hardware acceptance stay explicitly pending.

Disk: 72 GiB free; no project copies or new build directories. Reuse dist/.vercel/output and repo dependency install. All QA outputs use existing repo output or persistent release evidence outside checkout; task-created small scratch directories removed at completion.
