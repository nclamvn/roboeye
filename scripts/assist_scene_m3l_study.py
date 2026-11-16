#!/usr/bin/env python3
"""M3L Mac-only shared-detector trial: frozen DIS, RAFT, direct window.

Only scoring opens truth. Development reuses exact M3K A/C observations and
surfaces as historical A/B; fresh trials execute old YOLO, DIS and RAFT again.
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
from types import SimpleNamespace

import cv2
import numpy as np

import audit_assist_scene_m3k as independent
import assist_scene_m3k_study as previous
from assist_scene_motion import parse_detect, sha256
from assist_scene_motion_m3c import load_input
from assist_scene_m3e_study import DROPPED, legacy_score, output, read_frame, write_new
from assist_scene_m3f_study import stage
from assist_scene_m3g_study import DETECTOR_CONFIGURATION, bind_input, finite_payload, lane_contract, model_hashes, _percentiles
from assist_scene_m3h_study import cohort_contract, lifecycle_summary, read_json


HERE = Path(__file__).resolve().parent
LANES = ("A", "B", "C", "S")
MAX_FRAMES = 180
MAX_SECONDS = 1800
CODE = tuple(dict.fromkeys((*previous.CODE, "audit_assist_scene_m3k.py",
                           "assist_scene_m3l_study.py", "assist_scene_direct_window.py")))
TIMINGS = ("fullPreparation", "sharedPrep", "workingDecode", "nativeDecode", *LANES)


def policy_snapshot():
    from assist_scene_cohort_loom import POLICY as IDENTITY
    from assist_scene_learned_region import POLICY as FLOW
    from assist_scene_direct_window import POLICY as DIRECT
    return json.loads(json.dumps({"identity": dict(IDENTITY), "flow": dict(FLOW), "direct": dict(DIRECT)}))


def _require(ok, message):
    if not ok: raise ValueError(message)


def _deadline(deadline):
    if deadline is not None and perf_counter() > deadline:
        raise TimeoutError("M3L 1800-second replay budget exhausted; partial trial is not complete")


def load_cache(path, inputs, input_hash, exe_hash, hashes):
    cache = read_json(path, 64*1024**2)
    previous.receipt_contract(cache)
    independent.audit_receipt(cache)
    bind_input(cache, inputs)
    _require(cache.get("study") == "M3K" and cache.get("developmentOnly") is False
             and cache.get("detectorProvenance", {}).get("kind") == "actual-local-CoreML-and-PyTorch"
             and sum(len(c["frames"]) for c in cache["clips"]) == 99
             and cache.get("inputSha256") == input_hash and cache.get("sceneqaSha256") == exe_hash
             and cache.get("yoloModelHashes") == hashes, "Development requires exact actual original 99-exposure M3K cache")
    for source, clip in zip(inputs["clips"], cache["clips"], strict=True):
        for actual, frame in zip(source["frames"], clip["frames"], strict=True):
            _require(frame.get("sourceSha256") == actual["sha256"], "Historical source exposure changed")
    return cache


def track_contract(frame):
    """No current identity or warning may exist without this shared detector."""
    for lane in LANES:
        # Independent auditor selects candidateDetections for B. Here both
        # views are explicitly the SAME old full-frame detector observations.
        view = dict(frame, candidateDetections=frame["detections"])
        tracks = independent._tracks(view, lane)
        if lane in ("A", "B", "S"):
            independent._events(view, lane, tracks)
        else:
            independent._no_range(frame[lane]["tracks"])
            independent._no_range(frame[lane]["events"])
    _require(frame["C"]["tracks"] == frame["A"]["tracks"]
             and frame["C"]["epoch"] == frame["A"]["epoch"]
             and frame["C"].get("diagnostics", {}).get("sourceStatus") == frame["A"]["status"],
             "Direct window changed current detector identities or camera status")
    _require(frame["A"]["status"] == "valid" or not frame["C"]["events"], "Direct warning bypasses current camera veto")


def selected_origins(frame, history):
    """Replay the pinned cadence/oldest-origin rule without reading proof aliases."""
    from assist_scene_direct_window import POLICY
    bank, latest, prior, epoch = [], None, None, None
    for exposure in history:
        source = exposure["A"]
        if source["epoch"] != epoch:
            bank, latest, prior = [], None, None
        epoch = source["epoch"]
        if source["status"] not in {"valid", "first-frame"}:
            bank, latest, prior = [], None, None
            continue
        if prior is not None and (exposure["timeMs"]-prior["timeMs"] > POLICY["maxGapMs"]
                or (exposure["height"], exposure["width"]) != (prior["height"], prior["width"])):
            bank, latest, prior = [], None, None
            continue
        if source["status"] == "first-frame": bank, latest = [], None
        bank = [old for old in bank if exposure["timeMs"]-old["timeMs"] <= POLICY["maxWindowMs"]]
        if not bank or exposure["timeMs"]-bank[-1]["timeMs"] >= POLICY["bankCadenceMs"]:
            bank.append(exposure)
            bank = bank[-POLICY["maxSparseTimestamps"]:]
        latest, prior = exposure, exposure
    if frame["A"]["epoch"] != epoch or frame["A"]["status"] == "first-frame": return None, None
    eligible = [old for old in bank if POLICY["minWindowMs"] <= frame["timeMs"]-old["timeMs"] <= POLICY["maxWindowMs"]]
    if latest is not None and not POLICY["minFreshMs"] <= frame["timeMs"]-latest["timeMs"] <= POLICY["maxGapMs"]:
        latest = None
    return latest, eligible[0] if eligible else None


def eligible_graph(origin, current):
    """Rebuild geometric competition from source boxes/poses, never proof lists."""
    import assist_scene_direct_window as direct
    def objects(exposure):
        h, w = exposure["height"], exposure["width"]
        native = np.diag((exposure["nativeWidth"]/w, exposure["nativeHeight"]/h, 1.))
        out = []
        for record in exposure["detections"]:
            bounds = record["box"]
            rect = (bounds["x"]*w, bounds["y"]*h,
                    min(w, (bounds["x"]+bounds["width"])*w), min(h, (bounds["y"]+bounds["height"])*h))
            if direct.window._too_small(rect, (h, w), native):
                out.append(None)
            else:
                out.append(SimpleNamespace(box=rect, frame={"label": record["label"],
                    "intrinsics": np.asarray(exposure["cameraIntrinsics"], dtype=np.float64),
                    "cameraToWorld": np.asarray(exposure["cameraToWorld"], dtype=np.float64)}))
        return out
    old, now = objects(origin), objects(current)
    matrix = [[direct._eligible(a, b) for a in old] for b in now]
    rows = [[i for i, keep in enumerate(row) if keep] for row in matrix]
    columns = [[j for j, row in enumerate(matrix) if row[i]] for i in range(len(old))]
    cap = direct.POLICY["maxCandidatesPerObject"]
    allowed = [bool(row) and len(row) <= cap and all(len(columns[i]) <= cap
               and all(len(rows[j]) <= cap for j in columns[i]) for i in row) for row in rows]
    needed = set()
    for j, permitted in enumerate(allowed):
        if permitted:
            for i in rows[j]: needed.update((other, i) for other in columns[i])
    return rows, columns, allowed, needed


def association_contract(pair, current, origin, comparisons, ident):
    """Use every independently eligible competitor and actual compared score."""
    from assist_scene_direct_window import _pair_score
    association = pair["association"]
    start, end = pair["startDetectionIndex"], pair["endDetectionIndex"]
    _require(current["A"]["tracks"][end]["id"] == ident
             and current["detections"][end]["label"] == origin["detections"][start]["label"], "Direct pair warns for a different current object")
    raw = [p for p in comparisons if p.get("startToken") == origin["token"] and p.get("startMs") == origin["timeMs"]]
    by_index = {(p.get("endDetectionIndex"), p.get("startDetectionIndex")): p for p in raw}
    _require(len(by_index) == len(raw), "Duplicate direct registration comparisons")
    actual_pair = by_index.get((end, start))
    _require(actual_pair is not None and independent._same({k: v for k, v in pair.items() if k != "association"}, actual_pair),
             "Warning's direct pair is absent or differs from actual compared pair")
    rows, columns, allowed, needed = eligible_graph(origin, current)
    _require(set(by_index) == needed and allowed[end], "Direct comparison trace omits eligible appearance competition")
    candidates = rows[end]
    _require(association.get("eligibleAnchorIndices") == candidates
             and association.get("eligibleCompetitors") == {str(i): columns[i] for i in candidates}, "Direct appearance eligibility was pruned or forged")
    ranked = sorted(((_pair_score(by_index[end, i]), i) for i in candidates), key=lambda item: (-item[0], item[1]))
    score, selected = ranked[0]; runner = ranked[1][0] if len(ranked) > 1 else -1.
    reverse = sorted(((_pair_score(by_index[j, selected]), j) for j in columns[selected]), key=lambda item: (-item[0], item[1]))
    reciprocal, reverse_index = reverse[0]; reverse_runner = reverse[1][0] if len(reverse) > 1 else -1.
    expected = {"anchorDetectionIndex": selected, "currentDetectionIndex": end,
        "reciprocalCurrentIndex": reverse_index, "correlation": score, "runnerUpCorrelation": runner,
        "associationMargin": score-runner, "reverseRunnerUpCorrelation": reverse_runner,
        "reverseAssociationMargin": reciprocal-reverse_runner}
    _require(selected == start and reverse_index == end and all(independent._same(association.get(k), v) for k, v in expected.items()),
             "Direct appearance winner or reciprocal margins do not reproduce actual compared scores")


def mode_bound_contract(pair):
    """Direction-independent envelope: every forward and sign-corrected reverse mode."""
    values = []
    refinement = pair.get("modeRefinement", {})
    for direction, sign in (("forward", 1.), ("reverse", -1.)):
        modes = refinement.get(direction, {})
        growths = modes.get("linearLogGrowths")
        _require(isinstance(growths, list) and growths and modes.get("count") == len(growths)
                 and all(type(growth) in (int, float) and math.isfinite(growth) for growth in growths),
                 "Missing both-direction refined mode growth population")
        values.extend(sign*growth for growth in growths)
    _require(independent._same(pair.get("linearLogGrowthLowerBound"), min(values))
             and independent._same(pair.get("linearLogGrowthUpperBound"), max(values)),
             "Mode bounds must include both forward and sign-corrected reverse refinements")


def direct_contract(frame, history):
    """Bind independent positive pair certificates to real source exposures.

    Current owning ID comes from A, but earlier detections need not retain A's
    ID or cohort. A camera veto/epoch boundary still breaks the whole window.
    """
    from assist_scene_direct_window import POLICY, validate_pair_proof, validate_association_proof
    surface = frame["C"]
    diagnostics = surface.get("diagnostics", {})
    comparisons = diagnostics.get("comparisons", [])
    _require(isinstance(comparisons, list) and len(comparisons) <= POLICY["maxPairsPerFrame"]
             and diagnostics.get("comparisonCount", 0) == len(comparisons), "Unbounded or truncated direct pair execution")
    totals = {key: 0 for key in ("initializerWarps", "templateCalls", "eccCalls")}
    for pair in comparisons:
        _require(isinstance(pair, dict), "Malformed direct comparison")
        cost = pair.get("cost", {})
        _require(all(type(cost.get(key)) is int and cost[key] >= 0 for key in totals)
                 and cost["initializerWarps"] <= 2*POLICY["maxInitializerWarpsPerDirection"]
                 and cost["templateCalls"] <= cost["initializerWarps"]*POLICY["maxTemplateCallsPerWarp"]
                 and cost["eccCalls"] <= POLICY["maxEccCallsPerPair"], "Direct comparison operation budget changed")
        for key in totals: totals[key] += cost[key]
        _require(previous._number(pair.get("wallMs")), "Missing actual direct pair cost")
    if comparisons or "cost" in diagnostics:
        _require(diagnostics.get("cost") == totals, "Direct operation accounting does not reproduce")
        _require(previous._number(diagnostics.get("wallMs"))
                 and sum(pair["wallMs"] for pair in comparisons) <= diagnostics["wallMs"]+.001
                 and diagnostics["wallMs"] <= frame["timingsMs"]["C"]+.001, "Hidden direct operation cost")
    evidence = diagnostics.get("windowEvidence", {})
    pinned_previous, pinned_anchor = selected_origins(frame, history) if surface["events"] else (None, None)
    for event in surface["events"]:
        ident = event["trackId"]
        proof = evidence.get(str(ident))
        _require(isinstance(proof, dict) and proof.get("confirmed") is True
                 and proof.get("currentToken") == frame["token"] and proof.get("currentMs") == frame["timeMs"],
                 "Direct warning lacks current independently measured proof")
        _require(history, "Direct warning has no actual previous exposure")
        _require(pinned_previous is not None and pinned_anchor is not None,
                 "Direct warning lacks independently reconstructed temporal origins")
        previous_frame = history[-1]
        fresh, anchor = proof.get("fresh"), proof.get("anchor")
        _require(isinstance(fresh, dict) and isinstance(anchor, dict), "Missing fresh and direct-anchor proofs")
        starts = []
        for kind, pair in (("fresh", fresh), ("anchor", anchor)):
            validate_pair_proof(pair)
            mode_bound_contract(pair)
            validate_association_proof(pair.get("association"))
            _require(pair.get("endMs") == frame["timeMs"] and pair.get("endToken") == frame["token"]
                     and pair.get("endSha256") == frame["sourceSha256"], "Direct pair has stale or wrong current exposure")
            origins = [i for i, old in enumerate(history) if old["token"] == pair.get("startToken")
                       and old["timeMs"] == pair.get("startMs") and old["sourceSha256"] == pair.get("startSha256")]
            _require(len(origins) == 1, "Direct pair does not bind a real unique prior exposure")
            index = origins[0]; old = history[index]
            start_index, end_index = pair.get("startDetectionIndex"), pair.get("endDetectionIndex")
            _require(type(start_index) is int and 0 <= start_index < len(old["detections"])
                     and type(end_index) is int and 0 <= end_index < len(frame["detections"]), "Direct proof uses nonexistent source detection indices")
            def pixels(exposure, detection_index):
                bounds = exposure["detections"][detection_index]["box"]
                width, height = exposure["width"], exposure["height"]
                return [bounds["x"]*width, bounds["y"]*height,
                        (bounds["x"]+bounds["width"])*width, (bounds["y"]+bounds["height"])*height]
            _require(independent._same(pair.get("startBox"), pixels(old, start_index))
                     and independent._same(pair.get("endBox"), pixels(frame, end_index)), "Direct proof source boxes differ from actual detector observations")
            current_track = frame["A"]["tracks"][end_index]
            association = pair["association"]
            _require(current_track["id"] == ident
                     and association.get("currentDetectionIndex") == end_index
                     and association.get("anchorDetectionIndex") == start_index
                     and association.get("reciprocalCurrentIndex") == end_index,
                     "Direct association belongs to another current object")
            association_contract(pair, frame, old, comparisons, ident)
            age = frame["timeMs"]-old["timeMs"]
            _require(abs(pair.get("observationMs", -1)-age) < 1e-6, "Direct pair age differs from media clock")
            if kind == "fresh":
                _require(old is previous_frame and old is pinned_previous and 0 < age <= POLICY["maxGapMs"], "No actual fresh adjacent exposure proof")
            else:
                _require(old is pinned_anchor and POLICY["minWindowMs"] <= age <= POLICY["maxWindowMs"], "Direct anchor is not the pinned oldest eligible cadence origin")
            for offset, exposure in enumerate([*history[index:], frame]):
                _require(exposure["A"]["epoch"] == frame["A"]["epoch"]
                         and exposure["A"]["status"] in ({"first-frame", "valid"} if offset == 0 else {"valid"})
                         and not exposure["detectorGapInjected"], "Direct window crosses missing detection or camera veto")
            starts.append(old["token"])
        _require(starts[0] != starts[1] and proof.get("realExposureTokens") == [starts[1], starts[0], frame["token"]],
                 "Direct proof must use three distinct real exposures, not chained or duplicated ages")
        _require(proof.get("selectedPreviousToken") == starts[0] and proof.get("selectedPreviousMs") == previous_frame["timeMs"]
                 and proof.get("selectedAnchorToken") == starts[1] and proof.get("selectedAnchorMs") == anchor["startMs"],
                 "Selected direct origins do not reproduce their certificates")
        fresh_lower = fresh.get("linearLogGrowthLowerBound")
        anchor_lower = anchor.get("linearLogGrowthLowerBound")
        _require(previous._number(fresh_lower) and fresh_lower >= POLICY["minCurrentLinearGrowth"]
                 and previous._number(anchor_lower) and anchor_lower >= POLICY["minNetLinearGrowth"],
                 "Direct warning bypasses current or long all-refined-modes lower growth bound")
        _require(event.get("method") == POLICY["method"]
                 and all(independent._same(event.get(key), anchor.get(key)) for key in ("observationMs", "points"))
                 and independent._same(event.get("linearLogGrowth"), anchor_lower)
                 and independent._same(event.get("logAreaGrowth"), 2*anchor_lower)
                 and independent._same(event.get("linearLogGrowthLowerBound"), anchor_lower)
                 and event.get("growthBound") == "all-refined-modes-lower",
                 "Direct event does not explicitly reproduce its all-refined-modes lower bound")
        _require(independent._same(proof.get("linearLogGrowthLowerBound"), anchor_lower)
                 and independent._same(proof.get("linearLogGrowthUpperBound"), anchor.get("linearLogGrowthUpperBound"))
                 and independent._same(proof.get("linearLogGrowth"), anchor_lower),
                 "Direct warning evidence silently substitutes a point estimate for its mode bound")


def flow_contract(frame):
    independent._flow(frame, "B")


def receipt_contract(receipt):
    from assist_scene_learned_region import POLICY as FLOW
    development = receipt.get("developmentOnly")
    count = sum(len(c["frames"]) for c in receipt["clips"])
    _require(receipt.get("study") == "M3L" and receipt.get("schemaVersion") == 1 and type(development) is bool
             and 1 <= count <= MAX_FRAMES and (not development or count == 99), "Invalid M3L execution scope")
    _require(receipt.get("policies") == policy_snapshot() and receipt.get("opencv") == cv2.__version__
             and receipt.get("numpy") == np.__version__ and receipt.get("device") in {"mps", "cpu"}
             and receipt.get("codeSha256") == {name: sha256(HERE/name) for name in CODE}, "Wrong frozen M3L code/policy/runtime")
    provenance = receipt.get("detectorProvenance", {})
    kind = "development-historical-M3K-A-C-plus-fresh-direct" if development else "actual-local-CoreML-and-PyTorch"
    _require(provenance.get("kind") == kind and (previous._digest(provenance.get("cacheSha256")) if development else provenance.get("cacheSha256") is None)
             and provenance.get("baselineTimings") == ("historical, not current execution" if development else "actual current execution"),
             "Wrong historical/current baseline provenance")
    flow = receipt.get("learnedFlowModel", {})
    _require(flow.get("kind") == "actual-local-pretrained-torchvision" and flow.get("device") == receipt["device"]
             and flow.get("weightsSha256") == FLOW["weightSha256"] and flow.get("policy") == dict(FLOW), "Wrong RAFT checkpoint provenance")
    _require(previous._digest(receipt.get("sceneqaSha256")) and receipt.get("yoloModelHashes")
             and all(previous._digest(v) for v in receipt["yoloModelHashes"].values()), "Missing old detector artifacts")
    _require(receipt.get("maxWallSeconds") == MAX_SECONDS and previous._number(receipt.get("replayWallMs"))
             and receipt["replayWallMs"] <= MAX_SECONDS*1000, "Wrong complete replay wall budget")
    for clip in receipt["clips"]:
        size = len(clip["frames"])
        _require(size > 0 and clip.get("detectorConfiguration") == DETECTOR_CONFIGURATION
                 and clip.get("detectorCalls") == (0 if development else size)
                 and clip.get("detectorBatches") == (0 if development else math.ceil(size/50))
                 and clip.get("flowDirectionCalls") == (0 if development else sum(f["flowDirectionCalls"]["B"] for f in clip["frames"])),
                 "Wrong actual detector/flow call count")
        _require(development and clip.get("detectorBatchWallMs") is None or not development and previous._number(clip.get("detectorBatchWallMs")),
                 "Wrong actual detector batch cost")
        _require(all(previous._number(clip.get(k)) for k in ("stageWallMs", "studyWallMs")), "Missing execution cost")


def _timing_values(frames):
    for frame in frames:
        _require(all(previous._number(frame.get("timingsMs", {}).get(key)) for key in TIMINGS)
                 and previous._number(frame.get("detectorObservationMs")), "Missing actual or explicitly historical sample cost")
    out = {key: _percentiles([frame["timingsMs"][key] for frame in frames]) for key in TIMINGS}
    for lane in LANES:
        dependencies = ("fullPreparation", "sharedPrep", "A", "C") if lane == "C" else ("fullPreparation", "sharedPrep", lane)
        out[lane+"PairedProduct"] = _percentiles([f["detectorObservationMs"]+sum(f["timingsMs"][key]
            for key in dependencies) for f in frames])
    return out


def run_clip(clip, root, work, exe, model, flow_provider=None, cached=None, deadline=None):
    _deadline(deadline)
    from assist_scene_cohort_loom import CohortWindowLoom
    from assist_scene_learned_region import LearnedCohortWindowLoom
    from assist_scene_direct_window import DirectWindowMotion
    from assist_scene_m3d_study import BoxBaseline
    started = perf_counter(); preparation = []
    frames, samples, shapes = [], [], []
    origin = clip["frames"][0]["timestampUs"]
    for index, source in enumerate(clip["frames"]):
        _deadline(deadline)
        tick = perf_counter(); folder = work/str(index); folder.mkdir()
        staged, selected, dimensions = stage({"frames": [source]}, root, folder)
        frames.extend(staged); samples.append((index, (source["timestampUs"]-origin)/1000., selected[0][2])); shapes.extend(dimensions)
        preparation.append((perf_counter()-tick)*1000.)
    staging_wall = (perf_counter()-started)*1000.
    found, batch_wall, batches = ({}, None, 0) if cached else previous._detect_batched(samples, exe, model)
    _deadline(deadline)
    engines = {"C": DirectWindowMotion()}
    if cached is None:
        engines.update(A=CohortWindowLoom(), B=LearnedCohortWindowLoom(flow_provider), S=BoxBaseline())
    rows = []
    for index, frame in enumerate(frames):
        _deadline(deadline)
        h, w, nh, nw = shapes[index]
        tick = perf_counter(); gray = read_frame(samples[index][2], cv2.IMREAD_GRAYSCALE); decode = (perf_counter()-tick)*1000.
        tick = perf_counter(); native = previous._read_native(root/frame["path"], frame["sha256"])
        native_gray = cv2.cvtColor(native, cv2.COLOR_BGR2GRAY); native_decode = (perf_counter()-tick)*1000.
        _require(gray.shape == (h, w) and native_gray.shape == (nh, nw), "Wrong native/working exposure geometry")
        at = samples[index][1]; gap = index in DROPPED.get(clip["id"], ())
        if cached:
            old = cached["frames"][index]
            boxes = parse_detect({"width": w, "height": h, "orientation": 1, "tracks": old["detections"]}, w, h)
            observation, detector_ms = None, old["detectorObservationMs"]
        else:
            found_at, observation = found[index]
            _require(found_at == at, "Detector source clock changed")
            boxes = [] if gap else parse_detect(observation, w, h)
            detector_ms = observation["detectionMs"]
        row = {"token": frame["token"], "timestampUs": frame["timestampUs"], "timeMs": at, "index": index,
               "sourceSha256": frame["sha256"], "width": w, "height": h, "nativeWidth": nw, "nativeHeight": nh,
               "cameraIntrinsics": deepcopy(frame.get("intrinsics")), "cameraToWorld": deepcopy(frame.get("cameraToWorld")),
               "detectorGapInjected": gap, "detections": [b.record(w, h) for b in boxes], "oldObservation": observation,
               "detectorObservationMs": detector_ms, "learnedFlow": {}, "flowDirectionCalls": {},
               "timingsMs": {"fullPreparation": preparation[index], "sharedPrep": decode+native_decode,
                             "workingDecode": decode, "nativeDecode": native_decode}}
        if cached:
            for name, source_name in (("A", "A"), ("B", "C"), ("S", "S")):
                row[name] = deepcopy(old[source_name]); row["timingsMs"][name] = old["timingsMs"][source_name]
            row["learnedFlow"]["B"] = deepcopy(old["learnedFlow"]["C"])
            row["flowDirectionCalls"]["B"] = old["flowDirectionCalls"]["C"]
        else:
            for name in ("A", "B", "S"):
                cv2.setRNGSeed(650500+index); before = flow_provider.direction_calls; tick = perf_counter()
                result = engines[name].update(frame, at, gray, boxes, native_gray=native_gray) if name != "S" else engines[name].update(frame, at, gray, boxes)
                row[name] = output(result, at); row["timingsMs"][name] = (perf_counter()-tick)*1000.
                if name == "B":
                    row["learnedFlow"][name] = [dict(r, token=frame["token"], timeMs=at, sourceSha256=frame["sha256"]) for r in engines[name].drain_trace()]
                    row["flowDirectionCalls"][name] = flow_provider.direction_calls-before
        cv2.setRNGSeed(650500+index); tick = perf_counter()
        row["C"] = output(engines["C"].update(frame, at, gray, boxes, native_gray=native_gray, camera_surface=row["A"]), at)
        row["timingsMs"]["C"] = (perf_counter()-tick)*1000.
        for name in LANES:
            lane_contract(row[name], at, gap)
            if name in ("A", "B"): cohort_contract(row[name], at)
        track_contract(row); flow_contract(row); direct_contract(row, rows)
        rows.append(row)
        _deadline(deadline)
    return {"id": clip["id"], "detectorConfiguration": DETECTOR_CONFIGURATION,
            "detectorCalls": 0 if cached else len(samples), "detectorBatches": batches,
            "detectorBatchWallMs": batch_wall, "flowDirectionCalls": 0 if cached else sum(f["flowDirectionCalls"]["B"] for f in rows),
            "stageWallMs": staging_wall, "studyWallMs": (perf_counter()-started)*1000., "frames": rows}


def replay(args):
    replay_started = perf_counter(); deadline = replay_started+MAX_SECONDS
    inputs, root = load_input(args.input)
    count = sum(len(c["frames"]) for c in inputs["clips"])
    _require(inputs["dataset"] in {"Boreas-real", "synthetic-m3c"} and 1 <= count <= MAX_FRAMES, "Unknown or excessive input")
    _require(not args.output.exists() and not args.output.is_symlink(), "Choose a new output")
    _require(shutil.disk_usage(args.output.parent).free >= 10*1024**3, "Less than 10 GB free")
    development = bool(args.development_only); path = args.cached_observations
    _require(bool(path) == development and (not development or count == 99), "Development cache scope mismatch")
    exe, model = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    fingerprint, exe_hash, hashes = sha256(args.input), sha256(exe), model_hashes(model)
    cached = load_cache(path, inputs, fingerprint, exe_hash, hashes) if path else None
    _deadline(deadline)
    before = {name: sha256(HERE/name) for name in CODE}
    startup = 0.; flow = None
    if not development:
        from assist_scene_learned_region import TorchvisionRaftSmall
        tick = perf_counter(); flow = TorchvisionRaftSmall(args.flow_weights, device=args.device); startup = (perf_counter()-tick)*1000.
    cv2.setNumThreads(1); rows = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3l-{date.today():%Y%m%d}-", dir=args.output.parent) as folder:
        for index, clip in enumerate(inputs["clips"]):
            _deadline(deadline)
            print(f"Replay {clip['id']} ({len(clip['frames'])} exposures, M3L)", flush=True)
            work = Path(folder)/str(index); work.mkdir()
            rows.append(run_clip(clip, root, work, exe, model, flow, cached["clips"][index] if cached else None, deadline))
            _deadline(deadline)
    after = {name: sha256(HERE/name) for name in CODE}
    _require(before == after, "Output-affecting source changed during replay")
    result = {"schemaVersion": 1, "study": "M3L", "dataset": inputs["dataset"], "inputSha256": fingerprint,
        "developmentOnly": development, "device": args.device, "platform": platform.platform(),
        "opencv": cv2.__version__, "numpy": np.__version__, "policies": policy_snapshot(), "codeSha256": after,
        "lanes": {"A": "old YOLO, frozen DIS cohorts", "B": "same old YOLO, frozen RAFT cohorts", "C": "same old YOLO, direct template/ECC windows", "S": "old boxes diagnostic, not fallback"},
        "detectorProvenance": {"kind": "development-historical-M3K-A-C-plus-fresh-direct" if development else "actual-local-CoreML-and-PyTorch",
            "cacheSha256": sha256(path) if path else None, "baselineTimings": "historical, not current execution" if development else "actual current execution"},
        "sceneqaSha256": exe_hash, "yoloModelHashes": hashes, "learnedFlowModel": deepcopy(cached["learnedFlow"]) if cached else dict(flow.metadata),
        "flowStartupMs": startup, "clips": rows, "maxWallSeconds": MAX_SECONDS,
        "replayWallMs": (perf_counter()-replay_started)*1000.,
        "timingScope": "Development A/B/S engine and detector samples are historical, not new execution. Fresh A/B/S product samples sum current lane detector sample, staging, shared pixel preparation and complete engine wall. CoreML sample only measures Vision perform, so totals are lower bounds. C consumes A camera/identity surface and must include A wall as dependency; C product sums detector+prep+A+C. B includes RAFT inside engine wall, not added twice. Startup/study wall remain separate; no phone or real-time claim."}
    receipt_contract(result)
    return result


def score(receipt, truth, inputs=None, cache=None):
    finite_payload(receipt); finite_payload(truth); receipt_contract(receipt)
    if inputs is not None:
        bind_input(receipt, inputs)
        for clip, source in zip(receipt["clips"], inputs["clips"], strict=True):
            for frame, actual in zip(clip["frames"], source["frames"], strict=True):
                _require(frame["sourceSha256"] == actual["sha256"], "Wrong source fingerprint")
                expected_intrinsics = (np.diag((frame["width"]/frame["nativeWidth"], frame["height"]/frame["nativeHeight"], 1.))
                                       @ np.asarray(actual["intrinsics"], dtype=np.float64)).tolist()
                _require(independent._same(frame.get("cameraIntrinsics"), expected_intrinsics)
                         and independent._same(frame.get("cameraToWorld"), actual["cameraToWorld"]),
                         "Appearance competition camera geometry differs from source manifest")
            for frame, actual in zip(clip["frames"], source["frames"], strict=True):
                k = np.diag((frame["width"]/frame["nativeWidth"], frame["height"]/frame["nativeHeight"], 1.)) @ np.asarray(actual["intrinsics"])
                _require(independent._same(frame.get("cameraIntrinsics"), k.tolist())
                         and independent._same(frame.get("cameraToWorld"), actual["cameraToWorld"]),
                         "Appearance competition camera geometry differs from source input")
    _require(truth.get("schemaVersion") == 1 and truth.get("inputSha256") == receipt["inputSha256"]
             and [c["id"] for c in truth["clips"]] == [c["id"] for c in receipt["clips"]], "Wrong reviewed input")
    _require(not receipt["developmentOnly"] or cache is not None, "Development scoring requires original baseline cache")
    contract = legacy_score(); totals = {n: Counter(contract.empty()) for n in LANES}; clips = []; all_frames = []
    for clip_index, (clip, ref) in enumerate(zip(receipt["clips"], truth["clips"], strict=True)):
        labels = {f["token"]: f for f in ref["frames"]}; frames = clip["frames"]
        _require(len(labels) == len(ref["frames"]) and len({f["token"] for f in frames}) == len(frames)
                 and labels.keys() <= {f["token"] for f in frames}, "Duplicate or missing exact reviewed exposure")
        stats = {n: contract.empty() for n in LANES}; history = []; previous_stamp = None; origin = frames[0]["timestampUs"]
        for index, frame in enumerate(frames):
            at, stamp = frame["timeMs"], frame["timestampUs"]
            _require(type(stamp) is int and stamp >= 0 and (previous_stamp is None or stamp > previous_stamp)
                     and previous._number(at) and abs(at-(stamp-origin)/1000.) < 1e-6 and frame["index"] == index,
                     "Wrong exact stream clock")
            previous_stamp = stamp
            _require(type(frame.get("detectorGapInjected")) is bool and frame["detectorGapInjected"] == (index in DROPPED.get(clip["id"], ()))
                     and (not frame["detectorGapInjected"] or not frame["detections"]), "Wrong deterministic detector gap")
            if receipt["developmentOnly"]:
                old = cache["clips"][clip_index]["frames"][index]
                _require(all(frame[k] == old[k] for k in ("token", "timestampUs", "timeMs", "sourceSha256"))
                         and independent._same(frame["detections"], old["detections"])
                         and all(independent._same(frame[new], old[original]) for new, original in (("A", "A"), ("B", "C"), ("S", "S"))),
                         "Historical baseline surface changed")
            else:
                observation = frame.get("oldObservation")
                _require(isinstance(observation, dict) and observation.get("detectionMs") == frame["detectorObservationMs"], "Missing actual old detector observation")
                expected = [] if frame["detectorGapInjected"] else [b.record(frame["width"], frame["height"]) for b in parse_detect(observation, frame["width"], frame["height"])]
                _require(expected == frame["detections"], "Current detections differ from raw old detector")
            for lane in LANES:
                lane_contract(frame[lane], at, frame["detectorGapInjected"])
                if lane in ("A", "B"): cohort_contract(frame[lane], at)
            track_contract(frame); flow_contract(frame); direct_contract(frame, history)
            known = labels.get(frame["token"])
            _require(known is None or known["timestampUs"] == stamp, "Reviewed clock differs from exposure")
            targets = None if known is None else [{**t, "motion": {"approaching": "moving", "not-approaching": "stationary", "unknown": "unknown"}[t["approach"]]} for t in known["targets"]]
            for lane in LANES:
                contract.score_frame(frame, lane, targets, stats[lane])
                if ref.get("allSceneNegative"): stats[lane]["allSceneFalseNotices"] = stats[lane].get("allSceneFalseNotices", 0)+len(frame[lane]["events"])
            history.append(frame); all_frames.append(frame)
        for lane in LANES: totals[lane].update(stats[lane])
        clips.append({"id": clip["id"], "lanes": stats, "identityLifecycle": {n: lifecycle_summary(frames, n) for n in ("A", "B")}})
    timing = _timing_values(all_frames)
    return {"schemaVersion": 1, "study": "M3L", "dataset": receipt["dataset"], "inputSha256": receipt["inputSha256"],
            "developmentOnly": receipt["developmentOnly"], "unit": "reviewed target-keyframe", "frames": len(all_frames),
            "noMetreChecks": len(all_frames)*len(LANES), "totals": totals, "clips": clips, "stageMs": timing,
            "codeSha256": receipt["codeSha256"], "detectorProvenance": receipt["detectorProvenance"],
            "learnedFlowModel": receipt["learnedFlowModel"], "timingScope": receipt["timingScope"],
            "limits": "Physical approach labels unchanged; optical expansion is not metric range or universal radial closing. Unknown/unmatched/unreviewed remain separate. Development is not unseen evidence. No phone, real-time, commercial clearance or safety acceptance."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); modes = parser.add_subparsers(dest="mode", required=True)
    for mode, keys in (("replay", ("input", "sceneqa", "yolo", "flow-weights", "output")), ("score", ("input", "truth", "receipt", "output"))):
        sub = modes.add_parser(mode)
        for key in keys: sub.add_argument("--"+key, type=Path, required=True)
        sub.add_argument("--cached-observations", type=Path)
        if mode == "replay":
            sub.add_argument("--development-only", action="store_true"); sub.add_argument("--device", choices=("mps", "cpu"), required=True)
    args = parser.parse_args()
    if args.mode == "replay": result = replay(args)
    else:
        receipt = read_json(args.receipt, 64*1024**2); inputs, _ = load_input(args.input)
        _require(receipt["inputSha256"] == sha256(args.input), "Receipt/input hash mismatch")
        cache = read_json(args.cached_observations, 64*1024**2) if args.cached_observations else None
        _require(not receipt["developmentOnly"] or args.cached_observations and sha256(args.cached_observations) == receipt["detectorProvenance"]["cacheSha256"], "Wrong original cache bytes")
        result = score(receipt, read_json(args.truth, 2*1024**2), inputs, cache)
        result.update(receiptSha256=sha256(args.receipt), truthSha256=sha256(args.truth))
        print(json.dumps(result["totals"], indent=2))
    write_new(args.output, result)
