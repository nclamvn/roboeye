# TIP-37 — Anatomical humanoid hand

Priority: P0. Depends on TIP-34/35. Scope: robot mesh and studio presentation.

## Scan and decision

The rejected visual is caused by spherical fingertips, exposed cylindrical links,
emissive yellow joints and a rectangular plate wider than the MCP row. Increasing
resolution cannot change that silhouette. Replace the mesh with tapered phalange
shells, recessed hinge bearings, tactile pads and contoured palm/carpal plates.
Use satin titanium, graphite elastomer and a small cyan status strip.

Contractor decision: this is a correction within the approved procedural rig
architecture. User feedback authorizes implementation; no new approval round.
Builder preserves the pose/filter contract and all existing modes.

## Acceptance

- R1: five anatomically proportioned fingers with rounded tapered ends, no ball tips.
- R2: contoured palm and wrist, articulated metal shells, recessed mechanical joints.
- R3: neutral studio light and satin metal; no yellow spherical actuators or circular core.
- R4: existing live retarget contract remains usable; finite transforms in rest,
  flexion and rotation, build and relevant tests pass.
- R5: inspect front, three-quarter and flexed renders; record limitations honestly.

## Constraints

No new inference work, dependencies, image textures or network asset requirement.
Reuse geometry/material resources, release them on dispose. Do not certify physical
motion-to-photon latency from a resting-hand FPS reading.
