# TIP-19 — AirSketch pen bridge regression repair

## Header

- Priority: P0
- Depends on: TIP-18
- Scope: restore only the missing hand-landmark-to-ink integration and add a regression contract.

## Root cause

TIP-18 replaced the old gesture controller inside `handleAirLandmarks()`.  The replacement retained gesture state and scene manipulation, but omitted the call that consumes `sample.penDown`:

```ts
applyAirPen(point, sample.penDown)
```

The hand worker therefore recognized landmarks and the controller reported `drawing`, while `AirInkDocument.begin()` and `.move()` were never called. Pointer drawing continued to work because its handlers invoke `applyAirPen()` directly.

## Requirements

- `REQ-19-01`: A valid hand sample with `penDown: true` must create or extend an AirInk stroke.
- `REQ-19-02`: A following `penDown: false` sample must end the stroke and commit a selectable scene object.
- `REQ-19-03`: The browser test must cover the production hand-worker message path, not merely controller state.
- `REQ-19-04`: No calibration threshold, recognition model, dataset, or gesture contract is changed.

## Acceptance criteria

Given deterministic MediaPipe-shaped pinch landmarks followed by an index-only release,
when the application receives them through the hand worker,
then the benchmark reports one completed stroke with at least three points and the AirSketch canvas contains visible ink.

## Constraints

- Keep the bridge before manipulation handling so a released stroke is committed before it can be selected.
- Preserve mouse/touch fallback and the existing `idle → armed → drawing → manipulating → grabbing` state machine.
