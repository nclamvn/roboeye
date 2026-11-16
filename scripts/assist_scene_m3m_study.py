#!/usr/bin/env python3
"""M3M shared-global-field study; ground truth is opened only at scoring."""

import argparse
from collections import Counter
from copy import deepcopy
from datetime import date
from hashlib import sha256 as bytes_sha256
from hashlib import sha256 as bytes_sha256
from hashlib import sha256 as bytes_sha256
import json
from pathlib import Path
import platform
import shutil
import tempfile
from time import perf_counter

import cv2
import numpy as np

import assist_scene_m3l_study as previous
import audit_assist_scene_m3k as independent
from assist_scene_motion import parse_detect, sha256
from assist_scene_motion_m3c import load_input
from assist_scene_m3e_study import DROPPED, legacy_score, output, read_frame, write_new
from assist_scene_m3f_study import stage
from assist_scene_m3g_study import DETECTOR_CONFIGURATION, bind_input, finite_payload, lane_contract, model_hashes, _percentiles
from assist_scene_m3h_study import cached_observation, cohort_contract, lifecycle_summary, read_json


HERE = Path(__file__).resolve().parent
LANES = ("A", "B", "C", "S")
MAX_FRAMES = 110
MAX_SECONDS = 1800
MAX_RECEIPT_BYTES = 128*1024**2
CODE = tuple(dict.fromkeys((*previous.CODE, "assist_scene_m3m_study.py",
                           "assist_scene_global_field.py", "assist_scene_global_window.py")))
TIMINGS = ("fullPreparation", "sharedPrep", "workingDecode", "nativeDecode", *LANES)
_require = previous._require


def _deadline(deadline):
    if deadline is not None and perf_counter() > deadline:
        raise TimeoutError("M3M 1800-second replay budget exhausted; partial trial is not complete")


def policy_snapshot():
    from assist_scene_cohort_loom import POLICY as IDENTITY
    from assist_scene_learned_region import POLICY as ROI_FLOW
    from assist_scene_global_field import POLICY as GLOBAL_FLOW
    from assist_scene_global_window import POLICY as GLOBAL_WINDOW
    return json.loads(json.dumps({"identity": dict(IDENTITY), "roiFlow": dict(ROI_FLOW),
                                 "globalFlow": dict(GLOBAL_FLOW), "globalWindow": dict(GLOBAL_WINDOW)}))


def _validate_cache(cache, inputs, input_hash, exe_hash, hashes):
    previous.receipt_contract(cache); bind_input(cache, inputs)
    _require(cache.get("study") == "M3L" and cache.get("developmentOnly") is False
             and sum(len(c["frames"]) for c in cache["clips"]) == 100
             and cache.get("detectorProvenance", {}).get("kind") == "actual-local-CoreML-and-PyTorch"
             and cache.get("inputSha256") == input_hash and cache.get("sceneqaSha256") == exe_hash
             and cache.get("yoloModelHashes") == hashes, "Development requires exact actual 100-exposure M3L observations")
    for source, clip in zip(inputs["clips"], cache["clips"], strict=True):
        history = []; origin = source["frames"][0]["timestampUs"]
        for index, (actual, frame) in enumerate(zip(source["frames"], clip["frames"], strict=True)):
            _require(frame.get("sourceSha256") == actual["sha256"] and frame.get("index") == index
                     and frame.get("timeMs") == (actual["timestampUs"]-origin)/1000., "Historical source/clock/order changed")
            for name in ("A", "B", "S"):
                lane_contract(frame[name], frame["timeMs"], frame["detectorGapInjected"])
                if name != "S": cohort_contract(frame[name], frame["timeMs"])
            previous.track_contract(frame); previous.flow_contract(frame)
            previous.direct_contract(frame, history)
            history.append(frame)
    return cache


def load_cache(path, inputs, input_hash, exe_hash, hashes):
    return _validate_cache(read_json(path, MAX_RECEIPT_BYTES), inputs, input_hash, exe_hash, hashes)


def track_contract(frame):
    view = dict(frame, candidateDetections=frame["detections"])
    for lane in LANES:
        tracks = independent._tracks(view, lane)
        if lane != "C": independent._events(view, lane, tracks)
        else:
            independent._no_range(frame[lane]["tracks"]); independent._no_range(frame[lane]["events"])
    _require(frame["C"]["tracks"] == frame["A"]["tracks"] and frame["C"]["epoch"] == frame["A"]["epoch"]
             and frame["C"].get("diagnostics", {}).get("sourceStatus") == frame["A"]["status"],
             "Global measurement changed current detector handles/camera authority")
    _require(frame["A"]["status"] == "valid" or not frame["C"]["events"], "Global warning bypasses camera veto")


def _box_pixels(exposure, index):
    box = exposure["detections"][index]["box"]; w, h = exposure["width"], exposure["height"]
    return [box["x"]*w, box["y"]*h, (box["x"]+box["width"])*w, (box["y"]+box["height"])*h]


def _eligible_matrix(old, new, policy):
    """Independent geometry-only population; no texture/support pruning."""
    k = np.asarray(new["cameraIntrinsics"], dtype=float)
    rotation = np.asarray(new["cameraToWorld"], dtype=float)[:3, :3].T @ np.asarray(old["cameraToWorld"], dtype=float)[:3, :3]
    homography = k @ rotation @ np.linalg.inv(k)
    rows = []
    for j, current in enumerate(new["detections"]):
        b = np.asarray(_box_pixels(new, j)); choices = []
        for i, prior in enumerate(old["detections"]):
            if prior["label"] != current["label"]: continue
            a = _box_pixels(old, i)
            corners = np.asarray([[a[0], a[1], 1.], [a[2], a[1], 1.], [a[2], a[3], 1.], [a[0], a[3], 1.]]) @ homography.T
            if not np.isfinite(corners).all() or np.any(corners[:, 2] <= 0): continue
            points = corners[:, :2]/corners[:, 2:]
            warped = np.concatenate((np.min(points, axis=0), np.max(points, axis=0)))
            distance = np.linalg.norm((warped[:2]+warped[2:]-b[:2]-b[2:])/2)
            limit = policy["spatialCenterDiagonals"]*max(np.linalg.norm(warped[2:]-warped[:2]), np.linalg.norm(b[2:]-b[:2]))
            if distance <= limit: choices.append(i)
        rows.append(choices)
    return rows


def _score_bounds(pair):
    """Unknown pixel support remains [0,1], never a discarded competitor."""
    bounds = []
    for direction in ("forward", "reverse"):
        value = pair.get(direction)
        if not isinstance(value, dict):
            bounds.append((0., 1.)); continue
        seed, assigned, unknown = (value.get(key) for key in ("seedPoints", "assignedPoints", "unknownPoints"))
        _require(type(seed) is int and seed == 64 and type(assigned) is int and type(unknown) is int
                 and 0 <= assigned <= seed and 0 <= unknown <= seed-assigned, "Invalid fixed-grid assignment denominator")
        bounds.append((assigned/seed, (assigned+unknown)/seed))
    lower, upper = min(v[0] for v in bounds), min(v[1] for v in bounds)
    _require(independent._same(pair.get("scoreLower"), lower) and independent._same(pair.get("scoreUpper"), upper),
             "Pair assignment bounds discard failed or unknown grid points")
    return lower, upper


def _association_contract(pair, origin, current, comparisons, policy):
    start, end = pair["startDetectionIndex"], pair["endDetectionIndex"]
    _require(type(start) is int and 0 <= start < len(origin["detections"]) and type(end) is int and 0 <= end < len(current["detections"]),
             "Pair names nonexistent current detector boxes")
    _require(independent._same(pair.get("startBox"), _box_pixels(origin, start))
             and independent._same(pair.get("endBox"), _box_pixels(current, end)), "Global pair boxes differ from actual detector")
    rows = _eligible_matrix(origin, current, policy)
    raw = [p for p in comparisons if p.get("startToken") == origin["token"]]
    by_index = {(p.get("endDetectionIndex"), p.get("startDetectionIndex")): p for p in raw}
    needed = {(j, i) for j, choices in enumerate(rows) for i in choices}
    _require(len(by_index) == len(raw) and set(by_index) == needed, "Global association omitted or duplicated eligible competition")
    actual = by_index.get((end, start))
    _require(actual is not None and independent._same({k: v for k, v in pair.items() if k != "association"}, actual),
             "Warning pair differs from actual current full-field comparison")
    bounds = {key: _score_bounds(value) for key, value in by_index.items()}
    selected_lower = bounds[end, start][0]
    row_rivals = [bounds[end, i][1] for i in rows[end] if i != start]
    column_rivals = [bounds[j, start][1] for j, choices in enumerate(rows) if start in choices and j != end]
    _require(selected_lower-max(row_rivals, default=0.) >= policy["associationMargin"]
             and selected_lower-max(column_rivals, default=0.) >= policy["associationMargin"],
             "Global association does not beat every row and reciprocal rival upper bound")


def selected_origins(frame, history, policy):
    from assist_scene_scale_approach import _frame_view
    bank, latest, prior, prior_view, epoch = [], None, None, None, None
    for exposure in [*history, frame]:
        source = exposure["A"]
        if source["epoch"] != epoch: bank, latest, prior, prior_view = [], None, None, None
        epoch = source["epoch"]
        raw = {"timestampUs": exposure["timestampUs"], "poseTimestampUs": exposure.get("sourcePoseTimestampUs"),
               "intrinsics": exposure.get("cameraIntrinsics"), "cameraToWorld": exposure.get("cameraToWorld"), "token": exposure["token"]}
        if exposure.get("sourcePoseEpoch") is not None: raw["epoch"] = exposure["sourcePoseEpoch"]
        view, _ = _frame_view(raw, exposure["width"], exposure["height"])
        if (source["status"] not in {"valid", "first-frame"} or view is None
                or abs(exposure["timestampUs"]-exposure["sourcePoseTimestampUs"]) > 20_000
                or not previous.previous._digest(exposure.get("sourceSha256"))):
            bank, latest, prior, prior_view = [], None, None, None
            if exposure is frame: return None, None
            continue
        if prior is not None and (exposure["timeMs"] <= prior["timeMs"] or exposure["timeMs"]-prior["timeMs"] > policy["maxGapMs"]
                or abs((exposure["timeMs"]-prior["timeMs"])-(exposure["timestampUs"]-prior["timestampUs"])/1000.) > 1.
                or exposure["token"] == prior["token"] or view.get("epoch") != prior_view.get("epoch")
                or not np.allclose(view["intrinsics"], prior_view["intrinsics"], atol=1e-4, rtol=1e-6)
                or (exposure["height"], exposure["width"]) != (prior["height"], prior["width"])):
            bank, latest, prior, prior_view = [], None, None, None
            if exposure is frame: return None, None
            continue
        if source["status"] == "first-frame": bank, latest = [], None
        if not exposure["detections"]:
            bank, latest, prior, prior_view = [], None, exposure, view
            if exposure is frame: return None, None
            continue
        bank = [old for old in bank if exposure["timeMs"]-old["timeMs"] <= policy["maxWindowMs"]]
        if exposure is frame:
            eligible = [old for old in bank if policy["minWindowMs"] <= frame["timeMs"]-old["timeMs"] <= policy["maxWindowMs"]]
            if latest is not None and not policy["minFreshMs"] <= frame["timeMs"]-latest["timeMs"] <= policy["maxGapMs"]: latest = None
            return latest, eligible[0] if eligible else None
        if not bank or exposure["timeMs"]-bank[-1]["timeMs"] >= policy["bankCadenceMs"]:
            bank.append(exposure); bank = bank[-policy["maxSparseTimestamps"]:]
        latest, prior, prior_view = exposure, exposure, view
    return None, None


def global_contract(frame, history):
    from assist_scene_global_window import POLICY, validate_surface, validate_pair_proof, validate_comparison, validate_association_proof
    from assist_scene_global_field import geometry
    validate_surface(frame["C"], frame, history)
    surface = frame["C"]; diagnostics = surface.get("diagnostics", {})
    fields, comparisons = diagnostics.get("globalFields"), diagnostics.get("comparisons")
    _require(isinstance(fields, list) and len(fields) <= 2 and isinstance(comparisons, list)
             and len(comparisons) <= POLICY["maxComparisonsPerFrame"], "Missing or unbounded global traces")
    calls = frame.get("flowDirectionCalls", {}).get("C")
    _require(type(calls) is int and calls == len(fields)*2 <= 4, "Global model exceeds or misaccounts shared bidirectional pairs")
    _require(diagnostics.get("cost") == {"globalPairs": len(fields), "globalDirectionCalls": calls, "candidateComparisons": len(comparisons)},
             "Global comparison or model cost was hidden")
    _require(previous.previous._number(diagnostics.get("wallMs")) and diagnostics["wallMs"] <= frame["timingsMs"]["C"]+.001
             and sum(f.get("wallMs", -1) for f in fields) <= diagnostics["wallMs"]+.001, "Global execution omitted actual field cost")
    origins = {}; planned_previous, planned_anchor = selected_origins(frame, history, POLICY)
    expected_geometry = geometry((frame["height"], frame["width"]))
    for field in fields:
        matched = [old for old in history if old["token"] == field.get("startToken") and old["timeMs"] == field.get("startMs")
                   and old["sourceSha256"] == field.get("startSha256")]
        _require(len(matched) == 1, "Global field lacks unique real source exposure")
        old = matched[0]; field_id = old["token"]+"->"+frame["token"]
        _require(field.get("fieldId") == field_id and field_id not in origins and field.get("endToken") == frame["token"]
                 and field.get("endMs") == frame["timeMs"] and field.get("endSha256") == frame["sourceSha256"]
                 and field.get("providerKind") == "actual-local-pretrained-torchvision-global" and field.get("modelDirectionCalls") == 2
                 and field.get("oldWorkingPixelsSha256") == old.get("workingPixelsSha256")
                 and field.get("newWorkingPixelsSha256") == frame.get("workingPixelsSha256")
                 and field.get("fieldShapes") == [[frame["height"], frame["width"], 2]]*2
                 and set(field.get("fieldSha256", {})) == {"forward", "backward"}
                 and all(previous.previous._digest(v) for v in field["fieldSha256"].values()), "Global field has wrong pixels, endpoints or execution")
        provider = field.get("provider", {})
        _require(provider.get("status") == "field-supported" and provider.get("device") == "mps"
                 and provider.get("modelDirectionCalls") == 2 and provider.get("flowUpdatesPerDirection") == 12
                 and all(independent._same(provider.get(key), value) for key, value in expected_geometry.items())
                 and provider.get("outputShape") == [frame["height"], frame["width"], 2]
                 and previous.previous._number(provider.get("wallMs")) and previous.previous._number(field.get("wallMs"))
                 and provider["wallMs"] <= field["wallMs"]+.001, "Invalid global geometry, padding or synchronized provider timing")
        eligible = _eligible_matrix(old, frame, POLICY)
        related = [p for p in comparisons if p.get("fieldId") == field_id]
        actual_indices = [(p.get("endDetectionIndex"), p.get("startDetectionIndex")) for p in related]
        needed = {(j, i) for j, choices in enumerate(eligible) for i in choices}
        _require(len(actual_indices) == len(set(actual_indices)) and set(actual_indices) == needed,
                 "Global trace pruned eligible rivals or duplicated candidates")
        for pair in related:
            validate_comparison(pair); _score_bounds(pair)
            _require(pair.get("startToken") == old["token"] and pair.get("endToken") == frame["token"]
                     and pair.get("startMs") == old["timeMs"] and pair.get("endMs") == frame["timeMs"]
                     and pair.get("startSha256") == old["sourceSha256"] and pair.get("endSha256") == frame["sourceSha256"], "Unbound global comparison")
        origins[field_id] = old
    _require(all(p.get("fieldId") in origins for p in comparisons), "Comparison has no actual shared field")
    expected = [] if planned_previous is None else [planned_previous] + ([planned_anchor] if planned_anchor is not None else [])
    _require([origins[f["fieldId"]]["token"] for f in fields] == [f["token"] for f in expected],
             "Global fields omit planned work or differ from fixed previous/oldest cadence origins")
    for event in surface["events"]:
        proof = diagnostics.get("windowEvidence", {}).get(str(event["trackId"]), {})
        _require(proof.get("confirmed") is True and proof.get("currentToken") == frame["token"] and proof.get("currentMs") == frame["timeMs"], "No current global measurement evidence")
        fresh, anchor = proof.get("fresh"), proof.get("anchor")
        _require(isinstance(fresh, dict) and isinstance(anchor, dict) and planned_previous is not None and planned_anchor is not None, "Missing fresh and oldest anchor measurements")
        for pair, old in ((fresh, planned_previous), (anchor, planned_anchor)):
            validate_pair_proof(pair); validate_association_proof(pair.get("association"))
            _require(pair.get("fieldId") in origins and origins[pair["fieldId"]] is old
                     and pair.get("observationMs") == frame["timeMs"]-old["timeMs"], "Global proof uses wrong source time")
            _association_contract(pair, old, frame, comparisons, POLICY)
            _require(frame["A"]["tracks"][pair["endDetectionIndex"]]["id"] == event["trackId"], "Global proof belongs to another current handle")
            start = history.index(old)
            _require(all(row["A"]["epoch"] == frame["A"]["epoch"] and row["A"]["status"] in ({"valid", "first-frame"} if i == 0 else {"valid"})
                         and not row["detectorGapInjected"] for i, row in enumerate([*history[start:], frame])), "Global window crosses camera veto or epoch")
        lower = anchor["linearLogGrowthLowerBound"]
        _require(len({anchor["startMs"], fresh["startMs"], frame["timeMs"]}) == 3
                 and proof.get("realExposureTokens") == [planned_anchor["token"], planned_previous["token"], frame["token"]]
                 and fresh["linearLogGrowthLowerBound"] >= POLICY["minCurrentLinearGrowth"] and lower >= POLICY["minNetLinearGrowth"]
                 and event.get("linearLogGrowth") == lower and event.get("linearLogGrowthLowerBound") == lower
                 and event.get("logAreaGrowth") == 2*lower and event.get("growthBound") == POLICY["growthBound"]
                 and event.get("observationMs") == anchor["observationMs"], "Warning bypasses current/all-estimator lower growth bound")


def receipt_contract(receipt):
    from assist_scene_learned_region import POLICY as ROI_FLOW
    from assist_scene_global_field import POLICY as GLOBAL_FLOW
    count = sum(len(c["frames"]) for c in receipt["clips"]); development = receipt.get("developmentOnly")
    _require(receipt.get("schemaVersion") == 1 and receipt.get("study") == "M3M" and type(development) is bool
             and 1 <= count <= MAX_FRAMES and (not development or count == 100), "Invalid M3M scope")
    _require(receipt.get("maxWallSeconds") == MAX_SECONDS and previous.previous._number(receipt.get("replayWallMs"))
             and receipt["replayWallMs"] <= MAX_SECONDS*1000, "Missing or exceeded actual replay wall budget")
    _require(receipt.get("device") == "mps" and receipt.get("opencv") == cv2.__version__ and receipt.get("numpy") == np.__version__
             and receipt.get("policies") == policy_snapshot()
             and receipt.get("codeSha256") == {name: sha256(HERE/name) for name in CODE}, "Wrong frozen M3M source/runtime/policies")
    provenance = receipt.get("detectorProvenance", {})
    _require(provenance.get("kind") == ("development-historical-M3L-A-B-S-plus-actual-global" if development else "actual-local-CoreML-and-PyTorch-global")
             and (previous.previous._digest(provenance.get("cacheSha256")) if development else provenance.get("cacheSha256") is None)
             and provenance.get("baselineTimings") == ("historical, not current execution" if development else "actual current execution"),
             "Wrong current/historical execution provenance")
    roi, global_model = receipt.get("roiFlowModel", {}), receipt.get("globalFlowModel", {})
    _require(roi.get("policy") == dict(ROI_FLOW) and roi.get("weightsSha256") == ROI_FLOW["weightSha256"]
             and roi.get("device") == "mps" and roi.get("kind") == "actual-local-pretrained-torchvision"
             and global_model.get("policy") == dict(GLOBAL_FLOW) and global_model.get("weightsSha256") == ROI_FLOW["weightSha256"]
             and global_model.get("device") == "mps" and global_model.get("kind") == "actual-local-pretrained-torchvision-global"
             and global_model.get("algorithm") == GLOBAL_FLOW["algorithm"]
             and global_model.get("modelSharing") == "shared-legacy-provider"
             and global_model.get("counterScope") == "global-wrapper-only-not-legacy-counter"
             and all(global_model.get(k) == roi.get(k) and roi.get(k) for k in ("torch", "torchvision", "weights", "weightUrl")),
             "Wrong shared actual global/ROI model provenance")
    _require(previous.previous._number(receipt.get("sharedModelStartupMs"))
             and previous.previous._digest(receipt.get("sceneqaSha256")) and receipt.get("yoloModelHashes")
             and all(previous.previous._digest(v) for v in receipt["yoloModelHashes"].values()), "Missing model/executable/startup fingerprints")
    for clip in receipt["clips"]:
        size = len(clip["frames"])
        expected_roi = 0 if development else sum(f["flowDirectionCalls"]["B"] for f in clip["frames"])
        expected_global = sum(f["flowDirectionCalls"]["C"] for f in clip["frames"])
        _require(size > 0 and clip.get("detectorConfiguration") == DETECTOR_CONFIGURATION
                 and type(clip.get("detectorCalls")) is int and clip["detectorCalls"] == (0 if development else size)
                 and clip.get("detectorBatches") == (0 if development else (size+49)//50)
                 and clip.get("roiFlowDirectionCalls") == expected_roi and clip.get("globalFlowDirectionCalls") == expected_global
                 and clip.get("actualFlowDirectionCalls") == expected_roi+expected_global
                 and expected_global <= size*4, "Wrong actual detector/global/ROI call accounting")
        _require((development and clip.get("detectorBatchWallMs") is None) or (not development and previous.previous._number(clip.get("detectorBatchWallMs"))),
                 "Wrong actual or historical detector batch wall")
        _require(all(previous.previous._number(clip.get(key)) for key in ("stageWallMs", "studyWallMs")), "Missing actual execution wall")


def _timing_values(frames):
    for frame in frames:
        _require(all(previous.previous._number(frame.get("timingsMs", {}).get(key)) for key in TIMINGS)
                 and previous.previous._number(frame.get("detectorObservationMs")), "Missing per-exposure operation timing")
    result = {key: _percentiles([f["timingsMs"][key] for f in frames]) for key in TIMINGS}
    for lane in LANES:
        dependencies = ("fullPreparation", "sharedPrep", "A", "C") if lane == "C" else ("fullPreparation", "sharedPrep", lane)
        result[lane+"PairedProduct"] = _percentiles([f["detectorObservationMs"]+sum(f["timingsMs"][k] for k in dependencies) for f in frames])
    return result


def run_clip(clip, root, work, exe, model, global_provider, roi_provider=None, cached=None, deadline=None):
    _deadline(deadline)
    from assist_scene_cohort_loom import CohortWindowLoom
    from assist_scene_learned_region import LearnedCohortWindowLoom
    from assist_scene_global_window import GlobalWindowMotion
    from assist_scene_m3d_study import BoxBaseline
    _deadline(deadline); started = perf_counter(); frames, samples, shapes, preparation = [], [], [], []
    origin = clip["frames"][0]["timestampUs"]
    for index, source in enumerate(clip["frames"]):
        _deadline(deadline); tick = perf_counter(); folder = work/str(index); folder.mkdir()
        staged, selected, dimensions = stage({"frames": [source]}, root, folder)
        frames.extend(staged); samples.append((index, (source["timestampUs"]-origin)/1000., selected[0][2])); shapes.extend(dimensions)
        preparation.append(1000*(perf_counter()-tick))
    staging_wall = 1000*(perf_counter()-started)
    found, batch_wall, batches = ({}, None, 0) if cached else previous.previous._detect_batched(samples, exe, model)
    engines = {"C": GlobalWindowMotion(global_provider)}
    if cached is None: engines.update(A=CohortWindowLoom(), B=LearnedCohortWindowLoom(roi_provider), S=BoxBaseline())
    rows = []
    for index, frame in enumerate(frames):
        _deadline(deadline); h, w, nh, nw = shapes[index]
        tick = perf_counter(); gray = read_frame(samples[index][2], cv2.IMREAD_GRAYSCALE); working_decode = 1000*(perf_counter()-tick)
        tick = perf_counter(); native = previous.previous._read_native(root/frame["path"], frame["sha256"])
        native_gray = cv2.cvtColor(native, cv2.COLOR_BGR2GRAY); native_decode = 1000*(perf_counter()-tick)
        _require(gray.shape == (h, w) and native_gray.shape == (nh, nw), "Wrong bound source geometry")
        at, gap = samples[index][1], index in DROPPED.get(clip["id"], ())
        if cached:
            old = cached["frames"][index]; boxes, detector_ms = cached_observation(old, w, h, nw, nh); observation = None
        else:
            found_at, observation = found[index]; _require(found_at == at, "Wrong exact detector clock")
            boxes = [] if gap else parse_detect(observation, w, h); detector_ms = observation["detectionMs"]
        row = {"token": frame["token"], "timestampUs": frame["timestampUs"], "timeMs": at, "index": index,
            "sourceSha256": frame["sha256"], "width": w, "height": h, "nativeWidth": nw, "nativeHeight": nh,
            "cameraIntrinsics": np.asarray(frame["intrinsics"]).tolist() if frame.get("intrinsics") is not None else None,
            "cameraToWorld": np.asarray(frame["cameraToWorld"]).tolist() if frame.get("cameraToWorld") is not None else None,
            "detectorGapInjected": gap, "detections": [b.record(w, h) for b in boxes], "oldObservation": observation,
            "detectorObservationMs": detector_ms, "learnedFlow": {}, "flowDirectionCalls": {},
            "workingPixelsSha256": bytes_sha256(gray.tobytes()).hexdigest(),
            "sourcePoseTimestampUs": frame.get("poseTimestampUs"), "sourcePoseEpoch": frame.get("epoch"),
            "timingsMs": {"fullPreparation": preparation[index], "sharedPrep": working_decode+native_decode,
                          "workingDecode": working_decode, "nativeDecode": native_decode}}
        if cached:
            for lane in ("A", "B", "S"):
                row[lane] = deepcopy(old[lane]); row["timingsMs"][lane] = old["timingsMs"][lane]
            row["learnedFlow"]["B"] = deepcopy(old["learnedFlow"]["B"]); row["flowDirectionCalls"]["B"] = old["flowDirectionCalls"]["B"]
        else:
            for lane in ("A", "B", "S"):
                cv2.setRNGSeed(650500+index); before = roi_provider.direction_calls; tick = perf_counter()
                state = engines[lane].update(frame, at, gray, boxes, native_gray=native_gray) if lane != "S" else engines[lane].update(frame, at, gray, boxes)
                row[lane] = output(state, at); row["timingsMs"][lane] = 1000*(perf_counter()-tick)
                if lane == "B":
                    row["learnedFlow"][lane] = [dict(r, token=frame["token"], timeMs=at, sourceSha256=frame["sha256"]) for r in engines[lane].drain_trace()]
                    row["flowDirectionCalls"][lane] = roi_provider.direction_calls-before
        cv2.setRNGSeed(650500+index); before = global_provider.direction_calls; tick = perf_counter()
        row["C"] = output(engines["C"].update(frame, at, gray, boxes, native_gray=native_gray, camera_surface=row["A"]), at)
        row["timingsMs"]["C"] = 1000*(perf_counter()-tick); row["flowDirectionCalls"]["C"] = global_provider.direction_calls-before
        for lane in LANES:
            lane_contract(row[lane], at, gap)
            if lane in ("A", "B"): cohort_contract(row[lane], at)
        track_contract(row); previous.flow_contract(row); global_contract(row, rows)
        rows.append(row); _deadline(deadline)
    roi_calls = 0 if cached else sum(f["flowDirectionCalls"]["B"] for f in rows)
    global_calls = sum(f["flowDirectionCalls"]["C"] for f in rows)
    return {"id": clip["id"], "detectorConfiguration": DETECTOR_CONFIGURATION, "detectorCalls": 0 if cached else len(samples),
        "detectorBatches": batches, "detectorBatchWallMs": batch_wall, "roiFlowDirectionCalls": roi_calls,
        "globalFlowDirectionCalls": global_calls, "actualFlowDirectionCalls": roi_calls+global_calls,
        "stageWallMs": staging_wall, "studyWallMs": 1000*(perf_counter()-started), "frames": rows}


def replay(args):
    started = perf_counter(); deadline = started+MAX_SECONDS
    inputs, root = load_input(args.input); count = sum(len(c["frames"]) for c in inputs["clips"])
    _require(inputs["dataset"] in {"Boreas-real", "synthetic-m3c"} and 1 <= count <= MAX_FRAMES, "Invalid input/frame budget")
    _require(not args.output.exists() and not args.output.is_symlink(), "Choose a new receipt path")
    _require(shutil.disk_usage(args.output.parent).free >= 10*1024**3, "Less than 10 GB free")
    development, cache_path = bool(args.development_only), args.cached_observations
    _require(bool(cache_path) == development and (not development or count == 100), "Development requires both flags and exact M3L100 exposure suite")
    _require(args.device == "mps", "Same explicit Mac MPS execution only; no fallback")
    exe, model = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    input_hash, exe_hash, hashes = sha256(args.input), sha256(exe), model_hashes(model)
    cached = load_cache(cache_path, inputs, input_hash, exe_hash, hashes) if cache_path else None
    cache_hash = sha256(cache_path) if cached else None
    expected_sources = {clip["id"]+":"+frame["token"]: frame["sha256"] for clip in inputs["clips"] for frame in clip["frames"]}
    source_before = {clip["id"]+":"+frame["token"]: sha256(root/frame["path"]) for clip in inputs["clips"] for frame in clip["frames"]}
    _require(source_before == expected_sources, "Original source bytes changed before replay")
    before = {name: sha256(HERE/name) for name in CODE}; _deadline(deadline)
    from assist_scene_learned_region import TorchvisionRaftSmall
    from assist_scene_global_field import GlobalRaftSmall
    tick = perf_counter(); roi = TorchvisionRaftSmall(args.flow_weights, device=args.device)
    global_flow = GlobalRaftSmall.from_provider(roi); startup = 1000*(perf_counter()-tick)
    _require(not cached or dict(roi.metadata) == cached["learnedFlowModel"], "Historical baseline uses different checkpoint/library/device metadata")
    cv2.setNumThreads(1); clips = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3m-{date.today():%Y%m%d}-", dir=args.output.parent) as folder:
        for index, clip in enumerate(inputs["clips"]):
            _deadline(deadline); work = Path(folder)/str(index); work.mkdir()
            print(f"Replay {clip['id']} ({len(clip['frames'])} exposures; global M3M)", flush=True)
            clips.append(run_clip(clip, root, work, exe, model, global_flow, roi, cached["clips"][index] if cached else None, deadline))
    after = {name: sha256(HERE/name) for name in CODE}
    source_after = {clip["id"]+":"+frame["token"]: sha256(root/frame["path"]) for clip in inputs["clips"] for frame in clip["frames"]}
    _require(before == after and sha256(args.input) == input_hash and source_after == source_before
             and sha256(exe) == exe_hash and model_hashes(model) == hashes
             and sha256(args.flow_weights) == global_flow.metadata["weightsSha256"]
             and (not cached or sha256(cache_path) == cache_hash), "Source/input/model/executable/cache changed during replay")
    _require(sum(c["globalFlowDirectionCalls"] for c in clips) == global_flow.direction_calls
             and sum(c["roiFlowDirectionCalls"] for c in clips) == roi.direction_calls, "Model call counters do not match actual execution")
    result = {"schemaVersion": 1, "study": "M3M", "dataset": inputs["dataset"], "inputSha256": input_hash,
        "developmentOnly": development, "device": args.device, "platform": platform.platform(), "opencv": cv2.__version__, "numpy": np.__version__,
        "policies": policy_snapshot(), "codeSha256": after, "maxWallSeconds": MAX_SECONDS, "replayWallMs": 1000*(perf_counter()-started),
        "lanes": {"A": "old YOLO+frozen DIS", "B": "same old YOLO+frozen ROI-RAFT", "C": "same old YOLO+shared full-frame correspondence", "S": "old box diagnostic, not fallback"},
        "detectorProvenance": {"kind": "development-historical-M3L-A-B-S-plus-actual-global" if cached else "actual-local-CoreML-and-PyTorch-global",
            "cacheSha256": cache_hash, "baselineTimings": "historical, not current execution" if cached else "actual current execution"},
        "sceneqaSha256": exe_hash, "yoloModelHashes": hashes, "roiFlowModel": dict(roi.metadata), "globalFlowModel": dict(global_flow.metadata),
        "sharedModelStartupMs": startup, "clips": clips,
        "sourceSha256Before": source_before, "sourceSha256After": source_after,
        "timingScope": "A/B/S and detector samples are historical in development, not newly executed. C is actual global measurement and consumes A camera/handles, so paired C totals include A+C+shared prep/staging+old detector perform sample before percentiles. Fresh baselines execute normally. B already contains ROI flow; C already contains shared global flow; neither flow is added twice. CoreML perform-only samples make paired totals lower bounds. One shared checkpoint startup is separate. No phone or real-time claim."}
    receipt_contract(result)
    return result


def score(receipt, truth, inputs=None, cache=None):
    finite_payload(receipt); finite_payload(truth); receipt_contract(receipt)
    if inputs is not None:
        bind_input(receipt, inputs)
        for clip, source in zip(receipt["clips"], inputs["clips"], strict=True):
            for frame, actual in zip(clip["frames"], source["frames"], strict=True):
                expected = np.diag((frame["width"]/frame["nativeWidth"], frame["height"]/frame["nativeHeight"], 1.)) @ np.asarray(actual["intrinsics"])
                _require(frame["sourceSha256"] == actual["sha256"] and independent._same(frame["cameraIntrinsics"], expected.tolist())
                         and independent._same(frame["cameraToWorld"], actual["cameraToWorld"])
                         and frame.get("sourcePoseTimestampUs") == actual.get("poseTimestampUs")
                         and frame.get("sourcePoseEpoch") == actual.get("epoch"), "Wrong source fingerprint/camera geometry/pose clock")
    _require(truth.get("schemaVersion") == 1 and truth.get("inputSha256") == receipt["inputSha256"]
             and [c["id"] for c in truth["clips"]] == [c["id"] for c in receipt["clips"]], "Unbound reviewed truth")
    _require(not receipt["developmentOnly"] or cache is not None, "Development scoring requires exact original baseline cache")
    if cache is not None:
        _require(inputs is not None, "Historical cache requires original runtime manifest")
        _validate_cache(cache, inputs, receipt["inputSha256"], receipt["sceneqaSha256"], receipt["yoloModelHashes"])
    contract = legacy_score(); totals = {lane: Counter(contract.empty()) for lane in LANES}; clips = []; all_frames = []
    for ci, (clip, ref) in enumerate(zip(receipt["clips"], truth["clips"], strict=True)):
        frames = clip["frames"]; labels = {f["token"]: f for f in ref["frames"]}; history = []; origin = frames[0]["timestampUs"]; last = None
        _require(len(labels) == len(ref["frames"]) and len({f["token"] for f in frames}) == len(frames) and labels.keys() <= {f["token"] for f in frames}, "Duplicate/missing exact reviewed frame")
        stats = {lane: contract.empty() for lane in LANES}
        for index, frame in enumerate(frames):
            stamp, at = frame["timestampUs"], frame["timeMs"]
            _require(type(stamp) is int and stamp >= 0 and (last is None or stamp > last)
                     and previous.previous._number(at) and abs(at-(stamp-origin)/1000.) < 1e-6 and type(frame["index"]) is int and frame["index"] == index,
                     "Wrong exact stream clock/order")
            last = stamp; gap = frame.get("detectorGapInjected")
            _require(type(gap) is bool and gap == (index in DROPPED.get(clip["id"], ())) and (not gap or not frame["detections"]), "Wrong deterministic gap")
            if receipt["developmentOnly"]:
                old = cache["clips"][ci]["frames"][index]
                _require(all(independent._same(frame[k], old[k]) for k in ("token", "timestampUs", "timeMs", "sourceSha256", "detections"))
                         and all(independent._same(frame[lane], old[lane]) for lane in ("A", "B", "S"))
                         and frame["detectorObservationMs"] == old["detectorObservationMs"]
                         and frame["learnedFlow"]["B"] == old["learnedFlow"]["B"]
                         and frame["flowDirectionCalls"]["B"] == old["flowDirectionCalls"]["B"]
                         and all(frame["timingsMs"][lane] == old["timingsMs"][lane] for lane in ("A", "B", "S")), "Historical baseline surface or timing changed")
            else:
                observation = frame.get("oldObservation")
                _require(isinstance(observation, dict) and observation.get("detectionMs") == frame["detectorObservationMs"], "Missing actual old detector report")
                expected = [] if gap else [b.record(frame["width"], frame["height"]) for b in parse_detect(observation, frame["width"], frame["height"])]
                _require(frame["detections"] == expected, "Current boxes differ from raw actual detections")
            for lane in LANES:
                lane_contract(frame[lane], at, gap)
                if lane in ("A", "B"): cohort_contract(frame[lane], at)
            track_contract(frame); previous.flow_contract(frame); global_contract(frame, history)
            known = labels.get(frame["token"]); _require(known is None or known["timestampUs"] == stamp, "Wrong reviewed exposure clock")
            targets = None if known is None else [{**t, "motion": {"approaching": "moving", "not-approaching": "stationary", "unknown": "unknown"}[t["approach"]]} for t in known["targets"]]
            for lane in LANES:
                contract.score_frame(frame, lane, targets, stats[lane])
                if ref.get("allSceneNegative"): stats[lane]["allSceneFalseNotices"] = stats[lane].get("allSceneFalseNotices", 0)+len(frame[lane]["events"])
            history.append(frame); all_frames.append(frame)
        for lane in LANES: totals[lane].update(stats[lane])
        clips.append({"id": clip["id"], "lanes": stats, "identityLifecycle": {lane: lifecycle_summary(frames, lane) for lane in ("A", "B")}})
    return {"schemaVersion": 1, "study": "M3M", "dataset": receipt["dataset"], "inputSha256": receipt["inputSha256"],
        "developmentOnly": receipt["developmentOnly"], "frames": len(all_frames), "unit": "reviewed target-keyframe", "noMetreChecks": len(all_frames)*len(LANES),
        "totals": totals, "clips": clips, "stageMs": _timing_values(all_frames), "codeSha256": receipt["codeSha256"],
        "detectorProvenance": receipt["detectorProvenance"], "roiFlowModel": receipt["roiFlowModel"], "globalFlowModel": receipt["globalFlowModel"],
        "timingScope": receipt["timingScope"], "limits": "Physical approach labels unchanged; optical scale is not metric range or universal radial approach. Unknown/unmatched/unreviewed reports remain separate. Development is historical, not unseen evidence. No phone, real-time, safety or commercial acceptance."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); modes = parser.add_subparsers(dest="mode", required=True)
    for mode, keys in (("replay", ("input", "sceneqa", "yolo", "flow-weights", "output")), ("score", ("input", "truth", "receipt", "output"))):
        sub = modes.add_parser(mode)
        for key in keys: sub.add_argument("--"+key, type=Path, required=True)
        sub.add_argument("--cached-observations", type=Path)
        if mode == "replay":
            sub.add_argument("--development-only", action="store_true"); sub.add_argument("--device", choices=("mps",), required=True)
    args = parser.parse_args()
    if args.mode == "replay": result = replay(args)
    else:
        receipt = read_json(args.receipt, MAX_RECEIPT_BYTES); inputs = read_json(args.input)
        _require(receipt["inputSha256"] == sha256(args.input), "Receipt/input byte hash mismatch")
        cache = read_json(args.cached_observations, MAX_RECEIPT_BYTES) if args.cached_observations else None
        _require(not receipt["developmentOnly"] or args.cached_observations and sha256(args.cached_observations) == receipt["detectorProvenance"]["cacheSha256"], "Wrong original baseline cache bytes")
        result = score(receipt, read_json(args.truth, 2*1024**2), inputs, cache)
        result.update(receiptSha256=sha256(args.receipt), truthSha256=sha256(args.truth)); print(json.dumps(result["totals"], indent=2))
    write_new(args.output, result)
