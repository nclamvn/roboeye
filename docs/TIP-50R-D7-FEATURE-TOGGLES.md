# TIP-50R-D7 — In-video DriveSense feature toggles

## Header

- TIP-ID: TIP-50R-D7
- Project: RoboEye / DriveSense RoadStructure
- Module: DriveSense video controls
- Depends on: TIP-50R-D6 and existing distance/lane pipelines
- Priority: P0 operator control

This TIP reconstructs the approved contract from the user's explicit request and
the implementation report. It closes a missing audit artifact; it does not claim
the document preceded the implementation.

## Context

The lane-only UI left no visible route to restore vehicle detection and metric
estimation. DriveSense already had both pipelines, but their controls were split
between URL state, the analysis panel and transport actions.

## Task

Expose `Khoảng cách` and `Làn` as adjacent controls inside the video transport
dock. Make state and resource arbitration explicit without changing model,
distance or warning behavior.

## Specifications

1. Both toggles remain visible at desktop and 390 px viewport widths.
2. Each toggle exposes off, loading and ready state accessibly.
3. Starting unfinished distance inference stops lane inference first.
4. Starting lane inference stops unfinished live/file distance inference first.
5. A completed file replay may coexist with lane inference because replay does
   not consume detector/depth inference.
6. Turning distance display off must not destroy a completed replay.
7. Advanced calibration and diagnostics remain in the Analysis surface.

## Acceptance criteria

- Given lane-only startup, when the page becomes interactive, then both feature
  toggles are visible and the lane state is represented accurately.
- Given an unprocessed file, when distance is enabled, then conflicting lane
  inference stops and detector/metric analysis starts.
- Given unfinished distance inference, when lane is enabled, then the heavy
  distance job stops before lane inference begins.
- Given completed replay evidence, when lane is enabled, then the replay may be
  restored without rerunning detector/depth inference.
- Given a 390 px viewport, then neither toggle is clipped or displaced outside
  the video transport dock.

## Constraints

- Do not change detector, metric-depth, road model or calibration contracts.
- Do not change warning thresholds or make a safety/field-readiness claim.
- Reuse existing transport, feature-state and inference-stop mechanisms.
- Completion and independent Verify reports are required.
