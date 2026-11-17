#!/usr/bin/env python3
"""Blind 2D review with explicit source selection and omission denominators.

The retained scope is the frozen five-checkpoint stratified sample. It is not
all objects in a street scene. Every projected target has an accounting reason;
every selected candidate must receive a box or an explicit unscorable reason.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

import numpy as np

import assist_scene_boreas_review_2d as old


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def new_json(path, value):
    with path.open("x") as stream: json.dump(value, stream, indent=2, allow_nan=False); stream.write("\n")


def account_frame(targets, selected):
    """Same fixed selector as the frozen review builder; no model input."""
    keys = set(); picked = []; result = []
    for gt in sorted(targets, key=lambda g:-(g["box"]["width"]*g["box"]["height"])):
        b = gt["box"]; key = (gt["motion"], gt["approach"], gt["classFamily"])
        if key in keys: reason = "duplicate-reference-stratum"
        elif min(b["width"], b["height"]) < .019: reason = "below-fixed-normalized-size"
        elif gt["motion"] == gt["approach"] == "unknown": reason = "both-reference-labels-unknown"
        else:
            keys.add(key); picked.append(gt)
            reason = "selected-for-blind-review" if len(picked) <= 9 else "fixed-nine-candidate-cap"
        result.append({**gt, "selectionReason": reason})
    if picked[:9] != selected: raise ValueError("Accounting selection differs from frozen review")
    return result


def build(source, inputs, truth, out, *, account_existing=False):
    source = source.resolve(strict=True)
    if not account_existing:
        old.build(source, inputs, truth, out)
    else:
        # Explicit targeted repair after rendering succeeded but accounting did
        # not: retain the source-bound sheets instead of deleting/re-rendering.
        prior = json.loads((out/"candidates.json").read_text())
        if prior["inputSha256"] != sha(inputs) or any(
                sha(out/(row["key"]+".jpg")) != row["tileSha256"] for row in prior["rows"]):
            raise ValueError("Retained review sheets changed or belong to different inputs")
    raw = json.loads((source/"clips.json").read_text())["clips"]
    inp = json.loads(inputs.read_text()); ref = json.loads(truth.read_text())
    candidates_path = out/"candidates.json"; candidates = json.loads(candidates_path.read_text())
    chosen = {r["token"]: r for r in candidates["rows"]}
    records = []; counts = Counter()
    for clip, pictures, labels in zip(raw, inp["clips"], ref["clips"], strict=True):
        pairs = {t:c for c,t in old.matches(clip["cameraTimestampsUs"], clip["labelTimestampsUs"]).items()}
        frames = {g["timestampUs"]:g for g in labels["frames"]}; image_steps = {f["timestampUs"]:f for f in pictures["frames"]}
        lp = old.sensor_poses(source, Path('.'), "lidar", set(clip["labelTimestampsUs"]))
        history = defaultdict(list)
        for j, stamp in enumerate(clip["labelTimestampsUs"]):
            t = pairs.get(stamp)
            if t is None: history.clear(); continue
            g, f = frames[t], image_steps[t]
            center = np.asarray(f["cameraToWorld"])[:3, 3]
            objects, unsupported = old.labels_world(source, Path('.'), stamp, lp[stamp])
            for identifier, (_, family, points, position, _) in objects.items():
                if not family or points < 5: continue
                items = history[identifier]
                if items and stamp-items[-1][0] > 280_000: items.clear()
                items.append((stamp, float(np.linalg.norm(position-center))))
            targets = [{**gt, "approach":old.trend(history[gt["instance"]], stamp)} for gt in g["targets"]]
            if j not in {5,8,11,14,17}:
                counts["outside-five-fixed-checkpoints"] += len(targets)
                continue
            row = chosen[f["token"]]
            detail = account_frame(targets, row["candidates"])
            for target in detail: counts[target["selectionReason"]] += 1
            records.append(dict(key=row["key"], token=f["token"], labelTimestampUs=stamp,
                                projectedUsableTargets=len(targets), unsupportedSourceLabelRows=unsupported,
                                selectedCandidateCount=len(row["candidates"]), targets=detail))
    if {r["key"] for r in records} != {r["key"] for r in candidates["rows"]}:
        raise ValueError("Accounting misses a review checkpoint")
    result = dict(schemaVersion=1, study="M3Q", inputSha256=sha(inputs), rawTruthSha256=sha(truth),
                  candidatesSha256=sha(candidates_path), scope="five fixed checkpoint strata, not exhaustive scene objects",
                  omissionPolicy="Unreviewed/unscorable objects never become true negatives; unknown notice bins retained",
                  counts=dict(counts), frames=records, modelCalls=0)
    new_json(out/"selection-accounting.json", result)
    print(json.dumps(dict(rows=len(records), candidateUnits=counts["selected-for-blind-review"], counts=counts)))


def bind(candidates, checked, output):
    gold = json.loads(candidates.read_text()); review = json.loads(checked.read_text())
    account_path = candidates.parent/"selection-accounting.json"; account = json.loads(account_path.read_text())
    if (review.get("selectionAccountingSha256") != sha(account_path)
            or account["candidatesSha256"] != sha(candidates) or account["inputSha256"] != gold["inputSha256"]):
        raise ValueError("Review must bind complete selection-accounting revision")
    if set(review.get("frames", {})) != {r["key"] for r in gold["rows"]}:
        raise ValueError("Every fixed frame requires explicit decisions")
    missing = {f"{row['key']}:{key}" for row in gold["rows"] for key, value in review["frames"][row["key"]].items() if value is None}
    reasons = review.get("review", {}).get("omissions", {})
    if set(reasons) != missing or any(not isinstance(value, str) or not value.strip() for value in reasons.values()):
        raise ValueError("Every omitted candidate requires an explicit unscorable reason")
    old.bind(candidates, checked, output)
    # Additional accounting preserves every selected and omitted unit outside
    # the scoring truth, whose legacy schema intentionally excludes omissions.
    note = dict(schemaVersion=1, study="M3Q", inputSha256=gold["inputSha256"],
                candidatesSha256=sha(candidates), selectionAccountingSha256=sha(account_path),
                checkedSha256=sha(checked), boundTruthSha256=sha(output),
                reviewedCandidateUnits=sum(len(r["candidates"]) for r in gold["rows"]),
                correctedBoxUnits=sum(value is not None for row in review["frames"].values() for value in row.values()),
                unscorableCandidateUnits=len(missing), omissions=reasons,
                scope=account["scope"], completeSelectedCandidateReview=True,
                notExhaustiveSceneTruth=True, modelOutputsSeen=False)
    new_json(output.with_name(output.stem+"-coverage.json"), note)
    print(json.dumps(note))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); modes = parser.add_subparsers(dest="job", required=True)
    p = modes.add_parser("build")
    for name in ("source", "inputs", "truth", "out"): p.add_argument(name, type=Path)
    p.add_argument("--account-existing", action="store_true")
    p = modes.add_parser("bind")
    for name in ("candidates", "checked", "output"): p.add_argument(name, type=Path)
    a = parser.parse_args()
    if a.job == "build": build(a.source, a.inputs, a.truth, a.out, account_existing=a.account_existing)
    else: bind(a.candidates, a.checked, a.output)
