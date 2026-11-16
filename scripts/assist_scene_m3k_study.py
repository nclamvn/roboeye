#!/usr/bin/env python3
"""M3K Mac-only 2x2 actual detector/correspondence trial, labels only at score.

A/B use frozen DIS cohorts with old/new detections; C/D substitute the learned
field only. Each lane owns its unchanged identities and cohorts independently.
"""

import argparse
from collections import Counter
from datetime import date
from hashlib import sha256 as content_sha256
import json
import math
from pathlib import Path
import platform
import re
import shutil
import tempfile
from time import perf_counter

import cv2
import numpy as np

from assist_scene_motion import parse_detect, sha256
from assist_scene_motion_m3b import detect_samples
from assist_scene_motion_m3c import load_input
from assist_scene_m3e_study import CAPS, DROPPED, legacy_score, output, read_frame, write_new
from assist_scene_m3f_study import stage
from assist_scene_m3g_study import DETECTOR_CONFIGURATION, _percentiles, bind_input, finite_payload, lane_contract, model_hashes
from assist_scene_m3h_study import CODE as PREVIOUS_CODE, cached_observation, cohort_contract, lifecycle_summary, read_json, load_cache as original_cache


HERE = Path(__file__).resolve().parent
LANES = ("A", "B", "C", "D", "S")
LEARNED_FLOW_LANES = ("C", "D")
NEW_DETECTOR_LANES = ("B", "D")
MAX_FRAMES = 180
MAX_DETECTOR_CALLS = 360
CODE = tuple(dict.fromkeys((*PREVIOUS_CODE, "assist_scene_m3k_study.py",
    "assist_scene_learned_detector.py", "assist_scene_learned_region.py")))
TIMINGS = ("fullPreparation", "sharedPrep", "workingDecode", "nativeDecode", *LANES)


def policy_snapshot():
    from assist_scene_cohort_loom import POLICY as IDENTITY_POLICY
    from assist_scene_learned_detector import POLICY as DETECTOR_POLICY
    from assist_scene_learned_region import POLICY as FLOW_POLICY
    return {"identity": dict(IDENTITY_POLICY), "detector": dict(DETECTOR_POLICY), "flow": dict(FLOW_POLICY)}


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _digest(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def load_cache(path, inputs, input_hash, exe_hash, hashes):
    """Only original full observations from the actual 100-frame M3J suite.

    The unchanged M3H validator binds every source clock/token, input bytes,
    parser/staging implementation, executable, model, gap and historical cost.
    M3J's tile/candidate/identity surfaces are never reused or interpreted.
    """
    cache = original_cache(path, inputs, input_hash, exe_hash, hashes)
    provenance = cache.get("detectorProvenance", {})
    if (cache.get("study") != "M3J" or sum(len(c["frames"]) for c in cache["clips"]) != 100
            or cache.get("developmentOnly") is not False
            or provenance.get("kind") != "actual-local-CoreML" or provenance.get("cacheSha256") is not None
            or provenance.get("fullSampleTimings") != "actual per-exposure model inference"
            or any(clip.get("detectorExecution") != "actual-local-CoreML" for clip in cache["clips"])):
        raise ValueError("Development cache must be the actual original 100-exposure M3J full observations")
    for recorded, source in zip(cache["clips"], inputs["clips"], strict=True):
        size = len(source["frames"])
        if (recorded.get("detectorCalls") != size*5
                or recorded.get("fullDetectorBatches") != math.ceil(size/50)
                or recorded.get("tileDetectorBatches") != math.ceil(size*4/50)):
            raise ValueError("Wrong original M3J full detector execution metadata")
        for old, actual in zip(recorded["frames"], source["frames"], strict=True):
            if old.get("sourceSha256") != actual.get("sha256") or not _digest(old.get("sourceSha256")):
                raise ValueError("Cached full detections do not bind the original exposure fingerprint")
    return cache


def _detect_batched(items, exe, model):
    found, wall, batches = {}, 0., 0
    for start in range(0, len(items), 50):
        current = items[start:start+50]
        tick = perf_counter()
        config, observations = detect_samples(current, exe, model)
        wall += (perf_counter()-tick)*1000.
        batches += 1
        if config != DETECTOR_CONFIGURATION or set(observations) != {i for i, _, _ in current}:
            raise ValueError("Detector configuration or exact batch binding changed")
        found.update(observations)
    return found, wall, batches


def _read_native(path, fingerprint):
    """Hash and decode the same bounded bytes, without reopening the source."""
    with path.open("rb") as stream:
        payload = stream.read(8*1024**2+1)
    if not payload or len(payload) > 8*1024**2:
        raise ValueError("Missing or over-budget native exposure bytes")
    if not _digest(fingerprint) or content_sha256(payload).hexdigest() != fingerprint:
        raise ValueError("Original exposure changed before native decode")
    native = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
    if (native is None or min(native.shape[:2]) < 32 or max(native.shape[:2]) > CAPS["maxNativeSide"]
            or math.prod(native.shape[:2]) > CAPS["maxNativePixels"]):
        raise ValueError("Invalid or over-budget decoded native exposure")
    return native


def detector_contract(frame, device):
    """Rebuild the learned detector's exact deterministic output from raw rows."""
    from assist_scene_learned_detector import ID2LABEL, parse_predictions

    report = frame.get("learnedObservation", {})
    nh, nw = frame["nativeHeight"], frame["nativeWidth"]
    h, w = frame["height"], frame["width"]
    if (report.get("method") != "rtdetr-v2-r18vd" or report.get("device") != device
            or report.get("nativeShape") != [nh, nw] or report.get("workingShape") != [h, w]
            or report.get("token") != frame["token"] or report.get("timeMs") != frame["timeMs"]
            or report.get("sourceSha256") != frame["sourceSha256"]):
        raise ValueError("Unbound learned detector exposure, geometry or device")
    timing = report.get("timing", {})
    if any(not _number(timing.get(key)) for key in ("preprocessMs", "inferenceMs", "postprocessMs", "wallMs")):
        raise ValueError("Missing actual learned detector operation timing")
    if abs(timing["wallMs"]-sum(timing[key] for key in ("preprocessMs", "inferenceMs", "postprocessMs"))) > .004:
        raise ValueError("Learned detector timing does not account for its full execution")
    prediction, labels = report.get("prediction"), report.get("id2label")
    if not isinstance(prediction, dict) or labels != ID2LABEL:
        raise ValueError("Missing bounded raw learned predictions")
    boxes, counts = parse_predictions(prediction, labels, (nh, nw), (h, w))
    if any(report.get(key) != value for key, value in counts.items()):
        raise ValueError("Learned detector parser counts do not reproduce")
    expected = [] if frame["detectorGapInjected"] else [box.record(w, h) for box in boxes]
    if frame.get("candidateDetections") != expected:
        raise ValueError("Candidate boxes do not reproduce the pinned parser")
    if frame.get("learnedDetectorObservationMs") != timing["wallMs"]:
        raise ValueError("Learned model cost must include preprocessing and parsing")


def flow_contract(frame, lane):
    from assist_scene_learned_region import POLICY, _padded_shape

    records = frame.get("learnedFlow", {}).get(lane)
    if not isinstance(records, list) or len(records) > POLICY["maxTraceRows"]:
        raise ValueError("Missing or excessive learned field trace")
    if frame[lane]["events"] and not any(r.get("status") == "field-supported" for r in records if isinstance(r, dict)):
        raise ValueError("Learned warning needs an actual current supported learned field")
    for record in records:
        if (record.get("token") != frame["token"] or record.get("timeMs") != frame["timeMs"]
                or record.get("sourceSha256") != frame["sourceSha256"]
                or record.get("providerKind") != "actual-local-pretrained-torchvision"
                or not _number(record.get("wallMs"))):
            raise ValueError("Unbound learned flow exposure or execution")
        status, calls = record.get("status"), record.get("modelDirectionCalls")
        if status == "invalid-object-crop":
            if type(calls) is not int or calls != 0:
                raise ValueError("Invalid ROI must not consume model calls")
        elif status in {"field-supported", "invalid-learned-flow"}:
            shape = record.get("roiShape")
            if (not isinstance(shape, list) or len(shape) != 2
                    or any(type(n) is not int for n in shape)
                    or record.get("paddedShape") != list(_padded_shape(shape))
                    or type(calls) is not int or calls != POLICY["directionsPerField"]):
                raise ValueError("Wrong learned ROI or forward/reverse call budget")
        else:
            raise ValueError("Incomplete or unsupported learned model execution")
    if sum(r["wallMs"] for r in records) > frame["timingsMs"][lane]+.001:
        raise ValueError("Lane execution excludes learned field cost")
    expected = sum(r["modelDirectionCalls"] for r in records)
    if frame.get("flowDirectionCalls", {}).get(lane) != expected:
        raise ValueError("Truncated or incorrect actual learned direction-call trace")


def receipt_contract(receipt):
    from assist_scene_learned_detector import ARTIFACTS, MODEL_ID, REVISION
    from assist_scene_learned_region import POLICY as FLOW_POLICY

    development = receipt.get("developmentOnly")
    count = sum(len(c["frames"]) for c in receipt["clips"])
    provenance = receipt.get("detectorProvenance", {})
    kind = "development-historical-old-full-plus-fresh-learned" if development else "actual-local-CoreML-and-PyTorch"
    device = receipt.get("device")
    detector, flow = receipt.get("learnedDetector", {}), receipt.get("learnedFlow", {})
    if (type(development) is not bool or not 1 <= count <= MAX_FRAMES
            or development and count != 100 or count*(1 if development else 2) > MAX_DETECTOR_CALLS
            or device not in {"mps", "cpu"} or provenance.get("kind") != kind
            or (not _digest(provenance.get("cacheSha256")) if development else provenance.get("cacheSha256") is not None)
            or provenance.get("oldSampleTimings") != ("historical, not current execution" if development else "actual per-exposure model inference")
            or receipt.get("policies") != policy_snapshot() or receipt.get("opencv") != cv2.__version__
            or receipt.get("numpy") != np.__version__ or not _digest(receipt.get("sceneqaSha256"))
            or not receipt.get("yoloModelHashes") or not all(_digest(v) for v in receipt["yoloModelHashes"].values())
            or receipt.get("codeSha256") != {name: sha256(HERE/name) for name in CODE}):
        raise ValueError("Forged or incompatible execution, policy or provenance claims")
    if (detector.get("modelId") != MODEL_ID or detector.get("revision") != REVISION
            or detector.get("artifactSha256") != {name: data[1] for name, data in ARTIFACTS.items()}
            or detector.get("device") != device or detector.get("dtype") != "float32"
            or detector.get("cpuFallback") is not False or detector.get("execution") != "actual-local-PyTorch"
            or detector.get("policy") != receipt["policies"]["detector"]
            or not isinstance(detector.get("versions"), dict) or not all(detector["versions"].get(k) for k in ("torch", "transformers", "opencv", "numpy"))
            or detector["versions"].get("opencv") != cv2.__version__
            or detector["versions"].get("numpy") != np.__version__
            or flow.get("kind") != "actual-local-pretrained-torchvision" or flow.get("device") != device
            or flow.get("algorithm") != FLOW_POLICY["algorithm"] or flow.get("weights") != FLOW_POLICY["weights"]
            or flow.get("weightUrl") != FLOW_POLICY["weightUrl"] or not _digest(flow.get("weightsSha256"))
            or flow["weightsSha256"] != FLOW_POLICY["weightSha256"]
            or type(flow.get("weightBytes")) is not int or not 1 <= flow["weightBytes"] <= 100*1024**2
            or not flow.get("torch") or not flow.get("torchvision") or flow.get("policy") != receipt["policies"]["flow"]
            or flow.get("torch") != detector["versions"]["torch"]
            or any(not _number(receipt.get("modelStartupMs", {}).get(k)) for k in ("detector", "flow"))):
        raise ValueError("Wrong actual pinned learned model, runtime or device provenance")
    for clip in receipt["clips"]:
        size = len(clip["frames"])
        if (not size or clip.get("detectorConfiguration") != DETECTOR_CONFIGURATION or clip.get("detectorExecution") != kind
                or any(type(clip.get(k)) is not int for k in ("oldDetectorCalls", "learnedDetectorCalls", "detectorCalls", "oldDetectorBatches"))
                or clip.get("oldDetectorCalls") != (0 if development else size)
                or clip.get("learnedDetectorCalls") != size or clip.get("detectorCalls") != size*(1 if development else 2)
                or clip.get("oldDetectorBatches") != (0 if development else math.ceil(size/50))
                or development and clip.get("oldDetectorBatchWallMs") is not None
                or any(not _number(clip.get(k)) for k in ("stageWallMs", "studyWallMs", "learnedDetectorWallMs"))
                or not development and not _number(clip.get("oldDetectorBatchWallMs"))):
            raise ValueError("Wrong detector calls, batch count or actual wall cost")
        for lane in LEARNED_FLOW_LANES:
            if clip.get("flowDirectionCalls", {}).get(lane) != sum(f["flowDirectionCalls"][lane] for f in clip["frames"]):
                raise ValueError("Wrong clip-level actual learned direction calls")


def _timing_values(frames):
    for frame in frames:
        if (any(not _number(frame.get("timingsMs", {}).get(n)) for n in TIMINGS)
                or any(not _number(frame.get(n)) for n in ("detectorObservationMs", "learnedDetectorObservationMs"))):
            raise ValueError("Missing actual per-exposure timing")
    result = {n: _percentiles([f["timingsMs"][n] for f in frames]) for n in TIMINGS}
    for lane in LANES:
        detector = "learnedDetectorObservationMs" if lane in NEW_DETECTOR_LANES else "detectorObservationMs"
        result[lane+"PairedProduct"] = _percentiles([
            f[detector]+sum(f["timingsMs"][n] for n in ("fullPreparation", "sharedPrep", lane)) for f in frames])
    return result


def run_clip(clip, root, work, exe, model, learned_detector, flow_provider, cached=None):
    from assist_scene_cohort_loom import CohortWindowLoom
    from assist_scene_learned_region import LearnedCohortWindowLoom
    from assist_scene_m3d_study import BoxBaseline

    started = perf_counter()
    frames, samples, shapes, preparation = [], [], [], []
    origin = clip["frames"][0]["timestampUs"]
    for i, source in enumerate(clip["frames"]):
        tick = perf_counter()
        folder = work/str(i); folder.mkdir()
        fs, ss, dimensions = stage({"frames": [source]}, root, folder)
        at = (source["timestampUs"]-origin)/1000.
        frames.extend(fs); samples.append((i, at, ss[0][2])); shapes.extend(dimensions)
        preparation.append((perf_counter()-tick)*1000.)
    staging_wall = (perf_counter()-started)*1000.
    full, full_wall, batches = ({}, None, 0) if cached else _detect_batched(samples, exe, model)
    engines = {"A": CohortWindowLoom(), "B": CohortWindowLoom(),
               "C": LearnedCohortWindowLoom(flow_provider), "D": LearnedCohortWindowLoom(flow_provider),
               "S": BoxBaseline()}
    rows, learned_wall = [], 0.
    for i, frame in enumerate(frames):
        h, w, nh, nw = shapes[i]
        tick = perf_counter(); gray = read_frame(samples[i][2], cv2.IMREAD_GRAYSCALE)
        working_decode = (perf_counter()-tick)*1000.
        tick = perf_counter(); native = _read_native(root/frame["path"], frame["sha256"])
        native_gray = cv2.cvtColor(native, cv2.COLOR_BGR2GRAY)
        native_decode = (perf_counter()-tick)*1000.
        if gray.shape != (h, w) or native_gray.shape != (nh, nw):
            raise ValueError("Wrong exact native/working exposure geometry")
        tick = perf_counter()
        at, gap = samples[i][1], i in DROPPED.get(clip["id"], ())
        if cached:
            boxes, detector_ms = cached_observation(cached["frames"][i], w, h, nw, nh)
            old_observation = None
        else:
            found_at, old_observation = full[i]
            if found_at != at:
                raise ValueError("Old detector exact exposure clock mismatch")
            boxes = [] if gap else parse_detect(old_observation, w, h)
            detector_ms = old_observation["detectionMs"]
        shared = working_decode+native_decode+(perf_counter()-tick)*1000.
        tick = perf_counter()
        learned_boxes, learned = learned_detector.detect(native, working_shape=(h, w))
        learned_wall += (perf_counter()-tick)*1000.
        learned.update(token=frame["token"], timeMs=at, sourceSha256=frame["sha256"])
        if gap:
            learned_boxes = []
        row = {"token": frame["token"], "timestampUs": frame["timestampUs"], "timeMs": at, "index": i,
               "sourceSha256": frame["sha256"], "width": w, "height": h, "nativeWidth": nw, "nativeHeight": nh,
               "detectorGapInjected": gap, "detections": [d.record(w, h) for d in boxes],
               "candidateDetections": [d.record(w, h) for d in learned_boxes], "oldObservation": old_observation,
               "learnedObservation": learned, "detectorObservationMs": detector_ms,
               "learnedDetectorObservationMs": learned["timing"]["wallMs"],
               "learnedFlow": {}, "flowDirectionCalls": {},
               "timingsMs": {"fullPreparation": preparation[i], "sharedPrep": shared,
                             "workingDecode": working_decode, "nativeDecode": native_decode}}
        for name, engine in engines.items():
            cv2.setRNGSeed(650500+i)
            before = flow_provider.direction_calls
            tick = perf_counter()
            selected = learned_boxes if name in NEW_DETECTOR_LANES else boxes
            result = engine.update(frame, at, gray, selected, native_gray=native_gray) if name != "S" else engine.update(frame, at, gray, selected)
            row[name] = output(result, at)
            row["timingsMs"][name] = (perf_counter()-tick)*1000.
            lane_contract(row[name], at, gap)
            if name != "S":
                cohort_contract(row[name], at)
            if name in LEARNED_FLOW_LANES:
                row["learnedFlow"][name] = [dict(r, token=frame["token"], timeMs=at, sourceSha256=frame["sha256"]) for r in engine.drain_trace()]
                row["flowDirectionCalls"][name] = flow_provider.direction_calls-before
                flow_contract(row, name)
        detector_contract(row, learned_detector.device)
        rows.append(row)
    return {"id": clip["id"], "detectorConfiguration": DETECTOR_CONFIGURATION,
            "detectorExecution": "development-historical-old-full-plus-fresh-learned" if cached else "actual-local-CoreML-and-PyTorch",
            "oldDetectorCalls": 0 if cached else len(samples), "learnedDetectorCalls": len(samples),
            "detectorCalls": len(samples)*(1 if cached else 2), "oldDetectorBatchWallMs": full_wall,
            "oldDetectorBatches": batches, "learnedDetectorWallMs": learned_wall,
            "flowDirectionCalls": {n: sum(f["flowDirectionCalls"][n] for f in rows) for n in LEARNED_FLOW_LANES},
            "stageWallMs": staging_wall, "studyWallMs": (perf_counter()-started)*1000., "frames": rows}


def replay(args):
    inputs, root = load_input(args.input)
    count = sum(len(c["frames"]) for c in inputs["clips"])
    if inputs["dataset"] not in {"Boreas-real", "synthetic-m3c"} or not 1 <= count <= MAX_FRAMES:
        raise ValueError("Unknown or excessive M3K input")
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("Choose a new receipt path")
    if shutil.disk_usage(args.output.parent).free < 10*1024**3:
        raise ValueError("Less than 10 GB free; stop before staging")
    cached_path = getattr(args, "cached_detections", None)
    development = bool(getattr(args, "development_only", False))
    if bool(cached_path) != development or development and count != 100:
        raise ValueError("Old full-detection cache allowed only for the exact 100-exposure development suite")
    if count*(1 if development else 2) > MAX_DETECTOR_CALLS:
        raise ValueError("Actual detector call budget exceeded")
    if args.device not in {"mps", "cpu"}:
        raise ValueError("Choose the actual device explicitly; no automatic fallback")
    exe, model = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    input_hash, exe_hash, hashes = sha256(args.input), sha256(exe), model_hashes(model)
    cache = load_cache(cached_path, inputs, input_hash, exe_hash, hashes) if cached_path else None
    before = {name: sha256(HERE/name) for name in CODE}
    from assist_scene_learned_detector import LearnedDetector
    from assist_scene_learned_region import TorchvisionRaftSmall
    tick = perf_counter(); detector = LearnedDetector(args.learned_model_dir, device=args.device)
    detector_startup = (perf_counter()-tick)*1000.
    tick = perf_counter(); flow = TorchvisionRaftSmall(args.flow_weights, device=args.device, expected_sha256=getattr(args, "flow_sha256", None))
    flow_startup = (perf_counter()-tick)*1000.
    cv2.setNumThreads(1)
    rows = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3k-{date.today():%Y%m%d}-", dir=args.output.parent) as temp:
        for i, clip in enumerate(inputs["clips"]):
            print(f"Replay {clip['id']} ({len(clip['frames'])} exposures, actual learned detector/flow on {args.device})", flush=True)
            work = Path(temp)/str(i); work.mkdir()
            rows.append(run_clip(clip, root, work, exe, model, detector, flow, cache["clips"][i] if cache else None))
    after = {name: sha256(HERE/name) for name in CODE}
    if before != after:
        raise ValueError("Output-affecting code changed during replay")
    result = {"schemaVersion": 1, "study": "M3K", "dataset": inputs["dataset"], "inputSha256": input_hash,
        "developmentOnly": development, "platform": platform.platform(), "opencv": cv2.__version__, "numpy": np.__version__,
        "device": args.device, "policies": policy_snapshot(),
        "lanes": {"A": "Old detector, frozen DIS cohort engine", "B": "Learned detector, same frozen DIS cohort engine",
                  "C": "Old detector, learned field substituted only", "D": "Learned detector, learned field substituted only",
                  "S": "Old full-box diagnostic, not fallback"},
        "detectorProvenance": {"kind": "development-historical-old-full-plus-fresh-learned" if cache else "actual-local-CoreML-and-PyTorch",
            "cacheSha256": sha256(cached_path) if cache else None,
            "oldSampleTimings": "historical, not current execution" if cache else "actual per-exposure model inference"},
        "learnedDetector": detector.provenance(), "learnedFlow": dict(flow.metadata),
        "modelStartupMs": {"detector": detector_startup, "flow": flow_startup},
        "sceneqaSha256": exe_hash, "yoloModelHashes": hashes, "codeSha256": after, "clips": rows,
        "timingScope": "Each independent complete engine already includes its flow execution. Product samples sum staging, shared pixel preparation, that lane's detector sample and engine wall before percentiles. A/C/S old CoreML samples measure VNImageRequestHandler.perform only, excluding request setup and result parsing: their product sums are lower-bound estimates, not symmetric full-detector wall. B/D include the complete learned adapter preprocess/inference/postprocess wall. Do not infer strict like-for-like latency superiority or add flow trace wall again. Model startup, old CoreML batch wall, learned aggregate wall and whole sequential study wall remain separate. Historical old-model samples in development are not current execution. No phone or real-time claim."}
    receipt_contract(result)
    return result


def score(receipt, truth, inputs=None):
    finite_payload(receipt); finite_payload(truth)
    if inputs is not None:
        bind_input(receipt, inputs)
        for clip, source in zip(receipt["clips"], inputs["clips"], strict=True):
            for frame, actual in zip(clip["frames"], source["frames"], strict=True):
                if frame.get("sourceSha256") != actual["sha256"]:
                    raise ValueError("Wrong original exposure fingerprint")
    if (receipt.get("schemaVersion") != 1 or receipt.get("study") != "M3K" or truth.get("schemaVersion") != 1
            or receipt["inputSha256"] != truth["inputSha256"]
            or [c["id"] for c in receipt["clips"]] != [c["id"] for c in truth["clips"]]
            or not receipt["clips"] or len({c["id"] for c in receipt["clips"]}) != len(receipt["clips"])):
        raise ValueError("Unbound or incompatible M3K scoring inputs")
    receipt_contract(receipt)
    contract = legacy_score()
    totals = {n: Counter(contract.empty()) for n in LANES}
    rows, all_frames = [], []
    for clip, ref in zip(receipt["clips"], truth["clips"], strict=True):
        frames = clip["frames"]; labels = {f["token"]: f for f in ref["frames"]}
        if (not frames or len(labels) != len(ref["frames"]) or len({f["token"] for f in frames}) != len(frames)
                or not labels.keys() <= {f["token"] for f in frames}):
            raise ValueError("Duplicate/missing exact frame labels")
        stats = {n: contract.empty() for n in LANES}
        statuses, reasons = ({n: Counter() for n in LANES} for _ in range(2))
        ceilings = {n: Counter() for n in ("old", "learned")}
        origin, previous = frames[0]["timestampUs"], None
        for i, frame in enumerate(frames):
            stamp, at = frame.get("timestampUs"), frame.get("timeMs")
            if (not set(LANES) <= frame.keys() or type(stamp) is not int or stamp < 0
                    or previous is not None and stamp <= previous or type(at) not in (int, float)
                    or abs(at-(stamp-origin)/1000.) > .000001 or type(frame.get("index")) is not int or frame["index"] != i
                    or not _digest(frame.get("sourceSha256"))):
                raise ValueError("Missing lane or invalid exact stream clock/source")
            previous = stamp; gap = frame.get("detectorGapInjected")
            if type(gap) is not bool or gap != (i in DROPPED.get(clip["id"], ())) or gap and (frame["detections"] or frame["candidateDetections"]):
                raise ValueError("Invalid deterministic detector gap record")
            detector_contract(frame, receipt["device"])
            if not receipt["developmentOnly"]:
                old = frame.get("oldObservation")
                if not isinstance(old, dict) or old.get("detectionMs") != frame["detectorObservationMs"]:
                    raise ValueError("Missing actual old detector observation")
                expected = [] if gap else [d.record(frame["width"], frame["height"]) for d in parse_detect(old, frame["width"], frame["height"])]
                if frame["detections"] != expected:
                    raise ValueError("Old detections differ from raw current observation")
            known = labels.get(frame["token"])
            if known and known["timestampUs"] != stamp:
                raise ValueError("Reference timestamp does not match exact exposure")
            targets = None if known is None else [{**target, "motion": {"approaching": "moving", "not-approaching": "stationary", "unknown": "unknown"}[target["approach"]]} for target in known["targets"]]
            for detector, key in (("old", "detections"), ("learned", "candidateDetections")):
                for target in targets or ():
                    label = target["approach"]; ceilings[detector][label] += 1
                    ceilings[detector][label+".withYolo"] += any(contract.family(d["label"]) == target["classFamily"] and contract.iou(d["box"], target["box"]) >= contract.IOU for d in frame[key])
            for name in LANES:
                lane_contract(frame[name], at, gap)
                if name != "S":
                    cohort_contract(frame[name], at)
                if name in LEARNED_FLOW_LANES:
                    flow_contract(frame, name)
                contract.score_frame(frame, name, targets, stats[name])
                statuses[name][frame[name]["status"]] += 1
                reasons[name].update(frame[name].get("diagnostics", {}).get("trackReasons", {}).values())
                if ref.get("allSceneNegative"):
                    stats[name]["allSceneFalseNotices"] = stats[name].get("allSceneFalseNotices", 0)+len(frame[name]["events"])
            all_frames.append(frame)
        for name in LANES:
            totals[name].update(stats[name])
        rows.append({"id": clip["id"], "lanes": stats, "statuses": statuses, "trackReasons": reasons,
                     "detectorCeiling": ceilings, "identityLifecycle": {n: lifecycle_summary(frames, n) for n in LANES if n != "S"}})
    return {"schemaVersion": 1, "study": "M3K", "dataset": receipt["dataset"], "inputSha256": receipt["inputSha256"],
        "developmentOnly": receipt["developmentOnly"], "review": truth.get("review"), "reviewSha256": truth.get("reviewSha256"),
        "unit": "reviewed target-keyframe", "frames": len(all_frames), "noMetreChecks": len(all_frames)*len(LANES),
        "platform": receipt["platform"], "opencv": receipt["opencv"], "device": receipt["device"],
        "codeSha256": receipt["codeSha256"], "detectorProvenance": receipt["detectorProvenance"],
        "learnedDetector": receipt["learnedDetector"], "learnedFlow": receipt["learnedFlow"],
        "modelStartupMs": receipt["modelStartupMs"], "sceneqaSha256": receipt["sceneqaSha256"], "yoloModelHashes": receipt["yoloModelHashes"],
        "totals": totals, "clips": rows, "stageMs": _timing_values(all_frames), "timingScope": receipt["timingScope"],
        "limits": "Frozen physical approach labels. Relative optical expansion only; unknown, unmatched and unreviewed notices remain separate. Independent lane IDs do not imply MOT accuracy. Development cache is not unseen evidence. No phone, metric range, real-time or safety acceptance."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    for mode, keys in (("replay", ("input", "sceneqa", "yolo", "learned-model-dir", "flow-weights", "output")),
                       ("score", ("input", "truth", "receipt", "output"))):
        sub = modes.add_parser(mode)
        for key in keys:
            sub.add_argument("--"+key, type=Path, required=True)
        if mode == "replay":
            sub.add_argument("--device", choices=("mps", "cpu"), required=True)
            sub.add_argument("--flow-sha256")
            sub.add_argument("--cached-detections", type=Path)
            sub.add_argument("--development-only", action="store_true")
    args = parser.parse_args()
    if args.mode == "replay":
        result = replay(args)
    else:
        receipt = read_json(args.receipt)
        inputs, _ = load_input(args.input)
        if receipt["inputSha256"] != sha256(args.input):
            raise ValueError("Receipt/input byte hash mismatch")
        result = score(receipt, read_json(args.truth, 2*1024**2), inputs)
        result.update(receiptSha256=sha256(args.receipt), truthSha256=sha256(args.truth))
        print(json.dumps(result["totals"], indent=2))
    write_new(args.output, result)
