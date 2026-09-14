# TIP43 — Correct DriveSense detector decoding

Priority P0. Depends TIP42. Working directory: this repository. Sequential
Contractor → Builder → Contractor; focused debugging, not a new architecture.

## Scan and decisions

TS/Vite; Transformers.js 3.8.1; pinned RT-DETRv2 R18 ONNX; worker → per-class NMS
→ vehicle tracker → calibrated ray/plane range → replay. No backend/database.
The installed RTDetrImageProcessor delegates to generic DETR post-processing:
softmax and last-class background removal. The selected RT-DETRv2 uses focal
loss: official decoder is independent sigmoid, flattened top num_queries, no
background class. Generic scores cannot be corrected from the exported boxes.
Existing raw export also has near-identical car/truck boxes at the same position;
per-class NMS and per-class tracking let both become objects.

Calibration is null in the user's actual-video report. A box is not a metric
scale. Missing metres is a known unimplemented input workflow/acceptance gap,
not evidence that inserting assumed camera parameters would be correct.

Decision: repair decoder for DriveSense only with an instance-local adapter,
validate model contract, add near-identical cross-vehicle duplicate suppression.
Do not change global RoboEye detection behaviour or model/dependencies in this
bugfix. Do not tune arbitrary thresholds to this single screenshot. Scope checkpoint
merged with user's ongoing repair request; retain current camera calibration gate.

## Requirements and acceptance

- R1: focal logits decode with sigmoid/top-K and preserve the final real class;
  negative logits cannot turn into a high-score object through softmax.
- R2: adapter rejects unsupported configs/shapes; no node_modules patch; other
  engines/profiles unchanged.
- R3: near-identical car/bus/truck boxes produce one vehicle hypothesis, while
  nearby/partially occluded distinct vehicles are not suppressed by containment.
- R4: export records decoder/policy version; old decoded caches are not presented
  as new inference. Distance remains unknown without measured calibration.
- R5: unit/build checks plus fresh real-video inference and visual comparison;
  report residual false positives and missing metric acceptance, not merely boxes.
- R6 (added after first actual-video verification): do not let one weak birth
  remain displayed indefinitely through low-score associations. Confirm two strong
  samples, or one very strong sample; bound weak-evidence retention and invalidate
  its metric estimate immediately. Low-confidence detections can still associate.

Contractor refinement decision: first corrected run still created truck ID9 at
0.463 and then retained it at scores 0.18–0.425 for seconds. Add explicit admission
policy: 0.65 strong, two adjacent strong observations ≤400ms apart, 0.85 immediate,
400ms weak grace. These are conservative PoC operating thresholds, not calibrated
probabilities or a benchmark-selected optimum. Prefer abstention over unsupported
positive labels; reduced recall of small/occluded vehicles must be disclosed.

## Verification plan / constraints

Independent small analytical logits fixtures for decoder; tracking/replay regression.
Same local user clip, no video or identifiable image published/added to Git.
Keep original local report as before evidence. Do not overwrite unrelated RoboHand
changes. No commit/push/deploy. Actual-distance acceptance remains NOT READY.

Primary references:
- https://huggingface.co/onnx-community/rtdetr_v2_r18vd-ONNX/blob/main/config.json
- https://github.com/huggingface/transformers/blob/v4.50.3/src/transformers/models/rt_detr/image_processing_rt_detr.py
- Installed 3.8.1 `src/models/rt_detr/image_processing_rt_detr.js` and
  `src/base/image_processors_utils.js`, also present in browser bundle.
