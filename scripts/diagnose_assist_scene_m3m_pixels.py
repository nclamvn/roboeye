#!/usr/bin/env python3
"""QA-only frozen M3M population counts. No truth, tuning or event generation."""

import argparse
from datetime import date
from hashlib import sha256 as bytes_sha256
import json
from pathlib import Path
import shutil
import tempfile

import cv2
import numpy as np

import assist_scene_global_window as frozen
from assist_scene_motion import parse_detect, sha256


def require(condition, message):
    if not condition: raise ValueError(message)


def analyze_population(oldgray, newgray, box, forward, backward):
    """Count original 64 seeds at each unchanged gate, without conditioning away failures."""
    require(isinstance(oldgray, np.ndarray) and oldgray.dtype == np.uint8 and oldgray.ndim == 2
        and isinstance(newgray, np.ndarray) and newgray.dtype == np.uint8 and newgray.shape == oldgray.shape,
        "Expected equal frozen working grayscale images")
    require(all(isinstance(f, np.ndarray) and f.dtype == np.float32 and f.shape == (*oldgray.shape, 2)
        and np.isfinite(f).all() for f in (forward, backward)), "Expected finite original-working-pixel fields")
    a = frozen._seeds(box)
    delta, first = frozen._sample(forward, a); b = a+delta
    reverse, second = frozen._sample(backward, b)
    cycles = np.linalg.norm(a-(b+reverse), axis=1)
    finite = np.isfinite(b).all(axis=1) & np.isfinite(cycles)
    sample = first & second & finite
    fb = sample & (cycles <= frozen.POLICY["maxFlowFbPx"])
    ncc = frozen.base._matching_patches(oldgray, newgray, a, b)
    h, w = oldgray.shape
    old_inside = frozen.base._inside(a, (3, 3, w-4, h-4), 0)
    new_inside = frozen.base._inside(b, (3, 3, w-4, h-4), 0)
    interior = old_inside & new_inside; texture = np.zeros(len(a), bool)
    for index in np.flatnonzero(interior):
        p = cv2.getRectSubPix(oldgray, (7, 7), tuple(map(float, a[index]))).astype(np.float32)
        q = cv2.getRectSubPix(newgray, (7, 7), tuple(map(float, b[index]))).astype(np.float32)
        p -= p.mean(); q -= q.mean()
        texture[index] = float(np.linalg.norm(p)*np.linalg.norm(q)) >= 49*4**2
    count = lambda mask: int(np.count_nonzero(mask))
    return {"seedPoints": len(a), "geometryEligible": not frozen._small(box, oldgray.shape),
        "firstSampleValid": count(first), "reverseSampleValid": count(second), "finiteEndpoints": count(finite),
        "sampleValid": count(sample), "fbPass": count(fb), "nccPass": count(ncc), "fbAndNcc": count(fb & ncc),
        "nccConditionalOnFb": count(fb & ncc)/count(fb) if count(fb) else None,
        "oldPatchInside": count(old_inside), "newPatchInside": count(new_inside), "bothPatchInside": count(interior),
        "patchTextureEligible": count(texture), "fbButNotNcc": count(fb & ~ncc), "nccButNotFb": count(ncc & ~fb),
        "fbAndInteriorButLowTexture": count(fb & interior & ~texture),
        "fbAndTextureButLowCorrelation": count(fb & texture & ~ncc),
        "maxFlowFbPx": frozen.POLICY["maxFlowFbPx"], "minPatchCorrelation": frozen.base.POLICY["minPatchCorrelation"]}


def select_field(receipt, clip_id, index, origin):
    require(origin in {"fresh", "anchor"} and type(index) is int and index >= 0, "Invalid field selector")
    clips = [clip for clip in receipt["clips"] if clip["id"] == clip_id]
    require(len(clips) == 1, "Unknown or duplicated clip")
    frames = clips[0]["frames"]
    require(index < len(frames) and frames[index]["index"] == index, "Unknown exact current frame")
    current = frames[index]; selected = current["C"]["diagnostics"]["snapshotSelection"].get(origin)
    require(isinstance(selected, dict), "Selected origin has no recorded exposure")
    origins = [old for old in frames[:index] if old["token"] == selected.get("token")
        and old["timeMs"] == selected.get("timeMs") and old["sourceSha256"] == selected.get("sourceSha256")]
    require(len(origins) == 1, "Selected origin does not bind unique prior source")
    old = origins[0]
    fields = [field for field in current["C"]["diagnostics"]["globalFields"]
        if field.get("startToken") == old["token"] and field.get("startMs") == old["timeMs"]]
    require(len(fields) == 1, "Missing or duplicated actual selected global field")
    field = fields[0]
    require(field.get("fieldId") == old["token"]+"->"+current["token"]
        and field.get("endToken") == current["token"] and field.get("endMs") == current["timeMs"]
        and field.get("startSha256") == old["sourceSha256"] and field.get("endSha256") == current["sourceSha256"]
        and field.get("oldWorkingPixelsSha256") == old["workingPixelsSha256"]
        and field.get("newWorkingPixelsSha256") == current["workingPixelsSha256"]
        and field.get("modelDirectionCalls") == 2, "Recorded global field source/pixel/clock binding changed")
    return old, current, field


def verify_pixels(pixels, row, recorded_hash):
    require(pixels.shape == (row["height"], row["width"]), "Reconstructed working dimensions changed")
    fingerprint = bytes_sha256(pixels.tobytes()).hexdigest()
    require(fingerprint == row["workingPixelsSha256"] == recorded_hash, "Reconstructed working pixel hash changed")


def run(args):
    import assist_scene_m3m_study as study
    from assist_scene_global_field import GlobalRaftSmall
    from assist_scene_m3f_study import stage
    inputs, root = study.load_input(args.input)
    receipt = study.read_json(args.receipt, study.MAX_RECEIPT_BYTES)
    require(receipt["inputSha256"] == sha256(args.input), "Receipt/input bytes changed")
    study.receipt_contract(receipt); study.bind_input(receipt, inputs)
    old, current, field = select_field(receipt, args.clip, args.index, args.origin)
    source_clip = next(clip for clip in inputs["clips"] if clip["id"] == args.clip)
    sources = {source["token"]: source for source in source_clip["frames"]}
    for row in (old, current): require(sources[row["token"]]["sha256"] == row["sourceSha256"], "Source fingerprint changed")
    require(not args.output.exists() and not args.output.is_symlink(), "Choose a new diagnosis path")
    require(shutil.disk_usage(args.receipt.parent).free >= 10*1024**3, "Less than 10 GB free")
    hashes = {name: sha256(study.HERE/name) for name in study.CODE}
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-m3m-diagnosis-{date.today():%Y%m%d}-", dir=args.receipt.parent) as folder:
        _, samples, _ = stage({"frames": [sources[old["token"]], sources[current["token"]]]}, root, Path(folder))
        pixels = [study.read_frame(sample[2], cv2.IMREAD_GRAYSCALE) for sample in samples]
        for image, row, name in zip(pixels, (old, current), ("oldWorkingPixelsSha256", "newWorkingPixelsSha256"), strict=True):
            verify_pixels(image, row, field[name])
        provider = GlobalRaftSmall(args.weights, device=args.device)
        require(all(provider.metadata.get(k) == receipt["globalFlowModel"].get(k)
            for k in ("weightsSha256", "algorithm", "policy", "device", "torch", "torchvision")), "Diagnostic model/runtime differs from recorded field")
        before = provider.direction_calls; forward, backward = provider(*pixels)
        require(provider.direction_calls-before == 2, "Diagnostic must run exactly two actual directions")
        measured = {name: bytes_sha256(np.ascontiguousarray(flow).tobytes()).hexdigest()
            for name, flow in zip(("forward", "backward"), (forward, backward), strict=True)}
        populations = {}
        for direction, row, a, b, f, r in (("forward", old, *pixels, forward, backward),
                ("reverse", current, pixels[1], pixels[0], backward, forward)):
            boxes = parse_detect({"width": row["width"], "height": row["height"], "orientation": 1, "tracks": row["detections"]}, row["width"], row["height"])
            populations[direction] = [{"detectionIndex": i, **box.record(row["width"], row["height"]),
                "counts": analyze_population(a, b, box, f, r)} for i, box in enumerate(boxes)]
    require(hashes == {name: sha256(study.HERE/name) for name in study.CODE}, "Frozen source changed during diagnosis")
    matched = {name: measured[name] == field["fieldSha256"][name] for name in measured}
    return {"schemaVersion": 1, "study": "M3M-pixel-gate-diagnosis", "receiptSha256": sha256(args.receipt),
        "inputSha256": receipt["inputSha256"], "codeSha256": hashes, "diagnosticSha256": sha256(Path(__file__)),
        "clip": args.clip, "index": args.index, "origin": args.origin, "recordedField": field,
        "measuredFieldSha256": measured, "fieldHashMatch": matched, "exactFieldReconstruction": all(matched.values()),
        "actualDirectionCalls": 2, "provider": provider.last_call, "populations": populations,
        "limits": "QA counts only. Field hash mismatch means not an exact replay; geometry-ineligible populations were not measured by the original engine. No ground truth, tuning, event generation or physical range."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("input", "receipt", "output", "weights"): parser.add_argument("--"+key, type=Path, required=True)
    parser.add_argument("--clip", required=True); parser.add_argument("--index", type=int, required=True)
    parser.add_argument("--origin", choices=("fresh", "anchor"), required=True)
    parser.add_argument("--device", choices=("mps",), required=True)
    args = parser.parse_args(); result = run(args)
    with args.output.open("x") as stream: json.dump(result, stream, indent=2, allow_nan=False); stream.write("\n")
