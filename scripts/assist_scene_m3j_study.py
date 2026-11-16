#!/usr/bin/env python3
"""M3J Mac-only frozen 2x2 detector/correspondence study; no runtime labels."""

import argparse
from collections import Counter
from copy import deepcopy
from datetime import date
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
from assist_scene_m3e_study import DROPPED, legacy_score, output, read_frame, write_new
from assist_scene_m3f_study import stage
from assist_scene_m3g_study import DETECTOR_CONFIGURATION, _percentiles, bind_input, finite_payload, lane_contract, model_hashes
from assist_scene_m3h_study import cached_observation, cohort_contract, lifecycle_summary, read_json
from assist_scene_m3i_study import CODE as PREVIOUS_CODE, load_cache as original_cache, measurement_contract as original_measurement_contract


HERE = Path(__file__).resolve().parent
LANES = ("A", "B", "C", "D", "S")
SOURCES = {"C": "A", "D": "B"}
MAX_FRAMES = 180
MAX_MODEL_CALLS = 900
CODE = tuple(dict.fromkeys((*PREVIOUS_CODE, "assist_scene_m3j_study.py", "assist_scene_tiled_detection.py", "assist_scene_feature_region.py", "assist_scene_roi_redetect.py")))
TIMINGS = ("fullPreparation", "sharedPrep", "workingDecode", "nativeDecode", "tilePreparation", "tileParsing", "tileInference", "tileMerge", *LANES)


def policy_snapshot():
    from assist_scene_cohort_loom import POLICY as IDENTITY_POLICY
    from assist_scene_feature_region import FEATURE_POLICY
    from assist_scene_region_motion import POLICY as REGION_POLICY
    from assist_scene_tiled_detection import POLICY as TILE_POLICY
    return {"identity": dict(IDENTITY_POLICY), "region": dict(REGION_POLICY),
            "feature": dict(FEATURE_POLICY), "tile": dict(TILE_POLICY)}


def receipt_contract(receipt):
    """Stored execution/cost claims must match the preregistered runner."""
    development = receipt.get("developmentOnly")
    count = sum(len(c["frames"]) for c in receipt["clips"])
    kind = "development-historical-full-plus-fresh-tiles" if development else "actual-local-CoreML"
    provenance = receipt.get("detectorProvenance", {})
    cache = provenance.get("cacheSha256")
    digest = lambda value: isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None
    if (type(development) is not bool or not 1 <= count <= MAX_FRAMES
            or development and count != 100 or count*(4 if development else 5) > MAX_MODEL_CALLS
            or provenance.get("kind") != kind or (not digest(cache) if development else cache is not None)
            or provenance.get("fullSampleTimings") != ("historical, not current execution" if development else "actual per-exposure model inference")
            or provenance.get("tileSampleTimings") != "actual per-exposure four-call inference sum; not batch/model startup wall"
            or receipt.get("policies") != policy_snapshot() or receipt.get("opencv") != cv2.__version__
            or not digest(receipt.get("sceneqaSha256")) or not receipt.get("yoloModelHashes")
            or not all(digest(v) for v in receipt["yoloModelHashes"].values())
            or receipt.get("codeSha256") != {name: sha256(HERE/name) for name in CODE}):
        raise ValueError("Forged or incompatible execution, policy or provenance claims")
    for clip in receipt["clips"]:
        size = len(clip["frames"])
        if (clip.get("detectorConfiguration") != DETECTOR_CONFIGURATION
                or clip.get("detectorExecution") != kind
                or type(clip.get("detectorCalls")) is not int or clip["detectorCalls"] != size*(4 if development else 5)
                or type(clip.get("fullDetectorBatches")) is not int or clip["fullDetectorBatches"] != (0 if development else math.ceil(size/50))
                or type(clip.get("tileDetectorBatches")) is not int or clip["tileDetectorBatches"] != math.ceil(4*size/50)
                or development and clip.get("fullDetectorBatchWallMs") is not None):
            raise ValueError("Wrong actual detector calls, batch count or configuration")
        walls = ["tileDetectorBatchWallMs", "stageWallMs", "studyWallMs"]+([] if development else ["fullDetectorBatchWallMs"])
        if any(type(clip.get(key)) not in (int, float) or not math.isfinite(clip[key]) or clip[key] < 0 for key in walls):
            raise ValueError("Missing actual batch/staging/study wall cost")


def load_cache(path, inputs, input_hash, exe_hash, hashes):
    cache = original_cache(path, inputs, input_hash, exe_hash, hashes)
    if cache.get("study") != "M3I":
        raise ValueError("Development cache must be the exact old M3I full observations")
    return cache


def measurement_contract(surface, identity, at, *, frame, history, source="A"):
    """Keep every M3I final gate and additionally require actual feature proof."""
    from assist_scene_feature_region import FEATURE_POLICY
    from assist_scene_region_motion import POLICY

    if surface.get("diagnostics", {}).get("method") != "feature_ecc":
        raise ValueError("M3J must use declared feature-initialized ECC")
    # The unchanged M3I validator sees exactly the same proof, changing only
    # its method enum and the owning identity lane (D belongs to B, not A).
    checked = deepcopy(surface)
    checked["diagnostics"]["method"] = "ecc"
    for event in checked["events"]:
        if event.get("method") != "feature_ecc":
            raise ValueError("Wrong feature event method")
        event["method"] = "ecc"
    for evidence in checked["diagnostics"].get("windowEvidence", {}).values():
        for pair in [evidence.get("fresh"), *evidence.get("anchors", [])]:
            if isinstance(pair, dict):
                if pair.get("method") != "feature_ecc":
                    raise ValueError("Wrong feature comparison method")
                pair["method"] = "ecc"
    original_measurement_contract(checked, identity, at,
        frame={**frame, "A": frame[source]}, history=[{**old, "A": old[source]} for old in history])

    def number(value):
        return type(value) in (int, float) and math.isfinite(value)

    for event in surface["events"]:
        evidence = surface["diagnostics"]["windowEvidence"][str(event["trackId"])]
        for pair in [evidence["fresh"], *evidence["anchors"]]:
            if pair.get("supported") is not True:
                continue
            matches, inliers = pair.get("featureMatchCount"), pair.get("featureInlierCount")
            fraction, ratio = pair.get("featureInlierFraction"), pair.get("featureRatioP90")
            threshold = pair.get("featureRatioThreshold")
            keypoints = pair.get("featureKeypoints")
            if (type(matches) is not int or type(inliers) is not int
                    or not FEATURE_POLICY["minMatches"] <= inliers <= matches <= FEATURE_POLICY["maxFeatures"]
                    or not isinstance(keypoints, list) or len(keypoints) != 2
                    or not all(type(n) is int and matches <= n <= FEATURE_POLICY["maxFeatures"] for n in keypoints)
                    or not number(fraction) or abs(fraction-inliers/matches) > .000001
                    or fraction < FEATURE_POLICY["minInlierFraction"]
                    or threshold != FEATURE_POLICY["ratio"] or not number(ratio) or not 0 <= ratio <= threshold):
                raise ValueError("No actual bounded ratio/inlier feature support")
            matrix = pair.get("featureInitialAffine")
            if (not isinstance(matrix, list) or len(matrix) != 2
                    or any(not isinstance(row, list) or len(row) != 3 or not all(number(v) for v in row) for row in matrix)
                    or matrix[0][0]*matrix[1][1]-matrix[0][1]*matrix[1][0] <= 0):
                raise ValueError("Missing actual positive feature initialization")
            span, hull = pair.get("featureSpan"), pair.get("featureHull")
            if (not isinstance(span, list) or len(span) != 2
                    or any(not isinstance(axis, list) or len(axis) != 2
                        or not all(number(v) and v >= POLICY["minSpan"] for v in axis) for axis in span)
                    or not isinstance(hull, list) or len(hull) != 2
                    or not all(number(v) and v >= POLICY["minHull"] for v in hull)):
                raise ValueError("Feature inliers lack spatial spread")


def tile_contract(frame):
    """Reconstruct candidate detections from current raw, bound tile reports."""
    from assist_scene_tiled_detection import TiledDetector

    h, w, nh, nw = (frame[k] for k in ("height", "width", "nativeHeight", "nativeWidth"))
    state = TiledDetector()
    plan = state.plan((nh, nw), (h, w))
    records = frame.get("tiles")
    if not isinstance(records, list) or len(records) != len(plan):
        raise ValueError("Missing exact current four-tile observations")
    parsed = []
    for tile, record in zip(plan, records, strict=True):
        x, y, right, bottom = tile.rect
        if (record.get("index") != tile.index or record.get("rect") != list(tile.rect)
                or record.get("token") != frame["token"] or record.get("timeMs") != frame["timeMs"]
                or record.get("sourceSha256") != frame.get("sourceSha256")
                or not isinstance(record.get("jpegSha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", record["jpegSha256"])):
            raise ValueError("Unbound tile geometry, exposure or pixels")
        obs = record.get("observation", {})
        ms = obs.get("detectionMs")
        if type(ms) not in (int, float) or not math.isfinite(ms) or ms < 0:
            raise ValueError("Missing actual tile inference timing")
        parsed.append(parse_detect(obs, right-x, bottom-y))
    current = parse_detect({"width": w, "height": h, "orientation": 1,
                            "tracks": frame["detections"]}, w, h)
    merged, diagnostics = state.merge(current, plan, parsed, (nh, nw), (h, w))
    expected = [] if frame["detectorGapInjected"] else [box.record(w, h) for box in merged]
    if frame.get("candidateDetections") != expected or frame.get("tileMerge") != diagnostics:
        raise ValueError("Candidate boxes or provenance do not reproduce the frozen tile merge")
    ms = sum(record["observation"]["detectionMs"] for record in records)
    if frame.get("timingsMs", {}).get("tileInference") != ms:
        raise ValueError("Tile timing must sum all four actual current inference observations")


def _timing_values(frames):
    for frame in frames:
        if any(type(frame.get("timingsMs", {}).get(n)) not in (int, float)
               or not math.isfinite(frame["timingsMs"][n]) or frame["timingsMs"][n] < 0 for n in TIMINGS):
            raise ValueError("Invalid or missing actual per-exposure operation timing")
        ms = frame.get("detectorObservationMs")
        if type(ms) not in (int, float) or not math.isfinite(ms) or ms < 0:
            raise ValueError("Missing full detector observation timing")
    result = {name: _percentiles([f["timingsMs"][name] for f in frames]) for name in TIMINGS}
    for lane in LANES:
        dependencies = ["fullPreparation", "sharedPrep", lane]
        if lane in {"B", "D"}:
            dependencies += ["tilePreparation", "tileParsing", "tileInference", "tileMerge"]
        if lane in SOURCES:
            dependencies.append(SOURCES[lane])
        values = [f["detectorObservationMs"]+sum(f["timingsMs"][n] for n in dependencies) for f in frames]
        result[lane+"PairedProduct"] = _percentiles(values)
    return result


def _detect_batched(items, exe, model):
    found, wall, batches = {}, 0., 0
    for start in range(0, len(items), 50):
        tick = perf_counter()
        config, observations = detect_samples(items[start:start+50], exe, model)
        wall += (perf_counter()-tick)*1000.
        batches += 1
        if config != DETECTOR_CONFIGURATION or set(observations) != {i for i, _, _ in items[start:start+50]}:
            raise ValueError("Detector configuration or exact batch binding changed")
        found.update(observations)
    return found, wall, batches


def run_clip(clip, root, work, exe, model, cached=None):
    from assist_scene_cohort_loom import CohortWindowLoom
    from assist_scene_feature_region import FeatureRegionMotion
    from assist_scene_m3d_study import BoxBaseline
    from assist_scene_tiled_detection import TiledDetector

    started = perf_counter()
    frames, samples, shapes, preparation, tiles, tile_samples, tile_prep = [], [], [], [], [], [], []
    planner = TiledDetector()
    origin = clip["frames"][0]["timestampUs"]
    for i, source in enumerate(clip["frames"]):
        tick = perf_counter()
        folder = work/str(i)
        folder.mkdir()
        fs, ss, dimensions = stage({"frames": [source]}, root, folder)
        at = (source["timestampUs"]-origin)/1000.
        frames.extend(fs); samples.append((i, at, ss[0][2])); shapes.extend(dimensions)
        preparation.append((perf_counter()-tick)*1000.)
        tick = perf_counter()
        h, w, nh, nw = dimensions[0]
        native = read_frame(root/source["path"], cv2.IMREAD_COLOR)
        plan, records = planner.plan((nh, nw), (h, w)), []
        for tile in plan:
            x, y, right, bottom = tile.rect
            filename = folder/f"tile-{tile.index}.jpg"
            if not cv2.imwrite(str(filename), np.ascontiguousarray(native[y:bottom, x:right]), [cv2.IMWRITE_JPEG_QUALITY, 97]):
                raise RuntimeError("Cannot stage original-pixel tile")
            tile_samples.append((4*i+tile.index, at, filename))
            records.append({"index": tile.index, "rect": list(tile.rect), "token": source["token"], "timeMs": at,
                            "sourceSha256": source["sha256"], "jpegSha256": sha256(filename)})
        tiles.append((plan, records)); tile_prep.append((perf_counter()-tick)*1000.)
    staging_wall = (perf_counter()-started)*1000.
    full, full_wall, full_batches = ({}, None, 0) if cached else _detect_batched(samples, exe, model)
    tiled, tile_wall, tile_batches = _detect_batched(tile_samples, exe, model)
    owners = {name: CohortWindowLoom() for name in ("A", "B")}
    candidates = {name: FeatureRegionMotion(method="feature_ecc", native_detail=True) for name in SOURCES}
    diagnostic, rows = BoxBaseline(), []
    for i, frame in enumerate(frames):
        h, w, nh, nw = shapes[i]
        tick = perf_counter(); gray = read_frame(samples[i][2], cv2.IMREAD_GRAYSCALE)
        working_decode = (perf_counter()-tick)*1000.
        tick = perf_counter(); native = read_frame(root/frame["path"], cv2.IMREAD_COLOR)
        native_gray = cv2.cvtColor(native, cv2.COLOR_BGR2GRAY)
        native_decode = (perf_counter()-tick)*1000.
        if gray.shape != (h, w) or native_gray.shape != (nh, nw):
            raise ValueError("Wrong source/working geometry")
        tick = perf_counter()
        at, gap = samples[i][1], i in DROPPED.get(clip["id"], ())
        if cached:
            boxes, detector_ms = cached_observation(cached["frames"][i], w, h, nw, nh)
        else:
            found_at, obs = full[i]
            if found_at != at:
                raise ValueError("Full detector clock mismatch")
            boxes, detector_ms = ([] if gap else parse_detect(obs, w, h)), obs["detectionMs"]
        shared = working_decode+native_decode+(perf_counter()-tick)*1000.
        tick = perf_counter()
        plan, records = tiles[i]
        parsed = []
        for tile, record in zip(plan, records, strict=True):
            found_at, obs = tiled[4*i+tile.index]
            if found_at != at:
                raise ValueError("Tile detector clock mismatch")
            record["observation"] = obs
            x, y, right, bottom = tile.rect
            parsed.append(parse_detect(obs, right-x, bottom-y))
        tile_parsing = (perf_counter()-tick)*1000.
        tick = perf_counter()
        merged, merge = planner.merge(boxes, plan, parsed, (nh, nw), (h, w))
        merge_ms = (perf_counter()-tick)*1000.
        merged = [] if gap else merged
        row = {"token": frame["token"], "timestampUs": frame["timestampUs"], "timeMs": at, "index": i,
               "sourceSha256": frame["sha256"], "width": w, "height": h, "nativeWidth": nw, "nativeHeight": nh,
               "detectorGapInjected": gap, "detections": [d.record(w, h) for d in boxes],
               "candidateDetections": [d.record(w, h) for d in merged], "tiles": records, "tileMerge": merge,
               "detectorObservationMs": detector_ms,
               "timingsMs": {"fullPreparation": preparation[i], "sharedPrep": shared, "workingDecode": working_decode,
                             "nativeDecode": native_decode, "tilePreparation": tile_prep[i],
                             "tileParsing": tile_parsing, "tileInference": sum(r["observation"]["detectionMs"] for r in records), "tileMerge": merge_ms}}
        identities = {}
        for name, owner in owners.items():
            cv2.setRNGSeed(650500+i); tick = perf_counter()
            identities[name] = owner.update(frame, at, gray, boxes if name == "A" else merged, native_gray=native_gray)
            row[name] = output(identities[name], at)
            row["timingsMs"][name] = (perf_counter()-tick)*1000.
            lane_contract(row[name], at, gap); cohort_contract(row[name], at)
        for name, state in candidates.items():
            source = SOURCES[name]; frozen = deepcopy(identities[source])
            cv2.setRNGSeed(650500+i); tick = perf_counter()
            row[name] = output(state.update(frame, at, gray, identities[source], native_gray=native_gray), at)
            row["timingsMs"][name] = (perf_counter()-tick)*1000.
            if identities[source] != frozen:
                raise ValueError("Feature measurement mutated its frozen identity owner")
            lane_contract(row[name], at, gap)
            measurement_contract(row[name], row[source], at, frame=row, history=rows, source=source)
        cv2.setRNGSeed(650500+i); tick = perf_counter()
        row["S"] = output(diagnostic.update(frame, at, gray, boxes), at)
        row["timingsMs"]["S"] = (perf_counter()-tick)*1000.
        lane_contract(row["S"], at, gap); tile_contract(row)
        rows.append(row)
    return {"id": clip["id"], "detectorConfiguration": DETECTOR_CONFIGURATION,
            "detectorExecution": "development-historical-full-plus-fresh-tiles" if cached else "actual-local-CoreML",
            "detectorCalls": len(tile_samples)+(0 if cached else len(samples)),
            "fullDetectorBatchWallMs": full_wall, "tileDetectorBatchWallMs": tile_wall,
            "fullDetectorBatches": full_batches, "tileDetectorBatches": tile_batches,
            "stageWallMs": staging_wall, "studyWallMs": (perf_counter()-started)*1000., "frames": rows}


def replay(args):
    from assist_scene_cohort_loom import POLICY as IDENTITY_POLICY
    from assist_scene_feature_region import FEATURE_POLICY
    from assist_scene_region_motion import POLICY as REGION_POLICY
    from assist_scene_tiled_detection import POLICY as TILE_POLICY

    inputs, root = load_input(args.input)
    count = sum(len(c["frames"]) for c in inputs["clips"])
    if inputs["dataset"] not in {"Boreas-real", "synthetic-m3c"} or not 1 <= count <= MAX_FRAMES:
        raise ValueError("Unknown or excessive M3J input")
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("Choose a new receipt path")
    if shutil.disk_usage(args.output.parent).free < 10*1024**3:
        raise ValueError("Less than 10 GB free; stop before staging")
    cached_path = getattr(args, "cached_detections", None)
    development = bool(getattr(args, "development_only", False))
    if bool(cached_path) != development or cached_path and count != 100:
        raise ValueError("Old full-detection cache allowed only for the 100-exposure development suite")
    if development and count != 100:
        raise ValueError("Development suite must contain exactly 100 exposures")
    if count*(4 if cached_path else 5) > MAX_MODEL_CALLS:
        raise ValueError("Model call budget exceeded")
    exe, model = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    input_hash, exe_hash, hashes = sha256(args.input), sha256(exe), model_hashes(model)
    cache = load_cache(cached_path, inputs, input_hash, exe_hash, hashes) if cached_path else None
    before = {name: sha256(HERE/name) for name in CODE}
    cv2.setNumThreads(1)
    rows = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3j-{date.today():%Y%m%d}-", dir=args.output.parent) as temp:
        for i, clip in enumerate(inputs["clips"]):
            print(f"Replay {clip['id']} ({len(clip['frames'])} frames; full plus four fixed native tiles)", flush=True)
            work = Path(temp)/str(i); work.mkdir()
            rows.append(run_clip(clip, root, work, exe, model, cache["clips"][i] if cache else None))
    after = {name: sha256(HERE/name) for name in CODE}
    if before != after:
        raise ValueError("Output-affecting code changed during replay")
    return {"schemaVersion": 1, "study": "M3J", "dataset": inputs["dataset"], "inputSha256": input_hash,
            "developmentOnly": development, "platform": platform.platform(), "opencv": cv2.__version__,
            "policies": policy_snapshot(),
            "lanes": {"A": "Frozen M3H full detections", "B": "Same frozen M3H class, full plus four native tiles",
                      "C": "Feature ECC, exact A identities", "D": "Feature ECC, exact B identities", "S": "Old full-box diagnostic, not fallback"},
            "detectorProvenance": {"kind": "development-historical-full-plus-fresh-tiles" if cache else "actual-local-CoreML",
                "cacheSha256": sha256(cached_path) if cache else None,
                "fullSampleTimings": "historical, not current execution" if cache else "actual per-exposure model inference",
                "tileSampleTimings": "actual per-exposure four-call inference sum; not batch/model startup wall"},
            "sceneqaSha256": exe_hash, "yoloModelHashes": hashes, "codeSha256": after, "clips": rows,
            "timingScope": "Paired per-exposure product totals include full staging/decode/inference. B/D add actual tile staging, four inference samples and merge. C adds complete A; D adds complete B. Percentiles follow per-exposure sums. Full historical inference remains historical in development. Batch/model-startup wall and whole sequential-study wall are separate, not phone real-time latency."}


def score(receipt, truth, inputs=None):
    finite_payload(receipt); finite_payload(truth)
    if inputs is not None:
        bind_input(receipt, inputs)
        for clip, source in zip(receipt["clips"], inputs["clips"], strict=True):
            for frame, actual in zip(clip["frames"], source["frames"], strict=True):
                if frame.get("sourceSha256") != actual["sha256"]:
                    raise ValueError("Wrong original exposure fingerprint")
    if (receipt.get("schemaVersion") != 1 or receipt.get("study") != "M3J" or truth.get("schemaVersion") != 1
            or receipt["inputSha256"] != truth["inputSha256"]
            or [c["id"] for c in receipt["clips"]] != [c["id"] for c in truth["clips"]]
            or not receipt["clips"] or len({c["id"] for c in receipt["clips"]}) != len(receipt["clips"])):
        raise ValueError("Unbound or incompatible M3J scoring inputs")
    receipt_contract(receipt)
    contract = legacy_score()
    totals = {name: Counter(contract.empty()) for name in LANES}
    rows, all_frames = [], []
    for clip, ref in zip(receipt["clips"], truth["clips"], strict=True):
        frames = clip["frames"]; labels = {f["token"]: f for f in ref["frames"]}
        if (not frames or len(labels) != len(ref["frames"]) or len({f["token"] for f in frames}) != len(frames)
                or not labels.keys() <= {f["token"] for f in frames}):
            raise ValueError("Duplicate/missing exact frame labels")
        stats = {name: contract.empty() for name in LANES}
        statuses = {name: Counter() for name in LANES}
        reasons = {name: Counter() for name in LANES}
        ceilings = {name: Counter() for name in ("full", "tiled")}
        origin, previous = frames[0]["timestampUs"], None
        for i, frame in enumerate(frames):
            stamp, at = frame.get("timestampUs"), frame.get("timeMs")
            if (not set(LANES) <= frame.keys() or type(stamp) is not int or stamp < 0
                    or previous is not None and stamp <= previous or type(at) not in (int, float)
                    or abs(at-(stamp-origin)/1000.) > .000001 or type(frame.get("index")) is not int or frame["index"] != i):
                raise ValueError("Missing lane or invalid exact stream clock")
            previous = stamp; gap = frame.get("detectorGapInjected")
            if type(gap) is not bool or gap and (frame["detections"] or frame["candidateDetections"]):
                raise ValueError("Invalid detector gap record")
            tile_contract(frame)
            known = labels.get(frame["token"])
            if known and known["timestampUs"] != stamp:
                raise ValueError("Reference timestamp does not match exact exposure")
            targets = None if known is None else [{**target, "motion": {"approaching": "moving", "not-approaching": "stationary", "unknown": "unknown"}[target["approach"]]} for target in known["targets"]]
            for target in targets or ():
                for name, key in (("full", "detections"), ("tiled", "candidateDetections")):
                    ceilings[name][target["approach"]] += 1
                    ceilings[name][target["approach"]+".withYolo"] += any(contract.family(d["label"]) == target["classFamily"] and contract.iou(d["box"], target["box"]) >= contract.IOU for d in frame[key])
            for name in LANES:
                lane_contract(frame[name], at, gap)
                if name in {"A", "B"}:
                    cohort_contract(frame[name], at)
                elif name in SOURCES:
                    measurement_contract(frame[name], frame[SOURCES[name]], at, frame=frame, history=frames[:i], source=SOURCES[name])
                contract.score_frame(frame, name, targets, stats[name])
                statuses[name][frame[name]["status"]] += 1
                reasons[name].update(frame[name].get("diagnostics", {}).get("trackReasons", {}).values())
                if ref.get("allSceneNegative"):
                    stats[name]["allSceneFalseNotices"] = stats[name].get("allSceneFalseNotices", 0)+len(frame[name]["events"])
            all_frames.append(frame)
        for name in LANES:
            totals[name].update(stats[name])
        rows.append({"id": clip["id"], "lanes": stats, "statuses": statuses, "trackReasons": reasons,
                     "detectorCeiling": ceilings, "identityLifecycle": {name: lifecycle_summary(frames, name) for name in ("A", "B")}})
    if len(all_frames) > MAX_FRAMES:
        raise ValueError("Frame budget exceeded")
    return {"schemaVersion": 1, "study": "M3J", "dataset": receipt["dataset"], "inputSha256": receipt["inputSha256"],
            "developmentOnly": receipt.get("developmentOnly"), "review": truth.get("review"), "reviewSha256": truth.get("reviewSha256"),
            "unit": "reviewed target-keyframe", "frames": len(all_frames), "noMetreChecks": len(all_frames)*len(LANES),
            "platform": receipt["platform"], "opencv": receipt["opencv"], "codeSha256": receipt["codeSha256"],
            "detectorProvenance": receipt["detectorProvenance"], "sceneqaSha256": receipt.get("sceneqaSha256"),
            "yoloModelHashes": receipt.get("yoloModelHashes"), "totals": totals, "clips": rows,
            "stageMs": _timing_values(all_frames), "timingScope": receipt.get("timingScope"),
            "limits": "Original physical approach labels, unchanged final evidence gates. Projected surface expansion is not universal radial approach, metric distance or TTC. Unknown, unmatched and unreviewed reports separate. No tracker accuracy, phone, real-time or safety acceptance."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    for mode, keys in (("replay", ("input", "sceneqa", "yolo", "output")), ("score", ("input", "truth", "receipt", "output"))):
        sub = modes.add_parser(mode)
        for key in keys:
            sub.add_argument("--"+key, type=Path, required=True)
        if mode == "replay":
            sub.add_argument("--cached-detections", type=Path)
            sub.add_argument("--development-only", action="store_true")
    args = parser.parse_args()
    if args.mode == "replay":
        result = replay(args)
    else:
        receipt = read_json(args.receipt, 64*1024**2); inputs, _ = load_input(args.input)
        if receipt["inputSha256"] != sha256(args.input):
            raise ValueError("Receipt/input byte hash mismatch")
        result = score(receipt, read_json(args.truth, 2*1024**2), inputs)
        result.update(receiptSha256=sha256(args.receipt), truthSha256=sha256(args.truth))
        print(json.dumps(result["totals"], indent=2))
    write_new(args.output, result)
