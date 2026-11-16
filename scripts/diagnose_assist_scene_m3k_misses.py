#!/usr/bin/env python3
"""Posthoc M3K miss audit from frozen JSON only: no pixels/models/runtime replay.

GT is evaluation-only. Sparse source labels cannot establish what happened at
unlabelled adjacent exposures, and a returned field is not proof of expansion.
"""

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import json
from pathlib import Path

from assist_scene_motion import sha256
from assist_scene_m3e_study import legacy_score, write_new
from assist_scene_m3g_study import finite_payload
from assist_scene_m3h_study import read_json
from assist_scene_m3k_study import score


LANES = {"C": "detections", "D": "candidateDetections"}
WINDOW_MS = 800.
MAX_OUTPUT_BYTES = 8*1024**2


def matching_graph(reports, targets, contract=None):
    """The scorer's complete graph, including both ambiguity mechanisms.

    Each report selects among ALL same-family targets, not one target at a
    time. Multiple reports selecting one target make ALL of them ambiguous.
    """
    contract = legacy_score() if contract is None else contract
    edges = defaultdict(list)
    unmatched, ambiguous = [], []
    for index, report in enumerate(reports):
        ranked = sorted(((contract.iou(report["box"], g["box"]), i)
                         for i, g in enumerate(targets)
                         if contract.family(report["label"]) == g["classFamily"]), reverse=True)
        if not ranked or ranked[0][0] < contract.IOU:
            unmatched.append(index)
        elif len(ranked) > 1 and ranked[0][0]-ranked[1][0] < contract.MARGIN:
            ambiguous.append(index)
        else:
            overlap, target = ranked[0]
            edges[target].append({"reportIndex": index, "iou": overlap,
                "runnerUpMargin": None if len(ranked) < 2 else overlap-ranked[1][0]})
    hits = {}
    for target, choices in edges.items():
        if len(choices) == 1:
            hits[target] = choices[0]
        else:
            ambiguous.extend(choice["reportIndex"] for choice in choices)
    return {"hits": hits, "unmatchedReportIndexes": unmatched,
            "ambiguousReportIndexes": sorted(ambiguous)}


def event_graph(frame, lane, targets, contract=None):
    by_id = {t["id"]: t for t in frame[lane]["tracks"]}
    records = [by_id[e["trackId"]] for e in frame[lane]["events"]]
    return matching_graph(records, targets, contract)


def overlap_record(target, records, targets, target_index, contract):
    ranked = sorted(((contract.iou(record["box"], target["box"]), i)
                     for i, record in enumerate(records)
                     if contract.family(record["label"]) == target["classFamily"]), reverse=True)
    graph = matching_graph(records, targets, contract)
    assigned = graph["hits"].get(target_index)
    return {"anySameFamilyIoUAtLeastThreshold": bool(ranked and ranked[0][0] >= contract.IOU),
            "bestIoU": ranked[0][0] if ranked else None,
            "overlappingReportCount": sum(ov >= contract.IOU for ov, _ in ranked),
            "uniqueFullGraphAssignment": assigned is not None,
            "assignedReportIndex": None if assigned is None else assigned["reportIndex"],
            "candidateLabels": [records[i]["label"] for ov, i in ranked if ov >= contract.IOU],
            "scope": "Overlap ceiling is lenient; assignment includes all same-family targets and duplicate-report ambiguity"}


def _track_snapshot(frame, lane, track):
    if track is None:
        return None
    key = str(track["id"]); diagnostics = frame[lane].get("diagnostics", {})
    return {"trackId": track["id"], "label": track["label"], "box": deepcopy(track["box"]),
        "identity": deepcopy(diagnostics.get("identityDecisions", {}).get(key)),
        "reason": diagnostics.get("trackReasons", {}).get(key, "unknown-not-recorded"),
        "survivingCohorts": deepcopy(diagnostics.get("cohorts", {}).get(key, [])),
        "retiredCohorts": deepcopy(diagnostics.get("retiredCohorts", {}).get(key, [])),
        "windowEvidence": deepcopy(diagnostics.get("windowEvidence", {}).get(key))}


def _pixel_evidence(frame, lane, snapshot):
    cohorts = [] if snapshot is None else snapshot["survivingCohorts"]
    updated = [c["cohortId"] for c in cohorts if c.get("ageMs", 0) > 0
               and c.get("lastMs") == frame["timeMs"] and c.get("validSamples", 0) >= 2]
    identity = (snapshot or {}).get("identity") or {}
    fresh = identity.get("freshPair") or {}
    field_rows = frame.get("learnedFlow", {}).get(lane, [])
    return {"currentSurvivingCohortIdsWithAcceptedPixelUpdate": updated,
        "disposableIdentityPairSupported": fresh.get("reason") == "identity-supported",
        "targetAttributedPixelSupportObserved": bool(updated) or fresh.get("reason") == "identity-supported",
        "laneReturnedFieldCount": sum(r.get("status") == "field-supported" for r in field_rows),
        "laneFieldAttributionToThisTarget": "unknown: M3K field trace has no track/cohort identifiers",
        "scope": "A surviving updated cohort records accepted correspondences; returned dense arrays alone do not prove target support or growth"}


def _growth_evidence(snapshot):
    evidence = (snapshot or {}).get("windowEvidence") or {}
    keys = ("angularLogGrowth", "currentAngularLogGrowth", "robustPointGrowth", "robustBoxGrowth", "angularLogMad")
    values = {key: evidence[key] for key in keys if key in evidence}
    return {"status": "recorded" if values else "unknown-not-serialized-for-this-case",
            "values": values or None,
            "reason": "M3K stores detailed selected positive evidence, but failed per-cohort numeric growth is not recoverable from the receipt"}


def _reference_index(source_truth, receipt):
    if source_truth is None:
        return {}
    if (source_truth.get("schemaVersion") != 1 or source_truth.get("inputSha256") != receipt["inputSha256"]
            or [c["id"] for c in source_truth.get("clips", [])] != [c["id"] for c in receipt["clips"]]):
        raise ValueError("Source reference is not bound to the frozen receipt")
    result = {}
    for source, recorded in zip(source_truth["clips"], receipt["clips"], strict=True):
        actual = {f["token"]: f for f in recorded["frames"]}; labels = {}
        for label in source["frames"]:
            token = label["token"]
            if token in labels or token not in actual or label["timestampUs"] != actual[token]["timestampUs"]:
                raise ValueError("Duplicate, missing or wrong-clock source reference")
            if len({t["instance"] for t in label["targets"]}) != len(label["targets"]):
                raise ValueError("Duplicate source target identity")
            labels[token] = label
        result[source["id"]] = labels
    return result


def history_diagnostic(frames, index, lane, instance, references, contract):
    current = frames[index]
    window = [r for r in frames[:index+1] if current["timeMs"]-r["timeMs"] <= WINDOW_MS]
    rows = []
    for frame in window:
        label = references.get(frame["token"])
        item = {"index": frame["index"], "token": frame["token"], "timeMs": frame["timeMs"],
            "status": frame[lane]["status"], "epoch": frame[lane]["epoch"],
            "sourceReference": "unlabelled-exposure" if label is None else "target-not-labelled"}
        if label is not None:
            target_index = next((i for i, t in enumerate(label["targets"]) if t["instance"] == instance), None)
            if target_index is not None:
                targets = label["targets"]; target = targets[target_index]
                detection = overlap_record(target, frame[LANES[lane]], targets, target_index, contract)
                tracks = overlap_record(target, frame[lane]["tracks"], targets, target_index, contract)
                assigned = tracks["assignedReportIndex"]
                snapshot = _track_snapshot(frame, lane, None if assigned is None else frame[lane]["tracks"][assigned])
                item.update(sourceReference="exact-source-projected-target", detector=detection,
                            track=snapshot, trackAssignment=tracks)
        rows.append(item)
    labelled = [r for r in rows if r["sourceReference"] == "exact-source-projected-target"]
    paired = list(zip(labelled, labelled[1:]))
    detector_misses = sum(not r["detector"]["anySameFamilyIoUAtLeastThreshold"] for r in labelled)
    track_pairs = [(a["track"], b["track"]) for a, b in paired if a["track"] is not None and b["track"] is not None]
    summary = {"runtimeExposureCount": len(rows), "exactSourceTargetSamples": len(labelled),
        "unlabelledExposureCount": sum(r["sourceReference"] == "unlabelled-exposure" for r in rows),
        "sourceTargetNotLabelledCount": sum(r["sourceReference"] == "target-not-labelled" for r in rows),
        "detectorOverlapMissingAtSourceSamples": detector_misses,
        "observedSourceSpanMs": None if not labelled else labelled[-1]["timeMs"]-labelled[0]["timeMs"],
        "detectorOverlapPresentAtEveryObservedSourceSample": None if not labelled else detector_misses == 0,
        "detectorPresentToMissingTransitionsBetweenSourceSamples": sum(
            a["detector"]["anySameFamilyIoUAtLeastThreshold"] and not b["detector"]["anySameFamilyIoUAtLeastThreshold"] for a, b in paired),
        "idChangesBetweenUniquelyAssignedSourceSamples": sum(a["trackId"] != b["trackId"] for a, b in track_pairs),
        "classLabelChangesBetweenUniquelyAssignedSourceSamples": sum(a["label"] != b["label"] for a, b in track_pairs),
        "epochChangesInAllRuntimeExposures": sum(a["epoch"] != b["epoch"] for a, b in zip(rows, rows[1:])),
        "nonvalidRuntimeExposures": sum(r["status"] not in {"valid", "first-frame"} for r in rows),
        "strictAdjacentDetectorContinuity": "unknown: source GT is sparse; no interpolation or static-box backfill",
        "scope": "Posthoc source-GT correspondence only, not deployed tracking or certified MOT ID switches"}
    return {"windowMs": WINDOW_MS, "summary": summary, "rows": rows}


def _lane_case(frame, frames, index, lane, target, targets, target_index, event_matches, references, contract):
    raw = overlap_record(target, frame[LANES[lane]], targets, target_index, contract)
    track_match = overlap_record(target, frame[lane]["tracks"], targets, target_index, contract)
    assigned = track_match["assignedReportIndex"]
    track = None if assigned is None else frame[lane]["tracks"][assigned]
    snapshot = _track_snapshot(frame, lane, track)
    hit = target_index in event_matches["hits"]
    reason = ("true-positive" if hit else "no-current-detector-overlap" if not raw["anySameFamilyIoUAtLeastThreshold"]
              else "current-global-camera-veto" if frame[lane]["status"] != "valid"
              else "ambiguous-current-track-assignment" if snapshot is None
              else snapshot["reason"])
    pixel = _pixel_evidence(frame, lane, snapshot)
    history = history_diagnostic(frames, index, lane, target["instance"], references, contract)
    identity = (snapshot or {}).get("identity") or {}
    cohorts = (snapshot or {}).get("survivingCohorts", [])
    lifecycle = (identity.get("kept") is False or history["summary"]["epochChangesInAllRuntimeExposures"] > 0
                 or history["summary"]["idChangesBetweenUniquelyAssignedSourceSamples"] > 0)
    current_id = None if track is None else track["id"]
    lineage = []
    for old in frames[:index+1]:
        if frame["timeMs"]-old["timeMs"] > WINDOW_MS:
            continue
        same = next((tr for tr in old[lane]["tracks"] if tr["id"] == current_id), None)
        lineage.append({"index": old["index"], "timeMs": old["timeMs"], "status": old[lane]["status"],
                        "epoch": old[lane]["epoch"], "currentInternalIdPresent": same is not None,
                        "snapshot": _track_snapshot(old, lane, same)})
    return {"outcome": "tp" if hit else "fn", "currentCategory": reason,
        "currentStatus": frame[lane]["status"], "epoch": frame[lane]["epoch"],
        "currentGlobalGate": {"pose": deepcopy(frame[lane].get("diagnostics", {}).get("pose")),
                              "background": deepcopy(frame[lane].get("diagnostics", {}).get("background"))},
        "currentDetectorOverlap": raw, "currentTrackAssignment": track_match, "currentTrack": snapshot,
        "pixelEvidence": pixel, "currentGrowthEvidence": _growth_evidence(snapshot),
        "precedingSourceGtDiagnosticOnly": history, "currentInternalIdLineage": lineage,
        "counterfactualDiagnostic": {
            "laneReturnedFieldAndLifecycleInterruption": not hit and pixel["laneReturnedFieldCount"] > 0 and lifecycle,
            "targetAttributedCurrentPixelSupportAndLifecycleInterruption": not hit and pixel["targetAttributedPixelSupportObserved"] and lifecycle,
            "targetAttributedCurrentPixelSupportWithoutMatureCohort": not hit and pixel["targetAttributedPixelSupportObserved"] and not any(c.get("mature") for c in cohorts),
            "sameFamilyDetectorPresentAtAllObservedSourceSamplesDespiteLifecycleInterruption": not hit and lifecycle and history["summary"]["exactSourceTargetSamples"] >= 2 and history["summary"]["detectorOverlapPresentAtEveryObservedSourceSample"] is True,
            "wouldRecoverWithDirectAnchorOrGapTolerance": "unknown-not-measured",
            "scope": "Overlapping candidate counts, not causal rescue counts; no inference was rerun and failed numeric growth is unavailable"}}


def diagnose(receipt, truth, source_truth=None, inputs=None):
    """Validate frozen score, then retain every positive case including successes."""
    baseline = score(receipt, truth, inputs)
    references = _reference_index(source_truth, receipt)
    contract = legacy_score(); cases = []
    for clip, reviewed in zip(receipt["clips"], truth["clips"], strict=True):
        frames = clip["frames"]; positions = {r["token"]: i for i, r in enumerate(frames)}
        for label in reviewed["frames"]:
            index = positions[label["token"]]; frame = frames[index]; targets = label["targets"]
            events = {lane: event_graph(frame, lane, targets, contract) for lane in LANES}
            for i, target in enumerate(targets):
                if target["approach"] != "approaching":
                    continue
                cases.append({"clip": clip["id"], "index": index, "token": frame["token"],
                    "timestampUs": frame["timestampUs"], "instance": target["instance"],
                    "classFamily": target["classFamily"], "reviewedReferenceBox": deepcopy(target["box"]),
                    "approachUnchanged": "approaching", "lanes": {lane: _lane_case(frame, frames, index, lane,
                        target, targets, i, events[lane], references.get(clip["id"], {}), contract) for lane in LANES}})
    summary = {}
    for lane in LANES:
        rows = [case["lanes"][lane] for case in cases]; misses = [r for r in rows if r["outcome"] == "fn"]
        counterfactuals = Counter(key for r in misses for key, val in r["counterfactualDiagnostic"].items() if val is True)
        summary[lane] = {"positiveCases": len(rows), "tp": len(rows)-len(misses), "fn": len(misses),
            "missCategories": dict(Counter(r["currentCategory"] for r in misses)),
            "counterfactualCandidateCountsNotRescues": dict(counterfactuals),
            "missingNumericGrowthAmongMisses": sum(r["currentGrowthEvidence"]["status"] != "recorded" for r in misses)}
        if (summary[lane]["tp"], summary[lane]["fn"]) != (baseline["totals"][lane]["tp"], baseline["totals"][lane]["fn"]):
            raise ValueError("Diagnostic assignment does not reproduce the complete scoring graph")
    result = {"schemaVersion": 1, "study": "M3K-posthoc-misses", "inputSha256": receipt["inputSha256"],
        "provenance": "Deterministic analysis of saved actual receipts and evaluation labels; no model/pixel replay",
        "matching": {"sameFamilyIoU": contract.IOU, "minimumRunnerUpMargin": contract.MARGIN,
                     "duplicateTargetReports": "all ambiguous"},
        "summary": summary, "originalAllLaneTotals": baseline["totals"], "positiveCases": cases,
        "mechanismHypothesisNotImplementation": {
            "candidate": "Bounded direct anchor-to-current region correspondence, decoupled from a requirement that one ID/cohort survives every adjacent exposure",
            "contrast": "Current M3K chains finite cohorts through adjacent updates and permanently discards them on missed reidentification/pixel support; direct current-vs-anchor measurement would establish new evidence instead of coasting an old alert",
            "hardFloors": "Fresh current pixels, unambiguous object relation, camera veto, independent direct-pair support and expansion, finite anchors, silence when unsupported; no metric output",
            "unproven": "Receipt-only candidates do not establish that direct anchors recover a miss or preserve false-positive rate. Need actual bounded A/B replay and untouched clips; do not lower growth thresholds or use GT at inference"},
        "limits": "Source-projected boxes are evaluation diagnostics, not reviewed per-frame truth. Unlabelled adjacent exposures are unknown. Internal-ID changes are not certified MOT switches. Counts overlap and cannot be summed as recoverable FN. Positive physical approach need not create measurable optical expansion."}
    finite_payload(result)
    if len(json.dumps(result, allow_nan=False).encode()) > MAX_OUTPUT_BYTES:
        raise ValueError("Diagnostic output exceeds fixed artifact budget")
    return result


def run(args):
    receipt, truth, inputs = (read_json(path) for path in (args.receipt, args.truth, args.input))
    if sha256(args.input) != receipt.get("inputSha256"):
        raise ValueError("Input bytes do not bind frozen receipt")
    source_path = getattr(args, "source_truth", None)
    source = read_json(source_path) if source_path is not None else None
    result = diagnose(receipt, truth, source, inputs)
    result.update(receiptSha256=sha256(args.receipt), truthSha256=sha256(args.truth),
        sourceTruthSha256=None if source_path is None else sha256(source_path),
        diagnosticCodeSha256=sha256(Path(__file__)),
        frozenInferenceCodeSha256=deepcopy(receipt["codeSha256"]))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("input", "receipt", "truth", "output"):
        parser.add_argument("--"+key, type=Path, required=True)
    parser.add_argument("--source-truth", type=Path)
    args = parser.parse_args()
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("Choose a new diagnostic path")
    result = run(args)
    write_new(args.output, result)
    print(json.dumps(result["summary"], indent=2))
