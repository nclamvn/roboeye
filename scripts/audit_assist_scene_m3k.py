#!/usr/bin/env python3
"""Independent offline artifact audit. Does not run models or open truth labels."""

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path


LANES = ("A", "B", "C", "D", "S")
TOLERANCE = 1e-9
FORBIDDEN = {"metres", "meters", "ttc", "distance", "timeToCollision"}
LIMITS = [
    "Learned trace identifies a frame, not a track/cohort: a particular field cannot independently be attributed to each warning.",
    "Artifact consistency is not proof of numerical model correctness, independent semantic review, accuracy or commercial clearance.",
]


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _same(first, second):
    if _number(first) and _number(second):
        return math.isclose(first, second, rel_tol=TOLERANCE, abs_tol=TOLERANCE)
    if isinstance(first, dict) and isinstance(second, dict):
        return first.keys() == second.keys() and all(_same(first[k], second[k]) for k in first)
    if isinstance(first, list) and isinstance(second, list):
        return len(first) == len(second) and all(_same(a, b) for a, b in zip(first, second, strict=True))
    return type(first) is type(second) and first == second


def _finite(value):
    if isinstance(value, dict):
        for item in value.values(): _finite(item)
    elif isinstance(value, list):
        for item in value: _finite(item)
    elif type(value) is float:
        _require(math.isfinite(value), "Nonfinite artifact value")


def _no_range(value):
    if isinstance(value, dict):
        _require(not FORBIDDEN.intersection(value), "Track/event contains forbidden range or TTC claim")
        for item in value.values(): _no_range(item)
    elif isinstance(value, list):
        for item in value: _no_range(item)


def _box(row):
    _require(isinstance(row, dict) and isinstance(row.get("label"), str), "Invalid object label")
    _require(_number(row.get("score")) and 0 <= row["score"] <= 1, "Invalid object confidence")
    bounds = row.get("box", {})
    values = [bounds.get(k) for k in ("x", "y", "width", "height")]
    _require(all(_number(v) and 0 <= v <= 1 for v in values), "Invalid normalized object geometry")
    x, y, w, h = values
    _require(w > 0 and h > 0 and x+w <= 1+TOLERANCE and y+h <= 1+TOLERANCE, "Invalid normalized object bounds")
    return {"label": row["label"], "score": row["score"], "box": dict(zip(("x", "y", "width", "height"), values))}


def _tracks(frame, lane):
    source = frame["candidateDetections" if lane in ("B", "D") else "detections"]
    _require(isinstance(source, list) and len(source) <= 12, "Invalid current detector budget")
    candidates = [_box(row) for row in source]
    tracks = frame[lane]["tracks"]
    _require(isinstance(tracks, list) and len(tracks) <= 12, "Invalid current track budget")
    used, identifiers = set(), set()
    for track in tracks:
        ident = track.get("id")
        _require(type(ident) is int and ident >= 0 and ident not in identifiers, "Invalid or duplicated current identity")
        identifiers.add(ident)
        record = _box(track)
        matches = [i for i, candidate in enumerate(candidates) if i not in used and _same(record, candidate)]
        _require(bool(matches), f"{lane} current track is not backed by its current lane detector")
        used.add(matches[0])
        if lane == "S":
            x, y, w, h = (record["box"][k] for k in ("x", "y", "width", "height"))
            margin = min(x*frame["width"], y*frame["height"],
                         (1-x-w)*frame["width"], (1-y-h)*frame["height"])
            _require(margin >= 4-TOLERANCE, "S track violates its frozen edge filter")
    return {row["id"]: row for row in tracks}


def _events(frame, lane, tracks):
    surface = frame[lane]
    events = surface["events"]
    _require(isinstance(events, list), "Invalid event list")
    _no_range(surface["tracks"]); _no_range(events)
    _require(surface["answers"]["distance"]["metres"] is None, "Non-null metric answer")
    _require(not events or surface["status"] == "valid", "Invalid lane emits warnings")
    _require(not frame["detectorGapInjected"] or not events, "Gap emits warnings")
    seen = set()
    for event in events:
        ident = event.get("trackId")
        _require(ident in tracks and ident not in seen, "Warning has absent or repeated current track")
        seen.add(ident)
        _require(event.get("kind") == "relative-optical-approach" and event.get("label") == tracks[ident]["label"]
                 and event.get("timeMs") == frame["timeMs"] and event.get("epoch") == surface["epoch"], "Stale or mislabelled current warning")
        if lane == "S": continue
        supporting = event.get("supportingCohortIds")
        _require(isinstance(supporting, list) and supporting and all(type(n) is int and n >= 0 for n in supporting)
                 and len(set(supporting)) == len(supporting), "Warning lacks bounded supporting cohorts")
        observed = event.get("observationMs")
        _require(_number(observed) and 320 <= observed <= 800, "Invalid current observation age")
        records = surface.get("diagnostics", {}).get("cohorts", {}).get(str(ident), [])
        _require(isinstance(records, list) and all(isinstance(c, dict) for c in records), "Missing current cohort proof")
        by_id = {c.get("cohortId"): c for c in records}
        _require(len(by_id) == len(records), "Duplicate current cohorts")
        ages = []
        for cohort_id in supporting:
            cohort = by_id.get(cohort_id, {})
            born, age = cohort.get("bornMs"), cohort.get("ageMs")
            _require(_number(born) and born >= 0 and _number(age) and 320 <= age <= 800
                     and abs(frame["timeMs"]-born-age) <= 1e-6 and cohort.get("lastMs") == frame["timeMs"]
                     and cohort.get("mature") is True and cohort.get("confirmed") is True
                     and type(cohort.get("validSamples")) is int and cohort["validSamples"] >= 5
                     and all(type(cohort.get(k)) is int and 9 <= cohort[k] <= 64 for k in ("initialPoints", "currentPoints")),
                     "Warning has stale, unsupported or immature current cohort")
            ages.append(age)
        _require(observed <= max(ages)+1e-6, "Warning borrows older identity age")


def _flow(frame, lane):
    rows = frame.get("learnedFlow", {}).get(lane)
    _require(isinstance(rows, list) and len(rows) <= 12, "Invalid learned trace budget")
    calls, wall, supported = 0, 0., False
    for row in rows:
        _require(row.get("token") == frame["token"] and row.get("timeMs") == frame["timeMs"]
                 and row.get("sourceSha256") == frame["sourceSha256"]
                 and row.get("providerKind") == "actual-local-pretrained-torchvision", "Unbound current learned field")
        status, count = row.get("status"), row.get("modelDirectionCalls")
        _require(type(count) is int and _number(row.get("wallMs")) and row["wallMs"] >= 0, "Missing learned call accounting")
        if status == "invalid-object-crop":
            _require(count == 0, "Invalid crop consumed model calls")
        else:
            _require(status in ("field-supported", "invalid-learned-flow") and count == 2, "Learned field lacks actual forward/reverse calls")
            shape = row.get("roiShape")
            _require(isinstance(shape, list) and len(shape) == 2 and all(type(n) is int and 1 <= n <= 384 for n in shape), "Invalid learned ROI")
            expected = [max(128, ((n+7)//8)*8) for n in shape]
            _require(row.get("paddedShape") == expected, "Learned ROI padding changed")
            supported |= status == "field-supported"
        calls += count; wall += row["wallMs"]
    _require(frame.get("flowDirectionCalls", {}).get(lane) == calls, "Frame learned call count mismatch")
    _require(_number(frame.get("timingsMs", {}).get(lane)) and wall <= frame["timingsMs"][lane]+.001, "Hidden learned field execution cost")
    _require(not frame[lane]["events"] or supported, "Warning lacks any current supported learned field")
    return calls


def _without_timing(value):
    if isinstance(value, dict):
        return {k: _without_timing(v) for k, v in value.items() if k not in {"timing", "timingsMs"}}
    if isinstance(value, list): return [_without_timing(v) for v in value]
    return value


def audit_receipt(receipt, old_cache=None):
    _finite(receipt)
    _require(receipt.get("study") == "M3K" and receipt.get("schemaVersion") == 1, "Not an M3K receipt")
    clips = receipt.get("clips")
    _require(isinstance(clips, list) and clips and len({c["id"] for c in clips}) == len(clips), "Invalid clip set")
    if old_cache is not None:
        _finite(old_cache)
        _require(receipt.get("developmentOnly") is True and old_cache.get("study") == "M3J"
                 and old_cache.get("developmentOnly") is False
                 and old_cache.get("detectorProvenance", {}).get("kind") == "actual-local-CoreML"
                 and old_cache.get("inputSha256") == receipt.get("inputSha256")
                 and [c["id"] for c in old_cache["clips"]] == [c["id"] for c in clips], "Wrong original development comparator")
    counts = Counter(frames=0, tracks=0, events=0, cohortWarnings=0, baselineFramesChecked=0)
    for clip_index, clip in enumerate(clips):
        flow_calls = Counter(C=0, D=0)
        if old_cache is not None:
            old_frames = old_cache["clips"][clip_index]["frames"]
            _require(len(old_frames) == len(clip["frames"]), "Different development frame set")
        for index, frame in enumerate(clip["frames"]):
            counts["frames"] += 1
            for lane in LANES:
                tracks = _tracks(frame, lane)
                _events(frame, lane, tracks)
                counts["tracks"] += len(tracks); counts["events"] += len(frame[lane]["events"])
                if lane != "S": counts["cohortWarnings"] += len(frame[lane]["events"])
                if lane in ("C", "D"): flow_calls[lane] += _flow(frame, lane)
            if old_cache is not None:
                old = old_frames[index]
                _require(all(frame.get(k) == old.get(k) for k in ("token", "timestampUs", "timeMs", "sourceSha256")), "Different development exposure")
                _require(_same(frame["detections"], old["detections"]), "Development changed original detections")
                _require(_same(_without_timing(frame["A"]), _without_timing(old["A"])), "Development A baseline surface changed")
                counts["baselineFramesChecked"] += 1
        for lane in ("C", "D"):
            _require(clip.get("flowDirectionCalls", {}).get(lane) == flow_calls[lane], "Clip learned call count mismatch")
            counts[lane+"DirectionCalls"] += flow_calls[lane]
    _require(1 <= counts["frames"] <= 180, "Invalid frame budget")
    return {"schemaVersion": 1, "study": "M3K-independent-artifact-audit", "status": "PASS",
            "inputSha256": receipt.get("inputSha256"), "developmentOnly": receipt.get("developmentOnly"),
            "checks": dict(counts), "fieldToWarningAttribution": "NOT INDEPENDENTLY ATTRIBUTABLE",
            "limits": list(LIMITS)}


def _read(path):
    _require(path.is_file() and path.stat().st_size <= 64*1024**2, "Missing or excessive artifact")
    payload = path.read_bytes()
    return json.loads(payload), hashlib.sha256(payload).hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--old-cache", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    receipt, fingerprint = _read(args.receipt)
    old, old_hash = _read(args.old_cache) if args.old_cache else (None, None)
    result = audit_receipt(receipt, old)
    result.update(receiptSha256=fingerprint, oldCacheSha256=old_hash)
    text = json.dumps(result, indent=2, allow_nan=False)+"\n"
    if args.output:
        with args.output.open("x") as stream: stream.write(text)
    print(text, end="")
