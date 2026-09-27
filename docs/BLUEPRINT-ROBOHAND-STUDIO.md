# BLUEPRINT · RoboHand Studio

Status: **APPROVED BY OWNER REQUEST**
Date: 2026-09-24
Depends on: TIP-33 → TIP-37

## Outcome

RoboHand becomes a two-hand teleoperation studio. A small camera proof view
shows local landmarks while the main stage renders one or two independent
humanoid hands and stateful virtual props. Motion is copied continuously; named
gestures summarize the motion and control props but never replace articulation.

## Architecture

```text
camera → latest-frame worker (0..2 hands)
       → stable left/right slots
       → independent pose/filter/loss controllers
       → temporal gesture descriptors
       → prop interaction state machine
       → two procedural humanoid rigs + phone/book stage
       → one WebGPURenderer (WebGL2 fallback)
```

The existing one-hand fields remain in the worker message for AirSketch and
AirDesk. RoboHand consumes the new `hands[]` collection. No camera pixels leave
the browser.

## Requirements

| ID | Requirement |
|---|---|
| RHS-01 | Detect and render zero, one or two hands without index-order swaps. |
| RHS-02 | Each hand owns an independent filter, loss grace period and gesture stabilizer. |
| RHS-03 | PiP draws both 21-point skeletons with distinct identity colours. |
| RHS-04 | Main stage presents two articulated high-tech humanoid hands. |
| RHS-05 | Pinch/fist near a prop grabs it at a palm socket; a stable OPEN palm releases it into a bounded gravity fall. |
| RHS-06 | A free pointing hand can swipe a held phone or turn a held book page. |
| RHS-07 | Interaction state is temporal, bounded and testable without a camera. |
| RHS-08 | WebGPU and WebGL2 share the same scene; no remote runtime asset. |
| RHS-09 | Existing AirSketch, AirDesk and single-hand RoboHand contracts remain compatible. |
| RHS-10 | Build, unit tests and RoboHand browser E2E remain green. |

## Visual direction

- Deep optical-black stage with cool titanium hands; colour encodes identity,
  not decoration: cyan left, ultraviolet right, warm amber contact.
- Camera proof is subordinate and compact. The hero is the direct 3D response.
- Phone and book use recognizable silhouettes and active surfaces, not labels
  pretending to be objects.
- Copy is sentence case, short and operational.

## Decisions

- Preserve the procedural rig. It is already offline, licensed and fully
  controllable; asset replacement remains a later audited adapter.
- Use a deterministic interaction state machine rather than adding a physics
  dependency. TIP-57B extends it with bounded gravity/ground contact after the
  owner's explicit release requirement; it is still not force simulation.
- Resolve hand/prop visibility through shared 3D geometry and the renderer's
  depth buffer. Screen-space masks are prohibited because they fail as soon as
  the palm turns.
- Configure MediaPipe for two hands in the existing worker. The latest-frame
  boundary remains unchanged so extra inference cost cannot create a queue.
- The owner's explicit request to develop the feature is treated as approval
  for this compatible extension; no additional checkpoint is required before
  build.

## Deferred

- Full forearm/body pose, force estimation, collision-grade physics and a
  licensed skinned human-hand GLB.
- Semantic understanding of arbitrary real tools. The phone/book are explicit
  demo props with auditable interaction rules.
