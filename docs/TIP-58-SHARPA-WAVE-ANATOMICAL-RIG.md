# TIP-58: Sharpa Wave anatomical rig

## HEADER

- **TIP-ID:** TIP-58
- **Project:** RoboEye / RoboHand Studio
- **Module:** 3D hand renderer and retargeting
- **Depends on:** TIP-57D
- **Priority:** P0 — demo credibility
- **Date:** 2026-09-26

## CONTEXT

The procedural hand proved tracking continuity but its independently oriented
shells could violate a believable hand silhouette during small grasps. The
approved replacement is Sharpa Wave: native left/right 22-DoF URDF assets under
Apache-2.0, selected through the evidence registry in
`docs/research/robot-hand-models/`.

## REQUIREMENTS

| ID | Requirement |
|---|---|
| REQ-58-01 | Render separate native left and right Wave assets; never mirror the production asset with negative scale. |
| REQ-58-02 | Convert canonical landmarks/contact evidence into bounded Wave joint angles, including thumb opposition and PIP–DIP coupling. |
| REQ-58-03 | Keep the previous procedural rig as a visible fallback if asynchronous asset loading fails. |
| REQ-58-04 | Vendor the exact upstream visual subset with immutable revision, Apache attribution and offline service-worker precache. |
| REQ-58-05 | Preserve existing two-hand identity routing, hand/object depth ordering and grip-socket contract. |

## TASK

1. Vendor left/right `with_wrist` URDFs and only their referenced visual STLs.
2. Load with `urdf-loader`; parse visuals only and apply RoboEye PBR materials.
3. Map the ROS model axes into RoboEye's canonical palm basis.
4. Compute and smooth independent joint values within the manufacturer limits.
5. Route stable `left`/`right` Studio tracks to fixed matching rigs.
6. Keep positive world transforms and switch to the procedural fallback only on
   load error.
7. Add asset integrity, joint-limit, topology and browser-load gates.

## ACCEPTANCE CRITERIA

1. **Given** a browser build, **when** both assets load, **then** the status of
   each rig becomes `ready` and every URDF visual reference returns locally.
2. **Given** open, pinch and fist evidence, **when** retargeted, **then** all 22
   values per hand remain inside URDF limits and distal joints flex forward.
3. **Given** two tracked hands, **when** labels fluctuate, **then** the stable
   left track drives only the native left asset and right drives only right.
4. **Given** an asset failure, **when** the rig updates, **then** the old
   procedural hand stays visible instead of producing a blank stage.
5. **Given** a production build, **when** offline assets are enumerated, **then**
   the Wave URDF/STL subset and attribution files are included in precache.

## CONSTRAINTS

- No negative scale on the official assets.
- No stretching links to chase landmarks and no canned gesture animation.
- No collision/force claim; the PoC remains visual teleoperation.
- Keep camera frames and inference on device.

