# TIP-34 · RoboHand premium procedural rig

## Context

TIP-33 provides stable kinematics but no visual embodiment. The hero model must
look deliberate, remain lightweight on integrated GPUs and work from a static
GitHub Pages build without third-party asset downloads.

## Tasks

- Build an original articulated exoskeleton hand with reusable Three.js PBR
  geometry and material resources.
- Add a dedicated RoboHand render mode and camera.
- Add an unobtrusive camera picture-in-picture with synchronized 21-point hand
  skeleton and runtime telemetry.
- Wire RoboHand to the existing hand worker without loading the sketch
  classifier or running depth/detection concurrently.
- Preserve RGB, depth, cloud, BEV, AirSketch and AirDesk behavior.

## Acceptance criteria

- RoboHand can be entered from the mode rail and closed by selecting any other
  mode.
- A 21-point result visibly drives 20 articulated robot segments.
- The procedural model has no remote runtime asset dependency.
- Camera PiP mirrors the source and overlays the corresponding hand skeleton.
- WebGPU/WebGL2 build and all existing tests pass.

## Constraints

- One renderer and one animation loop.
- Reuse geometry/materials; no per-frame hot-path allocations after warm-up.
- Camera pixels and landmarks remain local to the browser.

