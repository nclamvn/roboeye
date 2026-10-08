# Completion Report — TIP-62 / partner-test hardening

2026-10-08 · Vibecode Kit v6.2 · Builder delivery.

## Outcome / scope

**Software deliverables implemented 8/8. Software gates PASS; physical-phone
acceptance remains PARTIAL.** No claim of commercial road-safety readiness.

Contractor scan → requirement/blueprint → Builder reproduce/fix → QA → Contractor
verify were performed sequentially in the same agent. No external team messages,
new hardware, paid API, Git reset, clip upload, model/threshold relaxation or
unapproved Git commit/push. Existing dirty TIP-61 work is preserved.

## Implementation and acceptance mapping

| REQ | Implementation | Evidence / verdict |
|---|---|---|
| P-01 | Camera ticket ownership; stop late streams; optional enumeration no longer blocks play; permission denial actionable | Source/browser race cases PASS |
| P-02 | Bounded source state machine; hidden/muted invalidate old metres; resume owned playing intent; explicit blocked/unexpected-pause retry; manual fixture pause preserved | Before bug reproduced; 15 after cases PASS |
| P-03 | pagehide tears down; persisted pageshow restarts RAF once without reacquiring camera | Simulated BFCache PASS; no physical Safari claim |
| P-04 | Single best-effort screen-lock request; release on suspension/Stop/replacement, discard late lock, nonfatal denial | Unit/race cases PASS; wake is not camera availability |
| P-05 | Central schema-10 version; `qa:drive-partner`; runtime-source snapshot guards; CI mobile/recovery/journal/lifecycle checks | 14/14 gates; 319/319 unit; lint NOT RUN |
| P-06 | Both exact-SHA old road clips, real pinned models, offline + wall-clock pipeline; publication/order validation | 2 offline + 2 realtime runs PASS, accuracy UNVALIDATED |
| P-07 | OS camera-source probe without fake flags; real-worker frame flow; physical phone protocol | Stream flow PASS only; built-in laptop identity and iPhone/Xiaomi hardware NOT VERIFIED |
| P-08 | Current source-of-truth/README, partner rehearsal, limits and exact build/rollback evidence | Handoff PASS, actual-phone gate remains open |

Additional QA found and fixed fixture transport hidden by CSS, a pre-play
landscape-model guess, obsolete queued pause events and missing unexpected
camera-pause retry. Models now start after decoded playback dimensions exist;
this prevents an avoidable wrong-orientation load, not a measured phone speedup.

## Numerical health

- Strict TypeScript/build: PASS; unit **319/319**, 0 failed/skipped.
- Dedicated software QA **14/14** with identical before/after runtime-source
  snapshot. 15 source cases, 6 live orchestration cases, 6 portrait/per-object
  checks, 3 bounded-recovery cases, 4 journal cases, 7 feature-toggle checks,
  7 video-anchor cases. Fake/real-worker/physical scopes are explicit.
- Real model smoke: detector/depth on WASM and WebGPU, external requests blocked.
- Detection, AirSketch, RoboHand and release E2E: PASS in mocked contract scope;
  they do not certify hand articulation or perception quality on real users.
- Release integrity: 5 checks PASS. `git diff --check`: PASS.
- npm audit: **0 critical, 0 high, 5 moderate**, not zero vulnerabilities.
- No configured lint: **NOT RUN**, not “0 lint errors”.

## Actual recorded road video

| Input / preset | Duration | Sample count | Processing, excluding startup | Depth successes / failures |
|---|---:|---:|---:|---:|
| Test1 / balanced, 2.5 samples/s | 19.5s | 50 | 8.10s | 50 / 0 |
| Test2 / fast, 1 sample/s | 186.73s | 188 | 28.02s | 183 / 0; 5 skipped |

These are desktop observations, not a causal before/after speedup or realtime
sensor latency. Fast sampling can miss brief events. Exact source SHA is in
`evidence/tip62/recorded-offline.json`; input clips/screenshots remain private
local files, not in repository/static deployment.

All planned samples completed in order; maximum decoded timeline deviation
0.001 ms, within the existing `<5 ms` seek contract. Original and midpoint HUD
views contain zero published ground-row ordinal inversions after safety gating.
This is an internal consistency check under the road-plane assumption, not
independent physical-distance correctness.

Across sampled + midpoint track views, only **31.0% / 32.4%** have accepted
metres; remaining views are explicitly unknown (ordinal conflict, tiny ROI,
unconfirmed/reacquiring/clipped track). Do not advertise these as accuracy or
eligible-lead coverage. Independent metre reference count: **0**.

Wall-clock actual-model recorded sessions: both detector/depth WebGPU. Desktop
frame-to-overlay P95 **175 / 143 ms**, depth P95 **142 / 125 ms**. Whole-session
visible-metre availability **53.6% / 51.5%**, including cold warm-up; maximum
blackouts **9.76 / 8.71s**. Eligible coverage remains null. Clip loops reset
current-generation live counters; the ledger retains whole-session accounting.
No claim that phone realtime or the 95% commercial coverage gate has passed.

## Camera / remaining readiness gates

The OS-selected stream advanced 0→4.70s at 1280×720. Actual WebGPU workers ran
55 detector requests without JS errors. No eligible vehicle was present, hence
zero depth requests: camera metre accuracy was **not tested**. System inventory
had initially reported no camera; browser acquisition contradicts treating that
inventory as authoritative. The stream is not identified as the built-in laptop
camera. No physical iPhone/Xiaomi is connected to these tools.

GO: recorded-video demo and HTTPS hardware rehearsal. NO-GO: asserting accepted
live-phone ranging or using the app to decide braking/steering. Actual-phone
after-session, independent metric truth, eligible lead coverage, long thermal
soak and verified road/contact assumptions remain product P0 gates.

## Open debt / decision log

- 5 propagated moderate findings originate in `sprintf-js@1.1.3` via
  `transformers → onnxruntime-node → global-agent → roarr`. Direct application
  code does not use that formatter; conditional browser export/native bundle
  checks pass. This is not a complete taint/security audit. The reviewed
  [GitHub advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) reports no
  patched sprintf version. npm proposes a major Transformers migration; defer
  to an isolated compatibility/model gate instead of changing pinned runtime
  immediately before demo. Risk remains OPEN; re-review before wider release.
- Orchestration concentration (`main.ts`, `drive/app.ts`) and no lint config
  remain P1 maintainability debt. Targeted extraction was chosen over a whole-app
  rewrite to preserve features and measure output.
- The next product gate is exact-build stationary iPhone/Xiaomi JSON evidence,
  then a controlled accuracy/performance benchmark. No highway driving or new
  hardware investment is required to start permission/lifecycle rehearsal.

## Delivery

Build **1b70083ec2c0**, source
`b3959cc788bf01d9de567d2cb164de6de43beedcd2c50ec846184b18781f950d`,
runtime `e1fda66b8d99`. Baseline Git `8219b578cb4e` plus preserved dirty work.
Local build, QA manifest and Vercel prebuilt agree; no clip/candidate/secret files
in static output. Production ID `dpl_FkREpCfQkNaiJMdgZbArHUcF99nH` READY.
Final HTTPS checks/alias and scoped go/no-go: `VERIFY-REPORT-TIP-62.md`.
