# TIP-64A — Assistive Vision evidence lab

2026-10-10. Owner approved the next step following TIP-64R research. Sequential Contractor → Builder → Contractor; Vibecode v6.2, Jev OFF. No subagents, deployment, paid services, new model downloads or hardware purchases.

## Scan / decision

Clean f1325bd checkout; reuse Vite, TypeScript, existing dependency install and browser QA. DriveSense road-plane calibration and outdoor learned Z are not handheld object-range providers. Keep its entry, workers, contracts and tests unchanged. TIP-64R's 76 primary-source captures/116 claims are research evidence, not physical phone validation.

Implement an independent `/assist.html` lab, not a navigation product. Native ARCore/ARKit, object models, audio warnings and physical device acceptance remain subsequent TIPs. Browser camera supplies RGB metadata only, explicitly no object detection or metres. No invented intrinsics, ground truth or scale.

## Blueprint / task graph

Contract/types + closed parser → geometry/freshness reference calculation → consent-bound recorder/import/replay → synthetic scenarios + 24-position collection plan → camera-metadata/replay UI → tests/build/baseline regression → completion report.

FramePacket: original camera pixels, explicit display crop/rotation/mirror, session-relative monotonic milliseconds, separate RGB/depth capture times, calibrated intrinsics or null, optional rigid camera-to-world pose, depth semantics/provenance/confidence and provider-associated foreground samples. Repeated depth capture IDs may be recorded but must not become new measurements. RangeEvidence is camera-to-supported-point Euclidean range, never body clearance or proof of safe passage. Provider declarations/import checksums are not hardware authentication.

Privacy: metadata-only consent, memory-only bounded capture (600 frames / 120 seconds / 2 MiB), explicit JSON export, no pixels/video/audio/location/device identifiers, clear/revoke/shutdown, no auto camera restart. Strict unknown-field rejection. Native raw pixels/depth grids are intentionally outside this diagnostic format; future adapters must resolve source-coordinate sparse support before submission.

## Requirements / acceptance criteria

- R1: Versioned vendor-neutral frame/recording contract. Reject unknown fields, invalid/nonfinite units, geometry, IDs, temporal order, support indices and malformed rigid poses. Relative depth cannot produce metres.
- R2: Test pixel mapping for crop/90° rotations/mirror and unprojection Z vs ray range. Reject stale/skewed/low-confidence/unassociated/ambiguous support; no hard-coded camera FOV. Native/learned/synthetic provenance stays visible and unverified.
- R3: Recorder cannot start without explicit metadata consent; enforces time/frame/byte caps without silent truncation; export includes rejection/stop counters and SHA-256 integrity. Clear/revoke removes in-memory frames. Import cannot restore recording consent or auto-start a camera.
- R4: Deterministic seek/replay uses recording time, not elapsed import time. Cover static/moving target, camera motion, mirror/crop/rotation, occlusion, low confidence, reused/stale depth, relative-only and learned-metric-unverified scenarios. Motion classification is not fabricated from box motion.
- R5: Provide 24 planned physical collection slots with no filled measurements, separate reference maths tests from physical accuracy. Evaluation matches recording/frame/target, measures coverage and error only against explicitly measured ground truth; absent labels → null MAE/P95, never PASS.
- R6: Usable Vietnamese `/assist.html`: synthetic watermark, scenario choice, scrub/play/pause, guarded camera + record/stop/clear/export/import, keyboard labels, mobile layout and visible limitations. Camera mode explicitly has no metres/model in this phase.
- R7: Type/unit/build and DriveSense partner regressions pass. Browser QA verifies default privacy, synthetic replay, import corruption/oversize, camera stop/late-permission disposal, recording caps, responsiveness and error-free operation. Real phone accuracy/latency/audio/thermal tests stay pending.

## UI design review

Use the owner's restrained black/white preference: #000000 camera field, #ffffff paper controls, #17212b text, #6e7c87 neutral metadata, #296fe8 selection, #946000 synthetic/uncertainty. Inter locally bundled, 16–18 px body. One uninterrupted camera/replay field, quiet overlaid controls, no animated warning, no dashboard tiles. Text labels accompany colour; detail/corpus panel collapses below. This is a testing instrument, not an end-user assistive interface or promise of navigation safety.

## Verification / exit

Map every R1–R7 to automated cases and documented remaining hardware gates. Save repeatable local QA receipts under docs/evidence/tip64a. Use current checkout/dist only, disk checked 70 GiB free. Any Chrome scratch profile must be task-named and removed in finally. Overall can be READY for foundation only, never ready for independent mobility.
