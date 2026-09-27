# Completion Report — TIP-60A Mobile capability and soak evidence

**Status:** COMPLETE / VERIFIED for software instrumentation scope
**Date:** 2026-09-27
**External evidence:** iPhone/Xiaomi smoke and soak reports still required

## Outcome

DriveSense can now export a bounded, pixel-free explanation of its mobile live
camera runtime instead of relying on visual impressions such as “box flashes”
or average FPS. The instrumentation does not change detector, tracker, range or
risk decisions.

## Files changed

### Created

- `src/drive/mobile-soak.ts` — bounded histograms, four soak windows, camera and
  model capability, frame-gap, busy/drop, metric, lifecycle and track-turnover
  telemetry.
- `src/drive/mobile-soak-evidence.ts` — fail-closed report contract and thermal
  trend interpretation without a safety claim.
- `scripts/verify-drive-mobile-soak-report.ts` — operator verifier for exported
  camera reports.
- `tests/unit/drive-mobile-soak.test.ts` — privacy, window, lifecycle and
  72,000-frame bounded-memory scenarios.
- `tests/unit/drive-mobile-soak-evidence.test.ts` — contract, trend and negative
  report scenarios.
- `docs/TIP-60A-MOBILE-CAPABILITY-SOAK.md` — accepted contract.
- `docs/evidence/TIP-60A-MOBILE-SOAK-PROTOCOL.md` — repeatable phone protocol.
- `docs/SCAN-DRIVESENSE-MOBILE-TRAFFIC-2026-09-27.md` — independent technical
  scan and implementation order.
- `docs/VERIFY-TIP-60A.md` — Contractor verification.

### Modified

- `src/drive/app.ts` — connects telemetry to camera settings, model lifecycle,
  frame callbacks, detector/depth results, tracker publication, overlay,
  visibility and report export. Camera labels are no longer exported.
- `drive.html` — shows the current warming/smoke/soak phase inside the existing
  analysis/report panel without adding driving-screen text.
- `package.json` — adds `verify:drive-mobile-soak`.
- `docs/TASK-GRAPH-DRIVESENSE-PRODUCT.md` — adds TIP-59/60A/60B mobile lane.

## Requirement result

- **REQ-60A-01..07:** 7/7 implemented.
- Actual camera settings use a closed allowlist; `deviceId`, `groupId`, label,
  pixels, video and local path are absent from `mobileSoak`.
- Detector/depth attempts preserve requested/resolved backend, total load and
  observable warmup, including preloaded-session semantics.
- Four time windows retain cumulative p50/p95/p99 through fixed histograms;
  no per-frame rows are retained by the soak collector.
- A separate verifier detects incomplete contracts and reports a 10–20 minute
  versus 0–5 minute frame-to-overlay trend without calling it safety evidence.

## Verification summary

- Focused TIP tests: **7/7 pass**.
- Full unit suite: **271/271 pass**.
- TypeScript typecheck: pass.
- Production build: pass; 84 modules transformed.
- Drive browser regression: 7 video-anchor cases pass; feature toggles pass.
- Security audit: pass; 0 critical, two pre-existing accepted-risk `sharp`
  advisories remain on their existing review dates.
- `git diff --check`: pass.

## Honest limitations

- No real iPhone 16 Pro Max or Xiaomi 14T report was fabricated in this TIP.
- Browser `captureTime` is reported only when exposed; it is not silently
  replaced with callback time.
- Track-set turnover is a runtime proxy, not reviewed MOT ID-switch accuracy.
- Fixed histograms clip percentile location above 5000 ms into `>5000`; max and
  clipped count remain explicit.
- This work locates runtime bottlenecks. It does not improve detection taxonomy,
  distance accuracy or collision-warning safety by itself.

## Next gate

Run the protocol in `docs/evidence/TIP-60A-MOBILE-SOAK-PROTOCOL.md`: one smoke
and three 30-minute soaks on each phone. Feed valid reports into the verifier.
Only then open TIP-60B to select input size, detector and iOS/Android execution
tier using the Common Evidence Plane quality results.
