#!/usr/bin/env python3
"""Prepare separate offline input/oracle manifests from approved local nuScenes v1.0-mini.

Format: https://github.com/nutonomy/nuscenes-devkit/blob/master/docs/schema_nuscenes.md
No download, remote service, archive extraction, detector or device action.
"""

import argparse
from collections import defaultdict
import hashlib
from io import BytesIO
from itertools import product
import json
import os
from pathlib import Path, PurePosixPath
import re

import numpy as np
from PIL import Image


VERSION = "v1.0-mini"
MAX_TABLE_BYTES = 64 * 1024**2
MAX_IMAGE_BYTES = 8 * 1024**2
MAX_SELECTED_IMAGE_BYTES = 512 * 1024**2
MAX_TABLE_ROWS = 100_000
MAX_SELECTED_FRAMES = 150  # Mac replay budget; inclusive source endpoints.
MAX_FRAME_GAP_US = 220_000
MAX_POSE_SKEW_US = 5_000
MAX_TRUTH_SKEW_US = 100_000
VISIBLE_TOKENS = {"3", "4"}  # At least 60% visible across cameras; not a CAM_FRONT occlusion mask.
TOKEN = re.compile(r"[0-9a-f]{32}")
RANGE = re.compile(r"(scene-[0-9]{4}):([0-9]{1,2}(?:\.[0-9]{1,3})?):([0-9]{1,2}(?:\.[0-9]{1,3})?)")


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def indexed(root, name):
    p = (root / f"{name}.json").resolve(strict=True)
    require(p.parent == root and p.is_file() and p.stat().st_size <= MAX_TABLE_BYTES, f"Unsafe/large {name} table")
    data = json.loads(p.read_bytes())
    require(isinstance(data, list) and len(data) <= MAX_TABLE_ROWS, f"Bad {name} table")
    rows = {}
    for row in data:
        token = row.get("token") if isinstance(row, dict) else None
        require(isinstance(token, str) and TOKEN.fullmatch(token) and token not in rows, f"Invalid/colliding {name} token")
        rows[token] = row
    return rows


def stamp(row):
    v = row.get("timestamp")
    require(type(v) is int and 0 < v < 2**53, "Invalid timestamp (integer microseconds required)")
    return v


def read_matrix(values, shape):
    require(isinstance(values, (list, tuple)), "Invalid numeric shape")
    if len(shape) == 2:
        require(all(isinstance(row, (list, tuple)) and all(type(x) in (int, float) for x in row)
                    and len(row) == shape[1] for row in values), "Invalid numeric matrix")
    else:
        require(all(type(x) in (int, float) for x in values), "Invalid numeric vector")
    a = np.asarray(values, dtype=np.float64)
    require(a.shape == shape and np.isfinite(a).all(), "Invalid matrix shape or non-finite values")
    return a


def rotation(wxyz):
    q = read_matrix(wxyz, (4,))
    norm = float(np.linalg.norm(q))
    require(.999 <= norm <= 1.001, "Non-unit rotation quaternion")
    w, x, y, z = q / norm
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])


def pose(record):
    t = np.eye(4)
    t[:3, :3] = rotation(record["rotation"])
    t[:3, 3] = read_matrix(record["translation"], (3,))
    return t


def intrinsics(record, w, h):
    k = read_matrix(record["camera_intrinsic"], (3, 3))
    require(np.allclose(k[2], [0, 0, 1], atol=1e-10, rtol=0) and k[0, 0] > 0 and k[1, 1] > 0
            and 0 <= k[0, 2] < w and 0 <= k[1, 2] < h, "Invalid pinhole intrinsics")
    return k


def clip_range(raw):
    m = RANGE.fullmatch(raw)
    require(m is not None, "Expected scene-XXXX:START_SECONDS:END_SECONDS")
    first, end = [round(1e6 * float(v)) for v in m.groups()[1:]]
    require(0 <= first < end <= 22_000_000 and 2_000_000 <= end - first <= 12_000_000,
            "Requires 2–12 s clip within a scene (bounds 0–22 s)")
    return m.group(1), first, end


def chain(rows, first, finish=None, cap=320):
    seen = set()
    seq = []
    latest = None
    while first:
        require(first not in seen and first in rows and len(seq) < cap, "Broken, cyclic or excessive linked table")
        rec = rows[first]
        t = stamp(rec)
        if latest is not None:
            require(rec["prev"] == seq[-1]["token"] and t > latest, "Backward or non-reciprocal linked record")
        latest = t
        seen.add(first)
        seq.append(rec)
        if first == finish:
            break
        first = rec["next"]
    require(seq and (finish is None or seq[-1]["token"] == finish), "Cannot reach scene end")
    return seq


def frame_path(root, row):
    name = row["filename"]
    require(isinstance(name, str) and len(name) <= 300 and "\\" not in name, "Malformed camera path")
    rel = PurePosixPath(name)
    require(not rel.is_absolute() and len(rel.parts) == 3 and ".." not in rel.parts
            and rel.parts[:2] in (("samples", "CAM_FRONT"), ("sweeps", "CAM_FRONT"))
            and rel.suffix.lower() in (".jpg", ".jpeg"), "Unexpected camera asset path")
    file = (root / rel).resolve(strict=True)
    require(file.is_relative_to(root) and file.is_file() and 0 < file.stat().st_size <= MAX_IMAGE_BYTES,
            "Missing/unsafe/large camera asset")
    return rel.as_posix(), file


def family(name):
    if name.startswith("human.pedestrian."):
        return "person"
    if name.startswith("vehicle.") and name != "vehicle.ego":
        return "vehicle"
    return None


def project_box(annotation, camera_to_world, k, w, h):
    width, length, height = read_matrix(annotation["size"], (3,))
    require(min(width, length, height) > 0 and max(width, length, height) < 100, "Invalid 3-D box dimensions")
    center = read_matrix(annotation["translation"], (3,))
    local = np.asarray(list(product((-1., 1.), repeat=3))) * (length*.5, width*.5, height*.5)
    world = local @ rotation(annotation["rotation"]).T + center
    camera = (world - camera_to_world[:3, 3]) @ camera_to_world[:3, :3]
    # Don't claim tight 2D GT for a cuboid intersecting the near plane.
    if np.min(camera[:, 2]) < .25:
        return None
    points = camera @ k.T
    points = points[:, :2] / points[:, 2:3]
    low, high = np.min(points, axis=0), np.max(points, axis=0)
    left, top = np.maximum(low, (0, 0))
    right, bottom = np.minimum(high, (w, h))
    if right-left < 8 or bottom-top < 8:
        return None
    fraction = (right-left)*(bottom-top) / np.prod(high-low)
    if fraction < .6:
        return None
    return {"x": float(left/w), "y": float(top/h), "width": float((right-left)/w), "height": float((bottom-top)/h)}


def causal_motion(ann, annotations, samples):
    points = []
    current = ann
    for i in range(3):
        sample = samples[current["sample_token"]]
        points.append((stamp(sample), read_matrix(current["translation"], (3,))[:2]))
        if i < 2:
            prev = current["prev"]
            if not prev:
                return "unknown"
            prior = annotations.get(prev)
            require(prior is not None and prior["instance_token"] == ann["instance_token"]
                    and prior["next"] == current["token"], "Broken or cross-instance annotation link")
            if prior["sample_token"] != sample["prev"]:
                return "unknown"
            current = prior
    (tc, xc), (tb, xb), (ta, xa) = points
    dt = np.array([tb-ta, tc-tb]) / 1e6
    require(float(np.min(dt)) > 0, "Annotation history runs backward")
    if np.min(dt) < .25 or np.max(dt) > .75:
        return "unknown"
    v1, v2 = xb-xa, xc-xb
    norms = np.array([np.linalg.norm(v1), np.linalg.norm(v2)])
    speeds = norms / dt
    if np.max(speeds) <= .25 and sum(norms) <= .22:
        return "stationary"
    if np.min(speeds) >= .65 and np.max(speeds) <= 65 and v1 @ v2 >= .80 * np.prod(norms):
        return "moving"
    return "unknown"


def build_manifests(root, output, clip_specs):
    root, output = root.resolve(strict=True), output.resolve()
    meta = (root / VERSION).resolve(strict=True)
    require(meta.parent == root and meta.is_dir(), "Expected extracted official v1.0-mini metadata inside dataset root")
    picks = [clip_range(spec) for spec in clip_specs]
    require(2 <= len(picks) <= 5 and len({x[0] for x in picks}) == len(picks), "Select 2–5 distinct scenes")
    wanted = {x[0] for x in picks}
    scenes = [r for r in indexed(meta, "scene").values() if r.get("name") in wanted]
    require(len(scenes) == len(picks) and {r["name"] for r in scenes} == wanted, "Absent or duplicate requested scene")
    scenes = {r["name"]: r for r in scenes}
    samples, data = indexed(meta, "sample"), indexed(meta, "sample_data")
    sensors, cal = indexed(meta, "sensor"), indexed(meta, "calibrated_sensor")
    egos = indexed(meta, "ego_pose")
    camera = {key for key, r in cal.items() if sensors[r["sensor_token"]]["channel"] == "CAM_FRONT"
              and sensors[r["sensor_token"]]["modality"] == "camera"}
    fronts = {key: r for key, r in data.items() if r["calibrated_sensor_token"] in camera}
    by_sample = defaultdict(list)
    for row in fronts.values():
        require(type(row["is_key_frame"]) is bool, "Invalid keyframe flag")
        if row["is_key_frame"]:
            by_sample[row["sample_token"]].append(row)

    # Prepare the complete input before accessing annotation/taxonomy tables.
    inputs = {"schemaVersion": 1, "dataset": "nuScenes-v1.0-mini", "assetRoot": os.path.relpath(root, output), "clips": []}
    keyframes = {}
    seen_frame_tokens, seen_images = set(), set()
    total_image_bytes = 0
    for name, start, stop in picks:
        scene = scenes[name]
        sample_seq = chain(samples, scene["first_sample_token"], scene["last_sample_token"], cap=64)
        require(len(sample_seq) == scene["nbr_samples"] and all(s["scene_token"] == scene["token"] for s in sample_seq),
                "Sample chain exceeds scene bounds")
        require(all(len(by_sample[s["token"]]) == 1 for s in sample_seq), "Missing or duplicate CAM_FRONT keyframe")
        wanted_keys = [by_sample[s["token"]][0]["token"] for s in sample_seq]
        dense = chain(fronts, wanted_keys[0], wanted_keys[-1])
        require([r["token"] for r in dense if r["is_key_frame"]] == wanted_keys
                and all(samples[r["sample_token"]]["scene_token"] == scene["token"] for r in dense),
                "CAM_FRONT chain crosses or misses scene keyframes")
        base = stamp(dense[0])
        selected = [r for r in dense if start <= stamp(r)-base <= stop]
        require(12 <= len(selected) <= MAX_SELECTED_FRAMES and stamp(selected[0])-base-start <= MAX_FRAME_GAP_US
                and stop-(stamp(selected[-1])-base) <= MAX_FRAME_GAP_US and
                all(stamp(b)-stamp(a) <= MAX_FRAME_GAP_US for a,b in zip(selected, selected[1:])),
                "Selected clip insufficient or has a dense frame gap")
        clip, keys = {"id": name, "frames": []}, []
        for row in selected:
            token, timestamp = row["token"], stamp(row)
            ego = egos[row["ego_pose_token"]]
            pt = stamp(ego)
            w, h = row["width"], row["height"]
            require(type(w) is int and type(h) is int and 64 <= min(w,h) <= max(w,h) <= 4096, "Invalid camera dimensions")
            require(abs(pt-timestamp) <= MAX_POSE_SKEW_US, "Camera and linked pose timestamps disagree")
            c = cal[row["calibrated_sensor_token"]]
            k = intrinsics(c, w, h)
            camera_world = pose(ego) @ pose(c)
            rel, file = frame_path(root, row)
            require(token not in seen_frame_tokens and file not in seen_images, "Colliding selected sample/image")
            seen_frame_tokens.add(token)
            seen_images.add(file)
            total_image_bytes += file.stat().st_size
            require(total_image_bytes <= MAX_SELECTED_IMAGE_BYTES, "Selected images exceed total hash budget")
            payload = file.read_bytes()
            require(payload[:2] == b"\xff\xd8" and len(payload) <= MAX_IMAGE_BYTES, "Invalid JPEG asset")
            # Intrinsics correspond to the raw certified raster; don't let
            # an EXIF orientation or silently rescaled copy move the GT boxes.
            with Image.open(BytesIO(payload), formats=["JPEG"]) as image:
                require(image.size == (w, h), "JPEG dimensions disagree with calibration record")
                image.load()
            digest = hashlib.sha256(payload).hexdigest()
            clip["frames"].append({"token": token, "path": rel, "timestampUs": timestamp, "poseTimestampUs": pt,
                                   "intrinsics": k.tolist(), "cameraToWorld": camera_world.tolist(), "sha256": digest,
                                   "isKeyFrame": row["is_key_frame"]})
            if row["is_key_frame"] and abs(stamp(samples[row["sample_token"]])-timestamp) <= MAX_TRUTH_SKEW_US:
                keys.append((row, camera_world, k, w, h))
        require(len(keys) >= 2, "Insufficient ground-truth-compatible CAM_FRONT keyframes")
        inputs["clips"].append(clip)
        keyframes[name] = keys

    keys = {r["sample_token"] for frames in keyframes.values() for r, *_ in frames}
    all_annotations = indexed(meta, "sample_annotation")
    instances, categories = indexed(meta, "instance"), indexed(meta, "category")
    annotations = defaultdict(list)
    for ann in all_annotations.values():
        if ann["sample_token"] in keys:
            annotations[ann["sample_token"]].append(ann)
    truth = {"schemaVersion": 1, "clips": []}
    for name, frames in keyframes.items():
        tclip = {"id": name, "frames": []}
        for row, world, k, w, h in frames:
            targets, seen_instances = [], set()
            for a in sorted(annotations[row["sample_token"]], key=lambda x: x["instance_token"]):
                instance = a["instance_token"]
                require(instance not in seen_instances, "Duplicate annotation instance for keyframe")
                seen_instances.add(instance)
                cls = family(categories[instances[instance]["category_token"]]["name"])
                v = a["visibility_token"]
                if cls is None or v not in VISIBLE_TOKENS:
                    continue
                bb = project_box(a, world, k, w, h)
                if bb is not None:
                    targets.append({"instance": instance, "box": bb, "classFamily": cls,
                                    "motion": causal_motion(a, all_annotations, samples)})
            tclip["frames"].append({"token": row["token"], "timestampUs": stamp(row), "targets": targets})
        truth["clips"].append(tclip)
    return inputs, truth


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dataset-root", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True, help="New directory for input.json and private truth.json")
    p.add_argument("--clip", action="append", required=True, help="Repeat 2–5 times: scene-XXXX:START_SECONDS:END_SECONDS")
    p.add_argument("--license-verified", action="store_true", help="Confirm rights for your intended local evaluation use")
    a = p.parse_args()
    if not a.license_verified:
        p.error("Dataset access requires an explicitly verified license for the intended use")
    if a.output_dir.exists() or a.output_dir.is_symlink():
        p.error("Choose a new output directory; existing manifests are never overwritten")
    try:
        i, t = build_manifests(a.dataset_root, a.output_dir, a.clip)
        a.output_dir.mkdir(mode=0o700, exist_ok=False)
        # Compute and serialize both before exposing either. Oracle remains local.
        public = json.dumps(i, allow_nan=False, indent=2) + "\n"
        t["inputSha256"] = hashlib.sha256(public.encode("utf-8")).hexdigest()
        private = json.dumps(t, allow_nan=False, indent=2) + "\n"
        with (a.output_dir / "truth.json").open("x", encoding="utf-8") as stream:
            stream.write(private)
        with (a.output_dir / "input.json").open("x", encoding="utf-8") as stream:
            stream.write(public)
    except (OSError, ValueError, KeyError, TypeError, OverflowError, Image.DecompressionBombError) as e:
        p.error(str(e))
    print(f"Wrote {sum(len(c['frames']) for c in i['clips'])} RGB entries and "
          f"{sum(len(c['frames']) for c in t['clips'])} separately scored keyframes across {len(i['clips'])} clips")


if __name__ == "__main__":
    main()
