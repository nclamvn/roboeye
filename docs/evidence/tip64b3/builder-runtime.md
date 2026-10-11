# TIP-64B3 Builder — Native runtime

Date: 2026-10-11. Scope: Q05–Q08/Q11 runtime portion. Contractor owns final fingerprinted QA/release. Method: vibecode-kit v6.2; ownership coordinated with Core and UI Builders.

## Result

Implemented bounded runtime repairs without replacing the checksum-pinned Apple YOLOv3 FP16 artifact, relaxing measurement validity, changing signing, or installing on the phone. Artifact version is now **0.2.1 (4)** to distinguish B3 from B2.

| Requirement | Implemented evidence | Builder verification |
|---|---|---|
| Q05 | `DepthSession.expire` only watches camera lifecycle/heat/manual mode; automatic object presentation is published only for new worker output. UI Builder owns the sole presentation/expiry heartbeat. | Source inspection; final UI lifecycle tests owned by Contractor |
| Q06 | One retained ARFrame in flight, no frame backlog; cached model/request; adaptive detector interval 200–1000 ms, serious heat baseline 400 ms; transient retry backoff 250/500/1000/2000 ms, terminal incompatibility blocked until explicit camera restart. Old epochs cannot overwrite retry gates. | 10/10 runtime policy tests PASS in coordinated94/94 Swift suite; final native QA pending |
| Q07 | One validated depth/confidence lock pair spans up to12 active objects; 8×8 unique live samples/object remain unchanged. Metadata projection/packet only created when recording requested. Withdrawal while worker runs strips the packet before publication. | Source inspection; existing bounded v1 interoperability regression retained |
| Q08 | Bounded last64 timing samples/stage, nearest-rank p50/p95, counters for detector/tracker calls, work, capture-to-ready, depth, busy drops, retry skips, errors, lock pairs, metadata projections. Missing timing stays nil, not0. No imagery/labels/depth history in statistics. | Runtime policy tests cover window/counters/backoff/unknown timings |
| Q11 | Descriptor validates bundle resource, names, thresholds,80-class contract; runtime validates416×416 image input, two double threshold inputs and80/4 output dimensions. Unsupported Vision results produce an explicit blocked failure instead of a silent empty list. Model/license resources unchanged; project patched in place. | Swift syntax parse; Info/PBX lint; generator syntax check PASS |

## Scan and resolved debts

1. P1 — Model load/inference failures previously retried at camera cadence; incompatible Vision outputs became empty objects. Added typed terminal/transient failure policy, bounded retry gate and meaningful diagnostics/UI message.
2. P1 — DepthSession timer, UI heartbeat and worker callbacks rendered duplicate automatic snapshots. Removed timer republishing; preserved thermal/background/manual watchdog. There is no range hold or expiry relaxation.
3. P2 — Depth/confidence buffers were locked per object. Batched sampling now validates/locks once per frame; per-object evidence is still raw, same-frame and bounded.
4. P2 — v1 projection and packet allocated without recording. Gated them at capture and stripped cancelled recording output at publication.
5. P2 — Model assumptions were embedded in operations; runtime evidence lacked rolling stage distributions. Added validated model configuration seam and bounded local diagnostic summaries.

## APIs / ownership

- `ObjectFrameContext.recordingRequested: Bool = false` and `DepthSession.recordingRequested: Bool` are main-thread capture/consent inputs. No automatic consent or recording starts.
- `ObjectPresentation.diag: ObjectRuntimeDiagnostics? = nil` preserves synthetic fixtures without inventing runtime measurements.
- Diagnostics: `modelId`, `phase`, `lastFailure`; `detectorCalls`, `trackerCalls`, `busyDrops`, `retrySkips`, `failureCount`, `depthLockPairs`, `metadataProjections`; `work`, `captureReady`, `inference`, `tracking`, `depth` summaries with `sampleCount`, `p50Ms?`, `p95Ms?`.
- Pure policies: `ObjectModelDescriptor`, `ObjectRetryPolicy`, `ObjectLatencyWindow`, `ObjectRuntimeStatistics` in Core, portable testable without ARKit.
- ARKit remains the only capture owner; the serial Vision worker retains at most one frame. All depth sampling uses the same ARFrame/raw sensor geometry. Display-only smoothing remains a separate Core/UI responsibility.

## Changed files

- `native/ios/App/ObjectPipeline.swift`
- `native/ios/App/DepthSession.swift`
- `native/ios/Core/ObjectRuntimePolicy.swift` (new)
- `native/ios/Tests/ObjectRuntimePolicyTests.swift` (new)
- `native/ios/AssistiveDepthProbe.xcodeproj/project.pbxproj` (add Core sources/version only)
- `native/ios/App/Info.plist` (version only)
- `scripts/generate-assistive-ios-project.mjs` (deterministic source discovery/version; existing-project refusal retained)

Signing preserved: Team `55UDK8Q785`, app bundle `com.roboeye.assistive.depthprobe`, test bundle `.uitests`. Generator was **not** run against the existing signed project. Core `ObjectPresentation.swift` source registration belongs to this Builder; its implementation belongs to the Core Builder.

## Verification and limits

Builder checks: Swift frontend syntax parse PASS; `plutil -lint` Info/project PASS; generator `node --check` PASS. Core Builder coordinated the package run: **94/94 Swift cases PASS,0 failures, including10/10 runtime policy cases**. Native Release/analyzer, model smoke and UI tests remain Contractor gates, not claimed by syntax or portable Core checks.

The historical B2 real-camera receipt (maximum detector inference67.4 ms over a short smoke) is not B3 performance or a physical range-accuracy result. B3 phone latency, accuracy/recall, UI pacing, thermal endurance and accessibility user validation remain untested until the real-device gate. Bounding-box interior support is approximate camera-to-surface evidence, **not semantic instance segmentation or walking clearance**. Non-LiDAR/RGB-only capture is deferred. Unknown/ambiguous/stale metrics remain unknown; 300 ms expiry,600 ms coast and detector-backed identity TTL unchanged.

No Xcode build/install, dependency install, project copy, temporary build tree, commit, push or deployment was performed by this Builder. No temporary artifact was created or required cleanup. Status: **READY for Contractor QA; not a physical-performance or safety certification.**
