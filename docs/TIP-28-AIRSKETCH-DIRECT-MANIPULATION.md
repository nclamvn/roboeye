# TIP-28: AirSketch Direct-manipulation Recovery

## Header

- Project: RoboEye
- Module: AirSketch interaction pipeline
- Depends on: TIP-23, TIP-27
- Priority: P0

## Evidence and root cause

The live-page console is clean, so this is not a worker crash or a rendering
exception. Code tracing identified three deterministic interaction faults:

1. `AirInteractionController` used index-tip coordinates while hovering but
   changed to the thumb-index midpoint when a pinch engaged. A visible pen
   jump and a hit-test miss are unavoidable whenever the thumb is separated
   from the target index tip.
2. The manipulation state rejected `pinch && openPalm`. A natural two-finger
   pinch commonly leaves the middle, ring and pinky extended, so the gesture
   advertised to users could not enter `grabbing`.
3. `main.ts` ended the pen and released the controller on the first null
   landmark. One transient detector miss therefore cut a stroke or dropped an
   object. The existing metric measured worker inference only, hiding queue,
   bitmap and reply latency which users actually feel.

## Implementation

- Keep the index fingertip as the raw coordinate in every gesture state.
- Produce two outputs per sample: bounded-predicted `cursor` for responsive
  display/ink and filtered `grabCursor` for stable object hit-test/movement.
- Permit pinch from the deliberate manipulation workspace even if the hand is
  still open; drawing remains guarded by the pointer pose and pinch clutch.
- Hold interaction state for at most 120 ms across a null landmark result,
  then release safely.
- Timestamp the bitmap-to-worker handoff and publish inference plus full
  capture-to-main p50/p95 metrics in the existing benchmark contract.

## Acceptance criteria

1. Given a hovering index finger, when thumb and index pinch, then the cursor
   remains at the index tip without a coordinate jump.
2. Given an object workspace entered by a 350 ms open palm, when thumb/index
   pinch while the remaining fingers stay open, then the object enters grab.
3. Given one missing landmark frame during draw/grab, then the current stroke
   or object remains active for the bounded grace window.
4. Given a benchmark snapshot, then it includes pipeline samples and p50/p95
   in addition to raw hand-model inference.

## Constraints

- No new model, network service or gesture grammar is introduced.
- A prolonged missing hand still ends input safely.
- This fixes interaction fidelity only; it does not claim a life-safety
  validation or sign-language capability.
