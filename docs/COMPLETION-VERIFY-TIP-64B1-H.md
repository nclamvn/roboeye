# Scan / Completion / Verify — TIP-64B1-H

2026-10-10 · Vibecode v6.2 · sequential Contractor → Builder → independent Contractor review. Jev OFF; no subagents.

**Hardening DONE. Software READY for controlled installation/rehearsal. Investor demonstration of a full assistive-vision product NOT READY.** No physical iPhone is connected, no signing Team is configured, and no signed build or installation has been verified. No promise of zero crashes/zero latency or physical accuracy can be inferred from the tests below.

## Scan and scope

112 browser source files; isolated Swift UIKit/ARKit app with six App/Core files, portable core and simulator tests. Existing Vite/strict TypeScript/Three.js/MediaPipe/browser workers remain separate. No native dependency, API subscription, model download, new simulator/runtime or hardware purchase. No new database/auth/network service. Native App/Core has no TODO/FIXME/fatalError/try! markers. Web/native lint is not configured; **NOT RUN**, not “zero lint errors”. Existing `.env.local` remains ignored and was not read/copied.

The smartphone virtual-eye vision still lacks native semantic recognition, automatic object tracking and speech/haptics/navigation. `/assist.html` is an evidence/replay lab, not the installable depth provider. Native Depth Probe uses manually selected surface support; it does not automatically recognize all surrounding objects. DriveSense's browser road-range pipeline is separate: the near-field LiDAR probe must not be presented as a highway distance upgrade. Legacy hand/sketch rendering is not proven physically accurate or smooth by its mock regressions.

## Findings fixed

- Export originally canonicalized/hashes up to a bounded 2-MiB recording on the main UI thread. It now serializes on a utility queue, single-flight. Revocation/background suppresses old results before files/share presentation. A worker snapshot may remain transiently until its bounded task completes; this is disclosed, not called immediate byte erasure.
- Valid readout updates are coalesced to at most 10 Hz and avoid repeated label/title writes. Stale/unavailable values clear immediately on detection. Pending readouts are age-checked again before presentation. Sparse sampling remains ≤15 Hz; queued stale callbacks are rejected before buffer/geometry work. These are **scheduling bounds**, not measured sensor FPS or end-to-end phone latency.
- A common-mode heartbeat independently enforces recording time caps during stalls/scrolling. Broken/NaN/backwards recording clocks stop rather than leaving an active session forever. Record is disabled until the first compatible camera clock exists.
- Explicit cancellable camera-start state; late permission callbacks are epoch/foreground guarded. Running capture stops on loss of foreground, error/interruption, critical thermal state or memory warning. Serious heat reduces sampling and preview-render load. The app restores the previous idle-timer setting after stopping. Full physical permission/interrupt behavior remains device-gated.
- Measured truth binds to the original recording UUID/frame/target. Clearing/replacing a recording cannot assign an old alert's number to a new frame with the same numerical ID. Revocation dismisses pending truth/share UI.
- Depth support rejects unknown units, out-of-image/nonfinite coordinates and invalid confidence. Crop arithmetic is bounded inside the source image; sparse sample limits match the strict web contract. No range/age/confidence threshold was loosened.
- QA discovers an existing simulator instead of hard-coding a device UUID; preserves signing configuration; uses process deadlines, bounded logs, exact source fingerprints and finally-cleaned task scratch. Read-only installation preflight stores no device identifiers and changes no signing/account state.

## Scoped coverage / acceptance

| REQ | Output / software verification | Outstanding physical check |
|---|---|---|
| H1 | Coalesced bounded presentation, second age check, old-frame early discard; stale/retarget/rotation tests | Actual responsiveness/blackout/accuracy |
| H2 | Independent cap heartbeat, empty-time-cap and bad-clock tests | OS scheduling/long run on phone |
| H3 | Explicit start cancellation, lifecycle/idle/thermal/memory handling; simulator background test + adapter review | Permission/interruptions/temperature on device |
| H4 | UUID/frame/target-bound labels, old-binding refusal, dismissed modals | Real measured frame and alert flow |
| H5 | Off-main single-flight export, cancelled completion, error and retry core tests | Files/AirDrop/share interactions on phone |
| H6 | Stronger support/crop checks + strict Swift/TypeScript interoperability | Actual RGB-depth registration and measured truth |
| H7 | Release/analyzer, simulator, browser regression and cleanup receipts | Physical camera tests not substituted by mocks |
| H8 | Read-only preflight, native install/rehearsal guide, explicit missing features | User device trust/Team/signed installation |

8/8 **scoped hardening outputs** implemented. This is not 100% of the end-product vision or device acceptance. All physical checks above remain **NOT TESTED**, not deferred cosmetic issues.

## Frozen QA evidence

- [Final native + expanded QA](evidence/tip64b1/summary.json): `pass:true`, before=after `b95b9cac9ecd1f9565cf057985cd699af19778ae0760dd5e513cf27163a33cd6`. Fingerprint covers native sources/project/guide, browser source, unit/selected UI tests/helpers and QA tooling.
- Swift **25/25 PASS**, no failures. Includes truth-replacement, invalid clock/support, stale early-discard, crop edge precision, 100 recording/revocation cycles, largest bounded export, off-main work/single-flight/cancellation/error recovery.
- Cross-language **5/5 PASS**: closed fields/nulls, canonical floats, checksum/tamper rejection, range parity. Generated contract fixtures are not hardware captures.
- Native UI **5/5 PASS**, no failures/skips/runtime warnings on existing iPhone18Pro/iOS27 simulator. Manual confirm/stale refusal, retarget/rotation invalidation, background clear/no auto-restart, unsupported sensor, Dynamic Type landscape control reachability. Permanent simulation watermark; device build cannot record/export this fixture. Xcode runner's `no debugger version` diagnostics are not a runtime-crash claim.
- iOS **Release unsigned build + analyze PASS**, no compiler errors; app version **0.1.1 / build 2**, unsigned app bundle approximately **544 KiB** excluding system frameworks. This is not an installable signed IPA.
- Existing TypeScript **353/353 PASS**, **14/14 DriveSense QA gates PASS**, **16/16 web-lab browser cases PASS**. Real pinned desktop detector/depth inference passed; live camera tests use mocks/fake browser devices and do not validate iPhone/Android hardware.
- Detection/AirSketch/RoboHand **all three additional browser-contract suites PASS** on final source. No fatal browser errors. Their gesture/render latency samples use mocks, not measured real-hand/phone performance.
- Security audit **0 high /0 critical**; typecheck/build PASS; `git diff --check` PASS. Native/web lint **NOT RUN** (not configured).

Full web regression was run during this task. The final native refinements reused it only after exact source equality against `5fc3f5be390160f31b7b6ce7e2371ebaff415edfc6b6f311d03a5a096c0e4eba`; native/core/interop/UI/build/analyzer and all three legacy suites ran again. [Prior failed receipt](evidence/tip64b1/summary-before-native-review.json) is retained, not overwritten as a pass.

Independent expanded QA found a legacy detection **test race**. Diagnostic DOM showed one lock at raw-panel readiness, then two: score .97 renders immediately, score .86 needs a second hit (`minHits=2`, immediate threshold .92). `refreshAnnotations` updates raw rows on the worker callback; RAF draws confirmed tracks later. Test now waits for the actual visible two-lock presentation with a 2-second bound and retains the exact two-box/badge assertions. No production tracking/model threshold changed. [Diagnosis](evidence/tip64b1/review-failure/detection-race.md).

SDK life-cycle behavior was cross-checked against Apple primary documentation: [session life cycle/tracking quality](https://developer.apple.com/documentation/arkit/managing-session-life-cycle-and-tracking-quality), [session interruption](https://developer.apple.com/documentation/arkit/arsessionobserver/sessionwasinterrupted(_:)), [delegate queue](https://developer.apple.com/documentation/arkit/arsession/delegatequeue). This does not replace device testing.

## Installation / demo go-no-go

[Installation and rehearsal guide](../native/ios/README.md) · [latest read-only preflight](evidence/tip64b1/install-preflight.json).

Needed app: **Depth Probe**, installed from Xcode, not a Chrome/Safari link. No extra third-party app/model/API purchase. Current preflight: **0 physical iPhones**, Team unconfigured, signed build/installed state **NOT VERIFIED**. Connect/unlock/Trust iPhone, select your Apple Team in Xcode, enable Developer Mode if required, Run Release on the phone. Account login/signing credentials stay with the user. Local developer signing is not a commercial distribution channel.

Before any live investor claim: test first permission/start/stop, measure opaque points at 1/2/3 m using a real tape, export/import one real recording, retarget/rotate/background/revoke, then a 30-minute thermal/crash rehearsal on the exact intended phone. All 24 physical collection positions remain uncollected; MAE, phone latency, sustained coverage and crash/thermal rates are unknown. ARFrame identity is not proof of a new independent LiDAR exposure, and the SDK frame-age limit is not measured photon-to-screen latency. Do not use for independent blind mobility or driving decisions.

Current installable scope after user signing: **controlled manual point-depth prototype**. The fuller investor-demo virtual-eye experience requires the approved next semantic association/tracking/audio phase and physical gates; no cosmetic hardening can replace them.

## Cleanup / release status

All three task QA scratch directories (`…kuBN3a`, `…Z4BUl6`, `…sw9Hfj`) and both read-only preflight scratch directories were removed by their `finally` blocks. Final read-only audit in the user temp root and `/private/tmp` found **zero task-prefix leftovers**. They held transient generated QA/browser data, not source or user recordings. Generated screenshots were replaced with final screenshots; result bundles remain re-exportable from the reusable ignored Xcode build cache. No simulator was erased; it is shutdown. No whole-project copies, dependency/model/runtime installs, Docker or per-task Next build directories.

Disk approximately **64 GiB free**. Reusable `native/ios/.build` /`.build-xcode` stay for installation/retest; no sensitive `.env` contents or Apple credentials copied. Existing Mac web preview `/assist.html` on port4197 responds HTTP200; that is a lab, not the native app.

No commit, push, HTTPS production change, account sign-in or physical app installation performed in this turn. Existing production remains unchanged. **Overall: READY for software-controlled install testing; NOT READY for a claimed complete, validated investor demonstration.**
