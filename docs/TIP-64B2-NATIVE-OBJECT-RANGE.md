# TIP-64B2 — Native automatic object recognition + LiDAR ranges

Date: 2026-10-11. Priority P0. Depends on TIP-64B1-H.

## Scan / root cause
The installed native app contains only ARKit point sampling. There is no object
detector, semantic box, object association or automatic measuring loop. User
screenshots demonstrate a running camera with no selected surface, then a stopped
session. This is a missing product capability, not a threshold or GPU diagnosis.
Existing Swift core, bounded recording, consent, camera lifecycle and web contracts
must be retained. iPhone 16 Pro Max is now connected and signing is configured by
the user. Preserve the existing Xcode project, Team and bundle identifier.

## Contractor decisions / approval
- The user's “triển khai đầy đủ để test 1 lần” approves the previously proposed
  detector → boxes/labels → same-frame LiDAR → tracking → compact camera UI chain.
  RRI and a second approval pause are merged because scope is already explicit.
- Vibecode roles stay separate: Contractor selects/contracts/verifies; delegated
  Builders implement core, native UI/runtime, and QA/assets in separate files.
- Use Apple-distributed YOLOv3 FP16 as the accuracy-oriented baseline, with a
  replaceable model boundary. Apple's model card declares MIT; the downloaded model
  metadata references original Darknet's public-domain notice instead. Record both
  accurately rather than inventing an MIT copyright or assuming an unrelated
  Ultralytics license. Commercial license review remains distinct from technical QA.
  This is a proven integration baseline, NOT a claim of SOTA or
  all-object recognition. The supported vocabulary is 80 COCO classes; e.g. a fan
  is not a supported semantic class. No API, cloud camera upload or new paid SDK.
- One ARKit camera owner. Core ML/Vision uses that captured RGB buffer, with one
  worker job in flight. Detection and intermediate Vision tracking never queue an
  unbounded frame history or block UIKit. Drop obsolete epochs/rotation/results.
- Detection sees upright pixels: derive Vision orientation from the SDK-verified
  ARKit Presentation.rotation, not a device-left/right guess. Inverse-map Vision
  bottom-left boxes into normalized raw RGB top-left boxes before raw depth
  sampling; map forward through the same SDK presentation for display. Core
  rectangle roundtrips test all four cardinal rotations. This supersedes an
  initially considered raw `.up` Vision input, which would harm portrait recall.
- Distances are approximate camera-to-supported-surface ranges, NOT free walking
  clearance. Bounding boxes are not segmentation masks: require spatially coherent
  interior depth support; ambiguous/transparent/background-only cases remain unknown.
- Metric values expire after 300 ms. Boxes may coast briefly with explicit lost
  tracking status but cannot retain a stale metric. Camera stop/background clears
  all boxes/readouts and requires explicit restart. Severe heat reduces work,
  critical heat/memory warning stops safely.
- UI design skill: full camera, quiet top state, Vietnamese labels with metres
  directly on boxes, compact nearest-object/footer controls. Manual probe remains
  an explicit mode. Recording/export/truth controls move to a collapsible diagnostic
  panel with accessible large-type scrolling. No flashing or “safe to walk” badge.

## Requirement / acceptance matrix
| ID | Given / when / then |
|---|---|
| R01 | Camera started: recognition runs automatically without point selection. |
| R02 | Supported objects: individual stable IDs, boxes and Vietnamese names visible. |
| R03 | Fresh co-registered LiDAR and coherent support: approximate metres on each box. |
| R04 | Motion: boxes update through detection/tracking; range follows fresh depth. |
| R05 | Multiple same-class objects: distinct bounded tracks; no range transfer across IDs. |
| R06 | Missing/ambiguous/old depth: explicit reason, never arbitrary metre fallback. |
| R07 | Portrait/landscape/crop: sensor/model/Vision/display coordinates agree. |
| R08 | Full-camera compact UI; diagnostics reachable in large type; manual mode works. |
| R09 | Stop/background/rotation: old result invalidated; worker bounded/cancellable. |
| R10 | Offline bundled model, source/license/hash recorded, no image upload. |
| R11 | Existing manual recording/export/truth and Swift/TS contract tests stay valid. |
| R12 | Signed Release builds; install on connected iPhone; no debugger required. |

## Verification / release gate
Pure Swift unit tests for coordinates, association, expiry and robust sampling;
real model inference on an independent standard image (not just synthetic boxes);
native simulator UI cases with permanent synthetic watermark; unsigned Release
build/analyze; existing interop/web regression as proportionate. Finally build
signed Release and install on the connected physical phone when available.
Actual room detection, range accuracy and sustained phone latency remain a real
device test; never mark them passed from fixtures. No git commit/push/deploy requested
in this TIP. Never regenerate the user's signed project destructively.

## Sources
- https://developer.apple.com/machine-learning/models/
- https://huggingface.co/apple/coreml-YOLOv3/raw/main/README.md
- https://developer.apple.com/documentation/vision/recognizing-objects-in-live-capture
- https://developer.apple.com/documentation/arkit/displaying-a-point-cloud-using-scene-depth

Completion report must state implemented/12, numerical test results, physical-device
install receipt, untested/deferred items, license/provenance and exact build version.
