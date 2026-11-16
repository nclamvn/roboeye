#!/usr/bin/env python3
"""Mac M3H: same detector, independent object IDs and bounded feature cohorts.

Inference cannot open reference labels. Sparse reviewed targets and authored
controls are scored only after a receipt is saved. No physical metres or TTC.
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
from assist_scene_m3g_study import (
    CODE as PREVIOUS_CODE, DETECTOR_CONFIGURATION, _percentiles, bind_input,
    finite_payload, lane_contract, model_hashes,
)


HERE = Path(__file__).resolve().parent
LANES = ("A", "B", "C", "S")
CODE = tuple(dict.fromkeys((*PREVIOUS_CODE, "assist_scene_m3h_study.py", "assist_scene_cohort_loom.py")))
CACHE_PIPELINE = ("assist_scene_m3f_study.py", "assist_scene_m3e_study.py",
                  "assist_scene_motion.py", "assist_scene_motion_m3b.py")
MAX_RECEIPT_BYTES = 24 * 1024**2


def read_json(path, limit=MAX_RECEIPT_BYTES):
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError("Missing or excessive JSON artifact")
    data = json.loads(path.read_text())
    finite_payload(data)
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON mapping")
    return data


def load_cache(path, inputs, input_hash, exe_hash, hashes):
    """Reuse original M3G/M3H detections, never their tracker or ROI boxes."""
    cache = read_json(path)
    if (cache.get("schemaVersion") != 1 or cache.get("dataset") != inputs["dataset"]
            or cache.get("inputSha256") != input_hash or cache.get("sceneqaSha256") != exe_hash
            or cache.get("yoloModelHashes") != hashes or cache.get("opencv") != cv2.__version__):
        raise ValueError("Cached observations do not bind this input/model/executable/runtime")
    bind_input(cache, inputs)
    code = cache.get("codeSha256", {})
    runners = ("assist_scene_m3g_study.py", "assist_scene_m3h_study.py")
    if not any(code.get(name) == sha256(HERE/name) for name in runners):
        raise ValueError("No known exact-bound original detector runner")
    if any(code.get(name) != sha256(HERE/name) for name in CACHE_PIPELINE):
        raise ValueError("Detector parser or exposure staging changed")
    if cache.get("detectorProvenance", {}).get("kind") not in {
            "actual-local-CoreML", "cached-historical-real-model"}:
        raise ValueError("Unknown original observation provenance")
    for source, recorded in zip(inputs["clips"], cache["clips"], strict=True):
        if recorded.get("detectorConfiguration") != DETECTOR_CONFIGURATION:
            raise ValueError("Detector configuration changed")
        origin = source["frames"][0]["timestampUs"]
        for i, (frame, old) in enumerate(zip(source["frames"], recorded["frames"], strict=True)):
            at = old.get("timeMs")
            gap = old.get("detectorGapInjected")
            if (type(at) not in (int, float) or not math.isfinite(at)
                    or abs(at-(frame["timestampUs"]-origin)/1000.) > .000001
                    or type(old.get("index")) is not int or old["index"] != i
                    or type(gap) is not bool or gap != (i in DROPPED.get(source["id"], ()))
                    or not isinstance(old.get("detections"), list)
                    or gap and old["detections"]):
                raise ValueError("Cached exposure clock/order/gap/original detections changed")
            ms = old.get("detectorObservationMs")
            if type(ms) not in (int, float) or not math.isfinite(ms) or ms < 0:
                raise ValueError("Invalid historical model timing")
    return cache


def cached_observation(old, width, height, native_width, native_height):
    if ((old.get("width"), old.get("height"), old.get("nativeWidth"), old.get("nativeHeight"))
            != (width, height, native_width, native_height)):
        raise ValueError("Cached detections use another exposure geometry")
    boxes = parse_detect({"width": width, "height": height, "orientation": 1,
                          "tracks": old["detections"]}, width, height)
    return boxes, old["detectorObservationMs"]


def cohort_contract(surface, at):
    """Do not accept object age or an old warning as current cohort evidence."""
    if not surface["events"]:
        return
    diagnostics = surface.get("diagnostics", {})
    cohorts = diagnostics.get("cohorts", {})
    for event in surface["events"]:
        supporting = event.get("supportingCohortIds")
        observed = event.get("observationMs")
        records = cohorts.get(str(event["trackId"]), [])
        if (not isinstance(supporting, list) or not supporting
                or any(type(value) is not int or value < 0 for value in supporting)
                or len(set(supporting)) != len(supporting)
                or type(observed) not in (int, float) or observed < 320. or observed > 800.):
            raise ValueError("No bounded supporting cohort or valid measurement age")
        if not isinstance(records, list) or any(not isinstance(c, dict) for c in records):
            raise ValueError("Malformed current cohort records")
        by_id = {c.get("cohortId"): c for c in records}
        if len(by_id) != len(records):
            raise ValueError("Duplicate cohort IDs")
        ages = []
        for ident in supporting:
            c = by_id.get(ident)
            if not isinstance(c, dict):
                raise ValueError("Warning cohort is not present in the current observation")
            born, age = c.get("bornMs"), c.get("ageMs")
            if (type(born) not in (int, float) or type(age) not in (int, float)
                    or born < 0 or abs(at-born-age) > .000001 or not 320. <= age <= 800.
                    or c.get("lastMs") != at
                    or c.get("confirmed") is not True or c.get("mature") is not True
                    or type(c.get("validSamples")) is not int or c["validSamples"] < 5
                    or type(c.get("currentPoints")) is not int or not 9 <= c["currentPoints"] <= 64
                    or type(c.get("initialPoints")) is not int or not 9 <= c["initialPoints"] <= 64):
                raise ValueError("Warning reused object age, stale or immature cohort evidence")
            ages.append(age)
        if observed > max(ages)+.000001:
            raise ValueError("Warning measurement window exceeds all supporting cohort ages")


def run_clip(clip, root, work, exe, model, cached=None):
    from assist_scene_dense_window import DenseWindowLoom
    from assist_scene_cohort_loom import CohortWindowLoom
    from assist_scene_m3d_study import BoxBaseline

    started = perf_counter()
    tick = perf_counter()
    frames, samples, shapes = stage(clip, root, work)
    stage_ms = (perf_counter()-tick)*1000.
    found, configs, wall_ms = {}, [], 0.
    if cached is None:
        for i in range(0, len(samples), 50):
            tick = perf_counter()
            config, batch = detect_samples(samples[i:i+50], exe, model)
            wall_ms += (perf_counter()-tick)*1000.
            configs.append(config)
            found.update(batch)
        if not configs or any(c != DETECTOR_CONFIGURATION for c in configs):
            raise ValueError("Shared detector configuration changed")
        config = configs[0]
    else:
        config = cached["detectorConfiguration"]
    lanes = {"A": DenseWindowLoom(), "B": CohortWindowLoom(),
             "C": CohortWindowLoom(native_detail=False), "S": BoxBaseline()}
    rows = []
    for i, frame in enumerate(frames):
        tick = perf_counter()
        h, w, oh, ow = shapes[i]
        gray = read_frame(samples[i][2], cv2.IMREAD_GRAYSCALE)
        working_decode = (perf_counter()-tick)*1000.
        tick_native = perf_counter()
        native = read_frame(root/frame["path"], cv2.IMREAD_COLOR)
        native_gray = cv2.cvtColor(native, cv2.COLOR_BGR2GRAY)
        native_decode = (perf_counter()-tick_native)*1000.
        if gray.shape != (h, w) or native.shape[:2] != (oh, ow):
            raise ValueError("Wrong source/working exposure geometry")
        at = samples[i][1]
        gap = i in DROPPED.get(clip["id"], ())
        if cached is None:
            found_at, obs = found[i]
            if found_at != at:
                raise ValueError("Detector exposure clock mismatch")
            boxes = [] if gap else parse_detect(obs, w, h)
            detector_ms = obs["detectionMs"]
        else:
            boxes, detector_ms = cached_observation(cached["frames"][i], w, h, ow, oh)
        row = {"token": frame["token"], "timestampUs": frame["timestampUs"], "timeMs": at,
               "index": i, "width": w, "height": h, "nativeWidth": ow, "nativeHeight": oh,
               "detectorGapInjected": gap, "detections": [d.record(w, h) for d in boxes],
               "detectorObservationMs": detector_ms,
               "timingsMs": {"sharedPrep": (perf_counter()-tick)*1000.,
                             "workingDecode": working_decode, "nativeDecode": native_decode}}
        for name, state in lanes.items():
            cv2.setRNGSeed(650500+i)
            tick_lane = perf_counter()
            options = {"native_gray": native_gray} if name in {"A", "B"} else {}
            row[name] = output(state.update(frame, at, gray, boxes, **options), at)
            lane_contract(row[name], at, gap)
            if name in {"B", "C"}:
                cohort_contract(row[name], at)
            row["timingsMs"][name] = (perf_counter()-tick_lane)*1000.
        rows.append(row)
    return {"id": clip["id"], "detectorConfiguration": config,
            "detectorExecution": "cached-historical-real-model" if cached else "actual-local-CoreML",
            "detectorCalls": 0 if cached else len(samples),
            "detectorBatchWallMs": None if cached else wall_ms, "stageWallMs": stage_ms,
            "studyWallMs": (perf_counter()-started)*1000., "frames": rows}


def replay(args):
    from assist_scene_dense_window import POLICY as A_POLICY
    from assist_scene_cohort_loom import POLICY as B_POLICY

    inputs, root = load_input(args.input)
    if (inputs["dataset"] not in {"Boreas-real", "synthetic-m3c"}
            or sum(len(c["frames"]) for c in inputs["clips"]) > CAPS["maxFramesTotal"]):
        raise ValueError("Unknown or excessive M3H input")
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("Choose a new receipt path")
    exe, model = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    input_hash, exe_hash, hashes = sha256(args.input), sha256(exe), model_hashes(model)
    cached_path = getattr(args, "cached_detections", None)
    cache = load_cache(cached_path, inputs, input_hash, exe_hash, hashes) if cached_path else None
    before = {name: sha256(HERE/name) for name in CODE}
    cv2.setNumThreads(1)
    rows = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3h-{date.today():%Y%m%d}-", dir=args.output.parent) as temp:
        for i, clip in enumerate(inputs["clips"]):
            print(f"Replay {clip['id']} ({len(clip['frames'])} frames; {'cached' if cache else 'actual'} detector)", flush=True)
            work = Path(temp)/str(i)
            work.mkdir()
            rows.append(run_clip(clip, root, work, exe, model, cache["clips"][i] if cache else None))
    after = {name: sha256(HERE/name) for name in CODE}
    if before != after:
        raise ValueError("Output-affecting code changed during replay")
    return {"schemaVersion": 1, "study": "M3H", "dataset": inputs["dataset"], "inputSha256": input_hash,
            "platform": platform.platform(), "opencv": cv2.__version__,
            "policies": {"A": dict(A_POLICY), "B": dict(B_POLICY), "C": dict(B_POLICY)},
            "lanes": {"A": "M3G dense cumulative incumbent", "B": "Independent identity/cohort native",
                      "C": "Independent identity/cohort no-native ablation", "S": "Box-only diagnostic, not fallback"},
            "detectorProvenance": {"kind": "cached-historical-real-model" if cache else "actual-local-CoreML",
                                   "cacheSha256": sha256(cached_path) if cache else None,
                                   "sampleTimings": "historical, not current execution" if cache else "actual per-exposure inference, not end-to-end"},
            "sceneqaSha256": exe_hash, "yoloModelHashes": hashes, "codeSha256": after, "clips": rows,
            "timingScope": "studyWallMs includes all four sequential lanes, not single-product latency"}


def lifecycle_summary(frames, name):
    """Observed internal IDs, not ground-truth MOT correctness or identity recall."""
    seen, reasons, retired = {}, Counter(), Counter()
    bounds = Counter()
    cohort_ages, warning_ages = [], []
    for frame in frames:
        surface = frame[name]
        at = frame["timeMs"]
        epoch = surface["epoch"]
        for track in surface["tracks"]:
            entry = seen.setdefault((epoch, track["id"]), [at, at, 0])
            entry[1] = at
            entry[2] += 1
        diag = surface.get("diagnostics", {})
        for decision in diag.get("identityDecisions", {}).values():
            if isinstance(decision, dict):
                reasons[str(decision.get("reason", "unspecified"))] += 1
        for records in diag.get("retiredCohorts", {}).values():
            for record in records:
                retired[str(record.get("reason", "unspecified"))] += 1
        for records in diag.get("cohorts", {}).values():
            cohort_ages.extend(c["ageMs"] for c in records if type(c.get("ageMs")) in (int, float))
        for key, value in diag.get("bounds", {}).items():
            if type(value) is int and value >= 0:
                bounds[key] = max(bounds[key], value)
        warning_ages.extend(e["observationMs"] for e in surface["events"] if "observationMs" in e)
    return {"observedInternalIds": len(seen), "repeatedObservedIds": sum(v[2] > 1 for v in seen.values()),
            "maxObservedIdSpanMs": max((v[1]-v[0] for v in seen.values()), default=0.),
            "identityDecisionCounts": reasons, "retiredCohortReasons": retired,
            "maxReportedBounds": bounds, "maxObservedCohortAgeMs": max(cohort_ages, default=None),
            "maxWarningMeasurementAgeMs": max(warning_ages, default=None),
            "scope": "Internal observed-ID/cohort diagnostics, NOT GT ID-switch or MOT accuracy"}


def score(receipt, truth, inputs=None):
    finite_payload(receipt)
    finite_payload(truth)
    if inputs is not None:
        bind_input(receipt, inputs)
    if (receipt.get("schemaVersion") != 1 or truth.get("schemaVersion") != 1
            or receipt["inputSha256"] != truth["inputSha256"]
            or [c["id"] for c in receipt["clips"]] != [c["id"] for c in truth["clips"]]
            or len({c["id"] for c in receipt["clips"]}) != len(receipt["clips"])):
        raise ValueError("Unbound or incompatible scoring inputs")
    contract = legacy_score()
    totals = {name: Counter(contract.empty()) for name in LANES}
    rows, all_frames = [], []
    for clip, ref in zip(receipt["clips"], truth["clips"], strict=True):
        frames = clip["frames"]
        labels = {f["token"]: f for f in ref["frames"]}
        if (not frames or len(labels) != len(ref["frames"])
                or len({f["token"] for f in frames}) != len(frames)
                or not labels.keys() <= {f["token"] for f in frames}):
            raise ValueError("Duplicate/missing exact frame labels")
        stats = {name: contract.empty() for name in LANES}
        statuses = {name: Counter() for name in LANES}
        reasons = {name: Counter() for name in LANES}
        ceiling = Counter()
        origin, previous = frames[0]["timestampUs"], None
        for i, frame in enumerate(frames):
            stamp, at = frame.get("timestampUs"), frame.get("timeMs")
            if (not set(LANES) <= frame.keys() or type(stamp) is not int or stamp < 0
                    or previous is not None and stamp <= previous
                    or type(at) not in (int, float) or abs(at-(stamp-origin)/1000.) > .000001
                    or "index" in frame and (type(frame["index"]) is not int or frame["index"] != i)):
                raise ValueError("Missing lane or invalid exact stream clock")
            previous = stamp
            gap = frame.get("detectorGapInjected", False)
            if type(gap) is not bool or gap and frame["detections"]:
                raise ValueError("Invalid detector gap record")
            known = labels.get(frame["token"])
            if known and known["timestampUs"] != stamp:
                raise ValueError("Reference timestamp does not match the exact exposure")
            targets = None if known is None else [
                {**target, "motion": {"approaching": "moving", "not-approaching": "stationary", "unknown": "unknown"}[target["approach"]]}
                for target in known["targets"]]
            for target in targets or ():
                key = target["approach"]
                ceiling[key] += 1
                ceiling[key+".withYolo"] += any(contract.family(d["label"]) == target["classFamily"]
                                               and contract.iou(d["box"], target["box"]) >= contract.IOU for d in frame["detections"])
            for name in LANES:
                lane_contract(frame[name], at, gap)
                if name in {"B", "C"}:
                    cohort_contract(frame[name], at)
                contract.score_frame(frame, name, targets, stats[name])
                statuses[name][frame[name]["status"]] += 1
                reasons[name].update(frame[name].get("diagnostics", {}).get("trackReasons", {}).values())
                if ref.get("allSceneNegative"):
                    stats[name]["allSceneFalseNotices"] = stats[name].get("allSceneFalseNotices", 0)+len(frame[name]["events"])
            all_frames.append(frame)
        for name in LANES:
            totals[name].update(stats[name])
        rows.append({"id": clip["id"], "lanes": stats, "statuses": statuses,
                     "trackReasons": reasons, "detectorCeiling": ceiling,
                     "lifecycle": {name: lifecycle_summary(frames, name) for name in LANES}})
    timing = {name: _percentiles([f["timingsMs"][name] for f in all_frames])
              for name in ("sharedPrep", "workingDecode", "nativeDecode", *LANES)}
    for name in LANES:
        timing[name+"PlusSharedPrep"] = _percentiles([f["timingsMs"][name]+f["timingsMs"]["sharedPrep"] for f in all_frames])
    return {"schemaVersion": 1, "study": "M3H", "dataset": receipt["dataset"], "inputSha256": receipt["inputSha256"],
            "review": truth.get("review"), "reviewSha256": truth.get("reviewSha256"),
            "unit": "reviewed target-keyframe", "frames": len(all_frames),
            "noMetreChecks": len(all_frames)*len(LANES), "platform": receipt["platform"], "opencv": receipt["opencv"],
            "codeSha256": receipt["codeSha256"], "detectorProvenance": receipt["detectorProvenance"],
            "sceneqaSha256": receipt.get("sceneqaSha256"), "yoloModelHashes": receipt.get("yoloModelHashes"),
            "detectorConfiguration": receipt["clips"][0]["detectorConfiguration"],
            "detectorObservationTimingMs": _percentiles([f["detectorObservationMs"] for f in all_frames]),
            "totals": totals, "clips": rows, "stageMs": timing,
            "limits": "Physical approach labels remain unchanged. Optical expansion is not metric range or universal radial closing. Unknown/unmatched/unreviewed reports are separate; internal ID lifetimes are not MOT GT accuracy. No phone, real-time or safety acceptance."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    for mode, keys in (("replay", ("input", "sceneqa", "yolo", "output")),
                       ("score", ("input", "truth", "receipt", "output"))):
        sub = modes.add_parser(mode)
        for key in keys:
            sub.add_argument("--"+key, type=Path, required=True)
        if mode == "replay":
            sub.add_argument("--cached-detections", type=Path)
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
