# Completion report · TIP-57 RoboHand Studio

Date: 2026-09-24  
Status: **implemented and locally verified**

## Delivered

- MediaPipe HandLandmarker is configured for two hands only in RoboHand mode;
  switching from the one-hand AirSketch/AirDesk graph rebuilds the worker once
  so a stale single-hand graph cannot masquerade as two-hand tracking.
- Worker results expose `hands[]` with 21 image and 21 world landmarks,
  handedness and score per hand. The original first-hand fields remain intact.
- Each hand has its own pose filter, short-loss controller, gesture memory and
  procedural humanoid rig. Cyan and ultraviolet accents expose identity.
- The PiP camera draws both skeletons, fingertips and per-hand gesture labels.
- A renderer-independent state machine supports phone/book acquisition by
  pinch or fist, release/place, phone swipe and book page turn by the free hand.
- The Three.js stage uses one `WebGPURenderer`, one animation loop and the
  existing WebGL2 fallback. Phone/book assets are procedural and offline.
- Props are staged outside the central articulation area; unrelated perception
  warnings are hidden in RoboHand mode.

## Root defects closed during implementation

1. Prop motion read the current hand memory after overwriting the previous
   sample, making every swipe displacement zero. Interaction now reads an
   immutable previous-frame snapshot.
2. MediaPipe fixes `numHands` when its graph is created. The shared worker is
   now rebuilt on a 1↔2 hand mode boundary, preventing a single-hand graph from
   surviving inside the two-hand UI.
3. Initial prop placement obscured the hero hand. Visual review moved and
   scaled the props into reachable side stations.

## Verification

| Gate | Result |
|---|---|
| TypeScript strict/no-unused | PASS |
| Production Vite bundle | PASS · 74 modules |
| Unit suite | PASS · 244/244 |
| RoboHand browser E2E | PASS · all checks |
| Two-hand worker contract | PASS |
| WebGL2 fallback | PASS |
| Mobile overflow/proof camera | PASS |
| Runtime console errors | 0 |

The repository lives in macOS cloud storage and its dependencies were
`dataless`; verification used a temporary hydrated dependency mirror with the
same pinned versions. No application behaviour or dependency version was
changed by that workaround.

## Honest boundary

This is a deterministic visual teleoperation demonstrator. It does not infer
force, guarantee collision, understand arbitrary real tools or translate sign
language. A photoreal human male/female hand requires a separately licensed,
audited skinned asset adapter; TIP-57 deliberately ships the controllable
high-tech humanoid rig first.

