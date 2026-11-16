#!/usr/bin/env python3
"""M3N source-texture selection and raw/warped photometric ablation.

The model executes separately for every actual lane. No truth is opened by
replay; historical A/T/S samples in development never count as new execution.
"""

import argparse
from collections import Counter
from copy import deepcopy
from datetime import date
from hashlib import sha256 as content_sha256
import json
from pathlib import Path
import platform
import shutil
import sys
import tempfile
from time import perf_counter

import cv2
import numpy as np

import assist_scene_m3m_study as old
import audit_assist_scene_m3k as audit
from assist_scene_motion import sha256, parse_detect
from assist_scene_motion_m3c import load_input
from assist_scene_m3e_study import output, read_frame, write_new, DROPPED, legacy_score
from assist_scene_m3f_study import stage
from assist_scene_m3g_study import bind_input, lane_contract, finite_payload, model_hashes, DETECTOR_CONFIGURATION, _percentiles
from assist_scene_m3h_study import cached_observation, cohort_contract, read_json


HERE = Path(__file__).resolve().parent
LANES = ("A", "B", "C", "S")
GLOBAL_LANES = ("A", "B", "C")
SURFACES = ("T", *LANES)
MAX_FRAMES, MAX_SECONDS, MAX_BYTES = 110, 1800, 256*1024**2
CODE = tuple(dict.fromkeys((*old.CODE, "assist_scene_m3n_study.py", "assist_scene_texture_patches.py", "assist_scene_textured_window.py")))
_require, _number, _digest = old._require, old.previous.previous._number, old.previous.previous._digest


def policy_snapshot():
    from assist_scene_cohort_loom import POLICY as CAMERA
    from assist_scene_global_field import POLICY as FIELD
    from assist_scene_global_window import POLICY as UNIFORM
    from assist_scene_textured_window import POLICY as TEXTURED
    from assist_scene_texture_patches import POLICY as PATCH
    keys = ("minPoints", "minSupport", "minCorrelation", "maxFlowFbPx", "maxAnisotropyLog", "maxRotationDeg", "maxLinearLogGrowth", "maxBoxLogDisagreement", "minNetLinearGrowth", "minCurrentLinearGrowth", "maxEstimatorLogGrowthSpan", "associationMargin")
    _require(all(TEXTURED[k] == UNIFORM[k] for k in keys), "M3N changes frozen geometry/support/growth floors")
    return json.loads(json.dumps({"camera": dict(CAMERA), "field": dict(FIELD), "uniform": dict(UNIFORM), "textured": dict(TEXTURED), "patch": dict(PATCH)}))


def _view(frame, lane):
    return {**frame, "A": frame["T"], "C": frame[lane], "flowDirectionCalls": {"C": frame["flowDirectionCalls"][lane]},
            "timingsMs": {**frame["timingsMs"], "A": frame["timingsMs"]["T"], "C": frame["timingsMs"][lane]}}


def validate_cache(cache, inputs, input_hash, exe_hash, hashes):
    old.receipt_contract(cache); bind_input(cache, inputs)
    _require(cache.get("study") == "M3M" and cache.get("developmentOnly") is False
             and sum(len(c["frames"]) for c in cache["clips"]) == 100 and cache["inputSha256"] == input_hash
             and cache["sceneqaSha256"] == exe_hash and cache["yoloModelHashes"] == hashes,
             "Development requires exact actual M3M100 cache")
    for source, clip in zip(inputs["clips"], cache["clips"], strict=True):
        history = []; origin = source["frames"][0]["timestampUs"]
        for index, (actual, frame) in enumerate(zip(source["frames"], clip["frames"], strict=True)):
            _require(frame["sourceSha256"] == actual["sha256"] and frame["index"] == index
                     and frame["timeMs"] == (actual["timestampUs"]-origin)/1000.
                     and frame["detectorGapInjected"] == (index in DROPPED.get(clip["id"], ())), "Historical source/clock/gap changed")
            observation = frame["oldObservation"]
            expected = [] if frame["detectorGapInjected"] else [b.record(frame["width"], frame["height"]) for b in parse_detect(observation, frame["width"], frame["height"])]
            _require(frame["detections"] == expected and frame["detectorObservationMs"] == observation["detectionMs"], "Historical detector boxes/timing changed")
            old.track_contract(frame); old.global_contract(frame, history)
            for name in ("A", "C", "S"): lane_contract(frame[name], frame["timeMs"], frame["detectorGapInjected"])
            cohort_contract(frame["A"], frame["timeMs"]); history.append(frame)
    return cache


def load_cache(path, inputs, input_hash, exe_hash, hashes):
    return validate_cache(read_json(path, old.MAX_RECEIPT_BYTES), inputs, input_hash, exe_hash, hashes)


def canonical_hash(value):
    return content_sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def historical_contract(frame, prior):
    _require(all(audit._same(frame[k], prior[k]) for k in ("token", "timestampUs", "timeMs", "sourceSha256", "detections", "detectorObservationMs", "workingPixelsSha256"))
             and all(frame[new] == prior[src] and frame["timingsMs"][new] == prior["timingsMs"][src] for new, src in (("T", "A"), ("A", "C"), ("S", "S")))
             and frame["flowDirectionCalls"]["A"] == prior["flowDirectionCalls"]["C"], "Historical baseline proof/cost changed")


def write_result(path, result, *, compact=False):
    if not compact:
        write_new(path, result); return
    data = json.dumps(result, separators=(",", ":"), allow_nan=False).encode()
    _require(len(data) <= MAX_BYTES, "M3N receipt exceeds declared 256 MiB bound")
    _require(not path.is_symlink(), "Output symlink forbidden")
    with path.open("xb") as stream: stream.write(data)


def track_contract(frame):
    _require(_digest(frame.get("workingPixelsSha256")), "Missing actual working-pixel fingerprint")
    for name in SURFACES:
        surface = frame[name]; lane_contract(surface, frame["timeMs"], frame["detectorGapInjected"])
        view = {**frame, "candidateDetections": frame["detections"]}
        audit._tracks(view, name); audit._no_range({k: v for k, v in surface.items() if k != "answers"})
        if name in GLOBAL_LANES:
            _require(surface["tracks"] == frame["T"]["tracks"] and surface["epoch"] == frame["T"]["epoch"]
                     and surface.get("diagnostics", {}).get("sourceStatus") == frame["T"]["status"], "Measurement changed current camera handles")
            _require(frame["T"]["status"] == "valid" or not surface["events"], "Current camera veto bypassed")
    cohort_contract(frame["T"], frame["timeMs"])


def _bounds(pair):
    values = []
    for name in ("forward", "reverse"):
        proof = pair[name]; n = proof["seedPoints"]
        _require(type(n) is int and 0 <= n <= 64, "Invalid original selected seed count")
        assigned, unknown, verified, points = (proof[k] for k in ("assignedPoints", "unknownPoints", "verifiedPoints", "points"))
        _require(all(type(v) is int and 0 <= v <= n for v in (assigned, unknown, verified, points))
                 and points <= assigned <= verified and verified+unknown == n, "Failed selected points were removed from denominator")
        values.append((0., 1.) if n < 9 else (assigned/n, (assigned+unknown)/n))
    lower, upper = (0., 1.) if pair.get("unverifiable") is True else (min(v[0] for v in values), min(v[1] for v in values))
    _require(audit._same(pair["scoreLower"], lower) and audit._same(pair["scoreUpper"], upper), "Unknown/failed selected seeds vanished from rival bounds")
    return lower, upper


def direction_contract(proof, population, source, target, source_box, target_box, policy):
    """Reconstruct assignment and retained affine support, not engine assertions."""
    if population["status"] != "measured": return
    records = population["points"]; n = len(records)
    points = np.asarray(population["selection"]["points"], np.float32)
    destination = np.asarray([p["destinationPoint"] if p["destinationPoint"] is not None else [np.nan, np.nan] for p in records], np.float32)
    good = np.asarray([p["good"] for p in records], bool)
    box = np.asarray(target_box, float); lo, hi = box[:2], box[2:]; border = .04*(hi-lo)
    assigned = good & ((lo+border <= destination) & (destination <= hi-border)).all(axis=1)
    _require(proof["assignedPoints"] == int(assigned.sum()) and proof["verifiedPoints"] == int(good.sum())
             and proof["unknownPoints"] == n-int(good.sum()), "Assignment differs from retained point coordinates")
    k = np.asarray(target["cameraIntrinsics"], float)
    rotation = np.asarray(target["cameraToWorld"], float)[:3, :3].T @ np.asarray(source["cameraToWorld"], float)[:3, :3]
    homography = k @ rotation @ np.linalg.inv(k)
    _require(audit._same(proof.get("rotationHomography"), homography.tolist()), "Affine proof uses wrong camera rotation")
    if "affine" not in proof:
        _require(proof["points"] == 0, "Inliers without retained affine")
        return
    indices = proof.get("inlierIndices", [])
    _require(isinstance(indices, list) and len(indices) == proof["points"] and indices == sorted(set(indices))
             and all(type(i) is int and 0 <= i < n and assigned[i] for i in indices), "Affine inlier indices dropped or invented source points")
    if not indices: return
    transformed = np.column_stack((points, np.ones(n))) @ homography.T
    transformed = transformed[:, :2]/transformed[:, 2:]
    matrix = np.asarray(proof["affine"], float)
    _require(matrix.shape == (2, 3) and np.isfinite(matrix).all(), "Malformed retained affine")
    residuals = np.linalg.norm(transformed@matrix[:, :2].T+matrix[:, 2]-destination, axis=1)
    _require(np.isfinite(residuals[indices]).all() and max(residuals[indices]) <= policy["ransacThresholdPx"]+1e-8, "Retained affine contradicts actual selected endpoints")
    spreads = []
    for coordinates, rect in ((points[indices], source_box), (destination[indices], target_box)):
        size = np.asarray(rect[2:])-rect[:2]
        spreads.append({"span": (np.ptp(coordinates, axis=0)/size).tolist(),
            "hull": float(cv2.contourArea(cv2.convexHull(coordinates.astype(np.float32)))/np.prod(size))})
    if "spread" in proof: _require(audit._same(proof["spread"], spreads), "Spread does not belong to actual affine inliers")
    if not proof.get("supported"): return
    singular = np.linalg.svd(matrix[:, :2], compute_uv=False); determinant = float(np.linalg.det(matrix[:, :2]))
    _require(determinant > 0 and abs(.5*np.log(determinant)) <= policy["maxLinearLogGrowth"]
             and np.log(singular[0]/singular[-1]) <= policy["maxAnisotropyLog"]
             and abs(np.degrees(np.arctan2(matrix[1, 0], matrix[0, 0]))) <= policy["maxRotationDeg"]
             and len(indices) >= max(policy["minPoints"], policy["minSupport"]*n)
             and all(min(s["span"]) >= policy["minSpan"] and s["hull"] >= policy["minHull"] for s in spreads), "Actual retained support violates unchanged geometry floor")
    rect = source_box; corners = np.asarray([[rect[0], rect[1], 1.], [rect[2], rect[1], 1.], [rect[2], rect[3], 1.], [rect[0], rect[3], 1.]]) @ homography.T
    corners = corners[:, :2]/corners[:, 2:]; warped = np.r_[corners.min(axis=0), corners.max(axis=0)]
    linear = float(.5*np.log(determinant)); box_growth = float(np.mean(np.log((box[2:]-box[:2])/(warped[2:]-warped[:2]))))
    center_error = float(np.linalg.norm(matrix[:, :2]@((warped[:2]+warped[2:])/2)+matrix[:, 2]-(lo+hi)/2))
    _require(audit._same(proof["linearLogGrowth"], linear) and audit._same(proof["boxLogGrowth"], box_growth)
             and audit._same(proof["centerErrorPx"], center_error)
             and audit._same(proof["maxSupportedCyclePx"], max(records[i]["centerCyclePx"] for i in indices))
             and audit._same(proof["maxSupportedFitResidualPx"], float(max(residuals[indices])))
             and abs(box_growth-linear) <= policy["maxBoxLogDisagreement"]
             and center_error <= max(2., policy["maxCenterFraction"]*min(hi-lo)), "Actual affine geometry/cycle/box evidence differs from proof")


def global_contract(frame, history, lane):
    if lane == "A":
        old.global_contract(_view(frame, lane), [_view(f, lane) for f in history]); return
    from assist_scene_textured_window import POLICY, validate_comparison, validate_pair_proof
    from assist_scene_texture_patches import validate_population, validate_selection
    from assist_scene_global_field import geometry
    surface = frame[lane]; diag = surface["diagnostics"]; fields, comparisons = diag["globalFields"], diag["comparisons"]
    _require(surface.get("mode", diag.get("mode")) == ("raw" if lane == "B" else "warped"), "Wrong photometric ablation mode")
    mapped, previous_rows = _view(frame, lane), [_view(f, lane) for f in history]
    fresh, anchor = old.selected_origins(mapped, previous_rows, POLICY)
    planned = [] if fresh is None else [fresh]+([] if anchor is None else [anchor])
    _require(isinstance(fields, list) and len(fields) <= 2 and frame["flowDirectionCalls"][lane] == len(fields)*2
             and [f["startToken"] for f in fields] == [f["token"] for f in planned], "Missing or wrong planned full-frame calls")
    _require(diag["cost"] == {"globalPairs": len(fields), "globalDirectionCalls": len(fields)*2, "candidateComparisons": len(comparisons)}, "Global call/comparison accounting differs")
    _require(_number(diag.get("wallMs")) and diag["wallMs"] <= frame["timingsMs"][lane]+.001
             and sum(f.get("wallMs", -1) for f in fields) <= diag["wallMs"]+.001, "Actual field cost omitted")
    catalog = diag.get("populations", [])
    _require(isinstance(catalog, list) and len(catalog) <= 48, "Missing or unbounded population catalog")
    populations = {p["populationId"]: p for p in catalog}
    _require(len(populations) == len(catalog), "Duplicated population catalog")
    expected_population_ids = set()
    inventory = diag.get("sourceSelections", {})
    _require(diag.get("sourceSelectionBeforeCorrespondence") is True and inventory.get("sourceToken") == frame["token"]
             and inventory.get("sourceMs") == frame["timeMs"] and inventory.get("sourceSha256") == frame["sourceSha256"]
             and inventory.get("workingPixelsSha256") == frame["workingPixelsSha256"]
             and len(inventory.get("selections", [])) == len(frame["detections"])
             and inventory.get("selectionSha256s") == [canonical_hash(s) for s in inventory["selections"]], "Current source inventory was not sealed before correspondence")
    for index, selection in enumerate(inventory["selections"]):
        validate_selection(selection)
        _require(selection["sourceSha256"] == frame["workingPixelsSha256"] and selection["sourceShape"] == [frame["height"], frame["width"]]
                 and audit._same(selection["sourceBox"], old._box_pixels(frame, index)), "Source selector used another current image or box")
    by_field = {}
    for field, origin in zip(fields, planned, strict=True):
        fid = origin["token"]+"->"+frame["token"]
        _require(field["fieldId"] == fid and fid not in by_field and field["startMs"] == origin["timeMs"]
                 and field["endMs"] == frame["timeMs"] and field["endToken"] == frame["token"]
                 and field["startSha256"] == origin["sourceSha256"] and field["endSha256"] == frame["sourceSha256"]
                 and field["oldWorkingPixelsSha256"] == origin["workingPixelsSha256"]
                 and field["newWorkingPixelsSha256"] == frame["workingPixelsSha256"], "Wrong global source pixels or media clock")
        provider = field.get("provider", {})
        _require(field.get("providerKind") == "actual-local-pretrained-torchvision-global" and field.get("modelDirectionCalls") == 2
                 and field.get("fieldShapes") == [[frame["height"], frame["width"], 2]]*2
                 and set(field.get("fieldSha256", {})) == {"forward", "backward"} and all(_digest(v) for v in field["fieldSha256"].values())
                 and provider.get("status") == "field-supported" and provider.get("device") == "mps"
                 and provider.get("modelDirectionCalls") == 2 and provider.get("flowUpdatesPerDirection") == 12
                 and all(audit._same(provider.get(k), v) for k, v in geometry((frame["height"], frame["width"])).items())
                 and provider.get("outputShape") == [frame["height"], frame["width"], 2]
                 and _number(field.get("wallMs")) and _number(provider.get("wallMs")) and provider["wallMs"] <= field["wallMs"]+.001,
                 "Wrong actual global field provenance, geometry or cost")
        for direction, exposure, target in (("forward", origin, frame), ("reverse", frame, origin)):
            for index in range(len(exposure["detections"])):
                pid = f"{fid}|{direction}|{index}"; expected_population_ids.add(pid)
                entry = populations.get(pid, {}); pp = entry.get("proof", {}); selection = pp.get("selection", {})
                validate_selection(selection)
                source_inventory = exposure[lane]["diagnostics"]["sourceSelections"]
                _require(entry.get("fieldId") == fid and entry.get("direction") == direction and entry.get("detectionIndex") == index
                         and entry.get("sourceToken") == exposure["token"] and entry.get("sourceMs") == exposure["timeMs"]
                         and entry.get("sourceSha256") == exposure["sourceSha256"] and entry.get("populationSha256") == canonical_hash(pp)
                         and entry.get("selectionSha256") == canonical_hash(selection)
                         and selection.get("sourceSha256") == exposure["workingPixelsSha256"]
                         and selection.get("sourceShape") == [exposure["height"], exposure["width"]]
                         and audit._same(selection.get("sourceBox"), old._box_pixels(exposure, index))
                         and selection == source_inventory["selections"][index], "Population not bound to actual source/detector inventory")
                if pp.get("status") == "measured":
                    validate_population(pp)
                    _require(pp.get("oldWorkingSha256") == exposure["workingPixelsSha256"] and pp.get("newWorkingSha256") == target["workingPixelsSha256"], "Photometry uses wrong source/destination pixels")
        population = old._eligible_matrix(origin, frame, POLICY)
        rows = [p for p in comparisons if p["fieldId"] == fid]
        pairs = {(p["endDetectionIndex"], p["startDetectionIndex"]): p for p in rows}
        _require(len(pairs) == len(rows) and set(pairs) == {(j, i) for j, choices in enumerate(population) for i in choices}, "Unverifiable competitor was omitted or duplicated")
        for (j, i), pair in pairs.items():
            validate_comparison(pair, populations=catalog); _bounds(pair)
            _require(pair["startToken"] == origin["token"] and pair["endToken"] == frame["token"]
                     and pair["startMs"] == origin["timeMs"] and pair["endMs"] == frame["timeMs"]
                     and pair["observationMs"] == frame["timeMs"]-origin["timeMs"]
                     and pair["startSha256"] == origin["sourceSha256"] and pair["endSha256"] == frame["sourceSha256"]
                     and audit._same(pair["startBox"], old._box_pixels(origin, i)) and audit._same(pair["endBox"], old._box_pixels(frame, j)), "Wrong comparison source or current detector")
            for direction, exposure, index, key in (("forward", origin, i, "oldSelectionSha256s"), ("reverse", frame, j, "newSelectionSha256s")):
                measured = pair[direction]; entry = populations.get(measured.get("populationId"), {}); population_proof = entry.get("proof", {})
                selection = population_proof.get("selection", {})
                digest = canonical_hash(selection)
                n = measured["seedPoints"]
                _require(selection.get("sourceOnly") is True and selection.get("sourceSha256") == exposure["workingPixelsSha256"]
                         and selection.get("sourceShape") == [exposure["height"], exposure["width"]]
                         and audit._same(selection.get("sourceBox"), old._box_pixels(exposure, index))
                         and selection.get("seedPoints") == n and len(selection.get("points", [])) == n
                         and len(selection.get("cells", [])) == n and len({tuple(c) for c in selection["cells"]}) == n
                         and population_proof.get("selectionSha256") == digest and field[key][index] == digest,
                         "Selected seeds are not bound to original source-only inventory")
                _require(measured.get("populationId") == f"{fid}|{direction}|{index}" and measured.get("populationSha256") == entry["populationSha256"]
                         and measured.get("selectionSha256") == digest, "Comparison references another population")
                _require(population_proof.get("seedPoints") == n and population_proof.get("mode") == ("raw" if lane == "B" else "warped"), "Wrong selected denominator or patch mode")
                if population_proof.get("status") == "measured":
                    points = population_proof.get("points")
                    _require(isinstance(points, list) and len(points) == n and [p.get("pointIndex") for p in points] == list(range(n))
                             and all(type(p.get("good")) is bool for p in points)
                             and sum(p["good"] for p in points) == measured["verifiedPoints"], "Failed patch points were dropped or relabelled")
                    direction_contract(measured, population_proof, exposure, frame if direction == "forward" else origin,
                        pair["startBox" if direction == "forward" else "endBox"], pair["endBox" if direction == "forward" else "startBox"], POLICY)
            if pair.get("supported"):
                values = [float(.5*np.log(np.linalg.det(np.asarray(pair[d]["affine"], float)[:, :2]))) for d in ("forward", "reverse")]
                low, high = min(values[0], -values[1]), max(values[0], -values[1])
                _require(all(audit._same(pair[d]["linearLogGrowth"], v) for d, v in zip(("forward", "reverse"), values))
                         and audit._same(pair["linearLogGrowthLowerBound"], low) and audit._same(pair["linearLogGrowthUpperBound"], high)
                         and high-low <= POLICY["maxEstimatorLogGrowthSpan"], "Pair omits actual FWD/-REV affine estimator envelope")
        by_field[fid] = (origin, population, pairs)
    _require(all(p["fieldId"] in by_field for p in comparisons), "Comparison without executed full field")
    _require(set(populations) == expected_population_ids, "Omitted or foreign source population")
    for event in surface["events"]:
        proof = diag["windowEvidence"].get(str(event["trackId"]), {})
        _require(proof.get("confirmed") is True and fresh is not None and anchor is not None, "No fresh/long current evidence")
        for key, origin in (("fresh", fresh), ("anchor", anchor)):
            pair = proof[key]; validate_pair_proof(pair, populations=catalog)
            source, rows, pairs = by_field[pair["fieldId"]]; j, i = pair["endDetectionIndex"], pair["startDetectionIndex"]
            _require(source is origin and audit._same({k: v for k, v in pair.items() if k != "association"}, pairs[j, i]), "Warning proof absent from executed comparison")
            lower = _bounds(pair)[0]
            selected = sorted(rows[j], key=lambda other: (-pairs[j, other]["scoreLower"], other))[0]
            column = [other for other, choices in enumerate(rows) if i in choices]
            reverse = sorted(column, key=lambda other: (-pairs[other, i]["scoreLower"], other))[0]
            runner = max((pairs[j, other]["scoreUpper"] for other in rows[j] if other != i), default=-1.)
            reverse_runner = max((pairs[other, i]["scoreUpper"] for other in column if other != j), default=-1.)
            cert = pair.get("association", {})
            _require(selected == i and reverse == j and cert.get("supported") is True
                     and cert.get("originToken") == origin["token"] and cert.get("originMs") == origin["timeMs"]
                     and cert.get("currentToken") == frame["token"] and cert.get("currentMs") == frame["timeMs"]
                     and cert.get("currentDetectionIndex") == j and cert.get("anchorDetectionIndex") == i
                     and cert.get("eligibleAnchorIndices") == rows[j]
                     and cert.get("eligibleCompetitors") == {str(index): [other for other, choices in enumerate(rows) if index in choices] for index in rows[j]}
                     and cert.get("reciprocalCurrentIndex") == reverse and audit._same(cert.get("scoreLower"), lower)
                     and audit._same(cert.get("runnerUpUpper"), runner) and audit._same(cert.get("reverseRunnerUpUpper"), reverse_runner)
                     and audit._same(cert.get("associationMargin"), lower-runner) and audit._same(cert.get("reverseAssociationMargin"), lower-reverse_runner),
                     "Association certificate differs from entire actual row/column matrix")
            _require(lower-max((pairs[j, other]["scoreUpper"] for other in rows[j] if other != i), default=-1.) >= POLICY["associationMargin"]
                     and lower-max((p["scoreUpper"] for (other, source_i), p in pairs.items() if source_i == i and other != j), default=-1.) >= POLICY["associationMargin"], "Unverifiable row/column rival was discarded")
            _require(frame["T"]["tracks"][j]["id"] == event["trackId"], "Wrong current camera handle")
            start = next(n for n, row in enumerate(history) if row["token"] == origin["token"])
            _require(all(row["T"]["epoch"] == frame["T"]["epoch"] and row["T"]["status"] in ({"valid", "first-frame"} if n == 0 else {"valid"})
                         and not row["detectorGapInjected"] for n, row in enumerate([*history[start:], frame])), "Warning crosses camera veto/epoch")
        first, recent = proof["anchor"], proof["fresh"]; lower = first["linearLogGrowthLowerBound"]
        _require(len({anchor["timeMs"], fresh["timeMs"], frame["timeMs"]}) == 3
                 and proof["realExposureTokens"] == [anchor["token"], fresh["token"], frame["token"]]
                 and recent["linearLogGrowthLowerBound"] >= POLICY["minCurrentLinearGrowth"] and lower >= POLICY["minNetLinearGrowth"]
                 and event["linearLogGrowth"] == lower and event["linearLogGrowthLowerBound"] == lower
                 and audit._same(event["logAreaGrowth"], 2*lower) and event.get("growthBound") == POLICY["growthBound"]
                 and event.get("observationMs") == first["observationMs"] and proof.get("currentToken") == frame["token"]
                 and proof.get("currentMs") == frame["timeMs"], "Warning ignores three-source or forward/reverse lower growth bound")


def receipt_contract(receipt):
    development = receipt.get("developmentOnly"); count = sum(len(c["frames"]) for c in receipt["clips"])
    _require(receipt.get("study") == "M3N" and receipt.get("schemaVersion") == 1 and type(development) is bool
             and 1 <= count <= MAX_FRAMES and (not development or count == 100), "Invalid M3N trial scope")
    _require(receipt.get("codeSha256") == {name: sha256(HERE/name) for name in CODE}
             and receipt.get("policies") == policy_snapshot() and receipt.get("opencv") == cv2.__version__
             and receipt.get("numpy") == np.__version__ and receipt.get("device") == "mps", "Wrong frozen implementation/runtime/policy")
    _require(receipt.get("maxWallSeconds") == MAX_SECONDS and _number(receipt.get("replayWallMs")) and receipt["replayWallMs"] <= MAX_SECONDS*1000, "Exceeded replay budget")
    _require(receipt.get("maxReceiptBytes") == MAX_BYTES, "Missing declared receipt byte cap")
    provenance = receipt["detectorProvenance"]
    _require(provenance.get("kind") == ("historical-M3M-detector-A-T-S-plus-actual-B-C" if development else "actual-CoreML-and-shared-global-RAFT")
             and (_digest(provenance.get("cacheSha256")) if development else provenance.get("cacheSha256") is None), "Wrong cached/current execution provenance")
    from assist_scene_global_field import POLICY as FIELD
    metadata = receipt["globalFlowModel"]
    _require(metadata.get("policy") == dict(FIELD) and metadata.get("weightsSha256") == FIELD["weightSha256"] and metadata.get("device") == "mps"
             and metadata.get("kind") == "actual-local-pretrained-torchvision-global" and metadata.get("modelSharing") == "owned-provider"
             and metadata.get("torch") and metadata.get("torchvision") and _number(receipt.get("modelStartupMs")), "Wrong actual single-model provenance")
    _require(_digest(receipt.get("sceneqaSha256")) and receipt.get("yoloModelHashes") and all(_digest(v) for v in receipt["yoloModelHashes"].values()), "Missing detector/executable fingerprints")
    for clip in receipt["clips"]:
        _require(all(set(f["flowDirectionCalls"]) == set(GLOBAL_LANES)
                     and all(type(f["flowDirectionCalls"][lane]) is int and 0 <= f["flowDirectionCalls"][lane] <= 4 for lane in GLOBAL_LANES)
                     for f in clip["frames"]), "Per-lane actual/historical direction budget differs")
        size = len(clip["frames"]); actual = {lane: 0 if development and lane == "A" else sum(f["flowDirectionCalls"][lane] for f in clip["frames"]) for lane in GLOBAL_LANES}
        _require(clip["detectorConfiguration"] == DETECTOR_CONFIGURATION and clip["detectorCalls"] == (0 if development else size)
                 and clip["detectorBatches"] == (0 if development else (size+49)//50)
                 and clip["actualFlowDirectionCallsByLane"] == actual and clip["actualFlowDirectionCalls"] == sum(actual.values())
                 and all(0 <= n <= size*4 for n in actual.values()), "Wrong actual inference counts")


def run_clip(clip, root, work, exe, model, provider, cached=None, deadline=None, clip_index=None):
    progress = {"clipId": clip.get("id"), "clipIndex": clip_index, "frameIndex": None, "phase": "start",
        "completedValidatedRows": 0, "completedActualLaneOutputs": {lane: 0 for lane in GLOBAL_LANES},
        "actualDirectionCallsByLane": {lane: 0 for lane in GLOBAL_LANES}}
    initial = provider.direction_calls
    try:
        return _run_clip(clip, root, work, exe, model, provider, cached, deadline, progress)
    except Exception as error:
        failure = {"schemaVersion": 1, "study": "M3N", "status": "FAILED-INCOMPLETE-NOT-SCORABLE", **progress,
            "providerDirectionCalls": provider.direction_calls, "actualClipDirectionCalls": provider.direction_calls-initial,
            "errorType": type(error).__name__, "error": str(error)[:512]}
        error.m3n_failure = failure
        print("M3N_FAILURE "+json.dumps(failure, separators=(",", ":"), allow_nan=False), file=sys.stderr, flush=True)
        raise


def _run_clip(clip, root, work, exe, model, provider, cached, deadline, progress):
    old._deadline(deadline)
    from assist_scene_global_window import GlobalWindowMotion
    from assist_scene_textured_window import TexturedGlobalWindowMotion
    from assist_scene_cohort_loom import CohortWindowLoom
    from assist_scene_m3d_study import BoxBaseline
    started = perf_counter(); origin = clip["frames"][0]["timestampUs"]; rows = []; prepared = []
    for i, source in enumerate(clip["frames"]):
        progress.update(frameIndex=i, phase="staging")
        old._deadline(deadline); tick = perf_counter(); folder = work/str(i); folder.mkdir()
        frames, samples, shapes = stage({"frames": [source]}, root, folder)
        prepared.append((frames[0], samples[0][2], shapes[0], 1000*(perf_counter()-tick)))
    stage_ms = 1000*(perf_counter()-started)
    samples = [(i, (source["timestampUs"]-origin)/1000., prepared[i][1]) for i, source in enumerate(clip["frames"])]
    found, batch_ms, batches = ({}, None, 0) if cached else old.previous.previous._detect_batched(samples, exe, model)
    progress.update(detectorCalls=0 if cached else len(samples), phase="prepared")
    engines = {"B": TexturedGlobalWindowMotion(provider, mode="raw"), "C": TexturedGlobalWindowMotion(provider, mode="warped")}
    if not cached: engines.update(T=CohortWindowLoom(), A=GlobalWindowMotion(provider), S=BoxBaseline())
    for i, (frame, filename, shape, prep_ms) in enumerate(prepared):
        progress.update(frameIndex=i, phase="frame-preparation")
        old._deadline(deadline); h, w, nh, nw = shape; at = samples[i][1]; gap = i in DROPPED.get(clip["id"], ())
        tick = perf_counter(); gray = read_frame(filename, cv2.IMREAD_GRAYSCALE); working_ms = 1000*(perf_counter()-tick)
        tick = perf_counter(); native = cv2.cvtColor(old.previous.previous._read_native(root/frame["path"], frame["sha256"]), cv2.COLOR_BGR2GRAY); native_ms = 1000*(perf_counter()-tick)
        if cached: boxes, detector_ms = cached_observation(cached["frames"][i], w, h, nw, nh); observation = None
        else:
            found_at, observation = found[i]; _require(found_at == at, "Wrong model exposure clock")
            boxes = [] if gap else parse_detect(observation, w, h); detector_ms = observation["detectionMs"]
        row = {"index": i, "token": frame["token"], "timestampUs": frame["timestampUs"], "timeMs": at, "sourceSha256": frame["sha256"],
            "sourcePoseTimestampUs": frame.get("poseTimestampUs"), "sourcePoseEpoch": frame.get("epoch"),
            "workingPixelsSha256": content_sha256(gray.tobytes()).hexdigest(), "width": w, "height": h, "nativeWidth": nw, "nativeHeight": nh,
            "cameraIntrinsics": np.asarray(frame["intrinsics"]).tolist(), "cameraToWorld": np.asarray(frame["cameraToWorld"]).tolist(),
            "detectorGapInjected": gap, "detections": [b.record(w, h) for b in boxes], "oldObservation": observation, "detectorObservationMs": detector_ms,
            "flowDirectionCalls": {}, "timingsMs": {"fullPreparation": prep_ms, "sharedPrep": working_ms+native_ms, "workingDecode": working_ms, "nativeDecode": native_ms}}
        if cached:
            prior = cached["frames"][i]
            for lane, source in (("T", "A"), ("A", "C"), ("S", "S")):
                row[lane] = deepcopy(prior[source]); row["timingsMs"][lane] = prior["timingsMs"][source]
            row["flowDirectionCalls"]["A"] = prior["flowDirectionCalls"]["C"]
            historical_contract(row, prior)
        else:
            for lane in ("T", "S"):
                cv2.setRNGSeed(650500+i); tick = perf_counter()
                result = engines[lane].update(frame, at, gray, boxes, native_gray=native) if lane == "T" else engines[lane].update(frame, at, gray, boxes)
                row[lane] = output(result, at); row["timingsMs"][lane] = 1000*(perf_counter()-tick)
        for lane in (("B", "C") if cached else GLOBAL_LANES):
            cv2.setRNGSeed(650500+i); before = provider.direction_calls; tick = perf_counter()
            progress["phase"] = "engine-"+lane
            try:
                row[lane] = output(engines[lane].update(frame, at, gray, boxes, camera_surface=row["T"]), at)
            finally:
                progress["actualDirectionCallsByLane"][lane] += provider.direction_calls-before
            progress["completedActualLaneOutputs"][lane] += 1
            row["timingsMs"][lane] = 1000*(perf_counter()-tick); row["flowDirectionCalls"][lane] = provider.direction_calls-before
        progress["phase"] = "contracts"
        track_contract(row)
        for lane in GLOBAL_LANES: global_contract(row, rows, lane)
        origins_by_lane = [[p["startToken"] for p in row[lane]["diagnostics"]["globalFields"]] for lane in GLOBAL_LANES]
        _require(all(origins == origins_by_lane[0] for origins in origins_by_lane), "Ablations measured different source timestamp pairs")
        rows.append(row); progress["completedValidatedRows"] = len(rows); old._deadline(deadline)
    actual = {lane: 0 if cached and lane == "A" else sum(f["flowDirectionCalls"][lane] for f in rows) for lane in GLOBAL_LANES}
    return {"id": clip["id"], "frames": rows, "detectorConfiguration": DETECTOR_CONFIGURATION, "detectorCalls": 0 if cached else len(rows),
        "detectorBatches": batches, "detectorBatchWallMs": batch_ms, "actualFlowDirectionCallsByLane": actual,
        "actualFlowDirectionCalls": sum(actual.values()), "stageWallMs": stage_ms, "studyWallMs": 1000*(perf_counter()-started)}


def replay(args):
    started = perf_counter(); deadline = started+MAX_SECONDS; inputs, root = load_input(args.input)
    count = sum(len(c["frames"]) for c in inputs["clips"]); development, cache_path = bool(args.development_only), args.cached_observations
    _require(1 <= count <= MAX_FRAMES and bool(cache_path) == development and (not development or count == 100), "Development requires exact M3M100 cache and paired flags")
    _require(args.device == "mps" and not args.output.exists() and not args.output.is_symlink(), "Explicit MPS and new output required")
    _require(shutil.disk_usage(args.output.parent).free >= 10*1024**3, "Less than 10 GB free")
    exe, model = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    input_hash, exe_hash, hashes = sha256(args.input), sha256(exe), model_hashes(model)
    cache = load_cache(cache_path, inputs, input_hash, exe_hash, hashes) if cache_path else None; cache_hash = sha256(cache_path) if cache else None
    before = {name: sha256(HERE/name) for name in CODE}
    source_before = {f["path"]: sha256(root/f["path"]) for c in inputs["clips"] for f in c["frames"]}
    _require(all(source_before[f["path"]] == f["sha256"] for c in inputs["clips"] for f in c["frames"]), "Source bytes changed")
    from assist_scene_global_field import GlobalRaftSmall
    tick = perf_counter(); provider = GlobalRaftSmall(args.flow_weights, device=args.device); startup = 1000*(perf_counter()-tick)
    cv2.setNumThreads(1); clips = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3n-{date.today():%Y%m%d}-", dir=args.output.parent) as temp:
        for i, clip in enumerate(inputs["clips"]):
            old._deadline(deadline); work = Path(temp)/str(i); work.mkdir()
            print(f"Replay {clip['id']} M3N ({len(clip['frames'])} exposures)", flush=True)
            try:
                clips.append(run_clip(clip, root, work, exe, model, provider, cache["clips"][i] if cache else None, deadline, clip_index=i))
            except Exception as error:
                failure = getattr(error, "m3n_failure", {"status": "FAILED-INCOMPLETE-NOT-SCORABLE", "errorType": type(error).__name__})
                failure = {**failure, "inputSha256": input_hash, "codeSha256": before, "completedClips": len(clips),
                    "developmentOnly": development, "replayWallMs": 1000*(perf_counter()-started), "modelStartupMs": startup}
                sidecar = args.output.with_name(args.output.stem+"-failure.json")
                if not sidecar.exists() and not sidecar.is_symlink(): write_new(sidecar, failure)
                raise
    _require(before == {name: sha256(HERE/name) for name in CODE} and sha256(args.input) == input_hash and sha256(exe) == exe_hash
             and model_hashes(model) == hashes and sha256(args.flow_weights) == provider.metadata["weightsSha256"]
             and source_before == {path: sha256(root/path) for path in source_before} and (not cache or sha256(cache_path) == cache_hash), "Source/model/implementation/cache drift")
    _require(provider.direction_calls == sum(c["actualFlowDirectionCalls"] for c in clips), "Actual shared model calls differ from per-lane counters")
    result = {"schemaVersion": 1, "study": "M3N", "dataset": inputs["dataset"], "inputSha256": input_hash, "developmentOnly": development,
        "device": args.device, "opencv": cv2.__version__, "numpy": np.__version__, "platform": platform.platform(), "policies": policy_snapshot(), "codeSha256": before,
        "maxWallSeconds": MAX_SECONDS, "maxReceiptBytes": MAX_BYTES, "replayWallMs": 1000*(perf_counter()-started), "sceneqaSha256": exe_hash, "yoloModelHashes": hashes,
        "globalFlowModel": dict(provider.metadata), "modelStartupMs": startup, "clips": clips,
        "lanes": {"A": "Frozen M3M uniform/raw", "B": "source-textured/raw", "C": "source-textured/warped", "S": "bbox diagnostic, not fallback", "T": "shared frozen DIS camera/handles"},
        "detectorProvenance": {"kind": "historical-M3M-detector-A-T-S-plus-actual-B-C" if cache else "actual-CoreML-and-shared-global-RAFT", "cacheSha256": cache_hash},
        "timingScope": "Development detector/A/T/S samples are historical, not current execution. Actual B/C execute model fields independently; fresh A/B/C do likewise in fixed sequential A->B->C order with one resident checkpoint. Warm-order effects are uncontrolled: these timings do not establish lane speed superiority. Paired global lane totals add detector perform, staging/prep, T and that lane only, before percentiles. Do not add other ablation lanes or flow twice. S excludes T. CoreML perform-only detector timings make totals lower bounds. Model startup and total sequential study wall are separate. No phone/real-time claim."}
    receipt_contract(result); return result


def score(receipt, truth, inputs=None, cache=None):
    finite_payload(receipt); finite_payload(truth); receipt_contract(receipt)
    _require(truth.get("inputSha256") == receipt["inputSha256"] and truth.get("schemaVersion") == 1
             and [c["id"] for c in truth["clips"]] == [c["id"] for c in receipt["clips"]], "Unbound reviewed truth")
    if inputs is not None: bind_input(receipt, inputs)
    _require(not receipt["developmentOnly"] or cache is not None, "Development requires original cache at score time")
    if receipt["developmentOnly"]:
        _require(inputs is not None, "Development score requires source input binding")
        validate_cache(cache, inputs, receipt["inputSha256"], receipt["sceneqaSha256"], receipt["yoloModelHashes"])
    contract = legacy_score(); totals = {lane: Counter(contract.empty()) for lane in LANES}; results = []; all_frames = []
    for ci, (clip, ref) in enumerate(zip(receipt["clips"], truth["clips"], strict=True)):
        frames = clip["frames"]; labels = {f["token"]: f for f in ref["frames"]}; stats = {lane: contract.empty() for lane in LANES}; history = []
        _require(len(labels) == len(ref["frames"]) and len({f["token"] for f in frames}) == len(frames) and labels.keys() <= {f["token"] for f in frames}, "Duplicate/missing reviewed exposure")
        origin = frames[0]["timestampUs"]; previous_stamp = None
        for i, frame in enumerate(frames):
            stamp = frame["timestampUs"]
            _require(type(stamp) is int and (previous_stamp is None or stamp > previous_stamp) and frame["index"] == i
                     and frame["timeMs"] == (stamp-origin)/1000., "Wrong source clock/order")
            previous_stamp = stamp
            _require(type(frame["detectorGapInjected"]) is bool and frame["detectorGapInjected"] == (i in DROPPED.get(clip["id"], ())), "Wrong predeclared detector gap")
            if inputs is not None:
                actual = inputs["clips"][ci]["frames"][i]; k = np.diag((frame["width"]/frame["nativeWidth"], frame["height"]/frame["nativeHeight"], 1.)) @ np.asarray(actual["intrinsics"])
                _require(frame["sourceSha256"] == actual["sha256"] and audit._same(frame["cameraIntrinsics"], k.tolist())
                         and audit._same(frame["cameraToWorld"], actual["cameraToWorld"]) and frame["sourcePoseTimestampUs"] == actual["poseTimestampUs"]
                         and frame.get("sourcePoseEpoch") == actual.get("epoch"), "Wrong camera/source metadata")
            if receipt["developmentOnly"]:
                prior = cache["clips"][ci]["frames"][i]
                historical_contract(frame, prior)
            else:
                obs = frame.get("oldObservation"); _require(isinstance(obs, dict) and obs["detectionMs"] == frame["detectorObservationMs"], "Missing actual detector timing/report")
                expected = [] if frame["detectorGapInjected"] else [b.record(frame["width"], frame["height"]) for b in parse_detect(obs, frame["width"], frame["height"])]
                _require(frame["detections"] == expected, "Current detector boxes differ from raw inference")
            track_contract(frame)
            for lane in GLOBAL_LANES: global_contract(frame, history, lane)
            known = labels.get(frame["token"]); _require(known is None or known["timestampUs"] == stamp, "Wrong reviewed clock")
            targets = None if known is None else [{**t, "motion": {"approaching": "moving", "not-approaching": "stationary", "unknown": "unknown"}[t["approach"]]} for t in known["targets"]]
            for lane in LANES:
                contract.score_frame(frame, lane, targets, stats[lane])
                if ref.get("allSceneNegative"): stats[lane]["allSceneFalseNotices"] = stats[lane].get("allSceneFalseNotices", 0)+len(frame[lane]["events"])
            history.append(frame); all_frames.append(frame)
        for lane in LANES: totals[lane].update(stats[lane])
        results.append({"id": clip["id"], "lanes": stats})
    timings = {}
    for lane in LANES:
        keys = ("fullPreparation", "sharedPrep", lane) if lane == "S" else ("fullPreparation", "sharedPrep", "T", lane)
        _require(all(_number(f["detectorObservationMs"]) and all(_number(f["timingsMs"][k]) for k in keys) for f in all_frames), "Missing actual/historical paired timings")
        timings[lane+"PairedProduct"] = _percentiles([f["detectorObservationMs"]+sum(f["timingsMs"][k] for k in keys) for f in all_frames])
    return {"schemaVersion": 1, "study": "M3N", "dataset": receipt["dataset"], "inputSha256": receipt["inputSha256"], "developmentOnly": receipt["developmentOnly"],
        "frames": len(all_frames), "noMetreChecks": len(all_frames)*len(SURFACES), "unit": "reviewed target-keyframe", "totals": totals, "clips": results,
        "stageMs": timings, "timingScope": receipt["timingScope"], "codeSha256": receipt["codeSha256"], "detectorProvenance": receipt["detectorProvenance"],
        "limits": "Sparse evaluation labels only; unknown/unmatched/unreviewed notices remain separate. Assistant-reviewed boxes are not independent human acceptance. No metric range, phone, safety, commercial or real-time acceptance."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); modes = parser.add_subparsers(dest="mode", required=True)
    for mode, keys in (("replay", ("input", "sceneqa", "yolo", "flow-weights", "output")), ("score", ("input", "truth", "receipt", "output"))):
        sub = modes.add_parser(mode)
        for key in keys: sub.add_argument("--"+key, type=Path, required=True)
        sub.add_argument("--cached-observations", type=Path)
        if mode == "replay": sub.add_argument("--development-only", action="store_true"); sub.add_argument("--device", choices=("mps",), required=True)
    args = parser.parse_args()
    if args.mode == "replay": result = replay(args)
    else:
        receipt, inputs = read_json(args.receipt, MAX_BYTES), read_json(args.input); _require(sha256(args.input) == receipt["inputSha256"], "Wrong input bytes")
        cache = read_json(args.cached_observations, old.MAX_RECEIPT_BYTES) if args.cached_observations else None
        _require(not receipt["developmentOnly"] or cache is not None and sha256(args.cached_observations) == receipt["detectorProvenance"]["cacheSha256"], "Wrong historical cache bytes")
        result = score(receipt, read_json(args.truth), inputs, cache); result.update(receiptSha256=sha256(args.receipt), truthSha256=sha256(args.truth))
    write_result(args.output, result, compact=args.mode == "replay")
