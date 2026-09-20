# Camera-Only Highway Safety Software Upgrade

## Executive conclusion

The present DriveSense approach can be made materially stronger before vehicle
hardware is introduced. Its useful ceiling is not “a better metre label from one
frame”, but a temporally consistent, uncertainty-aware forward-collision-warning
research stack. The best near-term architecture keeps the existing real-time
detector and metric-depth baseline, then adds motion-derived time-to-collision
(TTC), lane/path relevance, risk ranking, explicit abstention and event logging.

This is feasible with open research and an inexpensive single camera. It is not
evidence that a monocular system can supply certified absolute distance in every
highway condition. Monocular 2D-to-3D recovery remains ill-posed; newer work
improves it with complementary depth cues, probabilistic modeling and temporal
information rather than claiming the ambiguity has disappeared.^1

The highest-value software upgrade is therefore an **explainable shadow-risk
engine**. It should demonstrate what the system sees, which target matters, which
signals agree, when it abstains and what would have triggered a warning—without
controlling the car. This phase is implemented as TIP-46.

## Baseline audit

Before TIP-46, DriveSense already had several sound foundations:

- RT-DETRv2 R18 detection isolated in a worker, with vehicle-only decoding and
  conservative confirmation. RT-DETR is an appropriate baseline because its
  end-to-end design removes conventional NMS and supports speed tuning through
  decoder depth.^2
- ByteTrack-inspired two-stage association that lets low-confidence observations
  maintain an existing identity without allowing them to create a new vehicle.
  That choice follows the central ByteTrack finding that discarded low-score
  detections are a major source of fragmented tracks.^3
- Metric Depth Anything V2 outdoor depth for analysed video, with aspect-preserving
  letterboxing and robust interior vehicle ROI. Depth Anything V2 supplies small
  metric variants and reports a large efficiency improvement over diffusion-based
  alternatives, making it a credible browser baseline.^4
- Calibrated ground-plane geometry as a separate range method, plus fail-closed
  behavior, sample age, worker latency and independently supplied ground truth.

The gap was not another detector. The application had no path relevance, TTC,
time-headway, threat selection, warning explanation or event-level audit trail.
Its previous colors were fixed metre bands, which cannot represent highway risk:
the same gap has very different meaning at 30 and 100 km/h.

## Evidence synthesis and technology decisions

| Capability | Evidence | Decision |
|---|---|---|
| Real-time vehicle detection | RT-DETR reports a strong accuracy/speed trade-off and adaptable decoder depth.^2 RT-DETRv3 later reports higher R18 AP with comparable latency.^5 | Keep RT-DETRv2 as pinned baseline; benchmark v3/D-FINE only on the same device and dataset. |
| Track continuity | ByteTrack associates low-score detections to recover occluded objects and reduce fragmented trajectories.^3 | Keep two-stage association, but never let weak evidence refresh range or birth a track. |
| Metric depth | DA2 supports metric fine-tunes; single-frame video depth can flicker and fail under range changes.^4,6 | Keep DA2 for the PoC; smooth at track level and add a temporal-depth challenger later. |
| Scale-free collision cue | Optical expansion provides relative depth change and has demonstrated value for TTC estimation from monocular imagery.^7 | Add TTC from the logarithmic growth rate of each tracked box. |
| Road/path relevance | YOLOPv2 jointly performs traffic-object detection, drivable-area segmentation and lane detection with an embedded real-time design.^8 | Implement a transparent perspective corridor now; benchmark a panoptic-road model as the next challenger. |
| Uncertainty | Probabilistic monocular 3D work models correlated physical/visual-height uncertainty; calibration errors can strongly affect safety outputs.^9 | Surface evidence quality, refuse red escalation on conflicting TTC signals, and preserve unknown states. |
| Runtime packaging | NVIDIA DeepStream combines accelerated decode, TensorRT inference and tracking for dGPU/Jetson.^10 | Browser remains the demonstrator and report UI; the future vehicle pipeline moves to a native edge runtime. |

### Why TTC complements metres

For a rigid object approaching a pinhole camera, a characteristic image scale
`s` is approximately proportional to `1/Z`. Under constant relative velocity,
`TTC ≈ 1 / d(log s)/dt`. DriveSense uses the square root of bounding-box area as
`s`, rejects implausible scale jumps, smooths the log-scale rate and waits for
three strong updates before publishing TTC.

This cue can work without a camera profile or object-size prior. It can still be
wrong under strong yaw, lane changes, detector box jitter or non-rigid occlusion.
For that reason it is combined with range-derived TTC when available. Agreement
raises evidence quality; a disagreement larger than 2.2× is shown as a conflict
and cannot directly create a critical/red state.

### Why lane relevance precedes richer 3D

A close vehicle in another lane is often less urgent than a farther rapidly
closing lead vehicle. The first software gate is therefore a perspective corridor
whose width grows toward the camera. Vehicle overlap and center position form an
explicit path score. It is deliberately called an estimated corridor, not lane
detection. True lane/drivable-area segmentation is the next model experiment.

Camera-based occupancy and panoramic 3D representations are promising, but the
strongest published systems aggregate multi-frame, multi-view inputs and are too
heavy to insert into the current single-camera browser loop without measurement.^11
They are a later edge-runtime branch rather than a presentation dependency.

## TIP-46 product capability

TIP-46 adds six user-visible behaviors:

1. **Camera-only TTC:** scale-derived TTC is computed for every strong, continuous
   track even when metric depth is unavailable.
2. **Risk corridor:** a perspective corridor is drawn directly on the video and
   separates in-path from side targets.
3. **Primary threat lock:** one in-path target receives prominent corner brackets;
   labels consistently publish metres or explicitly abstain.
4. **Explainable risk console:** target ID, estimated distance, legal-distance
   reference, evidence percentage and reason are visible together. TTC and signal
   agreement remain internal/report evidence so the HMI never mixes seconds and
   metres as competing distance metrics.
5. **Speed-aware reference:** the UI maps a supplied test speed to the dry/good
   condition distances in Vietnam Circular 38/2024: 35 m at 60 km/h; 55 m above
   60 through 80; 70 m above 80 through 100; and 100 m above 100 through 120.^12
   Below 60 km/h it abstains because the regulation does not provide one fixed
   table value. An optional 25% adverse-condition factor is explicitly labeled
   as an engineering buffer, not law.
6. **Shadow events and sound:** transitions into caution/critical are rate-limited,
   counted, optionally sounded locally and included in report JSON with the input
   configuration and evidence.

The generated visual is useful for a presentation because it tells a coherent
story: “the system sees two vehicles, excludes the side vehicle, locks the lead
vehicle, estimates closing urgency, explains the warning and records the event.”
Every impressive element corresponds to a testable engineering function.

## Risk policy boundaries

The policy uses four states: `clear` means outside the estimated path, `monitor`
means in-path without a warning trigger, `caution` means one or more signals need
attention, and `critical` requires both severe evidence and adequate confidence.
It does not use green or the word “safe”.

Inputs include detection score, observation age, range sensitivity, scale-motion
history, range TTC, optical TTC, time-headway and the configured speed-distance
reference. A conflict between optical and range TTC caps confidence and prevents
red escalation. A missed observation resets motion TTC rather than preserving a
stale value.

These thresholds are demonstrator policy, not validated FCW trigger thresholds.
ISO 15623 defines performance requirements and test procedures for forward
vehicle collision warning and keeps responsibility with the driver.^13 ISO 21448
requires analysis of hazards caused by functional insufficiency of perception,
even when no hardware fault exists.^14 Those frameworks must shape the next
validation phase before public-road use.

## “Wow” capability backlog

The next presentation features should be selected by evidence value, not visual
novelty alone.

### Adopt next

- **Event scrubber:** mark caution/critical events on the video timeline and jump
  directly to the preceding five seconds. This makes a long run auditable in a
  live presentation.
- **Bird’s-eye evidence view:** project only calibrated/qualified tracks into a
  compact top-down plot; keep uncalibrated tracks in image space. This can expose
  lateral relevance without inventing 3D.
- **Cut-in trend:** estimate lateral velocity and time-to-corridor, then show
  “possible cut-in” separately from distance. Do not call it intent prediction
  until a labeled event benchmark exists.
- **Automatic degradation banner:** detect blur, darkness, blocked lens, abnormal
  horizon/camera movement and thermal/latency overruns; silence numeric output
  when the observation contract breaks.
- **Vietnamese voice alert:** short, rate-limited phrases such as “xe trước đang
  tiến gần”; never read rapidly changing metre values or require screen contact.

### Experiment after a dataset exists

- YOLOPv2/Q-YOLOP-style drivable-area and lane head to replace the heuristic
  corridor.^8
- Video Depth Anything or a lightweight temporal-stabilization stage to reduce
  frame-to-frame depth flicker.^6
- RT-DETRv3 or D-FINE challenger for small/distant vehicles, evaluated against
  the current model at identical input size and hardware.^5
- Target-domain fine-tuning using Vietnam dashcam clips, with trips separated
  across train/validation/test rather than random frames.

### Defer

- Automatic braking or steering.
- Open-ended vision-language narration in the alert loop.
- Heavy multi-camera occupancy models in the browser.
- Any accuracy, safe-distance or collision-avoidance claim without synchronized
  ground truth and event-based validation.

## Validation and data strategy

The software can be developed without installing LiDAR in the final product, but
it cannot be validated without independent truth. A2D2 provides synchronized and
registered camera, LiDAR and vehicle-bus data, including sequential frames; Waymo
provides independent camera and LiDAR labels plus calibration and vehicle pose.^15,16
BDD100K supplies diverse video, tracking, lane and drivable-area annotations but
is not an absolute-distance truth source.^17 These datasets are useful for
algorithm tests and failure discovery, not a substitute for the target camera,
mount and Vietnamese road domain.

The next controlled dataset should contain measured 5/10/20/30/50/70 m stations,
lead braking, constant following, side traffic, cut-in, crest/dip, curve, partial
occlusion, glare, rain and night. Each run needs synchronized source-frame time,
camera profile, truth distance, vehicle speed, detector output, track ID, TTC,
warning transition and complete latency.

Report gates should include distance MAE/P95 by range bucket, TTC error in the
hazard window, coverage/abstention, false warnings per hour, missed warning events,
lead time, ID switches, capture-to-alert P95/P99 and 30-minute thermal stability.
No average may omit unknown outputs or failed frames.

## Packaging path

For the current desktop phase, Vite/TypeScript remains the reproducible UI and
replay shell. Model revisions, hashes, preprocessing transforms and report schema
remain pinned. The browser demo never uploads video by default.

For the vehicle prototype, the same contracts should move behind a local service:
hardware decode → TensorRT/ONNX inference → tracker/risk engine → local WebSocket
telemetry → browser HMI. NVIDIA states that Jetson developer kits are for
development/testing rather than production systems; a production module/carrier,
power protection, cooling and watchdog are separate engineering work.^18

The advisory should remain audio-first. Vietnam’s current law requires vehicles
to maintain technical safety, and installation/certification implications must be
reviewed against Law 36/2024/QH15 and Circular 47/2024 before an on-road pilot.^19,20
UNECE R152 is relevant only as a later reference for systems that automatically
apply braking; it also requires false-reaction avoidance and acknowledges that
weather, road and vehicle conditions affect performance.^21

## Decision

The current approach is upgradeable and worth continuing. TIP-46 reaches the
maximum responsible presentation value from the present assets: it turns isolated
detection/range outputs into a coherent shadow FCW story while preserving unknown,
conflict and non-production labels. The next engineering investment should be the
event dataset and temporal/lane challengers—not more unvalidated UI thresholds.

## Sources

1. Yan et al. “[MonoCD: Monocular 3D Object Detection with Complementary Depths](https://openaccess.thecvf.com/content/CVPR2024/html/Yan_MonoCD_Monocular_3D_Object_Detection_with_Complementary_Depths_CVPR_2024_paper.html).” CVPR, 2024.
2. Zhao et al. “[DETRs Beat YOLOs on Real-time Object Detection](https://openaccess.thecvf.com/content/CVPR2024/html/Zhao_DETRs_Beat_YOLOs_on_Real-time_Object_Detection_CVPR_2024_paper.html).” CVPR, 2024.
3. Zhang et al. “[ByteTrack: Multi-Object Tracking by Associating Every Detection Box](https://arxiv.org/abs/2110.06864).” ECCV, 2022.
4. Yang et al. “[Depth Anything V2](https://arxiv.org/abs/2406.09414).” 2024.
5. Wang et al. “[RT-DETRv3](https://openaccess.thecvf.com/content/WACV2025/html/Wang_RT-DETRv3_Real-Time_End-to-End_Object_Detection_with_Hierarchical_Dense_Positive_Supervision_WACV_2025_paper.html).” WACV, 2025.
6. Chen et al. “[Video Depth Anything: Consistent Depth Estimation for Super-Long Videos](https://openaccess.thecvf.com/content/CVPR2025/html/Chen_Video_Depth_Anything_Consistent_Depth_Estimation_for_Super-Long_Videos_CVPR_2025_paper.html).” CVPR, 2025.
7. Yang and Ramanan. “[Upgrading Optical Flow to 3D Scene Flow Through Optical Expansion](https://openaccess.thecvf.com/content_CVPR_2020/papers/Yang_Upgrading_Optical_Flow_to_3D_Scene_Flow_Through_Optical_Expansion_CVPR_2020_paper.pdf).” CVPR, 2020.
8. Han et al. “[YOLOPv2: Better, Faster, Stronger for Panoptic Driving Perception](https://arxiv.org/abs/2208.11434).” 2022.
9. Shi, Chen and Kim. “[Multivariate Probabilistic Monocular 3D Object Detection](https://openaccess.thecvf.com/content/WACV2023/html/Shi_Multivariate_Probabilistic_Monocular_3D_Object_Detection_WACV_2023_paper.html).” WACV, 2023.
10. NVIDIA. “[DeepStream](https://github.com/NVIDIA/DeepStream).” Accessed 2026-09-14.
11. Wang et al. “[PanoOcc: Unified Occupancy Representation for Camera-based 3D Panoptic Segmentation](https://openaccess.thecvf.com/content/CVPR2024/html/Wang_PanoOcc_Unified_Occupancy_Representation_for_Camera-based_3D_Panoptic_Segmentation_CVPR_2024_paper.html).” CVPR, 2024.
12. Bộ Giao thông vận tải. “[Thông tư 38/2024/TT-BGTVT](https://vanban.chinhphu.vn/?classid=1&docid=211873&pageid=27160&typegroupid=6).” 2024.
13. ISO. “[ISO 15623:2013 — Forward vehicle collision warning systems](https://www.iso.org/standard/56655.html?browse=tc).” 2013.
14. ISO. “[ISO 21448:2022 — Safety of the intended functionality](https://www.iso.org/standard/77490.html).” 2022.
15. Audi. “[A2D2: Audi Autonomous Driving Dataset](https://a2d2-dataset.github.io/).” Accessed 2026-09-14.
16. Waymo. “[Waymo Open Dataset — Perception](https://waymo.com/open/data/perception/).” Accessed 2026-09-14.
17. Yu et al. “[BDD100K: A Diverse Driving Dataset for Heterogeneous Multitask Learning](https://openaccess.thecvf.com/content_CVPR_2020/papers/Yu_BDD100K_A_Diverse_Driving_Dataset_for_Heterogeneous_Multitask_Learning_CVPR_2020_paper.pdf).” CVPR, 2020.
18. NVIDIA. “[Jetson FAQ](https://developer.nvidia.com/embedded/faq).” Accessed 2026-09-14.
19. Quốc hội Việt Nam. “[Luật 36/2024/QH15](https://vanban.chinhphu.vn/?docid=211194&pageid=27160).” 2024.
20. Bộ Giao thông vận tải. “[Thông tư 47/2024/TT-BGTVT](https://vanban.chinhphu.vn/?classid=1&docid=212078&pageid=27160&typegroupid=6).” 2024.
21. UNECE. “[UN Regulation No. 152 Rev. 2](https://unece.org/transport/documents/2023/06/standards/un-regulation-no-152-rev2).” 2023.
