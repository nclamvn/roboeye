#!/usr/bin/env python3
"""M3O detector-only reviewed-still experiment and source-bound diagnostics.

Pipeline exports are not uncensored detector proposals. Runtime selection reads
reviewed frame keys only; target labels/boxes enter only the separate scorer.
No motion events, threshold tuning, model downloads or implicit GPU execution.
"""

import argparse
import gc
from collections import Counter
from functools import lru_cache
from hashlib import sha256 as hash_bytes
import json
import math
from pathlib import Path
import platform
import shutil
import tempfile
from datetime import date
from time import perf_counter

import cv2
import numpy as np

from assist_scene_motion import parse_detect, sha256
from assist_scene_motion_m3c import load_input
from assist_scene_m3e_study import legacy_score, read_frame
from assist_scene_m3f_study import stage
from assist_scene_m3g_study import DETECTOR_CONFIGURATION, bind_input, finite_payload, model_hashes


HERE = Path(__file__).resolve().parent
MAX_CHECKPOINTS = 20
IOU_CURVE = (.35, .50, .75)
WARNING_IOU, WARNING_MARGIN = .35, .08
CODE = ("assist_scene_m3o_detection.py", "assist_scene_learned_detector.py", "assist_scene_motion.py",
        "assist_scene_motion_m3b.py", "assist_scene_motion_m3c.py", "assist_scene_m3e_study.py",
        "assist_scene_m3f_study.py", "assist_scene_m3g_study.py", "assist_scene_m3k_study.py",
        "score-assist-scene-motion-m3c.py")
EXPORT_SCOPE = {
    "yolov3": "Vision recognized observations filtered at .38, then fresh ObjectTracker pipeline export, max12; not uncensored proposals",
    "rtdetr": "upstream global top300 query/class rows, then fixed .38/same-class .65 dedup/max12; not all logits/proposals",
}


def require(condition, message):
    if not condition: raise ValueError(message)


def same_payload(first, second):
    if type(first) in (float, int) and type(second) in (float, int): return math.isclose(first, second, rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(first, dict) and isinstance(second, dict): return first.keys() == second.keys() and all(same_payload(first[k], second[k]) for k in first)
    if isinstance(first, list) and isinstance(second, list): return len(first) == len(second) and all(same_payload(a, b) for a, b in zip(first, second, strict=True))
    return type(first) is type(second) and first == second


def read_json(path, limit=256*1024**2):
    require(path.is_file() and path.stat().st_size <= limit, "Missing or over-budget JSON")
    value = json.loads(path.read_text()); finite_payload(value)
    require(isinstance(value, dict), "Expected JSON mapping")
    return value


def normalize_detection(row):
    require(isinstance(row, dict) and isinstance(row.get("label"), str), "Missing detector label")
    bounds = row.get("box")
    require(isinstance(bounds, dict), "Missing detector bounds")
    values = [bounds.get(k) for k in ("x", "y", "width", "height")]
    require(all(type(value) in (float, int) and math.isfinite(value) and 0 <= value <= 1 for value in values), "Nonfinite or nonnormalized detector bounds")
    x, y, width, height = values
    require(width > 0 and height > 0 and x+width <= 1+1e-9 and y+height <= 1+1e-9, "Empty or out-of-bounds detector rectangle")
    confidence = row.get("score")
    require(confidence is None or type(confidence) in (int, float) and math.isfinite(confidence) and 0 <= confidence <= 1,
            "Invalid detector confidence")
    return {"label": row["label"], "score": confidence, "scoreState": "unknown" if confidence is None else "observed",
            "box": {k: bounds[k] for k in ("x", "y", "width", "height")}}


def checkpoint_keys(inputs, truth, input_hash):
    """Return frame metadata only. Targets never flow into model inputs."""
    require(truth.get("schemaVersion") == 1 and truth.get("inputSha256") == input_hash
            and [c["id"] for c in truth["clips"]] == [c["id"] for c in inputs["clips"]], "Reviewed selection belongs to another input")
    selected = []
    for source, reviewed in zip(inputs["clips"], truth["clips"], strict=True):
        by_token = {f["token"]: (index, f) for index, f in enumerate(source["frames"])}
        seen = set()
        for key in reviewed["frames"]:
            token = key["token"]
            require(token not in seen and token in by_token, "Duplicate or absent reviewed checkpoint")
            seen.add(token); index, frame = by_token[token]
            require(frame["timestampUs"] == key["timestampUs"], "Reviewed checkpoint source clock differs")
            selected.append({**frame, "clipId": source["id"], "index": index})
    require(1 <= len(selected) <= MAX_CHECKPOINTS, "Reviewed checkpoint call budget exceeded")
    return selected


def one_to_one(detections, targets, threshold):
    """Maximum cardinality, then total IoU; deterministic ties. Not COCO AP."""
    scorer = legacy_score()
    edges = [[(i, scorer.iou(d["box"], target["box"])) for i, d in enumerate(detections)
              if scorer.family(d["label"]) == target["classFamily"]
              and scorer.iou(d["box"], target["box"]) >= threshold] for target in targets]
    @lru_cache(None)
    def visit(index, used):
        if index == len(targets): return (0, 0., ())
        best = visit(index+1, used)
        for detection, overlap in edges[index]:
            if used & (1 << detection): continue
            count, total, pairs = visit(index+1, used | (1 << detection))
            candidate = (count+1, total+overlap, ((index, detection),)+pairs)
            if candidate[:2] > best[:2] or candidate[:2] == best[:2] and candidate[2] < best[2]: best = candidate
        return best
    return list(visit(0, 0)[2])


def warning_matches(detections, targets):
    """Unchanged warning scorer IoU/margin/duplicate policy, without events."""
    scorer = legacy_score(); edges = {}; rejected = Counter()
    for index, detection in enumerate(detections):
        ranked = sorted(((scorer.iou(detection["box"], g["box"]), i) for i, g in enumerate(targets)
                         if scorer.family(detection["label"]) == g["classFamily"]), reverse=True)
        if not ranked or ranked[0][0] < WARNING_IOU: rejected["unmatchedDetections"] += 1
        elif len(ranked) > 1 and ranked[0][0]-ranked[1][0] < WARNING_MARGIN: rejected["ambiguousDetections"] += 1
        else: edges.setdefault(ranked[0][1], []).append(index)
    hits = {target: indices[0] for target, indices in edges.items() if len(indices) == 1}
    rejected["duplicateAssignments"] = sum(len(indices) for indices in edges.values() if len(indices) > 1)
    return hits, dict(rejected)


def frame_diagnostics(detections, targets, *, exhaustive=False):
    scorer = legacy_score(); detections = [normalize_detection(d) for d in detections]
    require(len(detections) <= 12 and len({t["instance"] for t in targets}) == len(targets), "Invalid detector or target identity budget")
    for target in targets:
        require(target.get("classFamily") in {"vehicle", "person"} and target.get("approach") in {"approaching", "not-approaching", "unknown"}, "Invalid reviewed target scope")
        normalize_detection({"label": target["classFamily"], "box": target["box"]})
    hits, rejected = warning_matches(detections, targets); curve = {}
    for threshold in IOU_CURVE:
        pairs = one_to_one(detections, targets, threshold); matched_detections = {d for _, d in pairs}
        unmatched = [i for i, d in enumerate(detections) if i not in matched_detections and scorer.family(d["label"]) in {"vehicle", "person"}]
        curve[f"{threshold:.2f}"] = {"matchedTargets": len(pairs), "missedTargets": len(targets)-len(pairs),
            "approachingMatchedTargets": sum(targets[t].get("approach") == "approaching" for t, _ in pairs),
            "approachingMissedTargets": sum(t.get("approach") == "approaching" for t in targets)
                -sum(targets[t].get("approach") == "approaching" for t, _ in pairs),
            "pairs": [{"targetIndex": t, "detectionIndex": d, "iou": scorer.iou(targets[t]["box"], detections[d]["box"])} for t, d in pairs],
            "falsePositiveDetections": len(unmatched) if exhaustive else None,
            "unreviewedDetections": 0 if exhaustive else len(unmatched),
            "outOfScopeDetections": sum(scorer.family(d["label"]) is None for d in detections)}
    rows = []
    for target_index, target in enumerate(targets):
        ranked = sorted(((scorer.iou(d["box"], target["box"]), i) for i, d in enumerate(detections)
                         if scorer.family(d["label"]) == target["classFamily"]), key=lambda item: (-item[0], item[1]))
        any_class = sorted(((scorer.iou(d["box"], target["box"]), i) for i, d in enumerate(detections)), key=lambda item: (-item[0], item[1]))
        def record(best):
            if best is None: return None
            overlap, index = best
            return {"detectionIndex": index, "iou": overlap, **detections[index]}
        best = ranked[0] if ranked else None
        status = ("qualified" if target_index in hits else "no-same-family-export" if best is None else
                  "below-frozen-IoU" if best[0] < WARNING_IOU else "ambiguous-or-duplicate-assignment")
        rows.append({"targetIndex": target_index, "instance": target["instance"], "classFamily": target["classFamily"],
            "approach": target.get("approach"), "targetBox": target["box"], "bestFamily": record(best),
            "bestAnyClass": record(any_class[0] if any_class else None), "warningCriterionStatus": status,
            "qualifiedDetectionIndex": hits.get(target_index)})
    return {"targets": rows, "diagnosticIoUCurve": curve, "warningAssignment": rejected,
        "detectionAnnotationExhaustive": exhaustive, "detectorExportCount": len(detections)}


def _frames(receipt):
    if receipt.get("study") == "M3O-detection": return receipt["frames"]
    return [{"clipId": clip["id"], **frame} for clip in receipt["clips"] for frame in clip["frames"]]


def validate_exports(receipt):
    """Raw output reproduction where available; never invent absent raw data."""
    for frame in _frames(receipt):
        h, w = frame["height"], frame["width"]
        providers = frame.get("providers", {"yolov3": {"detections": frame.get("detections", []), "observation": frame.get("oldObservation")}})
        for name, provider in providers.items():
            if receipt.get("study") == "M3O-detection":
                require(provider.get("observationBinding") == {k: frame[k] for k in ("token", "timestampUs", "sourceSha256", "workingJpegSha256")},
                    "Detector observation source binding changed")
            for detection in provider["detections"]: normalize_detection(detection)
            raw = provider.get("observation")
            if raw is None: continue
            if name == "yolov3":
                require(same_payload(provider["detections"], [d.record(w, h) for d in parse_detect(raw, w, h)]), "YOLO pipeline export differs from recorded observations")
            elif name == "rtdetr":
                from assist_scene_learned_detector import ID2LABEL, parse_predictions
                require(raw.get("id2label") == ID2LABEL and raw.get("workingShape") == [h, w]
                    and raw.get("nativeShape") == [frame["nativeHeight"], frame["nativeWidth"]], "Learned output label/geometry changed")
                boxes, counts = parse_predictions(raw["prediction"], ID2LABEL, (frame["nativeHeight"], frame["nativeWidth"]), (h, w))
                require(same_payload(provider["detections"], [d.record(w, h) for d in boxes])
                    and all(raw.get(k) == v for k, v in counts.items()), "Learned export does not reproduce raw top300 rows")


def receipt_contract(receipt):
    from assist_scene_learned_detector import ARTIFACTS, MODEL_ID, REVISION, POLICY
    require(receipt.get("schemaVersion") == 1 and receipt.get("study") == "M3O-detection"
        and 1 <= len(receipt["frames"]) <= MAX_CHECKPOINTS
        and receipt.get("actualDetectorCalls") == {"yolov3": len(receipt["frames"]), "rtdetr": len(receipt["frames"])}
        and receipt.get("codeSha256") == {name: sha256(HERE/name) for name in CODE}, "Wrong detector execution/code scope")
    require(receipt.get("artifactBindingsBefore") == receipt.get("artifactBindingsAfter")
        and isinstance(receipt.get("artifactBindingsBefore"), dict)
        and receipt["artifactBindingsBefore"].get("inputSha256") == receipt["inputSha256"], "Artifact integrity snapshots differ")
    provenance = receipt.get("providerProvenance", {}); old = provenance.get("yolov3", {}); new = provenance.get("rtdetr", {})
    require(old.get("configuration") == DETECTOR_CONFIGURATION and old.get("sceneqaSha256")
        and old.get("modelHashes") and new.get("modelId") == MODEL_ID and new.get("revision") == REVISION
        and new.get("artifactSha256") == {name: value[1] for name, value in ARTIFACTS.items()}
        and new.get("policy") == POLICY and new.get("cpuFallback") is False
        and new.get("device") in {"mps", "cpu"}, "Wrong frozen detector provenance")
    validate_exports(receipt)


def score(receipt, truth, inputs=None):
    finite_payload(receipt); finite_payload(truth)
    validate_exports(receipt)
    require(receipt.get("inputSha256") == truth.get("inputSha256"), "Receipt/truth input hash mismatch")
    frames = _frames(receipt); found = {(f["clipId"], f["token"]): f for f in frames}
    require(len(found) == len(frames), "Duplicate detector source exposures")
    reviewed_keys = [(c["id"], key["token"]) for c in truth["clips"] for key in c["frames"]]
    require(len(set(reviewed_keys)) == len(reviewed_keys) and len({c["id"] for c in truth["clips"]}) == len(truth["clips"]), "Duplicated reviewed checkpoints")
    if receipt.get("study") == "M3O-detection": require(set(found) == set(reviewed_keys), "Standalone detector receipt differs from full reviewed checkpoint set")
    if inputs is not None:
        actual = {(c["id"], f["token"]): f for c in inputs["clips"] for f in c["frames"]}
        require(all(key in actual and found[key]["timestampUs"] == actual[key]["timestampUs"]
            and found[key]["sourceSha256"] == actual[key]["sha256"] for key in found), "Detector source clock/fingerprint changed")
    rows = []; totals = {}
    for clip in truth["clips"]:
        for key in clip["frames"]:
            frame = found.get((clip["id"], key["token"]))
            require(frame is not None and frame["timestampUs"] == key["timestampUs"], "Missing reviewed exact detector exposure")
            providers = frame.get("providers", {"yolov3": {"detections": frame.get("detections", [])}})
            for name, provider in providers.items():
                result = frame_diagnostics(provider["detections"], key["targets"], exhaustive=key.get("detectionAnnotationExhaustive") is True)
                rows.append({"clipId": clip["id"], "index": frame["index"], "token": frame["token"], "timestampUs": frame["timestampUs"],
                    "sourceSha256": frame["sourceSha256"], "provider": name, "cameraStatus": frame.get("T", {}).get("status"), **result})
                bucket = totals.setdefault(name, {"reviewedFrames": 0, "targets": 0, "approachingTargets": 0,
                    "approachingQualified": 0, "diagnosticIoUCurve": {f"{t:.2f}": Counter() for t in IOU_CURVE}})
                bucket["reviewedFrames"] += 1; bucket["targets"] += len(key["targets"])
                bucket["approachingTargets"] += sum(t.get("approach") == "approaching" for t in key["targets"])
                bucket["approachingQualified"] += sum(t["approach"] == "approaching" and t["warningCriterionStatus"] == "qualified" for t in result["targets"])
                for threshold, values in result["diagnosticIoUCurve"].items():
                    bucket["diagnosticIoUCurve"][threshold].update({k: v for k, v in values.items() if type(v) is int})
                    bucket["diagnosticIoUCurve"][threshold]["nonExhaustiveFrames"] += not result["detectionAnnotationExhaustive"]
    for bucket in totals.values():
        bucket["precisionState"] = "UNMEASURED-SPARSE-GT" if any(c["nonExhaustiveFrames"] for c in bucket["diagnosticIoUCurve"].values()) else "ASSESSED-EVALUATED-FAMILIES"
        for curve in bucket["diagnosticIoUCurve"].values():
            if curve["nonExhaustiveFrames"]: curve["falsePositiveDetections"] = None
            else: curve.setdefault("falsePositiveDetections", 0)
    return {"schemaVersion": 1, "study": "M3O-detector-diagnostics", "inputSha256": receipt["inputSha256"],
        "unit": "reviewed target-keyframe, not independent physical instances or COCO AP", "warningIoU": WARNING_IOU,
        "warningMargin": WARNING_MARGIN, "totals": totals, "frames": rows,
        "exportScope": EXPORT_SCOPE, "limits": "IoU curve is diagnostic only; warning gates unchanged. Sparse annotations do not establish detection precision: unreviewed detections are not false positives. Missing confidence is unknown, not zero. No motion inference, range, new threshold, phone or safety acceptance."}


def artifact_snapshot(args, selected, root):
    from assist_scene_learned_detector import verify_artifacts
    _, learned = verify_artifacts(args.rtdetr_model_dir)
    sources = {f"{source['clipId']}:{source['token']}": sha256(root/source["path"]) for source in selected}
    require(all(sources[f"{s['clipId']}:{s['token']}"] == s["sha256"] for s in selected), "Original checkpoint bytes changed")
    return {"inputSha256": sha256(args.input), "reviewSelectionSha256": sha256(args.reviewed_frames),
        "sceneqaSha256": sha256(args.sceneqa), "yoloModelHashes": model_hashes(args.yolo),
        "rtdetrArtifactSha256": learned, "sourceSha256": sources}


def replay(args, telemetry=None):
    from assist_scene_learned_detector import LearnedDetector
    from assist_scene_motion_m3b import detect_samples
    from assist_scene_m3k_study import _read_native
    telemetry = telemetry if telemetry is not None else {}
    telemetry.update(phase="input-validation", completeStudy=False,
        completedDetectorCalls={"yolov3": 0, "rtdetr": 0}, unresolvedCallsUpperBound={"yolov3": 0, "rtdetr": 0})
    inputs, root = load_input(args.input); input_hash = sha256(args.input)
    selected = checkpoint_keys(inputs, read_json(args.reviewed_frames, 2*1024**2), input_hash)
    require(not args.output.exists() and not args.output.is_symlink(), "Choose a new detector receipt")
    require(shutil.disk_usage(args.output.parent).free >= 10*1024**3, "Less than 10 GB free")
    exe, yolo = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    before = {name: sha256(HERE/name) for name in CODE}; artifacts_before = artifact_snapshot(args, selected, root); started = perf_counter()
    telemetry["phase"] = "learned-model-startup"
    detector = LearnedDetector(args.rtdetr_model_dir, device=args.device)
    learned_provenance = detector.provenance()
    learned_torch = detector.torch
    rows, samples = [], []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-m3o-detector-{date.today():%Y%m%d}-", dir=args.output.parent) as temp:
        for index, source in enumerate(selected):
            telemetry.update(phase="staging-checkpoint", checkpoint={"clipId": source["clipId"], "index": source["index"], "token": source["token"]})
            folder = Path(temp)/str(index); folder.mkdir()
            native = _read_native(root/source["path"], source["sha256"])
            _, items, shapes = stage({"frames": [source]}, root, folder)
            h, w, nh, nw = shapes[0]
            resized = native if (h, w) == (nh, nw) else cv2.resize(native, (w, h), interpolation=cv2.INTER_AREA)
            ok, encoded = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 93])
            require(ok and hash_bytes(encoded.tobytes()).hexdigest() == sha256(items[0][2]), "Staged JPEG differs from exact verified native bytes")
            telemetry["phase"] = "learned-adapter-attempt"; telemetry["unresolvedCallsUpperBound"]["rtdetr"] = 1
            boxes, report = detector.detect(native, working_shape=(h, w))
            telemetry["completedDetectorCalls"]["rtdetr"] += 1; telemetry["unresolvedCallsUpperBound"]["rtdetr"] = 0
            rows.append({"clipId": source["clipId"], "index": source["index"], "token": source["token"], "timestampUs": source["timestampUs"],
                "sourceSha256": source["sha256"], "width": w, "height": h, "nativeWidth": nw, "nativeHeight": nh,
                "workingJpegSha256": sha256(items[0][2]), "providers": {"rtdetr": {"detections": [b.record(w, h) for b in boxes], "observation": report}}})
            rows[-1]["providers"]["rtdetr"]["observationBinding"] = {k: rows[-1][k] for k in ("token", "timestampUs", "sourceSha256", "workingJpegSha256")}
            samples.append((index, 0., items[0][2]))
        del detector
        gc.collect()
        if args.device == "mps": learned_torch.mps.empty_cache()
        telemetry["phase"] = "old-detector-batch"; telemetry["unresolvedCallsUpperBound"]["yolov3"] = len(samples)
        tick = perf_counter(); configuration, observations = detect_samples(samples, exe, yolo); batch_wall = 1000*(perf_counter()-tick)
        telemetry["completedDetectorCalls"]["yolov3"] = len(samples); telemetry["unresolvedCallsUpperBound"]["yolov3"] = 0
        require(configuration == DETECTOR_CONFIGURATION and set(observations) == set(range(len(selected))), "Old detector configuration/binding changed")
        for index, row in enumerate(rows):
            at, observation = observations[index]
            require(at == 0., "Independent still detector binding changed")
            boxes = parse_detect(observation, row["width"], row["height"])
            row["providers"]["yolov3"] = {"detections": [b.record(row["width"], row["height"]) for b in boxes], "observation": observation}
            row["providers"]["yolov3"]["observationBinding"] = {k: row[k] for k in ("token", "timestampUs", "sourceSha256", "workingJpegSha256")}
    telemetry["phase"] = "post-inference-artifact-integrity"
    artifacts_after = artifact_snapshot(args, selected, root)
    require(artifacts_before == artifacts_after, "Input/review/executable/model/original source changed during inference")
    require(before == {name: sha256(HERE/name) for name in CODE}, "Output-affecting source changed during inference")
    result = {"schemaVersion": 1, "study": "M3O-detection", "inputSha256": input_hash, "platform": platform.platform(),
        "reviewSelectionSha256": sha256(args.reviewed_frames), "selectionScope": "reviewed frame keys only; target boxes/classes not passed to models",
        "inputPipelineDifference": "RT-DETR: native PNG pixels to processor 640; old YOLO: staged working JPEG to 416. Architecture and preprocessing differ; gains cannot be attributed to model alone.",
        "artifactBindingsBefore": artifacts_before, "artifactBindingsAfter": artifacts_after,
        "actualDetectorCalls": {"yolov3": len(selected), "rtdetr": len(selected)}, "maxCheckpoints": MAX_CHECKPOINTS,
        "providerProvenance": {"yolov3": {"configuration": configuration, "sceneqaSha256": sha256(exe), "modelHashes": model_hashes(yolo)}, "rtdetr": learned_provenance},
        "exportScope": EXPORT_SCOPE, "codeSha256": before, "oldDetectorBatchWallMs": batch_wall,
        "wholeReplayWallMs": 1000*(perf_counter()-started), "frames": rows}
    receipt_contract(result)
    telemetry.update(phase="complete", completeStudy=True)
    return result


def write_failure(output, telemetry, error):
    path = output.with_name(output.name+".failure.json")
    require(not path.is_symlink(), "Failure sidecar symlink forbidden")
    record = {"schemaVersion": 1, "study": "M3O-detector-failure", **telemetry, "completeStudy": False,
        "exceptionType": type(error).__name__, "error": str(error),
        "callScope": "Completed calls are observed. A failed active adapter/batch may have used 0..unresolved upper-bound additional calls; exact actual count is UNKNOWN."}
    with path.open("x") as stream: json.dump(record, stream, indent=2, allow_nan=False); stream.write("\n")
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); modes = parser.add_subparsers(dest="mode", required=True)
    for mode, keys in (("replay", ("input", "reviewed-frames", "sceneqa", "yolo", "rtdetr-model-dir", "output")), ("score", ("input", "truth", "receipt", "output"))):
        sub = modes.add_parser(mode)
        for key in keys: sub.add_argument("--"+key, type=Path, required=True)
        if mode == "replay": sub.add_argument("--device", choices=("mps", "cpu"), required=True)
    args = parser.parse_args()
    if args.mode == "replay":
        telemetry = {}
        try: result = replay(args, telemetry)
        except Exception as error:
            write_failure(args.output, telemetry, error)
            raise
    else:
        inputs, root = load_input(args.input); receipt, truth = read_json(args.receipt), read_json(args.truth, 2*1024**2)
        require(receipt["inputSha256"] == sha256(args.input), "Receipt/input byte hash mismatch")
        if receipt.get("study") == "M3O-detection": receipt_contract(receipt)
        elif receipt.get("study") == "M3N":
            import assist_scene_m3n_study as original
            original.receipt_contract(receipt); bind_input(receipt, inputs)
        else: raise ValueError("Unsupported actual detector receipt study")
        result = score(receipt, truth, inputs)
        result.update(receiptSha256=sha256(args.receipt), truthSha256=sha256(args.truth), diagnosticCodeSha256=sha256(Path(__file__)))
    require(not args.output.is_symlink(), "Output symlink forbidden")
    with args.output.open("x") as stream: json.dump(result, stream, indent=2, allow_nan=False); stream.write("\n")
