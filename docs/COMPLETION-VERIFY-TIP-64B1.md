# Completion / Verify — TIP-64B1

Historical initial B1 receipt. The current 0.1.1 build and subsequent audit supersede its source/test counts: see [TIP-64B1-H verification](COMPLETION-VERIFY-TIP-64B1-H.md). Evidence paths below are reusable QA output locations and may now contain the newer run; use its matching source fingerprint, not this historical fingerprint.

2026-10-10 · Vibecode v6.2 Contractor → Builder → independent Contractor review. No subagents. Jev OFF. **DONE / READY for controlled device installation and collection. Physical acceptance NOT TESTED; NOT READY for independent navigation.**

## Delivered

- Separate UIKit/ARKit Xcode project (`native/ios/AssistiveDepthProbe.xcodeproj`), iOS deployment target 17.0, no third-party dependency/model/API. Installed Xcode 27 + Swift 6.4 reused. Native target never replaces DriveSense/web camera.
- One ARSession owns RGB, direct sceneDepth/confidence, calibrated K and session-local pose. ARSCNView previews the same session. Runtime support + explicit permission; no second camera owner, no smoothedSceneDepth, planes-as-ground-truth, guessed FOV or metric RGB model.
- Manual surface selection/acknowledgement, original-image sampling with checked float/confidence formats and row strides, SDK display transform inversion/representation checks, ARKit camera axes converted to v1 row-major right-handed pose. 5×5 sparse support patch; high confidence ≥5 distinct positions, robust/mixed support refusal, SDK frame-age ≤300 ms, limited-tracking refusal, 0.5–5 m test domain.
- Big native metre readout, dynamic system typography and scrollable controls guided by frontend-design. Honest unsupported/permission/stale states. Selection is screen-relative, **not object tracking**. Measured range is the supported patch's median Euclidean camera-to-point distance, not body clearance/vehicle gap.
- Memory-only consent recorder ≤5 Hz, 600-frame/120-second/2-MiB limits, measured tape label on exact stopped last-frame/target, development/holdout separation. Closed metadata fields/no raw RGB/video/depth tensors/GPS/device IDs/audio/cloud. Pose metadata is sensitive relative motion, not “anonymous”.
- JavaScriptCore constant canonical serializer + CryptoKit SHA256 gives cross-language v1 envelope import; no evaluation of imported executable code. Revoke/background clears frames/consent; permission epochs dispose late callbacks; no automatic camera restart. Task-owned share files removed on dismiss/background and known-prefix crash leftovers recovered at next launch. Shared/downloaded files cannot be remotely revoked.
- Installation/test guide, reproducible native + web QA, compact receipts and screenshots. User must connect/trust/sign on their own iPhone. No Apple login, certificate/provisioning mutation, TestFlight purchase or physical app installation performed.

## Requirements / verification mapping

| ID | Implemented output | Software evidence | Physical gate |
|---|---|---|---|
| B1-R1 | Native project / isolated existing web | iOS Release unsigned build, simulator build, web regression | Signed install pending |
| B1-R2 | Capability/permission/single owner/lifecycle | Simulator unsupported/background states + adapter review/clock tests | Real permission/interruptions pending |
| B1-R3 | Calibration/coordinates/pose/pixel formats | Swift transform/centre/chirality tests, strict web import, SDK header/docs review | Sensor alignment/rotation pending |
| B1-R4 | Null instead of stale/weak/untracked/mixed values | Swift failure/domain/age tests, native stale UI | Actual coverage/blackout pending |
| B1-R5 | Consent/bounds/export/privacy | Swift cap/revoke/null/privacy tests, checksum/tamper interoperability | Save/AirDrop and thermal pending |
| B1-R6 | Exact stopped-frame measured truth | Swift measured truth tests, web physical-pending evaluation | All 24 slots uncollected |
| B1-R7 | Install + protocol | Native README / TIP / this report | User device and Team selection required |

7/7 scoped output requirements implemented. Physical scenarios above remain **untestable in this environment**, not pass by inference. Compile/simulator/declarations/checksum are not authentication of a LiDAR exposure, confidence calibration, clinical validation or proof of metre accuracy.

## QA result

Final receipts: [native QA](evidence/tip64b1/summary.json), [native UI](evidence/tip64b1/simulator-ui.json), [Swift→web interoperability](evidence/tip64b1/interop.json), [web regression](evidence/tip64b1/web-baseline/summary.json), [web lab](evidence/tip64b1/web-lab/result.json).

- **17/17 Swift core tests PASS**, 0 failures; coordinates/rotation/mirror/crop, pixel centres, camera axes, Z-vs-ray, confidence/mixed/domain/age/clock/tracking, consent/caps/revoke/identity/labels/null/privacy/export.
- **5/5 cross-language cases PASS**: synthetic/native declarations/explicit nulls/low support/float canonicalization, strict TypeScript v1 parser, checksum and tamper rejection. These are generated fixtures, not native hardware recordings.
- **4/4 native UI cases PASS**, 0 failure/skip, simulator iPhone18Pro + iOS27 runtime. Unsupported device, manual selection confirmation/stale reset, background clear/no auto-restart, landscape/accessibility type with every button brought into the actual scroll viewport and ≥44-pt target sizes. Synthetic UI path is disabled on physical-device builds and cannot record/export.
- **iOS Release unsigned build PASS**, simulator Debug build PASS; no compiler errors. Xcode test runner emits `no debugger version` warnings, but the native UI result has no runtime warnings/failures. No signed app/IPA/device-install success claimed.
- **353/353 existing TypeScript tests PASS**, **14/14 DriveSense regression gates PASS**, **16/16 web lab browser cases PASS**, 0 web-lab page errors/external requests. Real pinned detector/depth inference was checked on desktop Chrome (WASM/WebGPU), not physical phone/camera. Security audit 0 high/critical; lint NOT RUN (not configured); `git diff --check` PASS.
- Final native source/QA fingerprint: `cea05fdbf1d3e99bb9e19c5d63eca1a755c3ec6a7c8510e35703037cf32bc14f`, before=after, `pass:true`.
- Exact web fingerprint: `e4556f3053d3a33d2c5633d1faef9e1c80f328b3ed9721bf6a69a1000e5c54f8`, full regression before=after. Final native refinements reused these web receipts **only after comparing the current web fingerprint before/after**; native Swift/interop/Release/UI tests were run again on final frozen native source. `--reuse-web-baseline` refuses changed or missing web evidence; default QA still executes the full suites.

Independent review corrected dark-mode disabled-button contrast and strengthened the initially weak large-type test. Diagnostic failure found fast one-direction swipe **overshot** a control (record y=73 while viewport began y=175); short direction-aware drags now prove reachability. [Diagnosis](evidence/tip64b1/review-failure/diagnosis.md). No camera/range/age/confidence gate was relaxed. The repeatable QA exporter was repaired to replace only its generated screenshots because xcresulttool rejects an existing manifest; final export succeeded. A focused diagnostic Xcode process that lingered after logging failure was stopped; its interrupted status is not counted as a passing test. Final complete UI bundle passed all four cases.

Native software is build/test-ready. Real permission/camera/LiDAR, registration, actual distance errors, phone P95 and 30-minute thermal tests remain NOT TESTED. Physical requirements are disclosed as pending, never inferred from software counts.

## Limits / remaining gates

ARKit sceneDepth is reported for an ARFrame with that frame's timestamp. There is no separate sceneDepth hardware exposure timestamp in this API. Capture ID derived from ARFrame identity does not prove every frame contains a new LiDAR exposure. `capture→ready` means SDK capture timestamp to app after patch read; not measured photon-to-screen/audio. No UI redraw FPS is advertised as sensor throughput. Physical MAE/P95/coverage/false-confidence/blackout/phone latency/30-minute thermal/battery/older-phone acceptance are unknown.

Hardware gate: install via Xcode on iPhone16ProMax, verify `.sceneDepth` capability, one camera start/stop, real RGB-depth registration/orientation, opaque measured points 0.5–5 m, 24 controlled slots with actual tape truth and holdout checks. Then enrich dark/glass/reflective/thin/drop-off/overhead/mixed-motion cases. Do not use it as a mobility aid before supervised O&M review. Android/Xiaomi ARCore adapter TIP-64B2 and semantic perception/tracking/audio remain outside B1.

## Installation / authority / disk

Needed app: **Depth Probe**, built locally by Xcode, not a browser link or third-party App Store app. Instructions: [native guide](../native/ios/README.md). No extra Mac tool install or model download. A Personal Team can be used for local development subject to Apple's current quotas/expiry; not a commercial distribution method.

TIP-64A checkpoint commit `d8e7897` was created as approved by the preceding proposal. TIP-64B1 work is not pushed/deployed; production unchanged. Current native edits are uncommitted. Software caches stay in reusable `native/ios/.build` and `.build-xcode`, ignored by Git; no full project copies, per-task Next outputs or Docker. Disk was 68 GiB before builds, 64 GiB after full QA/simulator use; no extra SDK/runtime/model install.

All task-owned `codex-tmp-tip64b1-20261010-qa-*` directories were removed by `finally` on success **and failure**; final read-only audit found zero leftovers in system `/private/tmp` and the user temporary root. Their contents included web browser profiles/transient clips/model caches, not project copies. Old generated screenshot output was replaced with final screenshots; source/result bundles remain re-exportable in the reusable ignored build cache. The simulator is shutdown, no diagnostic Xcode build remains running, and only existing web preview is intentionally left available. No user recording/media, Docker volume/container, signing profile or physical phone state was erased.
