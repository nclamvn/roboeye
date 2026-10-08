# TIP-62 — Partner-test hardening

Dependencies: TIP-61D/E. Priority P0. 2026-10-08. Vibecode Kit v6.2, roles executed sequentially.

## Context / blueprint

Keep static browser/TypeScript/worker architecture and existing minimal video HUD. Extract only testable lifecycle/ownership helpers; no risky whole-application rewrite ahead of the partner session. Existing files belong to ongoing work and must remain intact.

Task graph: **62A** source lifecycle / wake lock → **62B** report/tooling/CI/documentation debt → **62C** three-channel rehearsal and go/no-go evidence.

## Requirements / acceptance

- **P-01 Source ownership:** Given slow permission/enumeration or device-list failure, when Stop/new file/new camera intervenes, then a late stream is stopped and cannot replace/label/play the newer source; enumeration failure cannot abort a valid camera.
- **P-02 Suspension:** Given an active live source, when hidden or track-muted, then no inference/new metres/warnings occur; old measurements are invalidated. When visible/unmuted, resume only the same owned session and its previously-running intent. Blocked autoplay yields an explicit retry action; manual clip pause remains paused.
- **P-03 BFCache:** Given pagehide/pageshow(persisted), then render loop restarts exactly once and UI stays usable, with source stopped; camera is not silently reopened.
- **P-04 Screen wake:** Best-effort wake lock only for a visible active live source. Stop/hide/replace releases it, asynchronous late acquisitions are released, denial is nonfatal and recorded. No guarantee that OS will keep a camera awake.
- **P-05 Reproducible QA:** One DriveSense partner command runs mandatory typed logic, build/security and lifecycle/mobile/source/controls regressions. CI includes new bounded recovery/journal regressions. Known fake/real-worker/physical scopes remain explicit.
- **P-06 Recorded-video proof:** Real pinned models process both checksum-matched historical road clips; exports have current schema, valid completed sample timeline and visible tracked vehicles. Replay rejects ordering/stale anomalies rather than forcing metre coverage. Performance/unknown coverage is recorded, not promised.
- **P-07 Camera readiness:** Genuine laptop camera probe without fake-device flags; physical PASS only if a real source is available and frames advance. Phone protocol tests rear permission, portrait/landscape, background return, interrupted track, exports and independent operation from laptop. Inaccessible hardware is **NOT TESTED**, never PASS.
- **P-08 Partner handoff:** Update current quick start/source-of-truth and provide concise rehearsal/go-no-go, exact build identity, per-channel verdicts and open product gates. No unsupported “commercial ready” badge.

## Verification / exclusions

Reproduce D-01 before patch. Unit tests for bounded ownership/races; browser E2E for hidden→visible, mute/unmute, BFCache, denied playback/permission/enumeration and stop/replacement; recorded clips with real models, and genuine hardware probe. Keep 1200 ms metric expiry, pins/shape/FP32, no cloud pixel upload or fabricated camera calibration.

Ground-truth accuracy and physical phone thermal/performance remain unclosed without device evidence. User is not required to drive on a highway to start this rehearsal. Completion and Verify reports must give implemented/total, AC results, numerical health and missing device channels. A new production deployment only follows current user authorization and passed software QA; no Git push in scope.

## Technical basis

[Page visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API), [track mute](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/mute_event), [pageshow/BFCache](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event), [wake lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API). Feature detection and rejection handling are required; API presence is not actual device acceptance.
