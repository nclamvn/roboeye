#!/usr/bin/env python3
"""Mac M3I: frozen M3H identities, independent region-motion measurements.

Runtime sees pixels/pose/detections only. Physical approach labels are joined
after a new receipt is saved. No metric range, TTC, app or safety acceptance.
"""

import argparse
from collections import Counter
from copy import deepcopy
from datetime import date
import json
import math
from pathlib import Path
import platform
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
from assist_scene_m3g_study import (
    DETECTOR_CONFIGURATION, _percentiles, bind_input, finite_payload, lane_contract, model_hashes,
)
from assist_scene_m3h_study import (
    CODE as PREVIOUS_CODE, cached_observation, cohort_contract, lifecycle_summary,
    load_cache as original_cache, read_json,
)


HERE = Path(__file__).resolve().parent
LANES = ("A", "B", "C", "S")
METHODS = {"B": "ecc", "C": "flow_affine"}
CODE = tuple(dict.fromkeys((*PREVIOUS_CODE, "assist_scene_m3i_study.py", "assist_scene_region_motion.py")))
TIMINGS = ("sharedPrep", "workingDecode", "nativeDecode", *LANES)


def load_cache(path, inputs, input_hash, exe_hash, hashes):
    """Reuse validated original detector bytes, not tracker or region outputs."""
    return original_cache(path, inputs, input_hash, exe_hash, hashes)


def identity_contract(candidate, identity):
    if candidate["epoch"] != identity["epoch"] or candidate["tracks"] != identity["tracks"]:
        raise ValueError("Region motion must use the exact frozen current M3H identities")
    if identity["status"] != "valid" and candidate["events"]:
        raise ValueError("Region motion cannot bypass the frozen pose/background validity gate")
    if candidate.get("diagnostics", {}).get("sourceStatus") != identity["status"]:
        raise ValueError("Region diagnostics must expose the frozen validity gate")


def measurement_contract(surface, identity, at, *, frame=None, history=None):
    """Validate fresh region evidence; never substitute a cohort/object age."""
    from assist_scene_region_motion import POLICY

    identity_contract(surface, identity)
    if not surface["events"]:
        return
    if not isinstance(frame, dict) or not history or frame["timeMs"] != at:
        raise ValueError("Region warning needs actual current and prior exposures")
    diagnostics = surface["diagnostics"]
    method = diagnostics.get("method")
    if method not in {"ecc", "flow_affine"}:
        raise ValueError("Unknown region measurement method")

    def number(value):
        return type(value) in (int, float) and math.isfinite(value)

    def pair_contract(pair, ident, *, adjacent=False):
        if not isinstance(pair, dict):
            raise ValueError("Missing direct region measurement")
        start, end, age = pair.get("startMs"), pair.get("endMs"), pair.get("observationMs")
        if (not all(number(v) for v in (start, end, age)) or end != at or start >= end
                or abs(age-(end-start)) > .000001 or pair.get("method") != method
                or pair.get("endToken") != frame["token"]):
            raise ValueError("Stale, chained or unbound region pair")
        if adjacent:
            if (start != history[-1]["timeMs"] or pair.get("startToken") != history[-1]["token"]
                    or age > POLICY["maxGapMs"]):
                raise ValueError("No fresh adjacent exposure measurement")
        elif not POLICY["minWindowMs"] <= age <= POLICY["maxWindowMs"]:
            raise ValueError("Direct region anchor must be 320-800 ms old")
        origins = [i for i, old in enumerate(history)
                   if old["timeMs"] == start and old["token"] == pair.get("startToken")]
        if len(origins) != 1:
            raise ValueError("Region anchor does not name an actual prior exposure")
        lineage = [*history[origins[0]:], frame]
        for index, exposure in enumerate(lineage):
            source = exposure["A"]
            if (source["epoch"] != identity["epoch"]
                    or not any(t["id"] == ident for t in source["tracks"])
                    or not index and source["status"] not in {"valid", "first-frame"}
                    or index and (source["status"] != "valid"
                        or source.get("diagnostics", {}).get("identityDecisions", {}).get(str(ident), {}).get("kept") is not True)):
                raise ValueError("Region anchor crosses missing/replaced identity or camera veto")
        if pair.get("supported") is not True:
            return False
        seed, points = pair.get("seedPoints"), pair.get("points")
        support = pair.get("supportFraction")
        if (type(seed) is not int or type(points) is not int
                or not POLICY["minPoints"] <= points <= seed <= POLICY["gridSide"]**2
                or not number(support) or abs(support-points/seed) > .000001
                or support < POLICY["minSupport"]):
            raise ValueError("Region pair lacks bounded current pixel support")
        matrix = pair.get("affine")
        if (not isinstance(matrix, list) or len(matrix) != 2
                or any(not isinstance(row, list) or len(row) != 3 or not all(number(v) for v in row) for row in matrix)):
            raise ValueError("Region measurement needs an actual finite affine fit")
        det = matrix[0][0]*matrix[1][1]-matrix[0][1]*matrix[1][0]
        linear, area = pair.get("linearLogGrowth"), pair.get("logAreaGrowth")
        if (det <= 0 or not number(linear) or not number(area)
                or abs(area-math.log(det)) > .000001 or abs(linear-.5*area) > .000001
                or abs(linear) > POLICY["maxLinearLogGrowth"]):
            raise ValueError("Region expansion is not the positive affine Jacobian determinant")
        singular = np.linalg.svd(np.asarray(matrix, dtype=float)[:, :2], compute_uv=False)
        angle = abs(math.degrees(math.atan2(matrix[1][0], matrix[0][0])))
        if (singular[-1] <= 0 or math.log(singular[0]/singular[-1]) > POLICY["maxAnisotropyLog"]
                or angle > POLICY["maxRotationDeg"]):
            raise ValueError("Region affine violates the frozen shape/rotation gate")
        if method == "ecc" and any(not number(pair.get(key)) or pair[key] < POLICY["minCorrelation"]
                for key in ("eccCorrelation", "reverseEccCorrelation")):
            raise ValueError("Supported ECC proof needs both actual correlation scores")
        return True

    for event in surface["events"]:
        ident = event["trackId"]
        evidence = diagnostics.get("windowEvidence", {}).get(str(ident))
        if not isinstance(evidence, dict) or evidence.get("confirmed") is not True:
            raise ValueError("No confirmed current direct-region evidence")
        fresh = evidence.get("fresh")
        if (not pair_contract(fresh, ident, adjacent=True)
                or fresh["linearLogGrowth"] < POLICY["minCurrentLinearGrowth"]):
            raise ValueError("Warning cannot coast without current region expansion")
        anchors = evidence.get("anchors")
        if not isinstance(anchors, list) or not 1 <= len(anchors) <= POLICY["maxAnchorChecks"]:
            raise ValueError("Missing or unbounded direct-anchor comparisons")
        if len({(a.get("startMs"), a.get("startToken")) for a in anchors if isinstance(a, dict)}) != len(anchors):
            raise ValueError("Duplicate or malformed direct region anchor")
        supported = [a for a in anchors if pair_contract(a, ident)]
        if any(a["linearLogGrowth"] <= 0 for a in supported):
            raise ValueError("A conflicting supported anchor must veto the region warning")
        positives = [a for a in supported if a["linearLogGrowth"] >= POLICY["minNetLinearGrowth"]]
        if not positives:
            raise ValueError("No supported long-window region expansion")
        best = max(positives, key=lambda pair: pair["observationMs"])
        if evidence.get("comparisonCount") != len(anchors)+1:
            raise ValueError("Incorrect actual direct comparison count")
        for key in ("observationMs", "linearLogGrowth", "logAreaGrowth"):
            if event.get(key) != best[key] or evidence.get(key) != best[key]:
                raise ValueError("Event does not bind the selected current direct measurement")
        if event.get("points") != best["points"] or event.get("method") != method:
            raise ValueError("Event does not bind actual region fit method/support")


def _timing_values(frames):
    for frame in frames:
        times = frame.get("timingsMs", {})
        if any(type(times.get(n)) not in (int, float) or not math.isfinite(times[n]) or times[n] < 0
               for n in TIMINGS):
            raise ValueError("Invalid or missing actual per-exposure stage timing")
    result = {n: _percentiles([f["timingsMs"][n] for f in frames]) for n in TIMINGS}
    for lane in LANES:
        dependencies = ("sharedPrep", lane) if lane in {"A", "S"} else ("sharedPrep", "A", lane)
        key = lane+"PlusSharedPrep" if lane in {"A", "S"} else lane+"PlusIdentityAndSharedPrep"
        result[key] = _percentiles([sum(f["timingsMs"][n] for n in dependencies) for f in frames])
    return result


def run_clip(clip, root, work, exe, model, cached=None):
    from assist_scene_cohort_loom import CohortWindowLoom
    from assist_scene_m3d_study import BoxBaseline
    from assist_scene_region_motion import RegionMotion

    started = perf_counter()
    tick = perf_counter()
    frames, samples, shapes = stage(clip, root, work)
    stage_ms = (perf_counter()-tick)*1000.
    found, configs, wall_ms = {}, [], 0.
    if cached is None:
        for start in range(0, len(samples), 50):
            tick = perf_counter()
            config, batch = detect_samples(samples[start:start+50], exe, model)
            wall_ms += (perf_counter()-tick)*1000.
            configs.append(config)
            found.update(batch)
        if not configs or any(config != DETECTOR_CONFIGURATION for config in configs):
            raise ValueError("Shared detector configuration changed")
        config = configs[0]
    else:
        config = cached["detectorConfiguration"]
    incumbent = CohortWindowLoom()
    candidate = {"B": RegionMotion(method="ecc", native_detail=True),
                 "C": RegionMotion(method="flow_affine", native_detail=True)}
    diagnostic = BoxBaseline()
    rows = []
    for i, frame in enumerate(frames):
        tick = perf_counter()
        h, w, oh, ow = shapes[i]
        gray = read_frame(samples[i][2], cv2.IMREAD_GRAYSCALE)
        working_decode = (perf_counter()-tick)*1000.
        tick = perf_counter()
        native = read_frame(root/frame["path"], cv2.IMREAD_COLOR)
        native_gray = cv2.cvtColor(native, cv2.COLOR_BGR2GRAY)
        native_decode = (perf_counter()-tick)*1000.
        if gray.shape != (h, w) or native_gray.shape != (oh, ow):
            raise ValueError("Wrong source/working exposure geometry")
        tick = perf_counter()
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
               "timingsMs": {"sharedPrep": working_decode+native_decode+(perf_counter()-tick)*1000.,
                             "workingDecode": working_decode, "nativeDecode": native_decode}}
        cv2.setRNGSeed(650500+i)
        tick = perf_counter()
        identity = incumbent.update(frame, at, gray, boxes, native_gray=native_gray)
        row["A"] = output(identity, at)
        row["timingsMs"]["A"] = (perf_counter()-tick)*1000.
        frozen_identity = deepcopy(identity)
        lane_contract(row["A"], at, gap)
        cohort_contract(row["A"], at)
        for name, state in candidate.items():
            cv2.setRNGSeed(650500+i)
            tick = perf_counter()
            row[name] = output(state.update(frame, at, gray, identity, native_gray=native_gray), at)
            row["timingsMs"][name] = (perf_counter()-tick)*1000.
            if identity != frozen_identity:
                raise ValueError("Region measurement mutated the frozen identity source")
            if row[name].get("diagnostics", {}).get("method") != METHODS[name]:
                raise ValueError("Region lane does not use its declared measurement method")
            lane_contract(row[name], at, gap)
            measurement_contract(row[name], row["A"], at, frame=row, history=rows)
        cv2.setRNGSeed(650500+i)
        tick = perf_counter()
        row["S"] = output(diagnostic.update(frame, at, gray, boxes), at)
        row["timingsMs"]["S"] = (perf_counter()-tick)*1000.
        lane_contract(row["S"], at, gap)
        rows.append(row)
    return {"id": clip["id"], "detectorConfiguration": config,
            "detectorExecution": "cached-historical-real-model" if cached else "actual-local-CoreML",
            "detectorCalls": 0 if cached else len(samples),
            "detectorBatchWallMs": None if cached else wall_ms, "stageWallMs": stage_ms,
            "studyWallMs": (perf_counter()-started)*1000., "frames": rows}


def replay(args):
    from assist_scene_cohort_loom import POLICY as A_POLICY
    from assist_scene_region_motion import POLICY as REGION_POLICY

    inputs, root = load_input(args.input)
    if (inputs["dataset"] not in {"Boreas-real", "synthetic-m3c"}
            or sum(len(c["frames"]) for c in inputs["clips"]) > CAPS["maxFramesTotal"]):
        raise ValueError("Unknown or excessive M3I input")
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("Choose a new receipt path")
    if shutil.disk_usage(args.output.parent).free < 10*1024**3:
        raise ValueError("Less than 10 GB free; stop before staging image copies")
    exe, model = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    input_hash, exe_hash, hashes = sha256(args.input), sha256(exe), model_hashes(model)
    cached_path = getattr(args, "cached_detections", None)
    cache = load_cache(cached_path, inputs, input_hash, exe_hash, hashes) if cached_path else None
    before = {name: sha256(HERE/name) for name in CODE}
    cv2.setNumThreads(1)
    rows = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3i-{date.today():%Y%m%d}-", dir=args.output.parent) as temp:
        for i, clip in enumerate(inputs["clips"]):
            print(f"Replay {clip['id']} ({len(clip['frames'])} frames; {'cached' if cache else 'actual'} detector)", flush=True)
            work = Path(temp)/str(i)
            work.mkdir()
            rows.append(run_clip(clip, root, work, exe, model, cache["clips"][i] if cache else None))
    after = {name: sha256(HERE/name) for name in CODE}
    if before != after:
        raise ValueError("Output-affecting code changed during replay")
    return {"schemaVersion": 1, "study": "M3I", "dataset": inputs["dataset"], "inputSha256": input_hash,
            "platform": platform.platform(), "opencv": cv2.__version__,
            "policies": {"A": dict(A_POLICY), "B": dict(REGION_POLICY), "C": dict(REGION_POLICY)},
            "lanes": {"A": "Frozen M3H cohort incumbent and sole identity owner",
                      "B": "ECC direct-region optical expansion, native detail, frozen A identities",
                      "C": "Fresh dense-flow affine region expansion, native detail, frozen A identities",
                      "S": "Legacy box-only diagnostic, not fallback"},
            "detectorProvenance": {"kind": "cached-historical-real-model" if cache else "actual-local-CoreML",
                                   "cacheSha256": sha256(cached_path) if cache else None,
                                   "sampleTimings": "historical, not current execution" if cache else "actual per-exposure inference, not end-to-end"},
            "sceneqaSha256": exe_hash, "yoloModelHashes": hashes, "codeSha256": after, "clips": rows,
            "timingScope": "A is complete frozen M3H execution, including its cohort measurement. B/C are incremental region measurement only. Candidate product samples add sharedPrep+A+B/C before percentiles; not a sum of p95s. Study wall includes all four sequential lanes and staging; detector batch wall is separate."}


def score(receipt, truth, inputs=None):
    finite_payload(receipt)
    finite_payload(truth)
    if inputs is not None:
        bind_input(receipt, inputs)
    if (receipt.get("schemaVersion") != 1 or receipt.get("study") != "M3I" or truth.get("schemaVersion") != 1
            or receipt["inputSha256"] != truth["inputSha256"]
            or [c["id"] for c in receipt["clips"]] != [c["id"] for c in truth["clips"]]
            or not receipt["clips"] or len({c["id"] for c in receipt["clips"]}) != len(receipt["clips"])):
        raise ValueError("Unbound or incompatible M3I scoring inputs")
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
                    or type(frame.get("index")) is not int or frame["index"] != i):
                raise ValueError("Missing lane or invalid exact stream clock")
            previous = stamp
            gap = frame.get("detectorGapInjected")
            if type(gap) is not bool or gap and frame["detections"]:
                raise ValueError("Invalid detector gap record")
            known = labels.get(frame["token"])
            if known and known["timestampUs"] != stamp:
                raise ValueError("Reference timestamp does not match exact exposure")
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
                if name == "A":
                    cohort_contract(frame[name], at)
                elif name in {"B", "C"}:
                    if frame[name].get("diagnostics", {}).get("method") != METHODS[name]:
                        raise ValueError("Region lane does not use its declared measurement method")
                    measurement_contract(frame[name], frame["A"], at, frame=frame, history=frames[:i])
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
                     "identityLifecycle": lifecycle_summary(frames, "A")})
    return {"schemaVersion": 1, "study": "M3I", "dataset": receipt["dataset"], "inputSha256": receipt["inputSha256"],
            "review": truth.get("review"), "reviewSha256": truth.get("reviewSha256"),
            "unit": "reviewed target-keyframe", "frames": len(all_frames),
            "noMetreChecks": len(all_frames)*len(LANES), "platform": receipt["platform"], "opencv": receipt["opencv"],
            "codeSha256": receipt["codeSha256"], "detectorProvenance": receipt["detectorProvenance"],
            "sceneqaSha256": receipt.get("sceneqaSha256"), "yoloModelHashes": receipt.get("yoloModelHashes"),
            "detectorConfiguration": receipt["clips"][0]["detectorConfiguration"],
            "detectorObservationTimingMs": _percentiles([f["detectorObservationMs"] for f in all_frames]),
            "totals": totals, "clips": rows, "stageMs": _timing_values(all_frames),
            "timingScope": receipt.get("timingScope"),
            "limits": "Unchanged physical approach labels. Optical area expansion, not angular growth, metric range or universal radial closing. Unknown/unmatched/unreviewed reports stay separate. Same observed internal IDs do not certify MOT accuracy. No phone, real-time or safety acceptance."}


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
