# TIP-26 — Motion-aware detection tracking

## Header

- **TIP-ID:** TIP-26
- **Project / module:** RoboEye / live object-detection overlay
- **Depends on:** TIP-14, TIP-15, TIP-24
- **Priority:** P0

## Context

The detector runs asynchronously on a 384 px camera capture while the camera and
renderer continue to advance. Drawing the raw result as soon as it returns makes
the box describe an older frame; smoothing coordinates alone cannot fix that
time mismatch. The prior threshold increase also diverged from the locked T14
benchmark manifest and caused the scheduled benchmark to fail before inference.

## Task

1. Carry the capture timestamp through the detection worker contract.
2. Associate detections against the current predicted track, estimate velocity
   from capture-to-capture measurements, and project an arriving result forward
   by its measured inference latency before correcting the displayed box.
3. Preserve NMS and low-confidence consecutive-hit confirmation. A high-score
   observation may render immediately; short misses retain a confirmed track.
4. Restore the T14-locked thresholds and fix the patchable `nanoid` security
   advisory without adding it to accepted-risk policy.

## Acceptance criteria

- Given a result captured before the current rendered frame, when it returns,
  then its box is projected to the current time before draw correction.
- Given a fast moving same-label object, when successive detector results have
  little or no IoU, then centre-gated association preserves one track.
- Given a low-confidence one-frame false positive, when no second result
  arrives, then it is not rendered.
- Given the repository lockfile, when `npm run security:audit` runs, then no
  unreviewed high/critical advisory remains.
- Given the scheduled detection benchmark preflight, when it reads config and
  manifest, then thresholds agree.

## Constraints

- No new runtime dependency or server component.
- Do not claim object identity or safety-critical tracking; this is a visual
  overlay stabilizer, not a tracker certified for rescue decisions.
- Keep the existing worker latest-frame-wins policy and T14 fixture baseline.
