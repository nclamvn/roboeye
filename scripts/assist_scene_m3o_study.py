#!/usr/bin/env python3
"""M3O bounded QA: detector coverage and retained correspondence diagnosis.

Truth is joined only by diagnose, after frozen M3N inference. No model or
image is opened by this diagnostic. Oracle comparisons are not deployment.
"""

import argparse
from collections import Counter
from math import ceil
from pathlib import Path
from time import perf_counter

import assist_scene_m3n_study as frozen
from diagnose_assist_scene_m3k_misses import matching_graph
from assist_scene_m3e_study import legacy_score, write_new
from assist_scene_motion import sha256
from assist_scene_m3h_study import read_json


MAX_DIAG_BYTES = 4*1024**2
DATA_RIGHTS = [
    {"dataset": "KITTI", "type": "real driving with labelled flow", "status": "commercial-use-not-permitted-under-published-terms", "source": "https://www.cvlibs.net/datasets/kitti/privacy_policy.php"},
    {"dataset": "MPI Sintel", "type": "rendered labelled flow", "status": "commercial-use-not-permitted-under-published-terms", "source": "https://sintel.is.tue.mpg.de/license"},
    {"dataset": "Freiburg SceneFlow", "type": "rendered labelled flow", "status": "commercial-use-not-permitted-under-published-terms", "source": "https://lmb.informatik.uni-freiburg.de/resources/datasets/SceneFlowDatasets.en.html"},
    {"dataset": "Spring", "type": "rendered labelled flow, not real driving", "status": "official-dataset-CC-BY-4.0-verified-attribution-required", "source": "https://darus.uni-stuttgart.de/dataset.xhtml?persistentId=doi:10.18419/darus-3376"},
    {"dataset": "HD1K", "type": "real driving with labelled flow", "status": "commercial-clearance-NOT-ESTABLISHED-accessible-primary-page-lacks-terms", "source": "https://hci.iwr.uni-heidelberg.de/content/hd1k-benchmark-suite"},
    {"dataset": "Middlebury Flow", "type": "mixed real and rendered labelled flow", "status": "commercial-clearance-NOT-ESTABLISHED", "source": "https://vision.middlebury.edu/flow/"},
]


def geometry(box, frame):
    x, y, right, bottom = box
    side = min(right-x, bottom-y)
    edge = min(x, y, frame["width"]-right, frame["height"]-bottom)
    return {"box": box, "minimumWorkingSidePx": side, "minimumEdgePx": edge,
        "belowFrozen18px": side < 18., "violatesFrozen4pxEdge": edge < 4.,
        "nccAttempted": None}


def pair_diagnosis(pair, diagnostics, frames):
    if pair is None: return None
    result = {key: pair.get(key) for key in ("fieldId", "reason", "supported", "unverifiable", "startToken", "endToken", "startDetectionIndex", "endDetectionIndex", "scoreLower", "scoreUpper", "observationMs", "linearLogGrowthLowerBound", "linearLogGrowthUpperBound")}
    result["association"] = pair.get("association")
    if "startBox" not in pair: return result
    old, current = frames[pair["startToken"]], frames[pair["endToken"]]
    result["sourceGeometry"] = geometry(pair["startBox"], old)
    result["currentGeometry"] = geometry(pair["endBox"], current)
    catalog = {p["populationId"]: p for p in diagnostics.get("populations", [])}
    result["directions"] = {}
    for direction, location in (("forward", "sourceGeometry"), ("reverse", "currentGeometry")):
        value = pair[direction]; entry = catalog.get(value.get("populationId")); population = entry["proof"] if entry else None
        proof = {key: value.get(key) for key in ("seedPoints", "verifiedPoints", "assignedPoints", "unknownPoints", "points", "reason", "supported", "populationId", "populationSha256", "selectionSha256", "linearLogGrowth", "maxSupportedFitResidualPx", "maxSupportedCyclePx")}
        proof["requiredAssignedPoints"] = ceil(max(9., .70*value["seedPoints"]))
        proof["measuredFractionOfOriginalN"] = value["verifiedPoints"]/value["seedPoints"] if value["seedPoints"] else None
        if population is not None:
            frozen._require(entry["populationSha256"] == frozen.canonical_hash(population), "Changed retained point catalog")
            proof.update(populationStatus=population["status"], pointReasonCounts=population.get("reasonCounts"),
                oldWorkingSha256=population.get("oldWorkingSha256"), newWorkingSha256=population.get("newWorkingSha256"))
            result[location]["nccAttempted"] = population["status"] == "measured"
        result["directions"][direction] = proof
    return result


def diagnose(receipt, truth, inputs=None):
    """All reviewed positives, full competing-target matcher, no GT inference."""
    started = perf_counter(); frozen.receipt_contract(receipt)
    frozen._require(receipt["study"] == "M3N" and receipt["developmentOnly"] is False
        and truth["inputSha256"] == receipt["inputSha256"], "Diagnosis requires actual bound M3N holdout")
    if inputs is not None: frozen.bind_input(receipt, inputs)
    scorer = legacy_score(); cases = []; summary = Counter(); reasons = {lane: Counter() for lane in "ABC"}
    points = {lane: Counter() for lane in "BC"}; point_reasons = {lane: Counter() for lane in "BC"}
    frozen._require([c["id"] for c in receipt["clips"]] == [c["id"] for c in truth["clips"]], "Different reviewed clip sets")
    for clip, reference in zip(receipt["clips"], truth["clips"], strict=True):
        frames = {f["token"]: f for f in clip["frames"]}
        for reviewed in reference["frames"]:
            frame = frames[reviewed["token"]]
            frozen._require(frame["timestampUs"] == reviewed["timestampUs"], "Reviewed clock changed")
            raw = matching_graph(frame["detections"], reviewed["targets"], scorer)
            tracks = matching_graph(frame["T"]["tracks"], reviewed["targets"], scorer)
            for target_index, target in enumerate(reviewed["targets"]):
                if target["approach"] != "approaching": continue
                raw_hit, hit = raw["hits"].get(target_index), tracks["hits"].get(target_index)
                case = {"clipId": clip["id"], "frameIndex": frame["index"], "frameToken": frame["token"],
                    "timeMs": frame["timeMs"], "sourceSha256": frame["sourceSha256"], "target": target,
                    "rawDetectionMatch": raw_hit, "currentTrackMatch": hit, "cameraStatus": frame["T"]["status"],
                    "maxSameFamilyRawIoU": max((scorer.iou(d["box"], target["box"]) for d in frame["detections"] if scorer.family(d["label"]) == target["classFamily"]), default=0.),
                    "rawAmbiguousReportIndices": raw["ambiguousReportIndexes"], "lanes": {}}
                summary["positiveTargetKeyframes"] += 1; summary[target["classFamily"]+"Positives"] += 1
                summary["currentRawCriterionMatch" if raw_hit else "currentRawCriterionFailure"] += 1
                if hit is None:
                    summary["currentTrackCriterionFailure"] += 1
                    for lane in "ABC": reasons[lane]["current-detector-or-handle-criterion-failure"] += 1
                else:
                    summary["currentTrackCriterionMatch"] += 1
                    j = hit["reportIndex"]; ident = frame["T"]["tracks"][j]["id"]; case["currentHandle"] = ident
                    for lane in "ABC":
                        diag = frame[lane]["diagnostics"]; proof = diag["windowEvidence"][str(ident)]
                        reason = diag["trackReasons"][str(ident)]; reasons[lane][reason] += 1
                        related = [p for p in diag["comparisons"] if p["endDetectionIndex"] == j]
                        fresh = pair_diagnosis(proof.get("fresh"), diag, frames)
                        case["lanes"][lane] = {"firstVeto": reason, "currentComparisonCount": len(related),
                            "supportedCurrentComparisons": sum(p["supported"] for p in related),
                            "fresh": fresh, "anchor": pair_diagnosis(proof.get("anchor"), diag, frames),
                            "growthUnavailable": "UNKNOWN when no supported pair serialized numeric growth"}
                        if lane in "BC" and fresh is not None and fresh.get("unverifiable") is False:
                            for direction in fresh["directions"].values():
                                points[lane].update(populations=1, originalSeeds=direction["seedPoints"], verified=direction["verifiedPoints"], assigned=direction["assignedPoints"])
                                point_reasons[lane].update(direction.get("pointReasonCounts") or {})
                cases.append(case)
    supported = {lane: sum(p["supported"] for c in receipt["clips"] for f in c["frames"] for p in f[lane]["diagnostics"]["comparisons"]) for lane in "ABC"}
    return {"schemaVersion": 1, "study": "M3O-M3N-posthoc-diagnosis", "inputSha256": receipt["inputSha256"],
        "matching": {"sameFamilyIoU": scorer.IOU, "competingTargetMargin": scorer.MARGIN, "duplicateAssignments": "all ambiguous, excluded"},
        "summary": dict(summary), "firstVetoByLane": reasons, "selectedMeasuredFreshPopulations": {lane: {**points[lane], "pointReasons": point_reasons[lane]} for lane in "BC"},
        "allRawSupportedComparisons": supported, "cases": cases, "wallMs": 1000*(perf_counter()-started),
        "actualNewModelDirectionCalls": 0,
        "licensingResearch": {"checked": "2026-11-16", "downloads": 0, "datasets": DATA_RIGHTS,
            "scope": "Per-dataset primary terms, not a claim all labelled datasets are unusable. No independent real dense-flow benchmark cleared or used in this trial."},
        "limits": ["Posthoc labels never entered inference.", "Selected old boxes are hypotheses, not GT-confirmed physical correspondences.",
            "A size-vetoed population did not attempt NCC: selected corners do not prove successful correspondence.",
            "No dense labelled flow in Boreas receipt: flow endpoint error and source of NCC failures remain UNKNOWN.",
            "Known-box/known-flow oracle tests diagnose ceilings only; GT injection is not a deployable result."]}


# Additive M3O execution below. Frozen M3N inference files remain unchanged.

import json
from copy import deepcopy
from datetime import date
from hashlib import sha256 as content_sha256
import platform
import shutil
import sys
import tempfile
import cv2
import numpy as np
from assist_scene_m3e_study import output, read_frame, DROPPED
from assist_scene_m3f_study import stage
from assist_scene_m3g_study import lane_contract, finite_payload, model_hashes, DETECTOR_CONFIGURATION, _percentiles, bind_input
from assist_scene_motion import parse_detect
from assist_scene_motion_m3c import load_input
import audit_assist_scene_m3k as audit

HERE = Path(__file__).resolve().parent
LANES, GLOBAL_LANES, SURFACES = frozen.LANES, frozen.GLOBAL_LANES, frozen.SURFACES
MAX_FRAMES, MAX_SECONDS, MAX_BYTES = 100, 1800, frozen.MAX_BYTES
CODE = tuple(dict.fromkeys((*frozen.CODE, "assist_scene_m3o_study.py", "assist_scene_m3o_correspondence_audit.py", "diagnose_assist_scene_m3k_misses.py", "fetch-assist-scene-boreas-slice.py")))
old = frozen.old
_require, _number, _digest = frozen._require, frozen._number, frozen._digest
_view, _bounds, direction_contract, canonical_hash = frozen._view, frozen._bounds, frozen.direction_contract, frozen.canonical_hash
track_contract = frozen.track_contract
KINDS = {"A": "actual-local-pretrained-torchvision-global", "B": "opencv-variational-refinement-of-global-provider", "C": "opencv-dis-full-working-input"}


def policy_snapshot():
    from assist_scene_m3o_correspondence_audit import POLICY
    return {"frozenM3N": frozen.policy_snapshot(), "correspondence": json.loads(json.dumps(dict(POLICY))), "lanes": KINDS}


def sum_calls(rows):
    return {lane: {kind: sum(f["actualCalls"][lane][kind] for f in rows) for kind in ("raft", "refinement", "dis")} for lane in GLOBAL_LANES}


def receipt_contract(receipt):
    from assist_scene_global_field import POLICY as FIELD
    from assist_scene_m3o_correspondence_audit import VR_DEFAULTS, NativeDis
    _require(receipt.get("study") == "M3O" and receipt.get("schemaVersion") == 1 and receipt.get("developmentOnly") is False
        and 1 <= sum(len(c["frames"]) for c in receipt["clips"]) <= MAX_FRAMES
        and receipt.get("codeSha256") == {n: sha256(HERE/n) for n in CODE} and receipt.get("policies") == policy_snapshot()
        and receipt.get("opencv") == cv2.__version__ and receipt.get("numpy") == np.__version__ and receipt.get("device") == "mps",
        "Wrong M3O scope, frozen source, runtime or policies")
    _require(receipt.get("maxWallSeconds") == MAX_SECONDS and receipt.get("maxReceiptBytes") == MAX_BYTES
        and _number(receipt.get("replayWallMs")) and receipt["replayWallMs"] <= MAX_SECONDS*1000 and _number(receipt.get("modelStartupMs")), "Missing/exceeded actual execution budget")
    providers = receipt["providers"]; base = providers["A"]
    _require(set(providers) == set(GLOBAL_LANES) and all(providers[lane].get("kind") == KINDS[lane] for lane in GLOBAL_LANES)
        and base.get("policy") == dict(FIELD) and base.get("weightsSha256") == FIELD["weightSha256"] and base.get("device") == "mps"
        and base.get("algorithm") == FIELD["algorithm"] and base.get("weights") == FIELD["weights"] and base.get("weightUrl") == FIELD["weightUrl"]
        and base.get("modelSharing") == "owned-provider" and base.get("torch") and base.get("torchvision")
        and providers["B"].get("baseline") == base and providers["B"].get("refinement") == VR_DEFAULTS
        and providers["B"].get("modelSharing") == "same-sequential-global-provider"
        and providers["B"].get("algorithm") == "raft-small-global-plus-opencv-variational-defaults" and providers["B"].get("opencv") == cv2.__version__
        and providers["C"] == NativeDis().metadata, "Wrong one-resident-model/refinement/DIS provenance or defaults")
    _require(receipt.get("detectorProvenance") == {"kind": "actual-local-CoreML-no-cached-observations"}
        and _digest(receipt.get("sceneqaSha256")) and receipt.get("yoloModelHashes") and all(_digest(v) for v in receipt["yoloModelHashes"].values()), "Wrong actual detector provenance")
    for clip in receipt["clips"]:
        size = len(clip["frames"])
        for row in clip["frames"]:
            _require(set(row["flowDirectionCalls"]) == set(GLOBAL_LANES) and set(row["actualCalls"]) == set(GLOBAL_LANES), "Missing actual lane counters")
            for lane in GLOBAL_LANES:
                directions = row["flowDirectionCalls"][lane]
                _require(type(directions) is int and directions in (0, 2, 4)
                    and row["actualCalls"][lane] == {"raft": directions if lane != "C" else 0,
                        "refinement": directions if lane == "B" else 0, "dis": directions if lane == "C" else 0}, "CPU directions counted as model inference or actual work omitted")
        totals = {lane: sum(f["flowDirectionCalls"][lane] for f in clip["frames"]) for lane in GLOBAL_LANES}
        _require(clip["detectorConfiguration"] == DETECTOR_CONFIGURATION and clip["detectorCalls"] == size
            and clip["detectorBatches"] == (size+49)//50 and clip["actualFlowDirectionCallsByLane"] == totals
            and clip["actualFlowDirectionCalls"] == sum(totals.values()) and clip["actualCalls"] == sum_calls(clip["frames"]), "Actual detector/field call accounting differs")
    expected = {kind: sum(c["actualCalls"][lane][kind] for c in receipt["clips"] for lane in GLOBAL_LANES) for kind in ("raft", "refinement", "dis")}
    _require(receipt.get("actualCalls") == expected, "Trial actual inference/refinement/DIS counters differ")


def run_clip(clip, root, work, exe, model, providers, deadline=None, clip_index=None):
    initial = {"raft": providers["A"].direction_calls, "refinement": providers["B"].refinement_calls, "dis": providers["C"].direction_calls}
    progress = {"clipId": clip.get("id"), "clipIndex": clip_index, "frameIndex": None, "phase": "start", "completedValidatedRows": 0,
        "completedActualLaneOutputs": {lane: 0 for lane in GLOBAL_LANES}, "actualDirectionCallsByLane": {lane: 0 for lane in GLOBAL_LANES}}
    try: return _run_clip(clip, root, work, exe, model, providers, deadline, progress)
    except Exception as error:
        totals = {"raft": providers["A"].direction_calls, "refinement": providers["B"].refinement_calls, "dis": providers["C"].direction_calls}
        failure = {"schemaVersion": 1, "study": "M3O", "status": "FAILED-INCOMPLETE-NOT-SCORABLE", **progress,
            "actualTotalCalls": totals, "actualClipCalls": {k: totals[k]-initial[k] for k in totals}, "errorType": type(error).__name__, "error": str(error)[:512]}
        error.m3o_failure = failure
        print("M3O_FAILURE "+json.dumps(failure, separators=(",", ":"), allow_nan=False), file=sys.stderr, flush=True)
        raise


def replay(args):
    started = perf_counter(); deadline = started+MAX_SECONDS; inputs, root = load_input(args.input)
    _require(1 <= sum(len(c["frames"]) for c in inputs["clips"]) <= MAX_FRAMES and args.device == "mps"
        and not args.output.exists() and not args.output.is_symlink(), "New bounded actual M3O replay requires explicit MPS")
    _require(shutil.disk_usage(args.output.parent).free >= 10*1024**3, "Less than 10 GB free")
    exe, model = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    input_hash, exe_hash, hashes = sha256(args.input), sha256(exe), model_hashes(model)
    before = {name: sha256(HERE/name) for name in CODE}
    sources = {f["path"]: f["sha256"] for c in inputs["clips"] for f in c["frames"]}
    _require(all(sha256(root/path) == digest for path, digest in sources.items()), "Input source bytes changed")
    from assist_scene_global_field import GlobalRaftSmall
    from assist_scene_m3o_correspondence_audit import VariationalRefinedRaft, NativeDis
    cv2.setNumThreads(1); tick = perf_counter(); base = GlobalRaftSmall(args.flow_weights, device=args.device)
    providers = {"A": base, "B": VariationalRefinedRaft(base), "C": NativeDis()}; startup = 1000*(perf_counter()-tick); clips = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3o-{date.today():%Y%m%d}-", dir=args.output.parent) as temp:
        for index, clip in enumerate(inputs["clips"]):
            work = Path(temp)/str(index); work.mkdir()
            print(f"Replay {clip['id']} M3O ({len(clip['frames'])} exposures)", flush=True)
            try: clips.append(run_clip(clip, root, work, exe, model, providers, deadline, clip_index=index))
            except Exception as error:
                failure = {**getattr(error, "m3o_failure", {}), "inputSha256": input_hash, "codeSha256": before,
                    "completedClips": len(clips), "replayWallMs": 1000*(perf_counter()-started), "modelStartupMs": startup}
                sidecar = args.output.with_name(args.output.stem+"-failure.json")
                if not sidecar.exists() and not sidecar.is_symlink(): write_new(sidecar, failure)
                raise
    _require(before == {name: sha256(HERE/name) for name in CODE} and sha256(args.input) == input_hash and sha256(exe) == exe_hash
        and model_hashes(model) == hashes and sha256(args.flow_weights) == providers["A"].metadata["weightsSha256"]
        and all(sha256(root/path) == digest for path, digest in sources.items()), "Source/model/input/implementation drift")
    measured = {"raft": sum(c["actualCalls"][lane]["raft"] for c in clips for lane in GLOBAL_LANES),
        "refinement": sum(c["actualCalls"]["B"]["refinement"] for c in clips), "dis": sum(c["actualCalls"]["C"]["dis"] for c in clips)}
    _require(measured == {"raft": base.direction_calls, "refinement": providers["B"].refinement_calls, "dis": providers["C"].direction_calls}, "Actual resident/provider counters differ from receipt")
    result = {"schemaVersion": 1, "study": "M3O", "dataset": inputs["dataset"], "inputSha256": input_hash, "developmentOnly": False,
        "device": args.device, "opencv": cv2.__version__, "numpy": np.__version__, "platform": platform.platform(), "codeSha256": before,
        "policies": policy_snapshot(), "maxWallSeconds": MAX_SECONDS, "maxReceiptBytes": MAX_BYTES, "replayWallMs": 1000*(perf_counter()-started),
        "sceneqaSha256": exe_hash, "yoloModelHashes": hashes, "providers": {k: dict(p.metadata) for k,p in providers.items()},
        "modelStartupMs": startup, "clips": clips, "actualCalls": measured, "detectorProvenance": {"kind": "actual-local-CoreML-no-cached-observations"},
        "lanes": {"A": "frozen M3N warped+RAFT", "B": "same warped engine+RAFT then default CPU variational refinement", "C": "same warped engine+default CPU DIS", "T": "shared frozen DIS camera/handles", "S": "bbox diagnostic, not fallback"},
        "counterScope": "flowDirectionCalls and frozen globalFields.modelDirectionCalls are logical field directions; provider modelDirectionCalls and actualCalls alone classify RAFT inference vs CPU VR/DIS. B baseline RAFT is counted once, not again as A.",
        "timingScope": "Actual fixed sequential A->B->C, one resident RAFT shared A/B. Warm/order effects uncontrolled, no speed superiority claim. Product lane includes CoreML perform-only lower-bound detector timing, preparation, common T, own engine wall (including its own RAFT/refinement/DIS), never other candidate lanes or duplicate flow sums. Startup and sequential total wall separate. S excludes T. No phone/real-time/commercial acceptance."}
    receipt_contract(result); return result


def provider_contract(field, frame, lane):
    from assist_scene_global_field import geometry as raft_geometry
    provider = field.get("provider", {})
    _require(field.get("providerKind") == KINDS[lane] and field.get("modelDirectionCalls") == 2
        and field.get("fieldShapes") == [[frame["height"], frame["width"], 2]]*2
        and set(field.get("fieldSha256", {})) == {"forward", "backward"} and all(_digest(v) for v in field["fieldSha256"].values())
        and provider.get("status") == "field-supported" and provider.get("outputShape") == [frame["height"], frame["width"], 2]
        and _number(field.get("wallMs")) and _number(provider.get("wallMs")) and provider["wallMs"] <= field["wallMs"]+.001,
        "Wrong actual provider identity, working field or wall cost")
    if lane == "C":
        _require(provider.get("device") == "cpu" and provider.get("roiShape") == [frame["height"], frame["width"]]
            and provider.get("modelDirectionCalls") == 0 and provider.get("directionCalls") == 2 and provider.get("refinementDirectionCalls") == 0,
            "DIS directions masquerade as learned model calls")
    else:
        _require(provider.get("device") == "mps" and provider.get("modelDirectionCalls") == 2 and provider.get("flowUpdatesPerDirection") == 12
            and all(audit._same(provider.get(k), v) for k, v in raft_geometry((frame["height"], frame["width"])).items()),
            "Wrong pinned RAFT execution or geometry")
        if lane == "B":
            base = provider.get("baselineProvider", {})
            _require(provider.get("refinementDirectionCalls") == 2 and _number(provider.get("refinementWallMs"))
                and base.get("status") == "field-supported" and base.get("modelDirectionCalls") == 2
                and _number(base.get("wallMs")) and base["wallMs"]+provider["refinementWallMs"] <= provider["wallMs"]+.001
                and all(audit._same(base.get(k), v) for k,v in raft_geometry((frame["height"], frame["width"])).items()),
                "Refinement omits actual baseline/refinement directions or cost")


def global_contract(frame, history, lane):
    from assist_scene_textured_window import POLICY, validate_comparison, validate_pair_proof
    from assist_scene_texture_patches import validate_population, validate_selection
    from assist_scene_global_field import geometry
    surface = frame[lane]; diag = surface["diagnostics"]; fields, comparisons = diag["globalFields"], diag["comparisons"]
    _require(surface.get("mode", diag.get("mode")) == "warped", "Wrong photometric ablation mode")
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
        provider_contract(field, frame, lane)
        for direction, exposure, target in (("forward", origin, frame), ("reverse", frame, origin)):
            for index in range(len(exposure["detections"])):
                pid = f"{fid}|{direction}|{index}"; expected_population_ids.add(pid)
                entry = populations.get(pid, {}); pp = entry.get("proof", {}); selection = pp.get("selection", {})
                validate_selection(selection)
                # selected_origins uses A=T camera aliases. Resolve inventories
                # from the actual lane row, especially M3O's textured lane A.
                actual_exposure = frame if exposure["token"] == frame["token"] else next(row for row in history if row["token"] == exposure["token"])
                source_inventory = actual_exposure[lane]["diagnostics"]["sourceSelections"]
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
                _require(population_proof.get("seedPoints") == n and population_proof.get("mode") == "warped", "Wrong selected denominator or patch mode")
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


def _run_clip(clip, root, work, exe, model, providers, deadline, progress):
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
    found, batch_ms, batches = old.previous.previous._detect_batched(samples, exe, model)
    progress.update(detectorCalls=len(samples), phase="prepared")
    engines = {lane: TexturedGlobalWindowMotion(providers[lane], mode="warped") for lane in GLOBAL_LANES}
    engines.update(T=CohortWindowLoom(), S=BoxBaseline())
    for i, (frame, filename, shape, prep_ms) in enumerate(prepared):
        progress.update(frameIndex=i, phase="frame-preparation")
        old._deadline(deadline); h, w, nh, nw = shape; at = samples[i][1]; gap = i in DROPPED.get(clip["id"], ())
        tick = perf_counter(); gray = read_frame(filename, cv2.IMREAD_GRAYSCALE); working_ms = 1000*(perf_counter()-tick)
        tick = perf_counter(); native = cv2.cvtColor(old.previous.previous._read_native(root/frame["path"], frame["sha256"]), cv2.COLOR_BGR2GRAY); native_ms = 1000*(perf_counter()-tick)
        found_at, observation = found[i]; _require(found_at == at, "Wrong model exposure clock")
        boxes = [] if gap else parse_detect(observation, w, h); detector_ms = observation["detectionMs"]
        row = {"index": i, "token": frame["token"], "timestampUs": frame["timestampUs"], "timeMs": at, "sourceSha256": frame["sha256"],
            "sourcePoseTimestampUs": frame.get("poseTimestampUs"), "sourcePoseEpoch": frame.get("epoch"),
            "workingPixelsSha256": content_sha256(gray.tobytes()).hexdigest(), "width": w, "height": h, "nativeWidth": nw, "nativeHeight": nh,
            "cameraIntrinsics": np.asarray(frame["intrinsics"]).tolist(), "cameraToWorld": np.asarray(frame["cameraToWorld"]).tolist(),
            "detectorGapInjected": gap, "detections": [b.record(w, h) for b in boxes], "oldObservation": observation, "detectorObservationMs": detector_ms,
            "flowDirectionCalls": {}, "timingsMs": {"fullPreparation": prep_ms, "sharedPrep": working_ms+native_ms, "workingDecode": working_ms, "nativeDecode": native_ms}}
        for lane in ("T", "S"):
            cv2.setRNGSeed(650500+i); tick = perf_counter()
            result = engines[lane].update(frame, at, gray, boxes, native_gray=native) if lane == "T" else engines[lane].update(frame, at, gray, boxes)
            row[lane] = output(result, at); row["timingsMs"][lane] = 1000*(perf_counter()-tick)
        row["actualCalls"] = {}
        for lane in GLOBAL_LANES:
            provider = providers[lane]; initial_refinements = getattr(provider, "refinement_calls", 0)
            cv2.setRNGSeed(650500+i); before = provider.direction_calls; tick = perf_counter()
            progress["phase"] = "engine-"+lane
            try:
                row[lane] = output(engines[lane].update(frame, at, gray, boxes, camera_surface=row["T"]), at)
            finally:
                progress["actualDirectionCallsByLane"][lane] += provider.direction_calls-before
            progress["completedActualLaneOutputs"][lane] += 1
            row["actualCalls"][lane] = {"raft": 0 if lane == "C" else provider.direction_calls-before,
                "refinement": getattr(provider, "refinement_calls", 0)-initial_refinements,
                "dis": provider.direction_calls-before if lane == "C" else 0}
            row["timingsMs"][lane] = 1000*(perf_counter()-tick); row["flowDirectionCalls"][lane] = provider.direction_calls-before
        progress["phase"] = "contracts"
        track_contract(row)
        for lane in GLOBAL_LANES: global_contract(row, rows, lane)
        origins_by_lane = [[p["startToken"] for p in row[lane]["diagnostics"]["globalFields"]] for lane in GLOBAL_LANES]
        _require(all(origins == origins_by_lane[0] for origins in origins_by_lane), "Ablations measured different source timestamp pairs")
        rows.append(row); progress["completedValidatedRows"] = len(rows); old._deadline(deadline)
    actual = {lane: sum(f["flowDirectionCalls"][lane] for f in rows) for lane in GLOBAL_LANES}
    return {"id": clip["id"], "frames": rows, "detectorConfiguration": DETECTOR_CONFIGURATION, "detectorCalls": len(rows),
        "detectorBatches": batches, "detectorBatchWallMs": batch_ms, "actualFlowDirectionCallsByLane": actual,
        "actualFlowDirectionCalls": sum(actual.values()), "actualCalls": sum_calls(rows), "stageWallMs": stage_ms, "studyWallMs": 1000*(perf_counter()-started)}


def score(receipt, truth, inputs=None):
    finite_payload(receipt); finite_payload(truth); receipt_contract(receipt)
    _require(truth.get("inputSha256") == receipt["inputSha256"] and truth.get("schemaVersion") == 1
             and [c["id"] for c in truth["clips"]] == [c["id"] for c in receipt["clips"]], "Unbound reviewed truth")
    if inputs is not None: bind_input(receipt, inputs)
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
    return {"schemaVersion": 1, "study": "M3O", "dataset": receipt["dataset"], "inputSha256": receipt["inputSha256"], "developmentOnly": receipt["developmentOnly"],
        "frames": len(all_frames), "noMetreChecks": len(all_frames)*len(SURFACES), "unit": "reviewed target-keyframe", "totals": totals, "clips": results,
        "stageMs": timings, "timingScope": receipt["timingScope"], "codeSha256": receipt["codeSha256"], "detectorProvenance": receipt["detectorProvenance"],
        "limits": "Sparse evaluation labels only; unknown/unmatched/unreviewed notices remain separate. Assistant-reviewed boxes are not independent human acceptance. No metric range, phone, safety, commercial or real-time acceptance."}



def detector_gt_metrics(receipt, truth):
    scorer = legacy_score(); counts = Counter(); families = {}
    for clip, reference in zip(receipt["clips"], truth["clips"], strict=True):
        frames = {f["token"]: f for f in clip["frames"]}
        for reviewed in reference["frames"]:
            frame = frames[reviewed["token"]]; graph = matching_graph(frame["detections"], reviewed["targets"], scorer)
            counts["unmatchedRawReportsOnSparseReviewedFrames"] += len(graph["unmatchedReportIndexes"])
            counts["ambiguousRawReports"] += len(graph["ambiguousReportIndexes"])
            for index, target in enumerate(reviewed["targets"]):
                family = target["classFamily"]; outcome = target["approach"]
                key = family+"-"+outcome; families.setdefault(key, Counter())
                families[key]["reviewedTargets"] += 1; families[key]["criterionMatches"] += int(index in graph["hits"])
    return {"matchingIoU": scorer.IOU, "margin": scorer.MARGIN, "byFamilyAndApproach": families, **counts,
        "limits": "Sparse reviewed visible 2D boxes, not exhaustive detector precision/mAP; unmatched raw boxes may be unreviewed real objects. Visibility omissions are unscorable, not TN."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); modes = parser.add_subparsers(dest="mode", required=True)
    for mode, keys in (("replay", ("input", "sceneqa", "yolo", "flow-weights", "output")),
            ("score", ("input", "truth", "receipt", "output")), ("diagnose", ("input", "truth", "receipt", "output"))):
        sub = modes.add_parser(mode)
        for key in keys: sub.add_argument("--"+key, type=Path, required=True)
        if mode == "replay": sub.add_argument("--device", choices=("mps",), required=True)
    args = parser.parse_args()
    if args.mode == "replay": result = replay(args)
    else:
        receipt, truth, inputs = read_json(args.receipt, MAX_BYTES), read_json(args.truth), read_json(args.input)
        _require(sha256(args.input) == receipt["inputSha256"], "Wrong input bytes")
        result = diagnose(receipt, truth, inputs) if args.mode == "diagnose" else score(receipt, truth, inputs)
        result.update(receiptSha256=sha256(args.receipt), truthSha256=sha256(args.truth), diagnosticSourceSha256=sha256(Path(__file__)))
        if args.mode == "score": result["detectorVsGT"] = detector_gt_metrics(receipt, truth)
    frozen.write_result(args.output, result, compact=args.mode == "replay")


