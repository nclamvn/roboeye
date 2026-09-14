## COMPLETION REPORT — TIP-46

**STATUS:** DONE — READY for a controlled camera-only shadow-risk demonstration;
NOT READY for public-road warning, braking decisions or a certified FCW claim.

**OUTCOME:**
- Added scale-free optical TTC from temporal box expansion, with fail-closed reset
  after a missed/weak observation.
- Added range TTC, reciprocal fusion and an explicit agreement/conflict state.
- Added transparent perspective-corridor evidence, side-target rejection and one
  deterministic primary threat.
- Added speed-aware time-headway and Vietnam TT38/2024 good-condition reference
  distances; the optional 25% adverse multiplier is labeled as an engineering
  demo buffer, not law.
- Added a high-contrast metre-only Shadow Risk HUD, primary-target brackets,
  rate-limited opt-in local audio and a bounded evidence/event log in report
  schema v4. TTC remains internal/report evidence rather than a displayed unit.
- Added deterministic per-track colours. High-risk red temporarily overrides
  on-video identity colour without changing track identity in the pipeline.
- Simplified the default HMI to distance-only large badges; moved risk console,
  evidence, track details, corridor visualization and configuration behind the
  closed-by-default Analysis disclosure. Source, stop/play and opt-in sound
  remain directly accessible; synthetic/replay provenance remains visible.
- Expanded video to the full available width without stretching/cropping;
  accepted high-risk boxes receive a steady translucent red fill/outline. A
  compact red warning breathes slowly (4 s, 12% opacity modulation), with static
  reduced-motion fallback.
  Proximity wording requires measured range; optical-only risk never claims a
  distance. Conflicting/weak/stale risk does not activate the red warning.
- Removed all outer video margins/header/transport rows. Brand, mode and the
  compact safety notice now overlay the video; primary controls sit in a
  translucent floating dock with inline SVGs, accessible labels, real playback
  state, preserved audio icons and optional native fullscreen. No backdrop blur.
- Reframed the HMI as one viewport camera shell. Source video and boxes share a
  contain transform, preserving aspect ratio without crop/stretch. A centered
  road-line illustration and one primary open-video action replace the left-heavy
  empty screen. The dock uses uniformly sized icon actions; play/timeline appear
  only for local files. Analysis is an internally scrolling non-modal overlay
  inside the video, with native details state, close action and Escape focus
  return. Responsive layouts preserve the compact PoC notice.
- Fixed warning-state flicker caused by applying live age-decay to every
  interpolated replay frame. Recorded/synthetic evidence is constant only
  inside its bounded sample interval (205/105 ms); displayed measurement age
  is unchanged. Live freshness and weak/conflict/missing-track gates remain.
  Risk snapshots expose the explicit evidenceMode in the existing report.
- Hardened replay evidence continuity: interpolated confidence is bounded by
  both observations, reset motion cannot retain an old TTC, and depth loss clears
  range-derived motion without erasing independently supported optical approach.
  The 80 ms end hold reports actual measurement age, including fractional
  timestamps; out-of-timeline seeks do not expose cached evidence.
- Kept all privacy, provenance and abstention behavior from TIP42–45.
- Fixed a silent long-file failure: the previous 120 s replay limit rejected a
  3-minute upload after AI startup, with the error hidden in closed Analysis.
  Local files now support up to 5 minutes at the same 5 Hz (at most 1,501
  samples). Metadata validation precedes AI initialisation; a compact in-video
  notice exposes reading/loading, real completed-frame progress and ETA,
  cancellation, retry, completion and persistent errors. Partial results are
  never promoted to a completed replay.

**RESEARCH BASIS:**
- Created `docs/research/camera-only-highway-software/REPORT.md` with 21 primary or
  official sources covering SOTIF/FCW boundaries, monocular ambiguity, optical
  TTC, temporally consistent depth, tracking, lane/drivable-space perception,
  datasets, edge deployment and Vietnamese road/vehicle rules.
- Architecture decision: strengthen temporal geometry and evidence fusion before
  adding another heavy model. Monocular metric depth remains useful evidence but
  cannot by itself remove the 2D-to-3D ambiguity or establish field accuracy.

**FILES CHANGED:**
- `src/drive/tracking.ts`: scale-motion state plus optical/range TTC.
- `src/drive/risk.ts`: corridor evidence, TTC fusion, headway, statutory reference
  and primary-threat policy.
- `src/drive/app.ts`: live risk evaluation, HUD rendering, event/audio lifecycle
  and report v4.
- `src/drive/demo.ts`, `drive.html`, `src/drive/drive.css`: deterministic demo and
  product presentation.
- `tests/unit/drive-risk.test.ts`, `tests/unit/drive.test.ts`: deterministic gates.
- `src/drive/replay.ts`, `tests/unit/drive-warning-stability.test.ts`: replay
  evidence continuity and full sample-to-HUD regression fixtures.
- `src/drive/analysis-job.ts`, `tests/unit/drive-analysis-job.test.ts`,
  `tests/unit/drive-replay.test.ts`: long-file limits and job lifecycle.
- `docs/TIP-46-SHADOW-RISK-HUD.md`, `docs/DRIVESENSE-USER-GUIDE.md` and research
  report: contract, operation and limitations.

**VERIFICATION:**
- Unit suite: 149/149 passed (including 3-minute replay and job-lifecycle cases).
- TypeScript: 0 errors.
- Production build: PASS.
- Browser walkthrough: PASS. Synthetic demo selected lead vehicle `#1`, showed
  its estimated distance and the 55 m TT38 reference at 80 km/h, while marking
  truck `#2` as outside the estimated corridor. No TTC/seconds appear in the HUD.
- Minimal-HUD browser walkthrough: PASS — collapsed Analysis hides diagnostic
  text and controls; expanding restores the existing features, collapsing leaves
  two distinct distance-only badges and warning-only primary corner brackets.
  Browser error/warning logs remained empty.
- Full-width/red-warning walkthrough: PASS — 1248 px stage in a 1280 px
  viewport (16 px page margins), native 16:9 ratio, no horizontal overflow.
  Synthetic approach displayed red fill/outline, metre badge and "Quá gần";
  stopping the source hid and cleared the warning. Browser logs remained empty.
- Floating-dock walkthrough: PASS — edge-to-edge stage at 1280 px and 390 px;
  all controls remain inside the frame, audio toggles preserve the SVG, native
  fullscreen enter/exit changes its accessible state. At 320 px, stage is
  320×180, no horizontal overflow, warning ends at 81.4 px before dock at 90 px.
  Temporary viewport overrides restored after verification.
- Slow-warning verification: PASS — browser computed animation duration 4 s;
  regression reproduces the former confidence-threshold crossings at 5 Hz,
  verifies stable sampled risk and rejects expired/weak/conflicting evidence.
- Sample-to-HUD regression: PASS — nine deterministic tests run the actual
  tracker, replay, risk and HUD helpers. A stable fixture has no warning-state
  transitions across 120 simulated 60 FPS render steps. Missing vehicles, depth
  loss, weak endpoints, optical-only approach, the 80 ms tail, fractional times,
  future-signal isolation and random seeking are covered. Before the replay fix,
  three tests failed on retained range TTC, retained optical motion and zero tail
  age. These are software-continuity fixtures, not detector/depth accuracy,
  measured display FPS, sensor latency or field false-warning evidence.
- Single-frame HMI walkthrough: PASS — initial stage/document 1280×720, no outer
  overflow, play and timeline hidden until a file source exists. At 390×844,
  analysis is within the stage at (14,100), size 362×628, with independent scroll.
  Native close and Escape return focus to summary; scroll does not move/extend
  the page. A 640×360 short viewport also remains one page-sized shell. Temporary
  viewport override restored. These supersede the earlier aspect-ratio-only
  stage dimensions above. The empty-stage primary action opens the native
  single-file chooser; it was cancelled without uploading private test media.
  Synthetic boxes and red warning still render with the shared contain mapping;
  this UI walkthrough is not a real-video detector/depth accuracy evaluation.
- Security audit: PASS — 0 critical/high advisories and 0 Sharp exposure in
  application source/browser bundle.
  This audit predates the long-file UI fix; no dependencies changed in that fix.
- Long-file regression: PASS — two cases reproduced the old 120 s rejection
  before the limit change. A 180 s fixture now plans 901 actual sample times,
  including 179,950 ms, and preserves the replay tail. Lifecycle tests cover
  preflight, real progress/ETA, metadata timeout, partial completion, persistent
  errors and explicit cancel/retry. In the browser, a native H.264 180 s colour
  fixture was accepted and actual RT-DETR/depth inference began (901 planned
  samples); cancellation released both workers and retry restarted processing.
  A 301 s fixture showed the visible limit error with neither model loaded.
  A 2 s colour fixture completed all 11 AI samples in 28 s and the in-video Play
  action hid the job notice during playback. The detector used WASM; processing
  is still materially slower than realtime. The 180 s inference run was cancelled
  intentionally, not tested through all 901 AI samples. These non-private colour
  videos validate file handling, not vehicle recognition or metre accuracy on
  the user's unattached road video. No page error/warning logs were observed.
- Diff hygiene: PASS — `git diff --check` reported no whitespace errors.

**ACCEPTANCE COVERAGE:**
- R46-1 optical TTC without metric range: PASS.
- R46-2 agreement/conflict-aware fusion: PASS.
- R46-3 path evidence + one primary threat: PASS.
- R46-4 speed/headway/TT38 reference: PASS.
- R46-5 fail-closed conflict and weak evidence: PASS.
- R46-6 clear on-video visualization: PASS.
- R46-7 opt-in audio + bounded event log: PASS.
- R46-8 report schema v4: PASS.
- R46-9 privacy/provenance preservation: PASS.

**KNOWN LIMITS:**
1. Camera live has detector plus optical TTC, but not live metric distance.
2. Local-file video remains analyse-then-replay; detector throughput is not yet
   realtime on the tested WASM fallback.
3. Perspective corridor is not detected lane geometry and does not model curves,
   ego yaw, pitch change, grade or cut-in probability.
4. Evidence percentage is a transparent engineering heuristic, not a calibrated
   probability.
5. No independent synchronized field ground truth exists yet; therefore no MAE,
   coverage, false-warning rate or road-safety claim is valid.

**NEXT ENGINEERING GATE:** TIP47 should create a synchronized, journey-split event
dataset and benchmark detector, TTC, corridor association, cut-in and latency.
Only then should a temporal lane/drivable-space challenger and edge-hardware
profile be promoted into the main pipeline.

**OVERALL VERDICT:** Software demonstrator is substantially stronger and suitable
for a controlled presentation. It must remain in shadow mode until field gates
and the vehicle-installation safety case are complete.
