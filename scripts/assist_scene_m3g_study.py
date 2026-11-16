#!/usr/bin/env python3
"""Mac-only same-detection M3E/cumulative/DIS/anchor study and box comparator.

Inference never opens labels. Cached model observations are accepted only for an
exact input, model artifact, runner artifact, source exposure and stream clock.
"""

import argparse
from collections import Counter
from datetime import date
import json
import math
from pathlib import Path
import platform
import tempfile
from time import perf_counter

import cv2

from assist_scene_motion import parse_detect, sha256
from assist_scene_motion_m3b import detect_samples
from assist_scene_motion_m3c import load_input
from assist_scene_m3e_study import CAPS, DROPPED, legacy_score, output, read_frame, write_new
from assist_scene_m3f_study import stage
from assist_scene_scale_approach_m3e import POLICY as A_POLICY, ScaleApproachM3E


HERE = Path(__file__).resolve().parent
LANES = ("A", "B", "C", "D", "E", "S")
CODE = ("assist_scene_m3g_study.py", "assist_scene_window_loom.py", "assist_scene_dense_window.py", "assist_scene_scale_approach_m3e.py",
        "assist_scene_scale_approach.py", "assist_scene_m3d_study.py", "assist_scene_m3e_study.py",
        "assist_scene_m3f_study.py", "assist_scene_motion_m3b.py", "assist_scene_motion_m3c.py",
        "assist_scene_pose_motion.py", "assist_scene_motion.py", "score-assist-scene-motion-m3c.py")
DETECTOR_CONFIGURATION = {"modelId": "apple-yolov3-fp16", "confidenceThreshold": .38,
                          "iouThreshold": .45, "cropAndScale": "scaleFill", "computeUnits": "all",
                          "coordinates": "EXIF-upright normalized top-left",
                          "detectionTiming": "VNImageRequestHandler.perform only"}
FORBIDDEN_METRIC_KEYS = {"metres", "meters", "ttc", "distance", "timeToCollision"}


def finite_payload(value):
    """JSON accepts NaN by default; evidence artifacts must never do so."""
    if isinstance(value, dict):
        for item in value.values():
            finite_payload(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            finite_payload(item)
    elif type(value) is float and not math.isfinite(value):
        raise ValueError("Nonfinite evidence payload")


def no_metric_claims(value):
    if isinstance(value, dict):
        if FORBIDDEN_METRIC_KEYS & value.keys():
            raise ValueError("Optical tracks/events must not contain metric or TTC claims")
        for item in value.values():
            no_metric_claims(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            no_metric_claims(item)


def lane_contract(surface, at, gap=False):
    if (not isinstance(surface, dict)
            or not {"status", "tracks", "events", "epoch", "answers"} <= surface.keys()
            or not isinstance(surface["tracks"], list) or not isinstance(surface["events"], list)):
        raise ValueError("Missing or malformed lane surface")
    finite_payload(surface)
    no_metric_claims(surface["tracks"])
    no_metric_claims(surface["events"])
    if gap and surface["events"]:
        raise ValueError("Detector gaps cannot produce approach notices")
    checked = output(surface, at)
    if surface.get("answers") != checked["answers"]:
        raise ValueError("Optical answer contract must contain only the explicit null distance")


def bind_input(receipt, inputs):
    """CLI scoring checks all runtime frames, not only sparse reviewed labels."""
    if (receipt["dataset"] != inputs["dataset"]
            or [c["id"] for c in receipt["clips"]] != [c["id"] for c in inputs["clips"]]):
        raise ValueError("Receipt/source clip mismatch")
    for clip, source in zip(receipt["clips"], inputs["clips"], strict=True):
        if len(clip["frames"]) != len(source["frames"]):
            raise ValueError("Receipt/source full frame-set mismatch")
        for frame, actual in zip(clip["frames"], source["frames"], strict=True):
            if frame["token"] != actual["token"] or frame["timestampUs"] != actual["timestampUs"]:
                raise ValueError("Receipt/source exact stream mismatch")


def model_hashes(path):
    if not path.is_dir() or path.suffix != ".mlmodelc":
        raise ValueError("Expected an existing compiled model")
    files = [p for p in sorted(path.rglob("*")) if p.is_file()]
    if not files or len(files) > 100:
        raise ValueError("Missing or unbounded model artifact")
    return {str(p.relative_to(path)): sha256(p) for p in files}


def load_cache(path, inputs, input_hash, exe_hash, hashes):
    if not path.is_file() or path.stat().st_size > 24 * 1024**2:
        raise ValueError("Missing or excessive detection cache")
    cache = json.loads(path.read_text())
    finite_payload(cache)
    if (cache.get("schemaVersion") != 1 or cache.get("dataset") != inputs["dataset"]
            or cache.get("inputSha256") != input_hash or cache.get("sceneqaSha256") != exe_hash
            or cache.get("yoloModelHashes") != hashes
            or cache.get("opencv") != cv2.__version__
            or [c["id"] for c in cache.get("clips", [])] != [c["id"] for c in inputs["clips"]]):
        raise ValueError("Cached detections are not bound to this input and actual model")
    for name in ("assist_scene_m3f_study.py", "assist_scene_m3e_study.py"):
        if cache.get("codeSha256", {}).get(name) != sha256(HERE/name):
            raise ValueError("Cached image staging code no longer matches this replay")
    config = None
    for source, recorded in zip(inputs["clips"], cache["clips"], strict=True):
        if config is None:
            config = recorded.get("detectorConfiguration")
        if config != DETECTOR_CONFIGURATION or recorded.get("detectorConfiguration") != config:
            raise ValueError("Cached detector configuration changed")
        frames = recorded.get("frames", [])
        if len(frames) != len(source["frames"]):
            raise ValueError("Wrong cached frame set")
        origin = source["frames"][0]["timestampUs"]
        for index, (frame, old) in enumerate(zip(source["frames"], frames, strict=True)):
            if (old.get("token") != frame["token"] or old.get("timestampUs") != frame["timestampUs"]
                    or type(old.get("timeMs")) not in (int, float)
                    or not math.isfinite(old["timeMs"])
                    or abs(old["timeMs"] - (frame["timestampUs"]-origin)/1000.) > .000001
                    or old.get("index") != index):
                raise ValueError("Cached token, order or exact exposure clock mismatch")
            if (type(old.get("detectorGapInjected")) is not bool
                    or old["detectorGapInjected"] != (index in DROPPED.get(source["id"], ()))
                    or "candidateDetections" not in old):
                # Only M3F receipts explicitly serialize full-input detections
                # after controlled gaps, separately from ROI candidates.
                raise ValueError("Cache must contain explicit original detections, not ROI/tracker output")
            if old["detectorGapInjected"] and old.get("detections") != []:
                raise ValueError("Cached injected gap contains detections")
            if (type(old.get("timingsMs", {}).get("detector")) not in (int, float)
                    or not math.isfinite(old["timingsMs"]["detector"]) or old["timingsMs"]["detector"] < 0):
                raise ValueError("Invalid historical model timing")
    return cache


def cached_observation(old, width, height, native_width, native_height):
    if ((old.get("width"), old.get("height"), old.get("nativeWidth"), old.get("nativeHeight"))
            != (width, height, native_width, native_height)):
        raise ValueError("Cached detections use different image geometry")
    # parse_detect applies the same label/confidence/geometry contracts to cache
    # records as to actual Core ML output; no tracker boxes are recycled.
    row = {"width": width, "height": height, "orientation": 1, "tracks": old.get("detections")}
    boxes = parse_detect(row, width, height)
    return boxes, old["timingsMs"]["detector"]


def run_clip(clip, root, work, exe, model, cached=None):
    from assist_scene_m3d_study import BoxBaseline
    from assist_scene_window_loom import CumulativeWindowLoom, AnchorWindowLoom
    from assist_scene_dense_window import DenseWindowLoom

    frames, samples, shapes = stage(clip, root, work)
    found, configs = {}, []
    wall_ms = 0.
    if cached is None:
        for i in range(0, len(samples), 50):
            tick = perf_counter()
            config, batch = detect_samples(samples[i:i+50], exe, model)
            wall_ms += (perf_counter()-tick)*1000.
            configs.append(config)
            found.update(batch)
        if any(config != configs[0] for config in configs):
            raise ValueError("Shared detector configuration changed")
        config = configs[0]
        if config != DETECTOR_CONFIGURATION:
            raise ValueError("Unexpected model or detector configuration")
    else:
        config = cached["detectorConfiguration"]
    lanes = {"A": ScaleApproachM3E(), "B": CumulativeWindowLoom(),
             "C": CumulativeWindowLoom(native_detail=False), "D": DenseWindowLoom(),
             "E": AnchorWindowLoom(), "S": BoxBaseline()}
    if tuple(lanes) != LANES:
        raise ValueError("Configured experiment lanes changed")
    rows = []
    for i, f in enumerate(frames):
        tick = perf_counter()
        h, w, oh, ow = shapes[i]
        gray = read_frame(samples[i][2], cv2.IMREAD_GRAYSCALE)
        native = read_frame(root/f["path"], cv2.IMREAD_COLOR)
        if gray.shape != (h, w) or native.shape[:2] != (oh, ow):
            raise ValueError("Source/working geometry mismatch")
        native_gray = cv2.cvtColor(native, cv2.COLOR_BGR2GRAY)
        at = samples[i][1]
        gap = i in DROPPED.get(clip["id"], ())
        if cached is None:
            found_at, obs = found[i]
            if found_at != at:
                raise ValueError("Detector stream clock mismatch")
            boxes = [] if gap else parse_detect(obs, w, h)
            detector_ms = obs["detectionMs"]
        else:
            boxes, detector_ms = cached_observation(cached["frames"][i], w, h, ow, oh)
        row = {"token": f["token"], "timestampUs": f["timestampUs"], "timeMs": at, "index": i,
               "width": w, "height": h, "nativeWidth": ow, "nativeHeight": oh,
               "detectorGapInjected": gap, "detections": [b.record(w, h) for b in boxes],
               "timingsMs": {"sharedPrep": (perf_counter()-tick)*1000.},
               "detectorObservationMs": detector_ms}
        for name, state in lanes.items():
            cv2.setRNGSeed(650500+i)
            tick = perf_counter()
            options = {"native_gray": native_gray} if name in {"A", "B", "D", "E"} else {}
            row[name] = output(state.update(f, at, gray, boxes, **options), at)
            lane_contract(row[name], at, gap)
            row["timingsMs"][name] = (perf_counter()-tick)*1000.
        rows.append(row)
    return {"id": clip["id"], "detectorConfiguration": config,
            "detectorExecution": "cached-historical-real-model" if cached else "actual-local-CoreML",
            "detectorCalls": 0 if cached else len(samples),
            "detectorBatchWallMs": None if cached else wall_ms, "frames": rows}


def replay(args):
    from assist_scene_window_loom import POLICY as B_POLICY
    from assist_scene_dense_window import POLICY as D_POLICY

    inputs, root = load_input(args.input)
    if inputs["dataset"] not in {"Boreas-real", "synthetic-m3c"}:
        raise ValueError("Unknown M3G source")
    if sum(len(c["frames"]) for c in inputs["clips"]) > CAPS["maxFramesTotal"]:
        raise ValueError("Frame budget exceeded")
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("Use a new receipt path")
    exe, model = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    input_hash, exe_hash, hashes = sha256(args.input), sha256(exe), model_hashes(model)
    cache_path = getattr(args, "cached_detections", None)
    cache = load_cache(cache_path, inputs, input_hash, exe_hash, hashes) if cache_path else None
    cv2.setNumThreads(1)
    rows = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3g-{date.today():%Y%m%d}-", dir=args.output.parent) as temp:
        for index, clip in enumerate(inputs["clips"]):
            print(f"Replay {clip['id']} ({len(clip['frames'])} frames; {'cached' if cache else 'actual'} detector)", flush=True)
            work = Path(temp)/str(index)
            work.mkdir()
            rows.append(run_clip(clip, root, work, exe, model, cache["clips"][index] if cache else None))
    return {"schemaVersion": 1, "dataset": inputs["dataset"], "inputSha256": input_hash,
            "platform": platform.platform(), "opencv": cv2.__version__,
            "policies": {"A": dict(A_POLICY), "D": dict(D_POLICY),
                         **{n: dict(B_POLICY) for n in ("B", "C", "E")}},
            "lanes": {"A": "M3E original incumbent", "B": "R1 cumulative window native detail",
                      "C": "R1 cumulative window no-native ablation", "D": "DIS dense window native detail",
                      "E": "R2 LK anchor window native detail", "S": "Box-only diagnostic; not an app fallback"},
            "detectorProvenance": {"kind": "cached-historical-real-model" if cache else "actual-local-CoreML",
                                   "cacheSha256": sha256(cache_path) if cache else None,
                                   "sampleTimings": "historical, not current execution" if cache else "actual sample inference; not end-to-end"},
            "sceneqaSha256": exe_hash, "yoloModelHashes": hashes,
            "codeSha256": {name: sha256(HERE/name) for name in CODE}, "clips": rows}


def _percentiles(values):
    if not values or any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in values):
        raise ValueError("Missing or invalid timing")
    values = sorted(values)
    return {f"p{p}": round(values[math.ceil(len(values)*p/100)-1], 2) for p in (50, 95)}


def score(receipt, truth, inputs=None):
    finite_payload(receipt)
    finite_payload(truth)
    if inputs is not None:
        bind_input(receipt, inputs)
    if (receipt.get("schemaVersion") != 1 or truth.get("schemaVersion") != 1
            or receipt["inputSha256"] != truth["inputSha256"]
            or [c["id"] for c in receipt["clips"]] != [c["id"] for c in truth["clips"]]):
        raise ValueError("Unbound or incompatible scoring inputs")
    if len({c["id"] for c in receipt["clips"]}) != len(receipt["clips"]):
        raise ValueError("Duplicate clip IDs")
    contract = legacy_score()
    totals = {name: Counter(contract.empty()) for name in LANES}
    rows, frames = [], []
    for clip, ref in zip(receipt["clips"], truth["clips"], strict=True):
        labels = {f["token"]: f for f in ref["frames"]}
        predicted = clip["frames"]
        if (not predicted or len(labels) != len(ref["frames"]) or len({f["token"] for f in predicted}) != len(predicted)
                or not labels.keys() <= {f["token"] for f in predicted}):
            raise ValueError("Duplicate or missing exact frame labels")
        stats = {name: contract.empty() for name in LANES}
        statuses = {name: Counter() for name in LANES}
        reasons = {name: Counter() for name in LANES}
        ceiling = Counter()
        origin, previous = predicted[0]["timestampUs"], None
        for index, f in enumerate(predicted):
            if not set(LANES) <= f.keys():
                raise ValueError("Missing experiment lane")
            stamp, at = f.get("timestampUs"), f.get("timeMs")
            if (type(stamp) is not int or stamp < 0 or (previous is not None and stamp <= previous)
                    or type(at) not in (int, float) or not math.isfinite(at)
                    or abs(at-(stamp-origin)/1000.) > .000001
                    or ("index" in f and (type(f["index"]) is not int or f["index"] != index))):
                raise ValueError("Invalid, nonincreasing or unbound stream clock")
            previous = stamp
            gap = f.get("detectorGapInjected", False)
            if type(gap) is not bool or (gap and f["detections"]):
                raise ValueError("Invalid detector gap evidence")
            known = labels.get(f["token"])
            if known and known["timestampUs"] != f["timestampUs"]:
                raise ValueError("Wrong exact reviewed timestamp")
            targets = None if known is None else [{**t, "motion": {"approaching": "moving", "not-approaching": "stationary", "unknown": "unknown"}[t["approach"]]} for t in known["targets"]]
            for target in targets or ():
                key = target["approach"]
                ceiling[key] += 1
                ceiling[key+".withYolo"] += any(contract.family(d["label"]) == target["classFamily"]
                                               and contract.iou(d["box"], target["box"]) >= contract.IOU for d in f["detections"])
            for name in LANES:
                lane_contract(f[name], at, gap)
                contract.score_frame(f, name, targets, stats[name])
                statuses[name][f[name]["status"]] += 1
                reasons[name].update(f[name].get("diagnostics", {}).get("trackReasons", {}).values())
                if ref.get("allSceneNegative"):
                    stats[name]["allSceneFalseNotices"] = stats[name].get("allSceneFalseNotices", 0) + len(f[name]["events"])
            frames.append(f)
        for name in LANES:
            totals[name].update(stats[name])
        rows.append({"id": clip["id"], "lanes": stats, "statuses": statuses,
                     "trackReasons": reasons, "detectorCeiling": ceiling})
    timing = {name: _percentiles([f["timingsMs"][name] for f in frames]) for name in ("sharedPrep", *LANES)}
    for name in LANES:
        timing[name+"PlusSharedPrep"] = _percentiles([f["timingsMs"][name]+f["timingsMs"]["sharedPrep"] for f in frames])
    observation_timing = _percentiles([f["detectorObservationMs"] for f in frames])
    return {"schemaVersion": 1, "dataset": receipt["dataset"], "inputSha256": receipt["inputSha256"],
            "review": truth.get("review"), "reviewSha256": truth.get("reviewSha256"),
            "unit": "reviewed target-keyframe", "frames": len(frames), "noMetreChecks": len(frames)*len(LANES),
            "platform": receipt["platform"], "opencv": receipt["opencv"], "codeSha256": receipt["codeSha256"],
            "detectorProvenance": receipt["detectorProvenance"],
            "detectorConfiguration": receipt["clips"][0]["detectorConfiguration"],
            "detectorObservationTimingMs": observation_timing,
            "totals": totals, "clips": rows, "stageMs": timing,
            "limits": "Physical relative-range labels are kept unchanged; optical looming is not a proof of radial closing. Unknown/unmatched/unreviewed reports stay separate. Checkpoints do not prove event-level recall, phone speed or safety."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    for mode, keys in (("replay", ("input", "sceneqa", "yolo", "output")), ("score", ("input", "truth", "receipt", "output"))):
        sub = modes.add_parser(mode)
        for key in keys:
            sub.add_argument("--"+key, type=Path, required=True)
        if mode == "replay":
            sub.add_argument("--cached-detections", type=Path)
    args = parser.parse_args()
    if args.mode == "replay":
        result = replay(args)
    else:
        rec = json.loads(args.receipt.read_text())
        if rec["inputSha256"] != sha256(args.input):
            raise ValueError("Input/receipt mismatch")
        inputs, _ = load_input(args.input)
        result = score(rec, json.loads(args.truth.read_text()), inputs)
        result.update(receiptSha256=sha256(args.receipt), truthSha256=sha256(args.truth))
        print(json.dumps(result["totals"], indent=2))
    write_new(args.output, result)
