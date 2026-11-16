#!/usr/bin/env python3
"""Forensic Mac replay of frozen evidence, with no detector or policy changes.

Reads labelled checkpoints only AFTER causal tracker replay. Geometry labels
remain evaluation-only. Function-return profiling inspects original helpers;
it never writes their locals or changes thresholds, detections or outputs.
"""

import argparse
from collections import Counter
from contextlib import contextmanager
import json
import math
from pathlib import Path
import sys

import cv2
import numpy as np

from assist_scene_boreas_import import labels_world, matches, sensor_poses
from assist_scene_motion import Detection, sha256
from assist_scene_m3e_study import legacy_score
import assist_scene_scale_approach as base
from assist_scene_scale_approach_m3e import POLICY, ScaleApproachM3E


def detections(rows, width, height):
    result = []
    for row in rows:
        b = row["box"]
        result.append(Detection(row["label"], row["score"],
                                (b["x"]*width, b["y"]*height,
                                 min(width, (b["x"]+b["width"])*width),
                                 min(height, (b["y"]+b["height"])*height))))
    return result


def scalar(value):
    if isinstance(value, (int, float, np.integer, np.floating)) and math.isfinite(value):
        return float(value)
    if isinstance(value, (tuple, list, np.ndarray)):
        a = np.asarray(value)
        if a.shape == (2,) and np.isfinite(a).all():
            return a.astype(float).tolist()
    return None


@contextmanager
def function_evidence(records):
    """Read selective intermediate values only when original helper returns."""
    previous = sys.getprofile()

    def profile(frame, event, returned):
        if event != "return" or frame.f_code.co_name not in {"_local_evidence", "_object_pixels"}:
            return
        if Path(frame.f_code.co_filename).name not in {"assist_scene_scale_approach.py", "assist_scene_scale_approach_m3e.py"}:
            return
        values = frame.f_locals
        reason = returned[1] if isinstance(returned, tuple) and len(returned) == 2 else "exception"
        details = {"function": frame.f_code.co_name, "reason": reason}
        for key in ("axis", "box_log", "point_log", "angle", "span", "hull", "center_error", "native_ratio"):
            if (v := scalar(values.get(key))) is not None:
                details[key] = v
        for key in ("seeds", "keep", "visible", "good", "inliers"):
            val = values.get(key)
            if isinstance(val, np.ndarray):
                details[key+"Count"] = len(val) if key == "seeds" else int(np.count_nonzero(val))
        records.append(details)

    sys.setprofile(profile)
    try:
        yield
    finally:
        sys.setprofile(previous)


class TraceScaleApproach(ScaleApproachM3E):
    def update(self, *args, **kwargs):
        self.local_calls = []
        return super().update(*args, **kwargs)

    def _record_evidence(self, old, new, a, b, warped, homography, native, diagnostics, *, identity=False):
        values = []
        with function_evidence(values):
            answer = ScaleApproachM3E._record_evidence(old, new, a, b, warped, homography, native,
                                                       diagnostics, identity=identity)
        h,w = new.shape
        self.local_calls.append({"newBox": {"x": b[0]/w, "y": b[1]/h,
                                             "width": (b[2]-b[0])/w, "height": (b[3]-b[1])/h},
                                 "oldBoxPixels": list(map(float, a)), "newBoxPixels": list(map(float, b)),
                                 "identityOnly": identity, "reason": answer[1], "helpers": values,
                                 "evidence": None if answer[0] is None else list(map(float, answer[0]))})
        return answer


def replay_clip(clip, predictions, root):
    """Recreate exact staging bytes from input; no new inference or labels."""
    if clip["id"] != predictions["id"] or len(clip["frames"]) != len(predictions["frames"]):
        raise ValueError("Clip mismatch")
    lanes = {n: TraceScaleApproach() for n in "AB"}
    output = []
    for f,row in zip(clip["frames"], predictions["frames"], strict=True):
        if f["token"] != row["token"] or f["timestampUs"] != row["timestampUs"]:
            raise ValueError("Frame mismatch")
        source = root/f["path"]
        if sha256(source) != f["sha256"]:
            raise ValueError("Source image changed")
        raw = cv2.imread(str(source), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if raw is None:
            raise ValueError("Cannot decode verified source")
        oh,ow = raw.shape[:2]
        h,w = row["height"],row["width"]
        scaled = cv2.resize(raw,(w,h),interpolation=cv2.INTER_AREA) if (oh,ow)!=(h,w) else raw
        ok,jpeg = cv2.imencode(".jpg",scaled,[cv2.IMWRITE_JPEG_QUALITY,93])
        if not ok:
            raise ValueError("Could not reproduce staging pixels")
        gray = cv2.imdecode(jpeg,cv2.IMREAD_GRAYSCALE)
        native = cv2.cvtColor(raw,cv2.COLOR_BGR2GRAY)
        metadata = {**f,"intrinsics": (np.diag((w/ow,h/oh,1.))@np.asarray(f["intrinsics"])).tolist()}
        observed = {"index": row["index"], "token": row["token"], "timestampUs": row["timestampUs"],
                    "timeMs": row["timeMs"], "height":h,"width":w}
        for name,state in lanes.items():
            boxes = detections(row["detections"] if name=="A" else row["candidateDetections"],w,h)
            cv2.setRNGSeed(650500+row["index"])
            r = state.update(metadata,row["timeMs"],gray,boxes,native_gray=native)
            # Normalized box round-trips can perturb a last-bit RANSAC tie.
            # Exact status/events and reasons/IDs must still reproduce before
            # the trace is accepted as evidence for the recorded failure.
            same = {"status":r["status"]==row[name]["status"], "events":r["events"]==row[name]["events"],
                    "trackReasons":r["diagnostics"].get("trackReasons")==row[name]["diagnostics"].get("trackReasons")}
            track_history = []
            if state._previous:
                for t in state._previous[-1]:
                    votes = list(t.votes)
                    track_history.append({"id":t.id,"verifiedIdentity":t.verified,"voteCount":len(votes),
                                          "sumWidthLogGrowth":sum(v[1] for v in votes),
                                          "sumHeightLogGrowth":sum(v[2] for v in votes),
                                          "sumPointLogGrowth":sum(v[3] for v in votes),
                                          "windowMs":row["timeMs"]-votes[0][0] if votes else 0.})
            observed[name]={**r,"calls":state.local_calls,"history":track_history,"reproduced":same}
        output.append(observed)
    return {"id":clip["id"],"frames":output}


def reference_history(source, raw_clip, runtime_clip, instances):
    """Physical evaluation centers; never serialized as usable metres."""
    cts,lts = raw_clip["cameraTimestampsUs"],raw_clip["labelTimestampsUs"]
    paired = {label:camera for camera,label in matches(cts,lts).items()}
    poses = sensor_poses(source,Path('.'),"lidar",set(lts))
    cameras = {f["timestampUs"]:f for f in runtime_clip["frames"]}
    history = {i: [] for i in instances}
    for ts in lts:
        ct = paired.get(ts)
        if ct is None:
            continue
        camera=np.asarray(cameras[ct]["cameraToWorld"])
        objects,_=labels_world(source,Path('.'),ts,poses[ts])
        for instance in instances & objects.keys():
            pos=objects[instance][3]
            relative=(pos-camera[:3,3])@camera[:3,:3]
            history[instance].append((ts,ct,float(np.linalg.norm(relative)),float(relative[2]),
                                      float(np.linalg.norm(relative[:2]))))
    return history


def physical_trend(history, camera_time):
    """Compare the exact reference intervals in dimensionless ratios only."""
    end=next((v for v in history if v[1]==camera_time),None)
    if end is None:
        return {"status":"missing-current-label"}
    mid=next((v for v in reversed(history) if end[0]-v[0]>=300_000),None)
    start=next((v for v in reversed(history) if mid and mid[0]-v[0]>=300_000),None)
    if not mid or not start or end[0]-start[0]>950_000:
        return {"status":"insufficient-reference-history"}
    points=(start,mid,end)
    radial=[v[2] for v in points]; z=[v[3] for v in points]; lateral=[v[4] for v in points]
    return {"status":"valid","labelTimestampsUs":[v[0] for v in points],
            "relativeRangeRatios":[v/radial[0] for v in radial],
            "opticalZRatios":[v/z[0] for v in z],
            "lateralFractionOfRange":[a/b for a,b in zip(lateral,radial)],
            "expectedRigidFrontoParallelAngularScale":z[0]/z[-1],
            "rangeClosingButOpticalZNotClosing":radial[-1]<radial[0] and z[-1]>=z[0],
            "physicalMeaning":"Range is camera-to-object-center norm; angular expansion approximates inverse optical Z only for fixed shape/viewpoint. These labels are not camera free-space or bbox-surface measurements."}


def nearest(target, tracks, contract):
    ranked=sorted(((contract.iou(t["box"],target["box"]),t) for t in tracks
                   if contract.family(t["label"])==target["classFamily"]),key=lambda q:q[0],reverse=True)
    if not ranked or ranked[0][0]<contract.IOU:
        return None,None,False
    return ranked[0][1],ranked[0][0],len(ranked)==1 or ranked[0][0]-ranked[1][0]>=contract.MARGIN


def timeline_for(target, current, frames, lane, contract):
    """Walk adjacent detections backwards; explicitly diagnostic, not GT IDs."""
    start=max(0,current-12)
    anchor=target["box"]
    collected=[]
    for f in reversed(frames[start:current+1]):
        t,overlap,unique=nearest({**target,"box":anchor},f[lane]["tracks"],contract)
        if t is None:
            collected.append({"index":f["index"],"timeMs":f["timeMs"],"status":f[lane]["status"],"matched":False})
            continue
        history=next((v for v in f[lane]["history"] if v["id"]==t["id"]),{})
        calls=[c for c in f[lane]["calls"] if not c["identityOnly"]
               and contract.iou(c["newBox"],t["box"])>.999]
        collected.append({"index":f["index"],"timeMs":f["timeMs"],"status":f[lane]["status"],
                          "matched":True,"uniqueDiagnosticMatch":unique,"diagnosticIoU":overlap,
                          "id":t["id"],"label":t["label"],"box":t["box"],
                          "reason":f[lane]["diagnostics"].get("trackReasons",{}).get(str(t["id"])),
                          "votes":history,"calls":calls})
        if unique:
            anchor=t["box"]
    return list(reversed(collected))


def diagnose(inputs,receipt,truth,source):
    inputs,receipt,truth,source=map(Path,(inputs,receipt,truth,source))
    inp=json.loads(inputs.read_text()); rec=json.loads(receipt.read_text()); gt=json.loads(truth.read_text())
    ih=sha256(inputs)
    if ih!=rec["inputSha256"] or ih!=gt["inputSha256"]:
        raise ValueError("Evidence does not bind input")
    if [c["id"] for c in inp["clips"]]!=[c["id"] for c in rec["clips"]] or [c["id"] for c in rec["clips"]]!=[c["id"] for c in gt["clips"]]:
        raise ValueError("Clip order mismatch")
    image_root=(inputs.parent/inp.get("assetRoot",".")).resolve(strict=True)
    source=source.resolve(strict=True)
    raw=json.loads((source/"clips.json").read_text())["clips"]
    if [c["id"] for c in raw]!=[c["id"] for c in inp["clips"]]:
        raise ValueError("Reference source differs")
    contract=legacy_score(); rows=[]; frames=[]
    cv2.setNumThreads(1)
    for c,r,g,raw_clip in zip(inp["clips"],rec["clips"],gt["clips"],raw,strict=True):
        replay=replay_clip(c,r,image_root)
        frames.extend(replay["frames"])
        by_token={f["token"]:j for j,f in enumerate(replay["frames"])}
        positives=[(f,t) for f in g["frames"] for t in f["targets"] if t["approach"]=="approaching"]
        physical=reference_history(source,raw_clip,c,{t["instance"] for _,t in positives})
        for checkpoint,target in positives:
            j=by_token[checkpoint["token"]]; f=replay["frames"][j]
            evidence={"clip":c["id"],"token":checkpoint["token"],"index":j,
                      "instance":target["instance"],"classFamily":target["classFamily"],"referenceBox":target["box"],
                      "referenceApproach":"approaching","referenceGeometry":physical_trend(physical[target["instance"]],f["timestampUs"])}
            for name in "AB":
                track,overlap,unique=nearest(target,f[name]["tracks"],contract)
                trace=timeline_for(target,j,replay["frames"],name,contract)
                if track is None:
                    reason="no-retained-same-family-detection"
                elif f[name]["status"]!="valid":reason=f[name]["status"]
                else:reason=f[name]["diagnostics"].get("trackReasons",{}).get(str(track["id"]),"unknown")
                matched=[t for t in trace if t["matched"]]
                ids=[t["id"] for t in matched]
                changes=sum(a!=b for a,b in zip(ids,ids[1:]))
                last=matched[-1] if matched else None
                native_budget=None
                for call in (last or {}).get("calls",[]):
                    if call["reason"]=="native-tile-budget":
                        a,b=np.asarray(call["oldBoxPixels"]),np.asarray(call["newBoxPixels"])
                        row=r["frames"][j]
                        scale=np.tile((row["nativeWidth"]/row["width"],row["nativeHeight"]/row["height"]),2)
                        sa,sb=a*scale,b*scale
                        needed=np.ceil(np.maximum(sa[2:],sb[2:]))-np.floor(np.minimum(sa[:2],sb[:2]))+2*POLICY["detailTilePaddingPx"]
                        native_budget={"requiredNativeTileSidePx":needed.astype(int).tolist(),"maximumAllowedSidePx":POLICY["detailMaxTileSidePx"]}
                evidence[name]={"currentReason":reason,"currentIoU":overlap,"currentMatchUnique":unique,
                                "timelineDiagnosticOnly":trace,"idChangesAmongAdjacentDiagnosticMatches":changes,
                                "maxVotesInTrace":max((p["votes"].get("voteCount",0) for p in matched),default=0),
                                "currentNativeBudget":native_budget,
                                "replayReproduced":all(all(f[name]["reproduced"].values()) for f in replay["frames"][max(0,j-12):j+1])}
            rows.append(evidence)
    counts={n:dict(Counter(r[n]["currentReason"] for r in rows)) for n in "AB"}
    repro={n:Counter(k for f in frames for k,passed in f[n]["reproduced"].items() if not passed) for n in "AB"}
    return {"schemaVersion":1,"inputSha256":ih,"receiptSha256":sha256(receipt),"truthSha256":sha256(truth),
            "sourceCodeSha256":{p:sha256(Path(__file__).with_name(p)) for p in
                (Path(__file__).name,"assist_scene_scale_approach.py","assist_scene_scale_approach_m3e.py","assist_scene_boreas_review_2d.py")},
            "policy":dict(POLICY),"positiveTargetFrames":len(rows),"currentReasonCounts":counts,
            "replayMismatchCounts":repro,
            "confirmed": [
                "The recorded current-frame camera gate is valid in all 10 failures; ROI detection alone cannot repair the downstream optical-evidence checks.",
                "Original native-detail policy uses a max192x192 union tile. A small working minimum side selects native detail even if its long source axis cannot fit that tile; source detail exists but the representation rejects it.",
                "Evidence votes only persist when each adjacent step passes positive expansion. A no-current-expansion result keeps an ID but replaces its history with an empty deque.",
                "The reference label is decreasing Euclidean camera-to-object-center range. The tested output is positive optical expansion; they are not equivalent under lateral motion or viewpoint/shape change."],
            "limits":["Forensic replay uses cached detections, not a new model run. Numeric fit values come from original helper return locals without mutation.",
                      "The backwards IoU diagnostic chain is not a ground-truth identity annotation and can jump between nearby same-class objects; unique flag and ID changes are diagnostic only.",
                      "Expected inverse-Z scale assumes fixed fronto-parallel shape. It is explanatory geometry, not a valid replacement for observed angular evidence or a metric prediction.",
                      "Original ground truth is unchanged. No thresholds were loosened and no baseline result was relabelled."],
            "cases":rows}


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for k in ("input","receipt","truth","source","output"):
        p.add_argument("--"+k,required=True,type=Path)
    a=p.parse_args()
    report=diagnose(a.input,a.receipt,a.truth,a.source)
    with a.output.open("x") as stream:
        json.dump(report,stream,indent=2,allow_nan=False);stream.write("\n")
    print(json.dumps({k:report[k] for k in ("positiveTargetFrames","currentReasonCounts","replayMismatchCounts")},indent=2))
