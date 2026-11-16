#!/usr/bin/env python3
"""Offline A/B: shared RGB YOLO, independent geometry; never reads truth."""

import argparse
from collections import Counter, deque
from datetime import date
import json
from pathlib import Path
import platform
import tempfile
from time import perf_counter

import cv2
import numpy as np

from assist_scene_camera_guard import CameraScaleGuard, affine_scale
from assist_scene_motion import MotionState, elapsed, mask_for, parse_detect, registered, sha256
from assist_scene_motion_m3b import detect_samples, present
from assist_scene_pose_motion import POLICY as POSE_POLICY, pose_pair, point_residuals

MAX_SIDE = 768
MAX_FRAMES = 150
POLICY = {"minObjectPoints": 7, "minObjectSupport": .68, "minObjectSpan": .16,
          "minBackgroundPoints": 24, "minBackgroundSupport": .7, "minBackgroundCells": 5,
          "minPairs": 3, "minObservationMs": 200, "maxObservationMs": 1100}
LK = {"winSize": (21,21), "maxLevel": 3,
      "criteria": (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 25, .01)}


def correspondences(old, new, mask, limit):
    a = cv2.goodFeaturesToTrack(old, maxCorners=limit, qualityLevel=.012, minDistance=4, mask=mask)
    if a is None:
        return np.empty((0,2)), np.empty((0,2))
    b, s, _ = cv2.calcOpticalFlowPyrLK(old, new, a, None, **LK)
    if b is None or s is None:
        return np.empty((0,2)), np.empty((0,2))
    back, rev, _ = cv2.calcOpticalFlowPyrLK(new, old, b, None, **LK)
    if back is None or rev is None:
        return np.empty((0,2)), np.empty((0,2))
    a, b, back = a[:,0], b[:,0], back[:,0]
    keep = (s.ravel()==1) & (rev.ravel()==1) & np.isfinite(b).all(axis=1)
    keep &= np.linalg.norm(a-back, axis=1) <= 1.3
    h,w = new.shape
    keep &= (b[:,0]>=0) & (b[:,0]<w-1) & (b[:,1]>=0) & (b[:,1]<h-1)
    return a[keep], b[keep]


def inside(points, rect, inset=.14):
    x0,y0,x1,y1 = rect
    dx,dy = (x1-x0)*inset,(y1-y0)*inset
    return ((x0+dx<=points[:,0]) & (points[:,0]<=x1-dx)
            & (y0+dy<=points[:,1]) & (points[:,1]<=y1-dy))


def background(pair, old, cur, boxes0, boxes1, floor):
    a,b = correspondences(old,cur,mask_for(old.shape, boxes0),POSE_POLICY["maxPointPairs"])
    mask = mask_for(cur.shape, boxes1)
    coords = b.astype(int)
    keep = mask[coords[:,1], coords[:,0]] > 0
    a,b = a[keep],b[keep]
    r,usable = point_residuals(pair,a,b)
    r,b = r[usable],b[usable]
    agree = r <= min(2.0,.65*floor)
    h,w = cur.shape
    cells = {(int(x*4/w), int(y*3/h)) for x,y in b[agree]}
    supported = (len(r)>=POLICY["minBackgroundPoints"] and len(cells)>=POLICY["minBackgroundCells"]
                 and np.mean(agree)>=POLICY["minBackgroundSupport"])
    return bool(supported), {"points":len(r), "occupiedCells":len(cells),
                             "support":float(np.mean(agree)) if len(r) else 0,
                             "medianPx":float(np.median(r)) if len(r) else None,
                             "p90Px":float(np.percentile(r,90)) if len(r) else None}


class PoseTracks:
    def __init__(self):
        self.epoch = 0
        self.next_id = 1
        self.active = []

    def update(self, pair, at, old, cur, boxes, floor):
        if pair is None:
            self.active = []
            self.epoch += 1
        edges, source_counts, target_counts = [], {}, {}
        if pair is not None:
            for i,(previous,previous_id,votes) in enumerate(self.active):
                x0,y0,x1,y1 = previous.xyxy
                mask = np.zeros(old.shape,np.uint8)
                lx,rx = int(.86*x0+.14*x1),int(.14*x0+.86*x1)
                ly,ry = int(.86*y0+.14*y1),int(.14*y0+.86*y1)
                mask[ly:ry,lx:rx] = 255
                a,b = correspondences(old,cur,mask,52)
                if len(a) < POLICY["minObjectPoints"]:
                    continue
                for j,box in enumerate(boxes):
                    if box.label != previous.label:
                        continue
                    keep = inside(b,box.xyxy)
                    if (np.count_nonzero(keep)<POLICY["minObjectPoints"]
                            or np.mean(keep)<POLICY["minObjectSupport"]):
                        continue
                    r,valid = point_residuals(pair,a[keep],b[keep])
                    targets = b[keep][valid]
                    if len(targets)<POLICY["minObjectPoints"]:
                        continue
                    bw = np.array(box.xyxy[2:])-np.array(box.xyxy[:2])
                    if np.min(np.ptp(targets,axis=0)/bw)<POLICY["minObjectSpan"]:
                        continue
                    supports = r[valid] > floor
                    strong = targets[supports]
                    yes = (len(strong)>=POLICY["minObjectPoints"] and np.mean(supports)>=POLICY["minObjectSupport"]
                           and np.min(np.ptp(strong,axis=0)/bw)>=POLICY["minObjectSpan"])
                    edges.append((i,j,at, bool(yes), float(np.median(r[valid])),len(targets)))
                    source_counts[i]=source_counts.get(i,0)+1
                    target_counts[j]=target_counts.get(j,0)+1
        proposed = {e[1]:e for e in edges if source_counts[e[0]]==1 and target_counts[e[1]]==1}
        output, events, active = [],[],[]
        h,w = cur.shape
        for j,box in enumerate(boxes):
            e = proposed.get(j)
            if e is None:
                id_, votes = self.next_id, deque(maxlen=10)
                self.next_id += 1
            else:
                i,_,_,ok,res,n = e
                _,id_,votes = self.active[i]
                if not ok:
                    votes.clear()
                else:
                    votes.append((at,res,n))
                while votes and at-votes[0][0] > POLICY["maxObservationMs"]:
                    votes.popleft()
            active.append((box,id_,votes))
            output.append({"id":id_,**box.record(w,h)})
            if len(votes)>=POLICY["minPairs"] and at-votes[0][0]>=POLICY["minObservationMs"]:
                events.append({"trackId":id_, "label":box.label, "epoch":self.epoch, "timeMs":at,
                               "pairCount":len(votes), "lastResidualPx":votes[-1][1], "lastPoints":votes[-1][2]})
        self.active = active
        return output,events


def load_input(path):
    """Accept only separated runtime manifests, no GT fields or tokens."""
    data = json.loads(path.read_text())
    if data.get("schemaVersion") != 1 or data.get("dataset") not in {"nuScenes-v1.0-mini", "synthetic-m3c", "PandaSet-real", "Boreas-real"}:
        raise ValueError("Unknown source manifest")
    suffixes = {".jpg", ".jpeg", ".png"} if data["dataset"] == "Boreas-real" else {".jpg", ".jpeg"}
    root = (path.parent / data.get("assetRoot",".")).resolve(strict=True)
    clips = data["clips"]
    if not 2 <= len(clips) <= 5 or len({c["id"] for c in clips}) != len(clips):
        raise ValueError("Expected 2–5 uniquely identified clips")
    frame_keys = {"token","path","timestampUs","poseTimestampUs","cameraToWorld","intrinsics","sha256","isKeyFrame"}
    for clip in clips:
        if set(clip) != {"id","frames"} or not 4 <= len(clip["frames"]) <= MAX_FRAMES:
            raise ValueError("Invalid or over-budget clip")
        previous = -1
        seen = set()
        for frame in clip["frames"]:
            if set(frame) - frame_keys or type(frame.get("timestampUs")) is not int or frame["timestampUs"] <= previous:
                raise ValueError("Invalid frame or unseparated truth")
            if frame["token"] in seen or Path(frame["path"]).is_absolute() or ".." in Path(frame["path"]).parts:
                raise ValueError("Duplicate token or unsafe asset path")
            seen.add(frame["token"])
            file = (root / frame["path"]).resolve(strict=True)
            if not file.is_relative_to(root) or file.suffix.lower() not in suffixes or file.stat().st_size>8*1024**2:
                raise ValueError("Expected bounded local image")
            previous = frame["timestampUs"]
    return data,root


def run_clip(clip, root, work, model, yolo, extra_factory=None):
    prepared, frames, items = [], [], []
    origin = clip["frames"][0]["timestampUs"]
    for idx, frame in enumerate(clip["frames"]):
        source = root / frame["path"]
        if sha256(source) != frame["sha256"]:
            raise ValueError("Unverified image bytes")
        data = cv2.imread(str(source), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if data is None:
            raise ValueError("Image decode failed")
        h,w = data.shape[:2]
        scale = min(1,MAX_SIDE/max(w,h))
        new_w,new_h = round(w*scale),round(h*scale)
        if scale<1:
            data=cv2.resize(data,(new_w,new_h),interpolation=cv2.INTER_AREA)
        output=work / f"{idx:03d}.jpg"
        if not cv2.imwrite(str(output),data,[cv2.IMWRITE_JPEG_QUALITY,93]):
            raise ValueError("Could not stage detector frame")
        prepared.append(output)
        f=dict(frame)
        matrix=f.get("intrinsics")
        if matrix is not None:
            matrix=np.array(matrix,dtype=float)
            if matrix.shape==(3,3):
                f["intrinsics"]=(np.diag([new_w/w,new_h/h,1])@matrix).tolist()
        frames.append(f)
        items.append((idx,(f["timestampUs"]-origin)/1000,output))
    found = {}
    for i in range(0,len(items),50):
        _, batch = detect_samples(items[i:i+50],model,yolo)
        found.update(batch)
    rgb,pose,guard = MotionState(),PoseTracks(),CameraScaleGuard()
    extra = extra_factory() if extra_factory else {}
    prev,gray0,boxes0,previous_at = None,None,[],None
    out = []
    for i,(f,filename) in enumerate(zip(frames,prepared)):
        gray=cv2.imread(str(filename),cv2.IMREAD_GRAYSCALE)
        h,w=gray.shape
        at,observation=found[i]
        boxes=parse_detect(observation,w,h)
        timing=perf_counter()
        bm,bq=registered(gray0,gray,boxes0,boxes) if prev is not None and 0<at-previous_at<=300 else (None,{"status":"first-or-gap"})
        atracks,ae,_,_=rgb.update(boxes,bm,at,w,h,gray0,gray)
        ae=[{**e,"epoch":rgb.epoch,"timeMs":at} for e in ae]
        camera_ambiguous=guard.update(at,affine_scale(bm))
        a=present(bm is not None and not camera_ambiguous,rgb,at,atracks,ae)
        a["status"]="scale-ambiguous" if camera_ambiguous else bq["status"]
        rgb_ms=elapsed(timing)
        timing=perf_counter()
        pair,q=pose_pair(prev,f,w,h) if prev is not None else (None,{"status":"first-frame"})
        floor=None
        if pair is not None:
            floor=pair.floor_px
            verified,bg=background(pair,gray0,gray,boxes0,boxes,floor)
            if not verified:
                pair=None
            else:
                floor += bg["p90Px"]
            q={**q,"status":q["status"] if verified else "insufficient-background-agreement","background":bg}
        btracks,be=pose.update(pair,at,gray0,gray,boxes,floor)
        b=present(pair is not None,pose,at,btracks,be)
        b["status"]=q["status"]
        out.append({"token":f["token"],"timestampUs":f["timestampUs"],"timeMs":at,
                    "width":w,"height":h,"detections":[box.record(w,h) for box in boxes],
                    "A":a,"B":b,"poseDiagnostics":q,
                    "timingsMs":{"detector":observation["detectionMs"],"A":rgb_ms,"B":elapsed(timing)}})
        for name, lane in extra.items():
            timing=perf_counter()
            evidence=lane.update(f,at,gray,boxes)
            # The study receipt sees only current, same-epoch notices, with a
            # distance answer that must remain null on every RGB branch.
            if name in {"D","S"}:
                counts=Counter(t["id"] for t in evidence["tracks"])
                event_counts=Counter(e["trackId"] for e in evidence["events"])
                ids={t["id"]:t["label"] for t in evidence["tracks"] if counts[t["id"]]==1}
                events=[e for e in evidence["events"] if evidence["status"]=="valid" and
                        e["kind"]=="relative-optical-approach" and e["timeMs"]==at and
                        e["epoch"]==evidence["epoch"] and ids.get(e["trackId"])==e["label"] and
                        event_counts[e["trackId"]]==1]
                lane_output={"epoch":evidence["epoch"],"tracks":evidence["tracks"],"events":events,
                             "answers":{"distance":{"metres":None},"kind":"relative-optical-approach"}}
            else:
                lane_output=present(evidence["status"]=="valid",lane,at,evidence["tracks"],evidence["events"])
            lane_output.update(status=evidence["status"],diagnostics=evidence["diagnostics"])
            out[-1][name]=lane_output
            out[-1]["timingsMs"][name]=elapsed(timing)
        prev,gray0,boxes0,previous_at=f,gray,boxes,at
    return {"id":clip["id"],"frames":out}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for arg in ("input","sceneqa","yolo","output"):
        p.add_argument(f"--{arg}",type=Path,required=True)
    args=p.parse_args()
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("Output must be new")
    data,root=load_input(args.input)
    cv2.setNumThreads(1)
    reports=[]
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3c-{date.today():%Y%m%d}-",dir=args.output.parent) as wk:
        for i,clip in enumerate(data["clips"]):
            cv2.setRNGSeed(65231)
            child=Path(wk).resolve()/str(i)
            child.mkdir()
            reports.append(run_clip(clip,root,child,args.sceneqa.resolve(strict=True),args.yolo.resolve(strict=True)))
    receipt={"schemaVersion":1,"dataset":data["dataset"],"inputSha256":sha256(args.input),
             "sceneqaSha256":sha256(args.sceneqa),"runnerSha256":sha256(Path(__file__)),
             "geometrySha256":sha256(Path(__file__).with_name("assist_scene_pose_motion.py")),
             "platform":platform.platform(),"opencv":cv2.__version__,"policy":POLICY,
             "clips":reports,"limits":"Recorded RGB and provided camera trajectory only; not physical motion/range or safety proof."}
    with args.output.open("x",encoding="utf-8") as f:
        json.dump(receipt,f,ensure_ascii=False,allow_nan=False,separators=(",",":"))
        f.write("\n")


if __name__=="__main__":
    main()
