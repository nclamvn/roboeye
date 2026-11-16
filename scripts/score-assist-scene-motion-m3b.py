#!/usr/bin/env python3
"""Score the frozen QA windows; frames outside them are explicitly unscored."""

import argparse
import hashlib
import json
from pathlib import Path
from statistics import median

LANES = ("baseline", "candidateRaw", "candidate", "m3Guarded")
VEHICLE = {"vehicle", "bus", "truck", "car"}


def sha(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def matches(label, event):
    return label == "*" or (label == "vehicle-family" and event["label"] in VEHICLE) or label == event["label"]


def qualify(receipt, manifest):
    indexed = {r["id"]: r for r in manifest["clips"]}
    out = []
    for clip in receipt["clips"]:
        ref = indexed[clip["id"]]
        if ref["sha256"] != clip["sha256"]:
            raise ValueError("Scoring wrong fixture")
        frames = clip["frames"]
        for f in frames:
            for lane in LANES:
                row = f[lane]
                if row["answers"]["distance"]["metres"] is not None:
                    raise ValueError("RGB-only path emitted metres")
                if len(row["events"]) != len(row["answers"]["motion"]["trackNotices"]):
                    raise ValueError("Receipt notice count mismatch")
                if row.get("scaleAmbiguity") and row["events"]:
                    raise ValueError("Notice while camera scale is ambiguous")
        windows = []
        for win in ref["windows"]:
            selected = [f for f in frames if win["startMs"] <= f["timeMs"] < win["endMs"]]
            if not selected:
                raise ValueError("No sample in labeled window")
            hits = {lane: [f["timeMs"] for f in selected if any(matches(win["label"], e) for e in f[lane]["events"])]
                    for lane in LANES}
            windows.append({**win, "hitTimesMs": hits})
        out.append({
            "id": clip["id"], "frames": len(frames), "windows": windows,
            "registrationValid": {
                "baseline": sum(f["baseline"]["registration"] == "valid" for f in frames),
                "candidate": sum(f["candidate"]["registration"]["status"] == "valid" for f in frames),
            },
            "registrationRawStatuses": clip["rawRegistrationCounts"],
            "events": {lane: [{"timeMs": f["timeMs"], "labels": [e["label"] for e in f[lane]["events"]]}
                             for f in frames if f[lane]["events"]] for lane in LANES},
            "scaleVetoTimesMs": {lane: [f["timeMs"] for f in frames if f[lane]["scaleAmbiguity"]]
                                 for lane in ("candidate", "m3Guarded")},
        })
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("receipt", type=Path)
    parser.add_argument("--bus-dense", type=Path)
    args = parser.parse_args()
    r = json.loads(args.receipt.read_text())
    if sha(args.manifest) != r["manifestSha256"]:
        raise ValueError("Scoring labels changed since replay")
    m = json.loads(args.manifest.read_text())
    if {x["id"] for x in m["clips"]} != {x["id"] for x in r["clips"]}:
        raise ValueError("Scoring requires all clips")
    clips = qualify(r, m)
    windows = [w for c in clips for w in c["windows"]]
    pos = [w for w in windows if w["status"] == "positive"]
    neg = [w for w in windows if w["status"] == "negative"]
    score = {lane: {"truePositiveWindows": sum(bool(w["hitTimesMs"][lane]) for w in pos),
                    "missedPositiveWindows": sum(not w["hitTimesMs"][lane] for w in pos),
                    "falsePositiveWindows": sum(bool(w["hitTimesMs"][lane]) for w in neg),
                    "falsePositiveFramesWithinWindows": sum(len(w["hitTimesMs"][lane]) for w in neg)}
             for lane in LANES}
    bus_dense = None
    if args.bus_dense:
        dense_receipt = json.loads(args.bus_dense.read_text())
        if dense_receipt["manifestSha256"] != r["manifestSha256"] or len(dense_receipt["clips"]) != 1:
            raise ValueError("Wrong dense diagnostic")
        item = dense_receipt["clips"][0]
        if item["id"] != "bus-real-pan":
            raise ValueError("Not the bus dense diagnostic")
        d = item["denseDiagnostic"]
        if not d["publicationDisabled"]:
            raise ValueError("Diagnostic could publish")
        labels = d["detectorLabelsPerFrame"]
        bus_dense = {"rawSha256": sha(args.bus_dense), "codeSha256": dense_receipt["codeSha256"],
                     "frames": len(labels), "detectorFps": d["detectorFps"],
                     "vehicleFrames": sum(bool(set(row) & VEHICLE) for row in labels),
                     "classFrames": {label: sum(label in row for row in labels) for label in sorted(VEHICLE)},
                     "validFramePairs": d["validFramePairs"], "proposals": d["diagnosticProposals"],
                     "rawRegistrationStatuses": item["rawRegistrationCounts"]}
    print(json.dumps({
        "schemaVersion": 1, "evidence": "Local real detector, exploratory preset time windows",
        "platform": r["platform"], "opencv": r["opencv"], "sceneqaSha256": r["sceneqaSha256"],
        "manifestSha256": r["manifestSha256"], "codeSha256": r["codeSha256"], "rawSha256": sha(args.receipt),
        "positiveWindows": len(pos), "negativeWindows": len(neg), "scores": score,
        "nullDistanceFramesAllLanes": sum(c["frames"] for c in clips) * len(LANES),
        "medianPerRawFrameRegistrationPlusTrackingMs": median(t for c in r["clips"] for t in c["rawStageMs"]),
        "medianPerSampleDetectorMs": median(f["detectorMs"] for c in r["clips"] for f in c["frames"]),
        "phoneEvidence": None, "denseBusDiagnostic": bus_dense, "clips": clips,
    }, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
