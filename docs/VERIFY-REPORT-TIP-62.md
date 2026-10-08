# Verification — TIP-62 / partner readiness

2026-10-08 · Vibecode Kit v6.2 · Contractor review of measured output.

## Verdict

**APPROVED: software hardening, recorded-video demo, HTTPS device rehearsal.**
**PARTIAL / NOT ACCEPTED: live-phone distance demonstration and commercial road safety.**

Implemented deliverables **8/8**. Software acceptance **7/7 PASS**; full P-01→P-08
acceptance **7/8 PASS + P-07 PARTIAL** because no physical iPhone/Xiaomi after-test
or identified built-in laptop-camera metre test exists. No new failing software
ACs remain on the frozen final source. Open product P0 gates are not labelled fixed.

## Traceability / quantitative evidence

| Gate | Result | Evidence |
|---|---|---|
| Typecheck, production build, code unchanged through QA | PASS | `evidence/tip62/software-qa.json` |
| Logic | 319/319, 0 fail/skip | software QA unit receipt |
| Mandatory partner command | 14/14 stages PASS | software QA source-before/source-after identical |
| Lifecycle / permission / source races / pause / graph orientation | 15 cases PASS; initial bug reproduced | `source-lifecycle-before.json`, `source-lifecycle.json` |
| Bounded AI recovery / stale data / journal persistence | 3 recovery + 6 live + 4 journal cases PASS | `recovery.json`, `live-orchestration.json`, `journal.json` |
| Portrait/per-object accounting | 6 checks PASS | `portrait-diagnostics.json` |
| HUD feature switches / video anchor | 7 + 7 cases PASS | `controls.json`, `video-anchor.json` |
| Real model smoke | WASM/WebGPU detector + depth PASS | `real-model-smoke.json` |
| Historical clips | 2 complete offline + 2 wall-clock actual-model runs PASS | `recorded-offline.json`, `recorded-realtime.json` |
| Existing independent features | 21 detection + 21 AirSketch + 16 RoboHand mocked contract checks PASS | Local CLI logs; not physical gesture/perception quality |
| Security | 0 critical, 0 high, **5 moderate OPEN** | `dependency-audit.json` |
| Lint | **NOT RUN** (not configured) | Maintainability debt, not reported as clean |
| Live HTTPS assets / headers / identity | **18/18 PASS** | `https-deploy-verification.json` |
| Production UI | 430×932 smoke PASS | `https-ui-smoke.json` |
| Actual compiled metric workers | **4/4** orientation×backend native parity/recovery PASS | `https-real-model-smoke.json` |
| Actual compiled source lifecycle | **6/6** PASS; canvas source/faults simulated | `https-source-lifecycle.json` |
| OS camera frame flow | 55 real detector requests, advancing stream, 0 JS errors; no eligible vehicle | `camera-source-probe.json` |
| Actual iPhone/Xiaomi / physical metre truth | **NOT TESTED / UNVALIDATED** | No tool-connected phone; independent reference count 0 |

Source pause tests require newly decoded frame flow, not merely `paused=false`
(play intent is synchronous while `play()` completion is asynchronous). Source
lifecycle snapshots were checked after frames resumed on the compiled HTTPS app.

Earlier exploratory runs exposed genuine fixture-control hiding and a pre-play
shape guess; both were fixed, not bypassed. A development-server recovery run
also timed out while source was being edited, and an overlapping run collided on
its port. Final QA was rerun serially with before/after source snapshot equality;
those exploratory runs are not used as passing evidence. Timeline collection
uses the existing decoded-seek `<5 ms` contract, strict sample count and order;
observed difference 0.001 ms is media-time representation, not missing frames.

## What the numerical results do NOT prove

Test2 (186.73s) processed in 28.02s **at 1 sample/s**; Test1 in 8.10s at 2.5
samples/s. These are offline timings, not phone sensor FPS or before/after
algorithm speedup. Sample + midpoint measured-track fractions are 31.0% / 32.4%.
The rest are conservatively unknown, not correct metres or model “accuracy”.
Wall-clock desktop sessions include startup: full-session metre visibility
53.6% / 51.5%, maximum blackouts 9.76 / 8.71s; eligible lead coverage is unknown.
No eligible vehicle in the camera-source probe means zero camera depth requests,
not a successful camera ranging test. None of this closes physical accuracy or
30-minute phone thermal/coverage gates.

No threshold/1200 ms expiry extension, invented calibration, FP16 promotion,
metre-value sorting/swapping or pixel uploads were used to obtain a pass.

## Exact production identity / rollback

- Canonical: `https://roboeye-drivesense.vercel.app`
- Test: `https://roboeye-drivesense.vercel.app/drive.html?v=tip62-1b70083ec2c0`
- Current deployment: `dpl_FkREpCfQkNaiJMdgZbArHUcF99nH`, **READY**; canonical
  alias independently inspected and matches created deployment.
- Immutable deployment: `https://roboeye-drivesense-3gtfonxcv-nclamvn-gmailcoms-projects.vercel.app`
- Build: `1b70083ec2c0`; runtime `e1fda66b8d99`.
- Source: `b3959cc788bf01d9de567d2cb164de6de43beedcd2c50ec846184b18781f950d`.
- Git baseline: `8219b578cb4e` plus preserved dirty TIP-61/62 changes. **No new
  commit/push**; baseline HEAD alone is not the deployed-byte identity.
- Prior production retained for authorized rollback:
  `dpl_F8nLUAwdfoxhaPyKbezQZG9Wbdr5` (previous build `80142f1f649a`).

User explicitly approved production deployment after local software QA.
Local build, prebuilt, HTTPS release, worker/model hashes and QA source agree.
No secrets, candidate FP16/native references or owner video files were shipped
in the static output. Receipt: `evidence/tip62/deployment-receipt.json`.

## Handoff / next gate

Use `PARTNER-REHEARSAL-TIP-62.md`: warm models, 1× rear camera, stationary test,
rotate, hide/return, Stop/reopen, then export current and saved JSON. Phone runs
independently of laptop; hardware acceptance requires that phone's exact-build
evidence. If the app only has boxes/unknown, demo detection/diagnostics but do
not claim live ranging accepted. Do not use it for braking/steering.

Next: an evidence-backed mobile model/cadence benchmark and controlled metric
truth, plus separately gated dependency-major migration. No hardware spend is
required for the initial stationary/laptop/recorded-video workflow.
