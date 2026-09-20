# TIP-50R-D5 — Quiet experimental lane HUD

## Contractor / scan / decision

Depends on D4, P0. User approved compact icon plus side-specific warning.
Existing UI redraws every mask/path and exposes every inference gap. D3 has no
vehicle footprint, mounting calibration or intent/indicator input. Therefore
this change is a **visual lane-proximity experiment**, not validated departure
detection. Green means stable paired lane evidence, never certified safe driving.
No change to vehicle distance, collision warnings, model or D3 tuning.
Condense workflow to scan → TIP → Builder → verify; no further interview needed.

## Design / implementation contract

Keep Inter, cabin #101c25, muted #9db2c0, tracking #69dab1, caution #f3bb53,
ink #f1f7fa. Replace changing text chip with fixed 40px lane icon, no flashing.
Only accepted side receives an amber line and a directional icon. Do not use red
severity without a validated physical severity measure. Full overlays require an
explicit debug checkbox in Analysis, off by default; surface independently off.

Pure temporal controller consumes distinct fresh model samples, rejects weak,
crossed, too narrow, nonfinite or missing paired lanes. Probe at normalized y=.9,
camera centre x=.5; paired-geometry position ratio is only an image-space proxy.
Require at least 3 samples over 700ms to acquire tracking or a side warning;
proximity entry ratio .22/.78, recovery .32/.68. Require prior centered tracking
before a new side warning; clear on stale data, seeking, source change, errors,
unsupported source or suspension. Do not count RAF ticks or paused duplicates.
Warn only with the latest fresh geometry. No sound or driving recommendation.

## Acceptance requirements

- R1: Default HUD fixed icon; no mask/path canvas ink while stable/unknown.
- R2: Sustained, good-quality paired evidence gives tracking; insufficient/stale
  evidence is gray, not a warning or a false green.
- R3: Sustained image-space proximity after tracking gives only left/right amber
  path; brief noise, one missing line, seek and stationary duplicate cannot warn.
- R4: Separate entry/recovery thresholds and dwell avoid boundary chatter.
- R5: Debug layers in Analysis restore inspection; error recovery and diagnostics
  remain; no model/range/risk changes or claims of real-world LDW accuracy.
- R6: Unit transition/geometry tests, browser render/lifecycle tests, real-video
  smoke and build. Completion report records measured results and limitations.
