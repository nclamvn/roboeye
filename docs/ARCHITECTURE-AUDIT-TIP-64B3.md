# RoboEye — architect audit and model strategy

2026-10-11 · Scope: repository inventory + deep audit of the native RoboEye Assist camera path just tested by the user. This is not certification of every historical module or a claim of leading commercial readiness.

## Executive finding

The native app now has a real offline detector and real LiDAR ranging. Its most immediate quality gaps are **association, presentation and observability**, not simply insufficient GPU power. Changing the detector alone cannot fix ghost identities, overlapping labels, redundant UI work, expired measurements or ambiguous depth provenance.

The right architecture has separate clocks for camera, perception and presentation; one bounded frame in flight; raw geometry for measurement; a presentation-only filter; explicit uncertainty; and a benchmark gate before a replacement model can ship. TIP-64B3 repairs these seams first.

## Current product boundaries

| Product | Entry | Current architecture | Important boundary |
|---|---|---|---|
| RoboEye web / RoboHand | `/` | TypeScript/Vite, three.js WebGPU/WebGL2, workers, relative depth and hand retargeting | Relative 3D is not physical metres; native Assist changes do not replace the hand rig |
| DriveSense | `/drive.html` | Separate detection, metric-depth, road workers, scheduling/join/evidence policies | Highway camera estimates have different scale, hardware and validation requirements; native 0.5–5 m LiDAR is not a highway solution |
| Assist evidence lab | `/assist.html` | Closed metadata contract, synthetic/replay cases, consent/RAM recorder | Browser camera captures RGB metadata, not automatic native recognition/LiDAR |
| RoboEye Assist iOS | Xcode app | UIKit + ARKit sceneDepth + Vision/Core ML + bounded native tracker | Requires supported LiDAR capture path; 80 classes, not all objects; approximate visible surface, not walkable clearance |

Repository scan: TypeScript strict/noUnusedLocals; 61 web unit files, 353 passing cases at start of this turn; Swift package and UI suite; no ESLint configuration found. Main application, native core/app and web unit source subset totals about 22,878 lines before changes. Fresh `security:audit` passed: 0 high / 0 critical dependency advisories and no sharp/libvips exposure in the existing browser bundle; that bundle was not rebuilt for this native-only task. Test count is not a measure of physical recall or distance accuracy. No authentication/database/server is needed in the current native offline path.

## Evidence and debt ledger

### P1 — fix now

1. **Ghost tracks at same-class overlap.** Ambiguous matching created a new ID and then appended obsolete candidate tracks as coasting. The existing ambiguity test checked ID renewal, not the total visible count. Add that missing invariant.
2. **Greedy matching.** Confidence order can consume the only valid match for a second detection although a two-object solution exists. Use bounded global assignment with explicit ambiguity rejection; not a claim of biometric/semantic re-identification.
3. **Presentation jitter and unreadable density.** Direct raw box placement, unconstrained badge collisions, duplicate render timers, per-frame accessibility allocation and fitting. Preserve raw coordinates while stabilizing only the visual layer.
4. **Error loops and silent model mismatch.** A failed load/inference can be retried at frame rate; a mismatched result type can be converted to an empty scene. Distinguish empty detections from incompatible output; bounded retry and useful diagnostics.
5. **QA command/evidence mismatch.** Historical gate expects five UI tests while current suite has eleven; receipt paths are hardcoded to old milestones. Route the current command consistently and preserve historical results rather than relabeling them.

### P2 — repair bounded costs, measure before claiming speedups

- Locking depth/confidence buffers for each object repeats work; one validated lock pair per frame is sufficient.
- Export projection/packet construction runs without recording consent; omit it when not requested, without changing live range support.
- Current timings are one sample or one maximum, not sustained distributions. Record bounded work/inference/capture-to-ready distributions and dropped/error counts.
- A six-color loop is not a reliable twelve-object identity scheme. Explicit IDs and stable accessibility identity matter more than colorful boxes.
- Current detector/config is hardcoded. A validated descriptor is a useful replacement seam, but a different tensor format still needs a real adapter and parity tests.

### Deferred gaps — not silently “fixed” by aesthetics

- **Foreground association:** a box interior may mostly contain background. Spatial support and depth clustering reduce risk, but cannot prove that depth belongs to the named object. Instance masks and measured occlusion/tilt cases are the next ranging upgrade.
- **Tilted surfaces:** a fixed optical-Z clustering band can reject a tilted plane. Evaluate plane residuals/foreground masks on independently measured surfaces before altering confidence policy.
- **Low-end/non-LiDAR devices:** current ARKit capture path requires sceneDepth. An RGB-only mode needs a separate capability contract and must not invent metric scale; Android needs a native camera/model/depth strategy, not reuse of an iOS claim.
- **Physical QA:** no held-out recall dataset, tape/laser error distribution, accessibility-user evaluation, 30-minute heat/endurance or comparative model test on the target phone yet.
- **Distribution:** native code is not in web deploy; browser links cannot update the Xcode-installed app. Shipping signed apps, TestFlight and stores require their own release process.
- **Broader repo:** DriveSense app orchestration, multiple model runtimes and historical experiment scripts remain separate debt candidates. No blanket dependency upgrade or unrelated rewrite in B3.

## Primary-source technical comparison

Checked 2026-10-11. These are **candidate decisions**, not phone benchmark results. No paid API, model conversion environment or additional weights installed for this comparison.

| Option | What is evidenced | Integration/quality tradeoff | Decision |
|---|---|---|---|
| Apple-distributed YOLOv3 FP16 | Existing checksum-pinned artifact, offline bundle, Core ML/Vision recognized-object output, actual B2 phone smoke | Older detector; 80 closed classes; no instance masks or proof of per-class recall | Keep as regression/fallback baseline, not claim SOTA |
| RF-DETR Nano / Seg Nano | Official project supports detection/instance segmentation; Apache-designated models; native Core ML export documented | Export is explicitly experimental. Tensor input normalization/output decoding differs from the current recognized-object adapter; mask/depth alignment and phone sustained performance must be measured | Preferred permissively licensed **evaluation lane**, not automatically shipping |
| YOLO26n / YOLO26n-seg | Official docs describe Core ML export and optional NMS-free detection | AGPL/Enterprise policy needs commercial review. Published CPU/T4 timings are not iPhone end-to-end latency; segmentation cost needs testing | Strong competing evaluation lane if licensing fits |
| YOLOX Nano | Official repository, Apache-2.0, lightweight detector; usable conceptual overlap with the existing web lite path | Core ML conversion/decoder needs validation; older method and no automatic foreground mask | Small-model fallback candidate for constrained hardware |
| Apple FastVLM | Official code includes an Apple-device demo and quantized inference path | Scene description is not calibrated range or frame-synchronous object tracking; token generation must not block the safety-critical perception loop; separate code/weight licenses | Optional user-requested scene description later, not live bounding-box/ranging replacement |

Sources: [Apple model collection](https://developer.apple.com/machine-learning/models/), [RF-DETR official project](https://github.com/roboflow/rf-detr), [RF-DETR native Core ML export](https://github.com/roboflow/rf-detr/blob/develop/docs/exports/coreml.md), [RF-DETR licensing](https://roboflow.com/licensing), [YOLO26 official technical documentation](https://docs.ultralytics.com/models/yolo26/), [YOLOX official repository](https://github.com/Megvii-BaseDetection/YOLOX), [FastVLM official implementation](https://github.com/apple-aiml-research/ml-fastvlm).

No cross-model paper AP comparison is treated as an app quality score. Provider pages differ in variants, inputs and benchmark hardware; select immutable artifacts and one local holdout before comparing.

### What we adopt in B3

- **Speed-adaptive display filtering** inspired by the [original 1€ filter](https://gery.casiez.net/1euro/): lower stationary jitter, higher responsiveness during movement; discontinuities reset. This is an engineering inference/application to display boxes, not a guarantee from the paper or a change to depth.
- **Detector + tracker split**, retained in a single-flight worker. [ByteTrack](https://github.com/FoundationVision/ByteTrack) supports the importance of association/fragmentation; B3 does not claim to implement its full algorithm or inherit its MOT benchmark scores. We repair bounded native matching, retaining strict recognition and measurement guards.
- **Explicit compute configuration**, not an assumption that `.all` or “GPU” is always fastest. [Core ML computeUnits](https://developer.apple.com/documentation/coreml/mlmodelconfiguration/computeunits) is a configuration seam; actual target-phone comparisons are still required.
- **Stable UI state**, meaningful IDs, explicit unknowns and restrained labels; no flashing or copied old measurements.

## Next model promotion gate

Build the replacement as a non-shipping experiment first. Pin source commit, weights hash, license, input transform, class vocabulary, decoder and mask transform. Run all current regressions, then the **same** phone/data protocol:

1. Static photos + videos: person, chair, fridge, bottle/phone, small and occluded objects, false-positive background, low light and motion blur. Report per-class precision/recall, miss duration and ID switches; never fill absent labels as ground truth.
2. Raw-to-display and mask-to-depth registration at portrait/landscape and image borders.
3. Sensor-to-present latency p50/p95/p99, box jitter, >100 ms visual gaps, processing drops, peak memory, model load time and 30-minute thermal degradation. Report measurement basis separately from render cadence.
4. Independently measured 0.5–5 m surface truth, including glass, tilted and occluded objects; report error **and refusal coverage**. Never optimize coverage by accepting background or stale metres.
5. VoiceOver, large text, Reduce Motion/Transparency and a supervised accessibility-user trial. No navigation release based on simulator passes.

Promotion requires a reproducible measured gain without regressions in freshness, false association, memory/heat, offline operation or licensing. Rollback remains the verified baseline. A modern model name is not a release gate.

## Definition of commercial readiness

B3 can make the software more coherent, measurable and visually stable. It cannot establish safe independent mobility, highway collision avoidance, all-object understanding or zero latency. Those claims need separate physical evidence and product validation. The completion report records exactly what passed and what is still unknown.
