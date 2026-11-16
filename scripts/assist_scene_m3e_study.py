#!/usr/bin/env python3
"""Offline Mac A/B and ablations; detector inputs separate from scoring labels."""

import argparse
from collections import Counter
from datetime import date
from importlib.util import module_from_spec, spec_from_file_location
import json
import math
from pathlib import Path
import platform
import tempfile
from time import perf_counter

import cv2
import numpy as np

from assist_scene_motion import parse_detect, sha256
from assist_scene_motion_m3b import detect_samples
from assist_scene_motion_m3c import MAX_SIDE, load_input
from assist_scene_scale_approach import POLICY as BASE_POLICY, ScaleApproach
from assist_scene_scale_approach_m3e import POLICY as CANDIDATE_POLICY, ScaleApproachM3E


LANES = ("A", "B", "detail", "relink", "S")
CAPS = {"maxNativeSide": 4096, "maxNativePixels": 12_000_000, "maxFramesTotal": 240}
CLAIM = "relative-optical-approach"
DROPPED = {"m3e-approach-gap": frozenset({5})}
HERE = Path(__file__).resolve().parent


def read_frame(path, mode):
    image = cv2.imread(str(path), mode | cv2.IMREAD_IGNORE_ORIENTATION)
    if (image is None or not 32 <= min(image.shape[:2]) or max(image.shape[:2]) > CAPS["maxNativeSide"]
            or math.prod(image.shape[:2]) > CAPS["maxNativePixels"]):
        raise ValueError("Invalid or over-budget source image")
    return image


def output(result, time):
    if (result["status"] != "valid" and result["events"]
            or len({t["id"] for t in result["tracks"]}) != len(result["tracks"])):
        raise ValueError("Invalid or contradictory lane output")
    current = {t["id"]: t["label"] for t in result["tracks"]}
    seen = set()
    for e in result["events"]:
        if (e["kind"] != CLAIM or e["timeMs"] != time or e["epoch"] != result["epoch"]
                or current.get(e["trackId"]) != e["label"] or e["trackId"] in seen):
            raise ValueError("Unsupported, stale or repeated approach")
        if {"metres", "meters", "ttc", "distance", "timeToCollision"} & e.keys():
            raise ValueError("An optical approach event must not contain distance or TTC")
        seen.add(e["trackId"])
    return {**result, "answers": {"kind": CLAIM, "distance": {"metres": None}}}


def run_clip(clip, root, work, exe, model):
    from assist_scene_m3d_study import BoxBaseline

    frames = clip["frames"]
    start = frames[0]["timestampUs"]
    staged, shapes = [], []
    cv2.setRNGSeed(6505)
    for i, f in enumerate(frames):
        source = root / f["path"]
        if f["sha256"] != sha256(source):
            raise ValueError("Source frame hash mismatch")
        image = read_frame(source, cv2.IMREAD_COLOR)
        oh, ow = image.shape[:2]
        resize = min(1., MAX_SIDE / max(ow, oh))
        h, w = round(oh * resize), round(ow * resize)
        pixels = image if (w, h) == (ow, oh) else cv2.resize(image, (w, h), interpolation=cv2.INTER_AREA)
        jpg = work / f"{i:03d}.jpg"
        if not cv2.imwrite(str(jpg), pixels, [cv2.IMWRITE_JPEG_QUALITY, 93]):
            raise RuntimeError("Could not stage detector frame")
        staged.append((i, (f["timestampUs"] - start) / 1000, jpg))
        shapes.append((h, w, oh, ow))
    found = {}
    configurations = []
    for i in range(0, len(staged), 50):
        config, batch = detect_samples(staged[i:i+50], exe, model)
        configurations.append(config)
        found.update(batch)
    if any(c != configurations[0] for c in configurations):
        raise ValueError("Shared detector configuration changed")
    lanes = {
        "A": ScaleApproach(), "B": ScaleApproachM3E(),
        "detail": ScaleApproachM3E(relink=False), "relink": ScaleApproachM3E(detail=False),
        "S": BoxBaseline(),
    }
    rows = []
    for i, f in enumerate(frames):
        start_prep = perf_counter()
        h, w, oh, ow = shapes[i]
        gray = read_frame(staged[i][2], cv2.IMREAD_GRAYSCALE)
        if (h, w) != gray.shape:
            raise ValueError("Geometry mismatch")
        at, obs = found[i]
        boxes = parse_detect(obs, w, h)
        drop = i in DROPPED.get(clip["id"], ())
        observed = [] if drop else boxes
        if f.get("intrinsics") is not None:
            f = {**f, "intrinsics": (np.diag((w/ow, h/oh, 1.)) @ np.asarray(f["intrinsics"])).tolist()}
        io_start = perf_counter()
        native = read_frame(root/f["path"], cv2.IMREAD_GRAYSCALE)
        if native.shape != (oh, ow):
            raise ValueError("Unbound native detail")
        timings = {"detector": obs["detectionMs"], "sharedPrep": (io_start-start_prep)*1000.,
                   "nativeDecode": (perf_counter()-io_start)*1000.}
        out = {k: f[k] for k in ("token", "timestampUs")}
        out.update(timeMs=at, index=i, detectorGapInjected=drop, width=w, height=h,
                   nativeWidth=ow, nativeHeight=oh, detections=[b.record(w,h) for b in boxes], timingsMs=timings)
        for n, lane in lanes.items():
            cv2.setRNGSeed(650500+i)
            tick = perf_counter()
            options = {"native_gray": native} if n in {"B", "detail"} else {}
            out[n] = output(lane.update(f, at, gray, observed, **options), at)
            timings[n] = (perf_counter()-tick)*1000.
        rows.append(out)
    return {"id": clip["id"], "detectorConfiguration": configurations[0], "frames": rows}


def write_new(path, data):
    with path.open("x", encoding="utf-8") as f:
        json.dump(data, f, indent=2, allow_nan=False)
        f.write("\n")


def replay(args):
    inputs, root = load_input(args.input)
    if sum(len(c["frames"]) for c in inputs["clips"]) > CAPS["maxFramesTotal"]:
        raise ValueError("Too many frames")
    if inputs["dataset"] not in {"Boreas-real", "synthetic-m3c"}:
        raise ValueError("Unexpected M3E source")
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("Use a new output path")
    cv2.setNumThreads(1)
    rows = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3e-{date.today():%Y%m%d}-", dir=args.output.parent) as temp:
        for n, clip in enumerate(inputs["clips"]):
            work = Path(temp).resolve()/str(n)
            work.mkdir()
            print(f"Replay {clip['id']} ({len(clip['frames'])} frames)", flush=True)
            rows.append(run_clip(clip, root, work, args.sceneqa.resolve(), args.yolo.resolve()))
    source = ("assist_scene_scale_approach.py", "assist_scene_scale_approach_m3e.py",
              "assist_scene_m3d_study.py", Path(__file__).name)
    return {"schemaVersion": 1, "inputSha256": sha256(args.input), "dataset": inputs["dataset"],
            "policies": {"A": dict(BASE_POLICY), "B": dict(CANDIDATE_POLICY)},
            "platform": platform.platform(), "opencv": cv2.__version__, "sceneqaSha256": sha256(args.sceneqa),
            "yoloModelHashes": {str(p.relative_to(args.yolo)): sha256(p)
                                for p in sorted(args.yolo.rglob("*")) if p.is_file()},
            "codeSha256": {name: sha256(HERE/name) for name in source}, "clips": rows}


def legacy_score():
    spec = spec_from_file_location("m3e_score_contract", HERE/"score-assist-scene-motion-m3c.py")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def score(receipt, truth):
    if (receipt["schemaVersion"] != 1 or truth["schemaVersion"] != 1
            or receipt["inputSha256"] != truth["inputSha256"]
            or [c["id"] for c in receipt["clips"]] != [c["id"] for c in truth["clips"]]):
        raise ValueError("Incompatible or unbound score inputs")
    contract = legacy_score()
    totals = {n: Counter(contract.empty()) for n in LANES}
    rows = []
    all_frames = []
    for clip, reference in zip(receipt["clips"], truth["clips"], strict=True):
        label = {f["token"]: f for f in reference["frames"]}
        if (len(label) != len(reference["frames"]) or len({f["token"] for f in clip["frames"]}) != len(clip["frames"])
                or not label.keys() <= {f["token"] for f in clip["frames"]}):
            raise ValueError("Duplicate or missing keyframes")
        stats = {n: contract.empty() for n in LANES}
        statuses = {n: Counter() for n in LANES}
        mechanisms = {n: Counter() for n in LANES}
        ceiling = Counter()
        gap = {}
        for f in clip["frames"]:
            t = label.get(f["token"])
            if t and t["timestampUs"] != f["timestampUs"]:
                raise ValueError("Different exact frame timestamp")
            targets = None if t is None else [
                {**g, "motion": {"approaching": "moving", "not-approaching": "stationary", "unknown": "unknown"}[g["approach"]]}
                for g in t["targets"]]
            for target in targets or ():
                overlap = any(contract.family(d["label"]) == target["classFamily"]
                              and contract.iou(d["box"], target["box"]) >= contract.IOU for d in f["detections"])
                ceiling[target["approach"]] += 1
                ceiling[target["approach"]+".withYolo"] += overlap
            for n in LANES:
                surface = f[n]
                output(surface, f["timeMs"])
                contract.score_frame(f, n, targets, stats[n])
                statuses[n][surface["status"]] += 1
                for key in ("detailAttempts", "detailEvidencePairs", "relinkAttempts", "relinkedTracks"):
                    val = surface.get("diagnostics", {}).get(key)
                    if isinstance(val, int):
                        mechanisms[n][key] += val
                if reference.get("allSceneNegative"):
                    stats[n]["allSceneFalseNotices"] = stats[n].get("allSceneFalseNotices", 0) + len(surface["events"])
                if clip["id"] in DROPPED and f["index"] in (4, 5, 6) and targets:
                    tracks = surface["tracks"]
                    g = targets[0]
                    ranked = sorted(((contract.iou(tk["box"], g["box"]), tk["id"]) for tk in tracks
                                     if contract.family(tk["label"]) == g["classFamily"]), reverse=True)
                    anchor = ranked[0][1] if (ranked and ranked[0][0] >= contract.IOU and
                                             (len(ranked) == 1 or ranked[0][0]-ranked[1][0] >= contract.MARGIN)) else None
                    gap.setdefault(n, {})[str(f["index"])] = {"matchedTrackId": anchor, "epoch": surface["epoch"],
                                                              "notices": len(surface["events"])}
            all_frames.append(f)
        for n, lane in stats.items():
            totals[n].update(lane)
        for records in gap.values():
            if {"4", "5", "6"} <= records.keys():
                pre, post = records["4"], records["6"]
                records["sameReferenceIdentity"] = (pre["matchedTrackId"] == post["matchedTrackId"]
                                                    and pre["matchedTrackId"] is not None and pre["epoch"] == post["epoch"])
        rows.append({"id": clip["id"], "lanes": stats, "statuses": statuses,
                     "instrumentation": mechanisms, "detectorCeiling": ceiling, "gapControl": gap})
    timing = {}
    for n in ("detector", "sharedPrep", "nativeDecode", *LANES):
        v = sorted(f["timingsMs"][n] for f in all_frames)
        timing[n] = {f"p{p}": round(v[math.ceil(len(v)*p/100)-1], 2) for p in (50, 95)}
    v = sorted(f["timingsMs"]["B"] + f["timingsMs"]["nativeDecode"] for f in all_frames)
    timing["BPlusNativeDecode"] = {f"p{p}": round(v[math.ceil(len(v)*p/100)-1], 2) for p in (50, 95)}
    return {"schemaVersion": 1, "dataset": receipt["dataset"], "inputSha256": receipt["inputSha256"],
            "review": truth.get("review"), "reviewSha256": truth.get("reviewSha256"),
            "unit": "target-frame", "frames": len(all_frames), "noMetreChecks": len(all_frames)*len(LANES),
            "platform": receipt["platform"], "opencv": receipt["opencv"], "codeSha256": receipt["codeSha256"],
            "detectorConfiguration": receipt["clips"][0]["detectorConfiguration"],
            "totals": totals, "clips": rows, "stageMs": timing}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    modes = p.add_subparsers(dest="mode", required=True)
    for mode, keys in (("replay", ("input", "sceneqa", "yolo", "output")),
                       ("score", ("input", "truth", "receipt", "output"))):
        parser = modes.add_parser(mode)
        for name in keys:
            parser.add_argument("--"+name, type=Path, required=True)
    args = p.parse_args()
    if args.mode == "replay":
        result = replay(args)
    else:
        rec = json.loads(args.receipt.read_text())
        if rec["inputSha256"] != sha256(args.input):
            raise ValueError("Invalid input/receipt binding")
        result = score(rec, json.loads(args.truth.read_text()))
        result.update(receiptSha256=sha256(args.receipt), truthSha256=sha256(args.truth))
        print(json.dumps(result["totals"], indent=2))
    write_new(args.output, result)
