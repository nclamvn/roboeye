# TIP-64B1 — iPhone native depth probe

2026-10-10 · Vibecode v6.2 · P0 · depends on TIP-64A. Approved by user: “triển khai nếu cài app gì cần cho tôi biết”. No subagents; sequential Contractor → Builder → independent Contractor review. Jev OFF.

## Scan / decisions / blueprint

Existing web foundation: closed v1 contract, original RGB intrinsics, +X-right/+Y-down/+Z-forward camera frame, row-major rigid pose, reference confidence/age/association gates, metadata-only replay. Existing web camera cannot expose native ARKit depth. Xcode 27.0, Swift 6.4 and iOS 27 SDK/runtime are installed. No connected physical device or signing account verified. 68 GiB free before builds. No added dependency, model download or SDK installation required.

User approved the previous proposal: checkpoint TIP-64A with a local commit, then a **separate native iPhone app**, physical point/range validation before semantic recognition. Android ARCore is TIP-64B2, not this task. No push, production deploy or App Store submission authorized in this turn.

Architecture: one ARSession owns RGB + unsmoothed sceneDepth + confidence + calibrated K + session-local pose. A small selected surface patch is sampled synchronously from the same ARFrame, with native row strides/pixel formats checked. SDK displayTransform is inverted for touch alignment, decomposed and checked against the web crop/rotation contract. Original calibration remains unrotated. No AR raycast-to-plane, guessed camera FOV, RGB metric model, fake calibration or hold-last-metres fallback.

Range: optical Z → Euclidean camera-to-supported-surface-point. Confidence low/medium/high → 0/.5/1 (support quality, not probability); high-only reference threshold. At least five distinct samples; reject mixed support, non-normal pose, age >300 ms, incompatible clock, invalid alignment or outside 0.5–5 m. Same-frame sceneDepth has ARFrame timestamp; ARKit does not expose a separate sceneDepth hardware timestamp. No claim that frame identity proves a new LiDAR exposure. User chooses/acknowledges the surface; this is not segmentation or object tracking. The screen probe stays screen-relative when the camera moves.

UI direction (frontend-design): photographic camera full area, white system type with black scrims for contrast, blue #2F80FF selected patch, amber #FFD166 uncertainty, red #FF6060 recording only. Native SF type scales with Dynamic Type, body 17 pt; one large range readout is the central instrument. Few 44-pt controls, no pulsing dashboard or decorative cards. Review: distinct from a generic stats dashboard because selection/measurement is the interaction, not decorative metrics. Camera permission/start explicit; unsupported simulator/device has an actionable explanation.

Portable Swift core owns math, versioned Codable metadata, bounded recorder and canonical checksum export. UIKit/ARKit adapter owns camera/lifecycle/UI; no web camera or second AV capture session. JSON imports into the existing web lab, with cross-language validation against TypeScript. Raw RGB/depth remain ephemeral native buffers; only up to 25 sparse support samples per frame are recorded, no images/video/audio/GPS/device identifiers. User starts a consent-bound, memory-only recording at ≤5 Hz; 600 frames /120 s/2 MiB caps. Background stops camera and erases metadata/consent; returning never auto-restarts. Export only after stop, explicit share sheet, task-scoped temporary files cleaned on dismiss/background. A downloaded/shared copy cannot be revoked remotely.

## Requirements / testable acceptance criteria

| ID | Requirement / scenario | Verification |
|---|---|---|
| B1-R1 | Separate native project builds for iOS and simulator without third-party install; web remains intact | Unsigned builds + web regression |
| B1-R2 | Runtime unsupported/permission/error states never fabricate depth; one camera owner; background/late permission cannot restart | Adapter review + simulator UI tests; hardware gate pending |
| B1-R3 | Original intrinsics, pixel-centre mapping/strides, display inverse and handedness produce aligned range | Portable math tests + SDK adapter review; physical alignment pending |
| B1-R4 | Low/mixed/missing/stale/untracked/out-of-domain evidence yields null, not an old number; thermal/error invalidates | Unit gates + simulator stale UI |
| B1-R5 | Explicit memory-only consent/caps/revoke/export; native JSON passes strict web schema/checksum | Unit privacy/caps + cross-language tests + lifecycle UI |
| B1-R6 | Measured labels bind to the stopped recording's exact last frame/target, never synthetic planned distance; holdout kept separate | Label binding tests + web evaluation |
| B1-R7 | Clear install/test instructions with 24-slot protocol and honest physical gates | README / completion report |

## Scope / install gate

Deliver source, local unsigned .app builds, deterministic project/config, tests/receipts, installation guide. An unsigned build is **not an installable production release**. User must connect/unlock/trust iPhone, enable Developer Mode and select their signing Team in Xcode. No Apple account login, certificate mutation, paid developer subscription, app installation or permission choice performed on their behalf. Free Personal Team may suffice for local development; TestFlight/App Store is separate. No additional hardware purchase. Physical capture/accuracy/P95/30-minute thermal acceptance remains NOT TESTED until the app runs on the real device with measured truth.

## Completion / verify

Report implemented/total requirements, tests pass/fail/untestable, build/lint/type results, exact source fingerprint, SDK/runtime, physical limitations and scratch cleanup. Status must distinguish **build/test-ready** from real-device/assistive-navigation acceptance.
