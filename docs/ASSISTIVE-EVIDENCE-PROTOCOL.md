# Assistive Vision evidence protocol v1

TIP-64A, 2026-10-10. This is a metadata/reference-calculation lab. It does not implement a handheld navigation system, native AR providers, object models, scene understanding, audio warnings or body-clearance estimation. DriveSense remains independent.

## Coordinates and time

`FramePacket` is closed and versioned (`assistive-frame-v1`). RGB dimensions are the **original decoded camera image**, maximum 8192 per axis. Intrinsics fx/fy/cx/cy are pixels of that original image, calibrated by the provider or **null**; no guessed FOV. Distorted pixels must be undistorted by a future adapter using the same calibration before supplying support. This diagnostic contract does not pretend to estimate distortion.

Boxes/crop are image-edge pixel rectangles; support u/v are original image pixel-centre coordinates, within `[0,width-1] × [0,height-1]`. Native depth resolution/alignment must be resolved into these coordinates by the adapter, not by scaling raw depth pixels blindly. Display crop → clockwise rotation → mirror changes only presentation. `toDisplay` / `fromDisplay` are inverses; never change the original K or depth when mirroring a preview.

Optional `cameraToWorld` is a 16-value **row-major rigid** matrix, not Three.js column-major serialization. Camera axes are +X right, +Y down, +Z forward; translation is metres. Reject nonorthonormal/reflected/scaled matrices. AR SDK conventions must be converted explicitly, not passed through unchanged. Pose is recorded for later ego-motion work; this phase does **not** infer approach/retreat or velocity from 2D box motion.

World must be session-local, never GPS/earth-registered. Native metadata can reveal relative motion and object context; it is not claimed anonymous. Default browser camera has pose null and never calls a location API.

All times share `session-monotonic-ms`, rebased to the recording session's origin. RGB capture and ready are separate; depth capture has its own timestamp and capture ID. Declare `timestampBasis`: sensor-capture / browser-availability / synthetic. Browser camera currently records callback availability time, not exposure time or sensor-to-display latency. Depth cannot be newer than ready; repeated capture IDs cannot change timestamp. Frame ID/capture time strictly increase. Sessions cap capture time at 120000 ms; incoming standalone frames support longer monotonic time for future live adapters.

The current browser recorder samples available stream geometry about 5 Hz using a timer; it is not per-exposure video recording and cannot prove image freshness or camera-to-event latency. No detector/depth uses those samples in this phase. Future live adapters must use decoded-frame ownership/timestamps and retain this limitation when falling back to browser availability.

## Depth / range semantics

`metre-z`: projected optical-axis Z. Unproject `(u,v,Z)` as `((u-cx)Z/fx,(v-cy)Z/fy,Z)`; Euclidean camera-to-point range is the vector norm. `metre-ray`: already a Euclidean ray range; divide by ray norm to recover Z before reconstructing XYZ. `relative` + `unscaled` must never become metres. This is **not** vehicle forward gap, camera-to-bounding-box-centre, body-to-obstacle clearance or a free-path guarantee.

Provenance: ARCore / ARKit declarations, learned-unverified, unscaled, synthetic. Provider fields and valid SHA-256 do **not** authenticate hardware, inference, consent or labels. All `RangeEvidence.physicalValidation` values remain `pending`; synthetic provider wins over any inner learned/native declaration. No model confidence is treated as physical accuracy.

Sparse support must be adapter-associated foreground, not median/minimum over a rectangle. Each target binds a unique index set to points inside its box; at least five distinct sufficiently confident image positions. Samples' normalized confidence is provider support quality, **not a calibrated probability** or equivalent native scale across SDKs. This phase's .7 support threshold is a reference gate; future provider adapters must document mapping and validate it. Target score is separate semantic model confidence.

Reference calculation refuses missing depth/K, relative-only, >300 ms RGB/depth age, >50 ms RGB-depth skew, reused capture IDs, bbox-only support, <5 qualified distinct positions, ≥20% inconsistent points and ranges outside 0.5–5 m. These are conservative lab defaults, not clinically validated limits. It deliberately does not retain old metres through occlusion; subsequent live tracking may display bounded aged evidence without mislabelling it a fresh measurement. Replaying/seeking must not make old/reused depth fresh.

## Privacy, import and lifecycle

`assistive-recording-v1` contains only typed frame metadata, source declarations, optional truth and explicit reject/stop counters. Recording needs an affirmative in-tab metadata consent; an imported file cannot grant it. The recorder is memory-only, no localStorage/IndexedDB/network/upload/pixel capture. JSON bounds: 600 frames, 120 seconds, 2 MiB; this is serialized-data size, not an exact JS heap claim. Bounds stop capture observably, never silently omit history.

Unknown fields are rejected at every nesting boundary, including images, video, location, local paths and hardware identifiers. Diagnostic IDs must be ephemeral; future adapters must not encode private data into them. Optional images/video/native raw maps are **not supported** in v1; any future capture format requires separate privacy design and explicit permission.

Export is explicit, only after stopping recording; a generation guard cancels pending export after clear/revoke/source change. Compact JSON contains SHA-256 of canonical sorted-key validated recording. Checksum is corruption detection, not a signature. Reject files over 2 MiB before parsing, malformed/unknown fields, contradictory provenance and tampered checksums. Do not evaluate HTML or fetch anything from imported content. Import uses last-request/source ownership, never auto-starts camera.

Camera acquisition is explicit and HTTPS/localhost-only. `CameraLease` invalidates pending permission requests and stops late streams. Stop/hidden tab/pagehide ends tracks; no automatic camera restart. Pagehide erases the volatile session and recording consent. Clear/revoke erases frames and pending imports/exports in the tab, but cannot delete downloaded files. No cloud request is required for the lab. CSP forbids external script/connect/frame and permits same-origin assets and media blobs.

## Corpus and honest evaluation

Nine reproducible synthetic scenarios: static, target motion, camera motion, display transforms, occlusion, confidence/mixed support, stale/reused depth, relative-only and learned-unverified. These test mechanics; no actual detector, tracker, physical phone or audio latency is exercised. Source fixtures are generated locally in code, no external image rights needed.

24 **uncollected** physical slots: six planned distances (0.5/1/1.5/2/3/5 m) × centre/edge/static-target-motion/camera-motion conditions. The planned distance is not ground truth. Start supervised on a tabletop/controlled safe space; do not ask a blind user to navigate independently. Existing dashcam RGB videos can test semantics/tracking later, but cannot supply reliable nearfield metric truth or native depth/VIO retroactively.

Measure camera-to-the-supported physical point by tape/laser and record the actual value; record scene/device/camera orientation and object surface conditions in a separately consented evaluation note. Associate each truth to the recording's exact frame ID and target ID. Mark development vs independent holdout; no calibration on holdout. Glass/dark/reflective/textureless/thin/overhead/drop-off cases and lost-pose/mixed-motion cases must enrich the physical corpus after baseline collection; 24 slots alone are not safety acceptance.

`evaluateRecording` excludes synthetic truth and development labels from physical error calculation. Returns target-observation support coverage, measured holdout count, paired count, labelled coverage, MAE/P95 errors if paired labels exist. Missing/refused observations remain misses; absent paired truth returns null error, never zero or PASS. Labelled values are still declarations; verdict stays physical-validation-pending. Phone capture-to-event P95, audio onset P95, false-confident range, long blackout, 30-minute thermal/battery performance, older-phone compatibility and usability with orientation/mobility specialists are future hardware gates, not inferred from Chromium/emulation.

## Run / next gate

`npm run typecheck`, `npm run test:unit`, `npm run build`, `npm run test:assistive-lab`, `npm run qa:drive-partner`. UI `/assist.html` is independent from `/drive.html`. No additional dependency or model install.

TIP-64B should implement native adapters behind this boundary, capability detection and single camera ownership: ARCore RGB/depth in one session on supported Android; ARKit sceneDepth + confidence when supported; explicit RGB-only fallback elsewhere. Browser camera in this lab cannot magically access phone LiDAR/ARCore depth. Add provider recordings, calibration/alignment/freshness evidence and actual supported-phone tests before enabling end-user semantic/audio risk behaviour. Native packaging is a distinct build target and must not hijack DriveSense's browser app.
