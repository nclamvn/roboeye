#!/usr/bin/env python3
"""Build offline M3C manifests from a licensed local PandaSet slice.

Only decoded cuboid JSON rows are accepted; this process never opens pickle,
archives, LiDAR point clouds or network connections. Optical projection follows
https://github.com/scaleapi/pandaset-devkit/tree/master/python/pandaset
"""

import argparse
from collections import Counter
import hashlib
from io import BytesIO
from itertools import product
import json
import math
import os
from pathlib import Path
import re

import numpy as np
from PIL import Image

from assist_scene_nuscenes_import import pose, read_matrix, require


MAX_ASSET = 8 * 1024**2
MAX_META = 2 * 1024**2
MAX_CLIP_BYTES = 200 * 1024**2
MAX_TOTAL_BYTES = 512 * 1024**2
MAX_SKEW_US = 60_000
MAX_SPAN_US = 8_500_000
MIN_SENSOR_STEP_US = 30_000
MAX_SENSOR_STEP_US = 170_000
DATASET = "PandaSet-real"
IDS = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9-]{0,99}")
RANGE = re.compile(r"([0-9]{3}):([0-9]{1,2}):([0-9]{1,2})")
VEHICLES = {"Car", "Pickup Truck", "Medium-sized Truck", "Semi-truck", "Towed Object", "Motorcycle",
            "Other Vehicle - Construction Vehicle", "Other Vehicle - Uncommon", "Other Vehicle - Pedicab",
            "Emergency Vehicle", "Bus", "Personal Mobility Device", "Motorized Scooter", "Bicycle", "Train",
            "Trolley", "Tram / Subway"}
PEOPLE = {"Pedestrian", "Pedestrian with Object"}


def file_under(root, relative, cap):
    asset = (root / relative).resolve(strict=True)
    require(asset.is_relative_to(root) and asset.is_file() and 0 < asset.stat().st_size <= cap,
            f"Missing/unsafe/over-budget input: {relative}")
    return asset


def records(root, relative):
    return json.loads(file_under(root, relative, MAX_META).read_bytes())


def clip_range(s):
    match = RANGE.fullmatch(s)
    require(match is not None, "Expected PandaSet clip SEQUENCE:FIRST_INDEX:LAST_INDEX")
    name, start, stop = match.groups()
    start, stop = int(start), int(stop)
    require(0 <= start < stop < 80 and 12 <= stop-start+1 <= 80, "Select 12–80 frames per clip (indices 0–79 inclusive)")
    return name, start, stop


def usec(stamps, name):
    require(isinstance(stamps, list) and 12 <= len(stamps) <= 80, f"Invalid {name} timestamp list")
    require(all(type(s) in (int, float) and math.isfinite(s) and 1e9 < s < 3e9 for s in stamps),
            f"Invalid {name} timestamps: expected Unix seconds")
    out = [round(s*1e6) for s in stamps]
    require(all(b > a for a,b in zip(out,out[1:])), f"Non-monotonic {name} timestamps")
    return out


def camera_pose(row):
    return pose({"rotation": [row["heading"][k] for k in "wxyz"],
                 "translation": [row["position"][k] for k in "xyz"]})


def camera_k(record, w, h):
    fx, fy, cx, cy = read_matrix([record[key] for key in ("fx", "fy", "cx", "cy")], (4,))
    require(fx > 0 and fy > 0 and 0 <= cx < w and 0 <= cy < h, "Invalid front-camera calibration")
    return np.array([[fx,0,cx],[0,fy,cy],[0,0,1]])


def family(label):
    return "vehicle" if label in VEHICLES else ("person" if label in PEOPLE else None)


def motion(row):
    annotation = row.get("attributes.object_motion")
    always_static = row.get("stationary")
    require(always_static is None or type(always_static) is bool, "Malformed stationary flag")
    if annotation == "Moving":
        return "unknown" if always_static else "moving"
    if annotation in ("Parked", "Stopped") or (annotation in (None, "", "Unknown") and always_static is True):
        return "stationary"
    return "unknown"


def cuboid_corners(row):
    dim = read_matrix([row[f"dimensions.{d}"] for d in "xyz"], (3,))
    mid = read_matrix([row[f"position.{d}"] for d in "xyz"], (3,))
    theta = row["yaw"]
    require(type(theta) in (int, float) and math.isfinite(theta) and abs(theta) <= 2*np.pi + .01
            and min(dim) > 0 and max(dim) <= 100,
            "Invalid PandaSet cuboid dimensions or yaw")
    sine, cosine = np.sin(theta), np.cos(theta)
    rz = np.array([[cosine,-sine,0.],[sine,cosine,0.],[0.,0.,1.]])
    # PandaSet native axes: X width, Y length (forward at yaw=0), Z up.
    return np.asarray(list(product((-1.,1.), repeat=3))) * (.5*dim) @ rz.T + mid


def project(row, camera_to_world, k, w, h):
    world = cuboid_corners(row)
    camera = (world-camera_to_world[:3,3]) @ camera_to_world[:3,:3]
    if np.min(camera[:,2]) < .25:
        return None
    homogeneous = camera @ k.T
    uv = homogeneous[:,:2] / homogeneous[:,2:]
    low, high = np.min(uv,axis=0), np.max(uv,axis=0)
    a,b = np.maximum(low,(0,0)), np.minimum(high,(w,h))
    size = b-a
    # 3-D projections are approximate extent, not 2-D masks. Remove tiny or
    # heavily truncated cuboids; occlusion is not given by this containment.
    if np.min(size) < 12 or float(np.prod(size)/np.prod(high-low)) < .70:
        return None
    return dict(zip(("x","y","width","height"), (float(a[0]/w),float(a[1]/h),float(size[0]/w),float(size[1]/h))))


def deduplicate(rows, audit=None):
    require(isinstance(rows,list) and len(rows) <= 1500, "Malformed or over-budget cuboid JSON records")
    by_id = {}
    for row in rows:
        require(isinstance(row,dict), "Malformed cuboid JSON record")
        id_ = row.get("uuid")
        label = row.get("label")
        require(isinstance(id_,str) and IDS.fullmatch(id_) and id_ not in by_id and isinstance(label,str),
                "Invalid or duplicate cuboid UUID")
        by_id[id_] = row
    if audit is None:
        audit = Counter()
    linked = set()
    for id_, row in by_id.items():
        if family(row["label"]) is None:
            audit["outsideClassFamilies"] += 1
            continue
        source, sibling = row.get("cuboids.sensor_id"), row.get("cuboids.sibling_id")
        require(type(source) is int and source in {-1,0,1}, "Malformed cuboid sensor ID")
        if source == -1:
            if sibling in (None, "", "-", "-1", -1):
                yield id_, row, motion(row)
            else:
                audit["malformedSiblingRecords"] += 1
            continue
        # The dataset provides fused LiDAR frame time, not the measured time
        # for each duplicated cuboid. Do not guess which is closer to RGB.
        audit["sensorSpecificCuboids"] += 1
        other = by_id.get(sibling) if isinstance(sibling,str) else None
        if (other is None or other.get("cuboids.sibling_id") != id_ or other.get("cuboids.sensor_id") != 1-source
                or other["label"] != row["label"]):
            audit["malformedSiblingRecords"] += 1
            continue
        linked.add(tuple(sorted((id_,sibling))))
    audit["excludedDualObjects"] += len(linked)


def build_manifests(root, out, specs, audit=None):
    root, out = root.resolve(strict=True), out.resolve()
    require(root.is_dir(), "Expected extracted local PandaSet directory")
    picks = [clip_range(spec) for spec in specs]
    require(2 <= len(picks) <= 5 and len({c[0] for c in picks}) == len(picks), "Select 2–5 distinct sequences")
    live = {"schemaVersion":1,"dataset":DATASET,"assetRoot":os.path.relpath(root,out),"clips":[]}
    truth = {"schemaVersion":1,"clips":[]}
    projection = {}
    assets = set()
    total_size = 0

    # Prepare detector inputs completely before opening cuboid/LiDAR labels.
    for seq,start,end in picks:
        front = Path(seq) / "camera/front_camera"
        poses = records(root,front/"poses.json")
        ts = usec(records(root,front/"timestamps.json"),"camera")
        require(isinstance(poses,list) and len(poses)==len(ts) and end<len(ts), "Camera poses/timestamps/index mismatch")
        require(ts[end]-ts[start] <= MAX_SPAN_US and
                all(MIN_SENSOR_STEP_US <= ts[i+1]-ts[i] <= MAX_SENSOR_STEP_US for i in range(start,end)),
                "Excessive time/cadence gap in requested camera clip")
        k_raw = records(root,front/"intrinsics.json")
        clip, info = {"id":seq,"frames":[]}, []
        clip_bytes = 0
        expected_size = None
        for idx in range(start,end+1):
            relative = front / f"{idx:02}.jpg"
            file = file_under(root,relative,MAX_ASSET)
            require(file not in assets, "Repeated camera asset")
            assets.add(file)
            data = file.read_bytes()
            clip_bytes += len(data)
            total_size += len(data)
            require(len(data) <= MAX_ASSET and clip_bytes <= MAX_CLIP_BYTES and total_size <= MAX_TOTAL_BYTES,
                    "Selected camera data exceed hash budget")
            with Image.open(BytesIO(data),formats=["JPEG"]) as jpg:
                w,h = jpg.size
                require(64 <= min(w,h) <= max(w,h) <= 4096 and jpg.getexif().get(274,1) == 1
                        and (expected_size is None or jpg.size == expected_size), "Unexpected raw JPEG dimensions/orientation")
                jpg.load()
            expected_size = (w,h)
            world, k = camera_pose(poses[idx]), camera_k(k_raw,w,h)
            token = f"pandaset-{seq}-front-{idx:02}"
            frame = {"token":token,"path":relative.as_posix(),"timestampUs":ts[idx],"poseTimestampUs":ts[idx],
                     "cameraToWorld":world.tolist(),"intrinsics":k.tolist(),"sha256":hashlib.sha256(data).hexdigest(),
                     "isKeyFrame":True}
            clip["frames"].append(frame)
            info.append((idx,ts[idx],token,world,k,w,h))
        live["clips"].append(clip)
        projection[seq] = info

    for seq, info in projection.items():
        stamp = usec(records(root,Path(seq)/"lidar/timestamps.json"),"lidar")
        require(info[-1][0] < len(stamp), "Missing LiDAR timestamp indices")
        tclip = {"id":seq,"frames":[]}
        abs_skews = []
        counts, bins, state_counts = Counter(), Counter(), Counter()
        for key in ("outsideClassFamilies", "sensorSpecificCuboids", "malformedSiblingRecords", "excludedDualObjects",
                    "outsideProjection", "excludedTimingFrames"):
            counts[key] = 0
        for key in ("0–10", ">10–25", ">25–40", ">40–60", ">60"):
            bins[key] = 0
        for cls in ("vehicle", "person"):
            for state in ("moving", "stationary", "unknown"):
                state_counts[(cls,state)] = 0
        for idx,timestamp,token,world,k,w,h in info:
            skew = abs(timestamp-stamp[idx])
            abs_skews.append(skew)
            for edge, label in zip((10000,25000,40000,60000,math.inf), bins):
                if skew <= edge:
                    bins[label]+=1
                    break
            if skew > MAX_SKEW_US:
                counts["excludedTimingFrames"] += 1
                continue
            anns = records(root,Path(seq)/f"annotations/cuboids_safe/{idx:02}.json")
            targets = []
            for key,row,state in deduplicate(anns,counts):
                rect = project(row,world,k,w,h)
                if rect is not None:
                    cls = family(row["label"])
                    targets.append({"instance":key,"box":rect,"classFamily":cls,"motion":state})
                    state_counts[(cls,state)]+=1
                else:
                    counts["outsideProjection"] += 1
            tclip["frames"].append({"token":token,"timestampUs":timestamp,"targets":sorted(targets,key=lambda t:t["instance"])})
        require(len(tclip["frames"]) >= 2, "Too few time-aligned PandaSet truth frames; do not resync by guessed offset")
        truth["clips"].append(tclip)
        if audit is not None:
            audit.append({"id":seq,"inputFrames":len(info),"scoreEligibleFrames":len(tclip["frames"]),
                          "absSkewBinsMs":dict(bins),"maxAbsSkewUs":max(abs_skews),
                          "exclusions":dict(counts),"targetKeyframesByFamily":{
                              cls:{st:state_counts[(cls,st)] for st in ("moving","stationary","unknown")}
                              for cls in ("vehicle","person")}})
    return live, truth


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dataset-root",type=Path,required=True)
    p.add_argument("--output-dir",type=Path,required=True,help="New local directory; not overwritten")
    p.add_argument("--clip",action="append",required=True,help="Repeat 2–5 times: SEQUENCE:FIRST_INCLUSIVE:LAST_INCLUSIVE")
    p.add_argument("--license-verified",action="store_true",help="Dataset license is verified for intended use")
    a = p.parse_args()
    if not a.license_verified:
        p.error("Dataset access requires an explicitly verified license for the intended use")
    if a.output_dir.exists() or a.output_dir.is_symlink():
        p.error("Choose a new output directory; existing manifests are never overwritten")
    try:
        audit = []
        live,truth = build_manifests(a.dataset_root,a.output_dir,a.clip,audit)
        public = json.dumps(live,allow_nan=False,indent=2)+"\n"
        truth["inputSha256"] = hashlib.sha256(public.encode("utf-8")).hexdigest()
        report = {"schemaVersion":1,"dataset":DATASET,"inputSha256":truth["inputSha256"],
                  "sensorTimePolicy":"same-index front RGB and fused LiDAR, not per-cuboid", "maxAbsSkewUs":MAX_SKEW_US,
                  "sensorSpecificDualPolicy":"excluded without per-cuboid verified timestamps", "clips":audit}
        payload = [json.dumps(d,allow_nan=False,indent=2)+"\n" for d in (truth,report)]+[public]
        a.output_dir.mkdir(mode=0o700,exist_ok=False)
        for name,data in zip(("truth.json","import-report.json","input.json"),payload):
            with (a.output_dir/name).open("x",encoding="utf-8") as stream:
                stream.write(data)
    except (OSError,KeyError,TypeError,ValueError,OverflowError,Image.DecompressionBombError) as exc:
        p.error(str(exc))
    print(f"PandaSet: {sum(len(c['frames']) for c in live['clips'])} input frames, "
          f"{sum(len(c['frames']) for c in truth['clips'])} separately scored frames in {len(live['clips'])} clips")


if __name__ == "__main__":
    main()
