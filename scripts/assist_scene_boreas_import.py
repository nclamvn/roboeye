#!/usr/bin/env python3
"""Build separate offline M3C manifests from a local Boreas objects-v1 slice.

Format and coordinates: https://github.com/utiasASRL/pyboreas
Dataset license: https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md
No download, archive unpack, pose inference, image re-encoding or runtime labels.
"""

import argparse
from bisect import bisect_left
from collections import Counter, defaultdict, deque
import csv
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

from assist_scene_nuscenes_import import require


DATASET = "Boreas-real"
SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}")
MIN_TIME_US, MAX_TIME_US = 10**15, 3*10**15
MAX_MATCH_US = 60_000
MAX_FRAME_GAP_US = 350_000
MAX_CLIP_SPAN_US = 16_000_000
MAX_IMG_BYTES = 8*1024**2
MAX_MEDIA_BYTES = 640*1024**2
MAX_META_BYTES = 32*1024**2
MAX_LABEL_BYTES = 256*1024
MIN_LIDAR_POINTS = 5
SIGNS = np.asarray(list(product((-1., 1.), repeat=3)))
FAMILY = {"car":"vehicle", "truck":"vehicle", "bus":"vehicle", "van":"vehicle", "vehicle":"vehicle",
          "bicycle":"vehicle", "cyclist":"vehicle", "motorcycle":"vehicle", "pedestrian":"person"}


def under(root, p, budget, empty_ok=False):
    path = (root / p).resolve(strict=True)
    require(path.is_relative_to(root) and path.is_file() and int(not empty_ok) <= path.stat().st_size <= budget,
            f"Missing/unsafe/over-budget asset: {p}")
    return path


def timestamp(value):
    require(type(value) is int and MIN_TIME_US <= value <= MAX_TIME_US, "Expected integer Unix microseconds")
    return value


def timestamp_list(values):
    require(isinstance(values, list) and 4 <= len(values) <= 150, "Expected 4–150 timestamps per list")
    payload = [timestamp(x) for x in values]
    require(all(b>a for a,b in zip(payload,payload[1:])) and payload[-1]-payload[0] <= MAX_CLIP_SPAN_US,
            "Timestamps must be unique, increasing and within 16 seconds")
    return payload


def ypr(y, p, r):
    # Official pyboreas uses this passive Rx(r) @ Ry(p) @ Rz(y).
    sy, cy, sp, cp, sr, cr = math.sin(y), math.cos(y), math.sin(p), math.cos(p), math.sin(r), math.cos(r)
    return np.array([[1.,0.,0.],[0.,cr,sr],[0.,-sr,cr]]) @ np.array([[cp,0.,-sp],[0.,1.,0.],[sp,0.,cp]]) @ np.array([[cy,sy,0.],[-sy,cy,0.],[0.,0.,1.]])


def sensor_poses(root, seq, name, wanted):
    path = under(root, seq/f"applanix/{name}_poses.csv", MAX_META_BYTES)
    found = {}
    with path.open(encoding="utf-8", newline="") as stream:
        reader = csv.reader(stream)
        columns = next(reader, [])
        keys = [v.strip().lower() for v in columns]
        require(len(keys) >= 10 and keys[0] in {"rostime","timestamp","timestamp_us","time"} and
                keys[7:9] == ["roll","pitch"] and keys[9] in {"heading","yaw"},
                "Unexpected Boreas timestamp/roll-pitch-yaw columns")
        last = None
        for n, row in enumerate(reader):
            if not row:
                continue
            require(n < 300_000 and len(row) >= 10, "Malformed or over-budget Boreas pose rows")
            ts = timestamp(int(row[0]))
            require(last is None or ts > last, "Duplicate or backward Boreas poses")
            last = ts
            if ts not in wanted:
                continue
            values = [float(v) for v in row[1:10]]
            require(all(math.isfinite(v) for v in values) and max(abs(a) for a in values[6:9]) <= math.pi*2+.01,
                    "Malformed Boreas pose values")
            t = np.eye(4)
            t[:3,:3] = ypr(values[8], values[7], values[6])
            t[:3,3] = values[:3]
            found[ts] = t
    require(set(found) == set(wanted), f"Missing exact {name} sensor poses")
    return found


def camera_calibration(root, seq):
    path = under(root, seq/"calib/P_camera.txt", 8192)
    p = np.loadtxt(path, dtype=float)
    require(p.shape in {(3,3),(3,4),(4,4)} and np.isfinite(p).all() and p[2,2] > 0,
            "Boreas camera projection must be finite 3×3, 3×4 or homogeneous 4×4")
    if p.shape==(4,4):
        require(np.allclose(p[3],[0,0,0,1],atol=1e-8,rtol=0), "Malformed homogeneous camera projection")
        p=p[:3]
    p = p/p[2,2]
    k = p[:,:3]
    require(np.allclose(k[2],[0,0,1],atol=1e-8,rtol=0) and abs(k[1,0]) <= 1e-8 and min(k[0,0],k[1,1]) > 0,
            "Unsupported camera projection (requires positive optical-Z pinhole)")
    offset = np.linalg.solve(k,p[:,3]) if p.shape==(3,4) else np.zeros(3)
    require(float(np.linalg.norm(offset)) <= 2., "Implausible calibrated optical origin offset")
    return k, offset


def matches(times, labels):
    """Mutual unique nearest inside 60 ms; ties and many-to-one are unscored."""
    def close(candidates, query):
        j = bisect_left(candidates,query)
        distances = [(abs(candidates[i]-query),candidates[i]) for i in (j-1,j) if 0<=i<len(candidates)]
        distances.sort()
        if not distances or distances[0][0] > MAX_MATCH_US or (len(distances)>1 and distances[0][0]==distances[1][0]):
            return None
        return distances[0][1]
    return {t:x for t in times if (x:=close(labels,t)) is not None and close(times,x)==t}


def labels_world(root, seq, stamp, lidar_to_world):
    path = under(root, seq/f"labels_detection/{stamp}.txt", MAX_LABEL_BYTES, empty_ok=True)
    items = {}
    other = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        cols = line.split()
        if not cols:
            continue
        require(len(cols) == 10 and SAFE_ID.fullmatch(cols[0]) and cols[0] not in items and len(items)<1500,
                "Invalid, predicted-score, duplicate or oversized Boreas ground-truth file")
        object_id, name = cols[:2]
        nums = np.asarray([float(a) for a in cols[2:9]])
        require(np.isfinite(nums).all() and min(nums[:3])>0 and max(nums[:3])<=100 and abs(nums[6])<=math.pi*2+.01,
                "Malformed Boreas cuboid")
        dim, center, angle = nums[:3], nums[3:6], nums[6]
        num = 0 if cols[9] == "None" else int(cols[9])
        require(0 <= num <= 1_000_000, "Invalid LiDAR support count")
        cls = FAMILY.get(name.casefold())
        if cls is None:
            other += 1
        rot, tr = lidar_to_world[:3,:3], lidar_to_world[:3,3]
        world = center @ rot.T + tr
        points = ((SIGNS * (dim*.5)) @ ypr(angle,0,0).T + center) @ rot.T + tr
        items[object_id] = (name, cls, num, world, points)
    return items, other


def project(world, camera, k, w, h):
    coordinates = (world-camera[:3,3]) @ camera[:3,:3]
    if np.min(coordinates[:,2]) < .25:
        return None
    homogeneous = coordinates@k.T
    xy = homogeneous[:,:2]/homogeneous[:,2:]
    lo, hi = np.min(xy,axis=0), np.max(xy,axis=0)
    a,b = np.maximum(lo,(0,0)),np.minimum(hi,(w,h))
    extent = b-a
    if np.min(extent)<12 or np.prod(extent)/np.prod(hi-lo)<.7:
        return None
    return dict(zip(("x","y","width","height"),map(float,(a[0]/w,a[1]/h,extent[0]/w,extent[1]/h))))


def motion(history):
    """Conservative classification from observed global XY centers, not ego motion."""
    now, current = history[-1]
    halfway = next(((t,p) for t,p in reversed(history) if now-t >= 220_000), None)
    if halfway is None:
        return "unknown"
    middle, mid = halfway
    start = next(((t,p) for t,p in reversed(history) if middle-t >= 220_000), None)
    if start is None:
        return "unknown"
    start_time, first = start
    durations = np.asarray((middle-start_time,now-middle))/1e6
    if max(durations)>.45 or now-start_time>900_000:
        return "unknown"
    steps = np.asarray((mid[:2]-first[:2],current[:2]-mid[:2]))
    lengths = np.linalg.norm(steps,axis=1)
    speeds = lengths/durations
    recent = np.asarray([p[:2]-first[:2] for t,p in history if t>=start_time])
    if max(speeds)<=.25 and np.max(np.linalg.norm(recent,axis=1))<=.18:
        return "stationary"
    if min(speeds)>=.75 and sum(lengths)>=.45 and max(speeds)<=55 and steps[0]@steps[1]>=.8*np.prod(lengths):
        if max(speeds)<=3*min(speeds) and .8*sum(lengths)<=np.linalg.norm(current[:2]-first[:2]):
            return "moving"
    return "unknown"


def build_manifests(root, manifest, out):
    root,out = root.resolve(strict=True),out.resolve()
    require(root.is_dir(), "Expected local Boreas directory")
    require(manifest.is_file() and manifest.stat().st_size<=128*1024, "Invalid/excessive clip manifest")
    requested = json.loads(manifest.read_bytes())
    require(isinstance(requested,dict) and type(requested.get("schemaVersion")) is int and requested["schemaVersion"]==1
            and isinstance(requested.get("clips"),list) and 1<=len(requested["clips"])<=5,
            "Select 1–5 clips in a v1 manifest (single clip for annotation preview)")
    inputs = {"schemaVersion":1,"dataset":DATASET,"assetRoot":os.path.relpath(root,out),"clips":[]}
    truth = {"schemaVersion":1,"clips":[]}
    report = {"schemaVersion":1,"dataset":DATASET,"maxMatchUs":MAX_MATCH_US,"minimumLidarPoints":MIN_LIDAR_POINTS,"clips":[]}
    scanned, prep, all_files, total = set(), [], set(), 0
    for row in requested["clips"]:
        require(isinstance(row,dict) and set(row)<={"id","sequence","cameraTimestampsUs","labelTimestampsUs"}, "Invalid clip keys")
        id_ = row.get("id")
        folder = row.get("sequence", id_)
        require(isinstance(id_,str) and SAFE_ID.fullmatch(id_) and id_ not in scanned and isinstance(folder,str)
                and SAFE_ID.fullmatch(folder), "Invalid/duplicate clip or unsafe sequence id")
        scanned.add(id_)
        seq = Path(folder) if "sequence" in row or (root/folder).is_dir() else Path(".")
        cams, labels = timestamp_list(row["cameraTimestampsUs"]),timestamp_list(row["labelTimestampsUs"])
        require(max(b-a for a,b in zip(cams,cams[1:]))<=MAX_FRAME_GAP_US, "Unexpected camera timestamp gap")
        require(min(abs(labels[0]-cams[0]),abs(labels[-1]-cams[-1]))<=MAX_FRAME_GAP_US, "Camera/label clips are not synchronized")
        k, offset = camera_calibration(root,seq)
        cam_poses = sensor_poses(root,seq,"camera",set(cams))
        submitted = {"id":id_,"frames":[]}
        details = []
        size = None
        for t in cams:
            relative = seq/f"camera/{t}.png"
            file = under(root,relative,MAX_IMG_BYTES)
            require(file not in all_files, "Repeated camera asset across the benchmark")
            all_files.add(file)
            data = file.read_bytes()
            total += len(data)
            require(len(data)<=MAX_IMG_BYTES and total<=MAX_MEDIA_BYTES, "Image byte budget exceeded")
            with Image.open(BytesIO(data),formats=["PNG"]) as img:
                w,h = img.size
                require(64<=min(w,h)<=max(w,h)<=4096 and (size is None or size==img.size) and
                        0<=k[0,2]<w and 0<=k[1,2]<h, "Unexpected image size or principal point")
                size = img.size
                img.load()
            cam = cam_poses[t].copy()
            cam[:3,3] -= cam[:3,:3]@offset
            token = f"boreas-{id_}-{t}"
            submitted["frames"].append({"token":token,"path":relative.as_posix(),"timestampUs":t,"poseTimestampUs":t,
                                        "intrinsics":k.tolist(),"cameraToWorld":cam.tolist(),"sha256":hashlib.sha256(data).hexdigest(),
                                        "isKeyFrame":False})
            details.append((t,token,cam,k,w,h))
        inputs["clips"].append(submitted)
        prep.append((id_,seq,cams,labels,details))

    # LiDAR data is loaded exclusively after runtime inputs are complete.
    for id_,seq,cams,labels,all_details in prep:
        pairs = matches(cams,labels)
        require(len(pairs)>=2,"Too few mutual unique nearest synchronized frames")
        details=[(t,pairs[t],*values) for t,*values in all_details if t in pairs]
        poses = sensor_poses(root,seq,"lidar",set(labels))
        hist = defaultdict(lambda: deque(maxlen=24))
        state_frames = {}
        by_label = {entry[1]:entry for entry in details}
        counts = Counter()
        predicted = {"id":id_,"frames":[]}
        for stamp in labels:
            objects, other = labels_world(root,seq,stamp,poses[stamp])
            counts["unsupportedClassRows"] += other
            for object_id, (name,cls,n,center,_) in objects.items():
                if cls is None or n<MIN_LIDAR_POINTS:
                    continue
                previous_name, series = hist.get(object_id,(None,None))
                if previous_name != name or stamp-series[-1][0]>280_000:
                    series=deque(maxlen=24)
                series.append((stamp,center))
                hist[object_id] = (name,series)
            if stamp not in by_label:
                continue
            t,_,token,cam,k,w,h = by_label[stamp]
            targets = []
            for object_id, (_,cls,n,_,box) in objects.items():
                if cls is None:
                    continue
                if n<MIN_LIDAR_POINTS:
                    counts["insufficientLidarPoints"] += 1
                    continue
                rect = project(box,cam,k,w,h)
                if rect is None:
                    counts["outsideUsableProjection"] += 1
                    continue
                check = motion(hist[object_id][1])
                targets.append({"instance":object_id,"box":rect,"classFamily":cls,"motion":check})
                counts[f"{cls}.{check}"]+=1
            state_frames[t] = {"token":token,"timestampUs":t,"targets":sorted(targets,key=lambda x:x["instance"])}
        predicted["frames"] = [state_frames[t] for t in sorted(state_frames)]
        truth["clips"].append(predicted)
        skews = [abs(a-b) for a,b,*_ in details]
        report["clips"].append({"id":id_,"inputFrames":len(cams),"scoreEligibleFrames":len(details),"labelFrames":len(labels),
                                "maxAbsSkewUs":max(skews),"absSkewBinsUs":{
                                    "0-10000":sum(x<=10_000 for x in skews),"10001-25000":sum(10_000<x<=25_000 for x in skews),
                                    "25001-40000":sum(25_000<x<=40_000 for x in skews),"40001-60000":sum(x>40_000 for x in skews)},
                                "counts":dict(counts)})
    return inputs,truth,report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("dataset-root","clip-manifest","output-dir"):
        p.add_argument(f"--{name}",type=Path,required=True)
    a=p.parse_args()
    if a.output_dir.exists() or a.output_dir.is_symlink():
        p.error("Choose a new output dir; existing artifacts are never overwritten")
    try:
        i,t,r=build_manifests(a.dataset_root,a.clip_manifest,a.output_dir)
        public=json.dumps(i,indent=2,allow_nan=False)+"\n"
        digest=hashlib.sha256(public.encode("utf-8")).hexdigest()
        t["inputSha256"]=r["inputSha256"]=digest
        r["clipManifestSha256"]=hashlib.sha256(a.clip_manifest.read_bytes()).hexdigest()
        a.output_dir.mkdir(mode=0o700,exist_ok=False)
        outputs={"truth.json":json.dumps(t,indent=2,allow_nan=False)+"\n",
                 "import-report.json":json.dumps(r,indent=2,allow_nan=False)+"\n","input.json":public}
        for name,data in outputs.items():
            with (a.output_dir/name).open("x",encoding="utf-8") as f:
                f.write(data)
    except (OSError,ValueError,KeyError,TypeError,OverflowError,Image.DecompressionBombError) as err:
        p.error(str(err))
    print(f"Boreas: {sum(len(c['frames']) for c in i['clips'])} camera frames, "
          f"{sum(len(c['frames']) for c in t['clips'])} scored frames across {len(i['clips'])} clips")


if __name__=="__main__":
    main()
