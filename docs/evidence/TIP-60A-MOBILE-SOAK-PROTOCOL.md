# TIP-60A mobile soak protocol

This protocol measures browser/runtime capability only. It does not validate
distance accuracy and must not be performed by a driver holding or operating a
phone. Initial runs should be stationary, with the phone fixed and a traffic
scene or controlled playback in view.

## Devices

- iPhone 16 Pro Max: current Safari, normal mode, Low Power Mode off.
- Xiaomi 14T: current Chrome, normal mode, Battery Saver off.
- Record OS/browser version outside the JSON report. The application does not
  collect a free-form device identifier.

## Controlled setup

1. Use the same HTTPS build, camera orientation and physical scene on both
   phones.
2. Close unrelated tabs/apps; note whether the phone begins cold or warm.
3. Keep screen brightness and power connection condition fixed across runs.
4. Open DriveSense, choose Camera and enable Khoảng cách. Do not enable lane
   processing in this baseline run.
5. Confirm boxes appear. Camera width/height/frame rate and the resolved model
   backend are captured automatically in the report.

## Runs

### Smoke

- Run at least 60 seconds.
- Export `drivesense-report.json` from Phân tích → Báo cáo.
- Verify locally:

```bash
npm run verify:drive-mobile-soak -- /path/to/drivesense-report.json
```

### Soak

- Run continuously for at least 30 minutes without changing source.
- Do not background the tab. If the tab is hidden or camera ends, the lifecycle
  counter must show it; do not delete the event.
- Export and verify the report as above.
- Repeat three times per device before comparing.

## What to compare

- resolved detector/depth backend and load/warmup;
- actual camera width/height/frame rate;
- detector busy/drop rate and presented-frame gaps;
- request-to-result and frame-to-overlay p50/p95/p99;
- 10–20 minute p95 divided by 0–5 minute p95 (thermal trend signal);
- metric attempt/accept rate;
- track-set turnover proxy, explicitly not ground-truth ID switches;
- visibility, camera and worker lifecycle events.

## Decision boundary

- A complete report proves observability, not product readiness.
- Do not compare device/model quality if the contract verifier fails.
- Do not promote a detector using publisher FPS. Use these same-window reports
  plus the Common Evidence Plane quality corpus.
- Do not show metres or issue a collision warning solely because runtime passes;
  camera calibration and physical distance truth remain separate gates.
