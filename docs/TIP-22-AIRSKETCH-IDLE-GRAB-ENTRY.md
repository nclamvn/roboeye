# TIP-22 — AirSketch idle-to-grab entry repair

## Root cause

TIP-21 correctly returns a fist to `idle`, but the state machine only allowed open-palm manipulation from `armed` or `drawing`. A completed object could therefore not be picked up again after safe transport.

## Requirement

- `REQ-22-01`: open palm from `idle` enters `manipulating` without arming or drawing.
- `REQ-22-02`: from this state, pinch grabs and release places an existing object.
- `REQ-22-03`: browser E2E must exercise draw → idle → open palm → grab → release through the real main-thread path.

## Acceptance

The controller passes `idle → manipulating → grabbing → manipulating`; browser E2E reports `Đã đặt vật thể` after a post-idle pickup and release.
