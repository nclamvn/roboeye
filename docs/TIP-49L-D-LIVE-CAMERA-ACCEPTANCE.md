# TIP-49L-D — repeatable live-camera acceptance

**State:** IMPLEMENTED / real camera evidence pending

**Scope:** local browser software only; no vehicle mount or hardware purchase

## Purpose

Turn an exported DriveSense camera report into a reproducible runtime gate. This
TIP measures whether the current browser pipeline can capture, infer and publish
an overlay on time. It does **not** measure physical distance accuracy or prove
that warnings are safe to use while driving.

## Evidence tiers

### Smoke

- camera source, non-synthetic, positive source dimensions;
- at least 60 seconds and 100 accepted detector frames;
- at least 99% of dispatched frames accepted;
- at most 1% dispatched frames dropped;
- capture callback to published overlay P95 at most 150 ms;
- no worker-error or geometry-change drop.

### Soak

The same runtime gates over at least 30 minutes and 3,000 accepted detector
frames. This remains a local stability check, not a road-safety qualification.

### Metric path

Distance inference is reported independently. It is `not-observed` until a
strong vehicle candidate causes at least one depth request. Passing requires at
least 10 attempts, at least 80% accepted and at most 20% dropped/unmatched.
This prevents an empty camera scene from being presented as distance evidence.

## Operator sequence

1. Open `drive.html`, choose the MacBook camera or a phone exposed by the OS as
   a webcam, and enable **Khoảng cách**.
2. For runtime-only smoke, keep the tab visible for at least 60 seconds. For the
   metric gate, include a stationary vehicle or a legitimately controlled video
   target in the camera view; do not test while driving.
3. Open **Phân tích** and select **Xuất báo cáo JSON**.
4. Verify the exported report:

   ```bash
   npm run verify:drive-live-report -- /path/to/drivesense-report.json
   npm run verify:drive-live-report -- /path/to/drivesense-report.json --require-metric
   npm run verify:drive-live-report -- /path/to/drivesense-report.json --soak --require-metric
   ```

Exit code `0` means the selected runtime gate passed. Exit code `1` means valid
evidence did not meet the gate. Exit code `2` means the file or structure is
invalid.

## Claim boundary

The report contains aggregate timing and counters, not camera pixels. A pass
does not validate metres, bumper clearance, TTC, collision warnings, sensor
exposure latency or readiness for public-road operation.
