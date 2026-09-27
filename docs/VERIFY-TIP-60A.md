# Verification — TIP-60A Mobile capability and soak evidence

**Verified:** 2026-09-27
**Environment:** local macOS / Node / TypeScript / Chromium browser regressions
**Perception model or warning policy changed:** no

## Requirement coverage

| Requirement | Evidence | Result |
|---|---|---|
| REQ-60A-01 privacy-safe camera settings | Closed sanitizer; forbidden-field assertions; camera source exported generically | PASS |
| REQ-60A-02 model lifecycle | Requested/resolved backend, load, warmup, fallback/preloaded semantics | PASS |
| REQ-60A-03 frame presentation | Presented-frame gaps and optional capture/decode/display timing | PASS |
| REQ-60A-04 soak windows | Exact 0–5, 5–10, 10–20 and 20+ minute tests | PASS |
| REQ-60A-05 runtime continuity/lifecycle | Busy/drop/metric/visibility/camera/worker/track proxy counters | PASS |
| REQ-60A-06 bounded memory | 72,000-frame simulation; zero retained frame rows; 64 in-flight cap | PASS |
| REQ-60A-07 no perception regression | 271 unit tests, build and Drive browser regressions | PASS |

**Coverage:** 7/7 = 100%.

## Quantitative checks

- 72,000 simulated frames: 72,000 detector starts, 72,000 frame-to-overlay
  histogram samples, p99 preserved, 0 retained frame rows and 0 in-flight rows
  after completion.
- Four-window fixture: one accepted detector/metric observation placed in each
  intended window; overall counters equal their window sums.
- Trend fixture: p95 grows from 50 ms to 80 ms; verifier reports ratio 1.60 and
  `degrading`, while preserving the non-safety claim boundary.
- Privacy fixture: camera width/height/frame rate/aspect/facing/resize survive;
  camera label, `deviceId` and `groupId` do not.

## Quality gates

| Gate | Result |
|---|---|
| Focused tests | PASS — 7/7 |
| Full unit suite | PASS — 271/271 |
| `npm run typecheck` | PASS — 0 errors |
| `npm run build` | PASS — 84 modules transformed |
| Drive video-anchor browser cases | PASS — 7/7 |
| Drive feature-toggle browser checks | PASS |
| `npm run security:audit` | PASS — 0 critical; two reviewed pre-existing advisories |
| `git diff --check` | PASS |

## Deferred external evidence

- iPhone 16 Pro Max: one ≥60 s smoke and three ≥30 min soak reports.
- Xiaomi 14T: one ≥60 s smoke and three ≥30 min soak reports.
- Controlled phone temperature/power/browser notes recorded alongside reports.
- Reviewed traffic corpus for detection/ID quality remains a TIP-56B/TIP-60B
  input; runtime turnover cannot replace it.

## Contractor verdict

**SOFTWARE GATE PASS / DEVICE GATE OPEN.** The evidence collector is complete,
bounded and safe to deploy for controlled phone measurements. No model promotion
or public-road warning claim is authorized until the device and physical-truth
gates are passed.
