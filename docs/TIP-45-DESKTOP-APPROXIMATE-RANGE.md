# TIP-45: Desktop approximate vehicle range

## HEADER
- TIP-ID: TIP-45
- Project: RoboEye / DriveSense
- Module: Vehicle detection, metric depth, analysed replay
- Depends on: TIP-42, TIP-43, TIP-44
- Priority: P0
- Estimated effort: one focused implementation session

## CONTEXT
- Working directory: `/Users/os/Documents/Codex/2026-08-05/new-chat/roboeye-live`
- Key files: `src/drive/app.ts`, `src/drive/replay.ts`, `src/drive/tracking.ts`, `src/drive/metric-contract.ts`, `src/worker/drive-metric-worker.ts`
- Existing pattern: every selected video is sampled at 5 Hz, analysed, then replayed with synchronized interpolated tracks.
- Root gap: metric-depth is isolated in a lab and never reaches DriveSense samples or tracks. Without a measured camera profile, the product therefore always emits an unknown range.

## TASK
Integrate a pinned outdoor metric-depth model into the desktop analysed-video path so each eligible vehicle can display an approximate metric distance without mounting or calibrating a camera. Keep the existing calibrated ground-plane path available as a separate method.

## SPECIFICATIONS
- Use a dedicated product worker and a fixed landscape input contract. Preserve source aspect ratio with letterboxing and map detection boxes into model coordinates.
- Run detection and depth against the same decoded video frame. Store only per-box range observations, never a full depth map per replay sample.
- Estimate vehicle Z from a robust lower-central interior ROI; reject invalid, sparse, tiny, highly dispersed or out-of-contract depth instead of inventing a number.
- Smooth accepted observations per track with the existing temporal range filter. Replayed values retain sampled age/provenance and are never presented as fresh realtime inference.
- Learned metric depth works without a camera profile. A valid profile remains an optional geometric method and fallback, not an implied accuracy certificate.
- If the metric model is absent or fails, vehicle detection and replay remain usable and the UI says that distance is unavailable.
- UI and exported JSON must label the result `learned-unverified`, optical-axis Z, approximate, not bumper gap, not safe following distance, and not field-validated accuracy.
- Runtime model weights remain local/ignored; preparation is reproducible and pinned by size and SHA-256.

## ACCEPTANCE CRITERIA
1. Given a local video and prepared model, when analysis completes, then eligible vehicle tracks contain approximate metre values without a camera profile.
2. Given a landscape source, when metric input is built, then it is letterboxed without geometric stretching and ROI coordinates map correctly.
3. Given invalid/sparse/noisy depth or a weak/tiny detection, when range is probed, then the range is unknown with an explicit reason.
4. Given samples with accepted learned ranges, when replay runs between 5 Hz samples, then boxes move smoothly while range provenance and sample age remain honest.
5. Given the metric model cannot initialize, when video detection runs, then bounding-box analysis still completes and no fake metre value appears.
6. Given a user exports a report, then the report identifies detector timing separately from depth timing and states the non-realtime, unverified-distance limitations.
7. Typecheck, focused unit tests, full unit tests and production build pass. Browser PoC verifies visible approximate ranges and model-error degradation.

## CONSTRAINTS
- Desktop browser is the target for this TIP; phone optimization is deferred.
- No claim of production ADAS, collision warning, centimetre accuracy, or safety certification.
- No dependency or detector replacement in this TIP.
- Do not overwrite the older relative-depth worker or the independent TIP-44 metric lab.
- Preserve unrelated dirty-worktree changes.

## REPORT FORMAT
Create `docs/COMPLETION-REPORT-TIP-45.md` with requirement coverage, quantitative test evidence, limitations and READY/NOT READY verdict.
