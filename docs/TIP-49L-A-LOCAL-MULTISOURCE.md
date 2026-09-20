# TIP-49L-A — local multi-source live pipeline

## HEADER

- Project: RoboEye / DriveSense
- Role split: Contractor specifies and verifies; Builder implements
- Depends on: TIP-48 telemetry, current RT-DETR/depth/tracker pipeline
- Priority: P0 software-first
- Scope: browser on the current computer; no purchased hardware, vehicle installation, cloud or public-road use

## CONTEXT

DriveSense already accepted an uploaded video and a generic browser camera, but it did not let the operator select the MacBook camera versus a phone exposed by macOS as a webcam. The live camera path drew detector boxes but did not attach metric-depth results, while the uploaded-video path used a different scheduled workflow. This prevented a credible local workbench test before hardware investment.

## TASK

Make laptop camera, phone-as-webcam and uploaded video explicit local sources around the same detector, tracker, range, risk and report contracts. Keep the detector responsive while metric depth runs at a lower bounded cadence. Only apply a depth result to a compatible current track and fail closed when it is late or unmatched.

## ACCEPTANCE CRITERIA

1. Enumerate concrete `videoinput` devices after permission and allow an exact device choice, while retaining a safe default camera constraint.
2. A phone connected through Continuity Camera/USB works only when the operating system exposes it as `videoinput`; the app must not claim a private phone transport.
3. Live detector boxes are rendered without waiting for depth. Depth uses the same captured source frame at no more than 2 Hz.
4. Live depth cannot modify another source/epoch, a newer incompatible track or a result older than the freshness budget. A published learned range expires rather than lingering.
5. A supplied geometric camera profile remains authoritative and is never silently overridden by learned depth.
6. The local report records source type, dimensions, backend, attempts/accepted/dropped metric results and existing capture-to-overlay timing without frame bytes or local paths.
7. Uploaded video keeps the existing ordered offline detector/depth pipeline and report semantics.
8. Unit tests, typecheck, production build, security audit and diff hygiene pass.

## NON-GOALS

- No direct iPhone app, WebRTC relay, recording or upload.
- No claim of true bumper clearance, lateral separation, realtime readiness or field accuracy.
- No hardware selection, fixed mount, speed/GNSS integration or vehicle installation.
