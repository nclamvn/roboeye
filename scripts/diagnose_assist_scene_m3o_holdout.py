#!/usr/bin/env python3
"""Posthoc frozen M3O holdout joins; no images/models or runtime alterations."""
import argparse
from collections import Counter
import json
from pathlib import Path
from time import perf_counter
import assist_scene_m3o_study as study
from diagnose_assist_scene_m3k_misses import matching_graph
from assist_scene_m3e_study import legacy_score, write_new
from assist_scene_m3h_study import read_json
from assist_scene_motion import sha256
frozen = study.frozen
pair_diagnosis = study.pair_diagnosis
DATA_RIGHTS = study.DATA_RIGHTS
MAX_BYTES = 8*1024**2


def compact_pair(pair):
    return {**{k: pair.get(k) for k in ("fieldId", "startDetectionIndex", "endDetectionIndex", "startToken", "endToken", "supported", "reason", "unverifiable", "scoreLower", "scoreUpper", "linearLogGrowthLowerBound", "linearLogGrowthUpperBound")},
        "directions": {d: {k: pair[d].get(k) for k in ("seedPoints", "verifiedPoints", "assignedPoints", "unknownPoints", "points", "supported", "reason", "maxSupportedCyclePx", "maxSupportedFitResidualPx")} for d in ("forward","reverse")}}


def analyze(receipt, truth, inputs=None):
    """All reviewed positives, full competing-target matcher, no GT inference."""
    started = perf_counter(); study.receipt_contract(receipt)
    frozen._require(receipt["study"] == "M3O" and receipt["developmentOnly"] is False
        and truth["inputSha256"] == receipt["inputSha256"], "Diagnosis requires actual bound M3O holdout")
    if inputs is not None: frozen.bind_input(receipt, inputs)
    scorer = legacy_score(); cases = []; summary = Counter(); reasons = {lane: Counter() for lane in "ABC"}
    points = {lane: Counter() for lane in "ABC"}; point_reasons = {lane: Counter() for lane in "ABC"}
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
                        diag = frame[lane]["diagnostics"]; proof = diag["windowEvidence"].get(str(ident), {})
                        reason = diag["trackReasons"].get(str(ident), "surface-"+frame[lane]["status"]); reasons[lane][reason] += 1
                        related = [p for p in diag["comparisons"] if p["endDetectionIndex"] == j]
                        fresh = pair_diagnosis(proof.get("fresh"), diag, frames)
                        case["lanes"][lane] = {"firstVeto": reason, "currentComparisonCount": len(related), "allComparisonReasons": dict(Counter(p["reason"] for p in related)),
                            "allPairs": [compact_pair(p) for p in related],
                            "supportedCurrentComparisons": sum(p["supported"] for p in related),
                            "fresh": fresh, "anchor": pair_diagnosis(proof.get("anchor"), diag, frames),
                            "growthUnavailable": "UNKNOWN when no supported pair serialized numeric growth"}
                        if fresh is not None and fresh.get("directions"):
                            for name, direction in fresh["directions"].items():
                                points[lane]["nccAttemptedPopulations" if direction.get("populationStatus") == "measured" else "nccSkippedPopulations"] += 1
                        if fresh is not None and fresh.get("directions"):
                            for direction in fresh["directions"].values():
                                points[lane].update(populations=1, originalSeeds=direction["seedPoints"], verified=direction["verifiedPoints"], assigned=direction["assignedPoints"])
                                point_reasons[lane].update(direction.get("pointReasonCounts") or {})
                cases.append(case)
    supported = {lane: sum(p["supported"] for c in receipt["clips"] for f in c["frames"] for p in f[lane]["diagnostics"]["comparisons"]) for lane in "ABC"}
    return {"schemaVersion": 1, "study": "M3O-holdout-posthoc-diagnosis", "inputSha256": receipt["inputSha256"],
        "matching": {"sameFamilyIoU": scorer.IOU, "competingTargetMargin": scorer.MARGIN, "duplicateAssignments": "all ambiguous, excluded"},
        "summary": dict(summary), "firstVetoByLane": reasons, "selectedMeasuredFreshPopulations": {lane: {**points[lane], "pointReasons": point_reasons[lane]} for lane in "ABC"},
        "allRawSupportedComparisons": supported, "cases": cases, "wallMs": 1000*(perf_counter()-started),
        "actualNewModelDirectionCalls": 0,
        "licensingResearch": {"checked": "2026-11-16", "downloads": 0, "datasets": DATA_RIGHTS,
            "scope": "Per-dataset primary terms, not a claim all labelled datasets are unusable. No independent real dense-flow benchmark cleared or used in this trial."},
        "limits": ["Posthoc labels never entered inference.", "Selected old boxes are hypotheses, not GT-confirmed physical correspondences.",
            "A size-vetoed population did not attempt NCC: selected corners do not prove successful correspondence.",
            "No dense labelled flow in Boreas receipt: flow endpoint error and source of NCC failures remain UNKNOWN.",
            "Known-box/known-flow oracle tests diagnose ceilings only; GT injection is not a deployable result."]}


def comparisons(result):
    totals = {lane: Counter() for lane in "ABC"}; transitions = {lane: Counter() for lane in "BC"}
    for case in result["cases"]:
        if not case["lanes"]: continue
        maps = {}
        for lane, report in case["lanes"].items():
            pairs = report["allPairs"]; totals[lane].update(pairs=len(pairs), supportedPairs=sum(p["supported"] for p in pairs),
                targetKeyframesWithAnySupportedPair=int(any(p["supported"] for p in pairs)))
            maps[lane] = {(p["fieldId"],p["startDetectionIndex"],p["endDetectionIndex"]):p for p in pairs}
        for lane in "BC":
            study._require(maps[lane].keys() == maps["A"].keys(), "Candidate omitted a target-linked eligible pair")
            for key, base in maps["A"].items():
                other = maps[lane][key]
                transitions[lane]["gainedSupportedPairs" if other["supported"] and not base["supported"] else "lostSupportedPairs" if base["supported"] and not other["supported"] else "unchangedSupportedPairs" if base["supported"] else "bothUnsupportedPairs"] += 1
            baseline = case["lanes"]["A"]["fresh"]; candidate = case["lanes"][lane]["fresh"]
            keys = ("fieldId","startDetectionIndex","endDetectionIndex")
            same = baseline is not None and candidate is not None and all(baseline.get(k)==candidate.get(k) for k in keys)
            case["lanes"][lane]["sameSelectedFreshHypothesisAsA"] = same
    result["targetLinkedComparisonSummary"] = totals; result["pairedTargetLinkedSupportTransitions"] = transitions
    result["causalLimits"] = {
        "observableGroundTruth": "UNKNOWN: physical approach from 3D labels is not independent dense image-flow/expansion ground truth; a miss does not establish that this particular visible surface has affine expansion above the frozen floor.",
        "sourceIdentity": "Selected old boxes/all eligible hypotheses are not independently GT-labelled source/current physical correspondences.",
        "grayscale": {"codeFact": "GlobalRaftSmall repeats grayscale into 3 input channels; weights are a pretrained image-flow checkpoint.", "causalStatus": "HYPOTHESIS ONLY: no controlled native-RGB versus repeated-gray ablation was run."},
        "resolution": {"codeFact": "Sources2448x2048 -> working768x643 -> RAFT640x536; flow restored into working coordinates. DIS/VR consume working grayscale.", "causalStatus": "HYPOTHESIS ONLY: no native-resolution counterfactual was run; resizing alone does not prove the observed error cause."},
        "counterfactual": "No threshold/gate was relaxed and no candidate patch was promoted; numeric improvements without target-supported pairs are not rescued warnings."}
    return result


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("receipt","truth","input","output"): parser.add_argument("--"+name,type=Path,required=True)
    args=parser.parse_args(); receipt=read_json(args.receipt,study.MAX_BYTES); truth=read_json(args.truth); inputs=read_json(args.input)
    study._require(sha256(args.input)==receipt["inputSha256"],"Wrong input bytes")
    result=comparisons(analyze(receipt,truth,inputs))
    result.update(receiptSha256=sha256(args.receipt),truthSha256=sha256(args.truth),sourceSha256=sha256(Path(__file__)),
        dependencySha256={name:sha256(study.HERE/name) for name in ("assist_scene_m3o_study.py","diagnose_assist_scene_m3k_misses.py","score-assist-scene-motion-m3c.py","assist_scene_global_field.py","assist_scene_learned_region.py")})
    study._require(len(json.dumps(result,allow_nan=False).encode())<=MAX_BYTES,"Diagnosis exceeds8MiB")
    write_new(args.output,result)

