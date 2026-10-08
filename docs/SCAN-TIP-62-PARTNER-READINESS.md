# Full scan — partner-test readiness / TIP-62

2026-10-08 · Vibecode Kit v6.2 · Builder scan → Contractor triage.

## Inventory / architecture

- Actual checkout: `/Users/os/Documents/Codex/DriveSense-Mobile-Recovery-2026-10-06/roboeye`. Branch `codex/tip61-mobile-reliability`; baseline HEAD `8219b578cb4e`. Existing dirty/untracked TIP-61 work is preserved, not reset.
- 97 source files, 95 TypeScript modules, approximately 15,666 TS/CSS lines; DriveSense has 48 modules / 5,964 TS lines. 58 unit-test files; last verified suite 310 tests.
- Vite 7 / strict TypeScript 5.9 / plain DOM; static browser app. Three.js/MediaPipe/TFLite serve the independent RoboEye/AirSketch/RoboHand entry. DriveSense `drive.html` uses worker RT-DETR + pinned FP32 DA2, latest-frame capture, immutable same-frame binding, geometry/ROI/temporal abstention and shadow-risk rendering.
- Persistent diagnostics are bounded IndexedDB journals. No application server/auth/database/paid API is required. `.env` files are ignored; do not copy them to static output or documentation.
- Entrypoints: `/`, `/drive.html`; Node CLI corpus/profile/report checks; local road annotation/model-research tooling is not a production route. Production is existing Vercel HTTPS, build `80142f1f649a` at scan time.
- Code health: strict/no-unused TypeScript; zero TODO/FIXME and console.log/debug in src; nine `any` tokens need contextual review rather than a cosmetic rewrite. No lint configuration: **lint NOT RUN**, not zero lint errors. Source orchestration remains concentrated in `main.ts` and `drive/app.ts`.

## Evidence-backed debts / prioritization

| ID | Severity | Finding | Action |
|---|---|---|---|
| D-01 | P0 | visibilitychange pauses camera video; visible state has no resume path. Camera Play handler is disabled by source kind | Reproduce, then explicit bounded source lifecycle; invalidate old measurements; only resume an owned active session |
| D-02 | P0 | pagehide cancels render RAF and destroys source, but BFCache pageshow does not restart RAF | Resume rendering only; never silently reacquire camera or resurrect old metres |
| D-03 | P0 | enumerateDevices is awaited after stream acquisition; rejection/race can strand the stream or act on a replacement source | Nonessential enumeration cannot block playback; ticket/stream ownership guards around asynchronous work |
| D-04 | P0 | Track mute/unmute lacks handling; interrupted phone camera may appear frozen | Explicit suspension/resume, no stale capture/publication while muted |
| D-05 | P1 | Default qa/CI excludes new live/recovery/journal/portrait regression suites | Dedicated reproducible DriveSense partner gate; retain scope distinctions and add mandatory orchestration tests to CI |
| D-06 | P1 | Offline profiler still asserts report version 7 while app exports 10 | Central report-version constant and contract regression; run actual existing road clips |
| D-07 | P1 | README/X-Ray prescribe obsolete checkout and omit current phone/realtime evidence workflow | Current quick start + archived history + concise partner rehearsal / go-no-go matrix |
| D-08 | P1 | No screen-awake lifecycle; browser/OS may release wake lock or suspend camera | Best-effort, feature-detected wake lock; clean release; refusal is visible, not fatal |

## Test inputs / hardware boundary

Recovered historical uploads at their relocated local paths, verified against prior evidence before use:

- Test1.mp4: 3,258,278 bytes; SHA `83a2ee31d6bbdd205531f5c684b29d23d2573011ac988b12efb8058ffb9de93f`.
- Test2.mp4: 34,210,680 bytes; SHA `85d59cccacf5e968df17d92dad570ddbb1a72854e2221e1842a669fdb8cf575d`.

These are user road clips, not synthetic or independent metre ground truth. They remain local and will not be published to a host.

The system inventory initially reported **zero** cameras, but the subsequent
browser probe without fake-device flags opened an OS-selected stream. In-app
video advanced 0→4.94s, 1280×720; actual WebGPU workers ran 52 detector requests
without JS errors. No qualifying vehicle: no depth requests or metre proof.
The source has not been identified as the built-in laptop camera. This is source
and frame-flow evidence only, not physical road-distance/phone acceptance.
There is no tool-connected physical iPhone/Xiaomi. Mobile-sized Chrome fixtures
cannot substitute for iOS/Android/Brave device evidence.

## Decisions / boundaries

Extended regressions exposed a fixture UI debt: CSS hid Play/seek except for
offline `file`, although the fixture handler already supported pause/play. Both
sources now share the transport affordance. Camera models also wait for decoded
playback dimensions rather than starting a guessed landscape graph before play.
Unexpected camera pause has explicit retry; obsolete queued pause events cannot
cancel an opening/resuming source. No model/metric threshold change is involved.

RRI auto-answered from owner history: test laptop recorded video, laptop camera, phone rear camera; prioritize iPhone 16 Pro Max Chrome and Xiaomi 14T (Chrome baseline, Brave separately). No hardware purchase, native rewrite, new model, threshold relaxation or new provider. Contractor skips another architecture-approval checkpoint because this is in-scope lifecycle hardening, not an inference architecture change. Production update approval is requested separately; no Git commit/push inferred.

Physical accuracy, eligible lead coverage and sustained phone realtime remain P0 product gates, NOT debts that can be closed by documentation or desktop tests. Partner live-distance demonstration is NOT READY until a stationary physical-phone rehearsal succeeds and its exact-build session is reviewed.
