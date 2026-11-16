#!/usr/bin/env python3
"""Join frozen ground truth after inference. Never runs detection or tracking."""

import argparse
import hashlib
import json
import math
from pathlib import Path

VEHICLE = {"car", "truck", "bus", "vehicle", "motorcycle", "bicycle", "train"}
STATES = {"moving", "stationary", "unknown"}
IOU = .35
MARGIN = .08


def digest(path):
    with path.open("rb") as fh:
        return hashlib.file_digest(fh,"sha256").hexdigest()


def family(label):
    return "vehicle" if label in VEHICLE else ("person" if label == "person" else None)


def iou(a, b):
    def values(rect):
        v = [rect[k] for k in ("x","y","width","height")]
        if (not all(type(j) in {int,float} and math.isfinite(j) and 0<=j<=1 for j in v)
                or min(v[2:])<=0 or v[0]+v[2]>1.000001 or v[1]+v[3]>1.000001):
            raise ValueError("Invalid normalized bbox")
        return v
    ax,ay,aw,ah=values(a)
    bx,by,bw,bh=values(b)
    common=max(0,min(ax+aw,bx+bw)-max(ax,bx))*max(0,min(ay+ah,by+bh)-max(ay,by))
    return common/(aw*ah+bw*bh-common)


def empty():
    return dict(tp=0,fp=0,fn=0,tn=0,unmatchedReports=0,ambiguousReports=0,
                unknownTargetReports=0,unknownTargets=0,unscoredFrameReports=0,scoredKeyframes=0,
                framesAbstained=0)


def score_frame(row, lane, targets, out):
    surface = row[lane]
    events, tracks = surface["events"], surface["tracks"]
    if surface["answers"]["distance"]["metres"] is not None:
        raise ValueError("RGB lane emitted a distance")
    if len({t["id"] for t in tracks})!=len(tracks) or len({e["trackId"] for e in events})!=len(events):
        raise ValueError("Duplicated track id/evidence")
    if not events:
        out["framesAbstained"]+=1
    if targets is None:
        out["unscoredFrameReports"]+=len(events)
        return
    out["scoredKeyframes"]+=1
    if (len({t["instance"] for t in targets})!=len(targets)
            or any(t["motion"] not in STATES for t in targets)):
        raise ValueError("Invalid ground truth")
    by_id = {t["id"]:t for t in tracks}
    edges, hits = {}, set()
    for e in events:
        if e["timeMs"]!=row["timeMs"] or e["epoch"]!=surface["epoch"]:
            raise ValueError("Stale event")
        t = by_id[e["trackId"]]
        if t["label"]!=e["label"]:
            raise ValueError("Wrong event label")
        ranked=sorted(((iou(t["box"],g["box"]),i) for i,g in enumerate(targets)
                       if family(t["label"])==g["classFamily"]),reverse=True)
        if not ranked or ranked[0][0] < IOU:
            out["unmatchedReports"]+=1
            continue
        if len(ranked)>1 and ranked[0][0]-ranked[1][0]<MARGIN:
            out["ambiguousReports"]+=1
            continue
        score,i=ranked[0]
        edges.setdefault(i,[]).append((score,e["trackId"]))
    for i,matches in edges.items():
        if len(matches)>1:
            out["ambiguousReports"]+=len(matches)
        else:
            hits.add(i)
    for i,g in enumerate(targets):
        state=g["motion"]
        if state=="unknown":
            out["unknownTargets"]+=1
            if i in hits: out["unknownTargetReports"]+=1
        elif state=="moving":
            out["tp" if i in hits else "fn"]+=1
        else:
            out["fp" if i in hits else "tn"]+=1


def score(receipt, truth):
    if truth.get("schemaVersion")!=1 or receipt.get("schemaVersion")!=1:
        raise ValueError("Unknown schema")
    clips={c["id"]:c["frames"] for c in truth["clips"]}
    names={c["id"] for c in receipt["clips"]}
    if len(clips)!=len(truth["clips"]) or set(clips)!=names or len(names)!=len(receipt["clips"]):
        raise ValueError("Different clip sets")
    result=[]
    for c in receipt["clips"]:
        labels={f["token"]:f for f in clips[c["id"]]}
        seen=set()
        if len(labels)!=len(clips[c["id"]]):
            raise ValueError("Duplicate labels")
        lanes={lane:empty() for lane in ("A","B")}
        detect_coverage={}
        for f in c["frames"]:
            if f["token"] in seen:
                raise ValueError("Duplicate prediction keys")
            seen.add(f["token"])
            ref=labels.get(f["token"])
            if ref and ref["timestampUs"]!=f["timestampUs"]:
                raise ValueError("Wrong timestamp for exact token")
            # Lenient coverage ceiling: at least one raw RGB box overlaps this
            # reference. This is not one-to-one detector AP or semantic review.
            if ref and "detections" in f:
                for gt in ref["targets"]:
                    k=f"{gt['classFamily']}.{gt['motion']}"
                    counters=detect_coverage.setdefault(k,dict(targets=0,overlapped=0,gateAValid=0,gateBValid=0))
                    counters["targets"]+=1
                    if any(family(d["label"])==gt["classFamily"] and iou(d["box"],gt["box"])>=IOU
                           for d in f["detections"]):
                        counters["overlapped"]+=1
                        counters["gateAValid"]+=f["A"]["status"]=="valid"
                        counters["gateBValid"]+=f["B"]["status"]=="valid"
            for lane,row in lanes.items():
                score_frame(f,lane,ref["targets"] if ref else None,row)
        if not set(labels).issubset(seen):
            raise ValueError("Missing labeled frame(s) in prediction")
        row={"id":c["id"],"lanes":lanes}
        if detect_coverage:
            row["rawDetectionCoverage"]=detect_coverage
        result.append(row)
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--truth",type=Path,required=True)
    p.add_argument("--receipt",type=Path,required=True)
    p.add_argument("--output",type=Path,help="Optional new path for aggregate JSON")
    args=p.parse_args()
    pred=json.loads(args.receipt.read_text())
    if pred["inputSha256"]!=digest(args.input):
        raise ValueError("Inference receipt belongs to another input version")
    truth=json.loads(args.truth.read_text())
    if truth.get("inputSha256") != pred["inputSha256"]:
        raise ValueError("Truth belongs to another input version")
    rows=score(pred,truth)
    total={lane:{k:sum(c["lanes"][lane][k] for c in rows) for k in empty()} for lane in ("A","B")}
    if not sum(total["A"][k] for k in ("tp","fn","tn","fp")):
        raise ValueError("No known-motion or known-stationary labeled targets; cannot report error rates")
    summary=json.dumps({"schemaVersion":1,"dataset":pred["dataset"],"truthSha256":digest(args.truth),
                      "receiptSha256":digest(args.receipt),"matchingIoU":IOU,"margin":MARGIN,
                      "unit":"labeled target-keyframe", "totals":total,"clips":rows},indent=2)+"\n"
    if args.output:
        with args.output.open("x",encoding="utf-8") as out:
            out.write(summary)
    print(summary,end="")


if __name__=="__main__":
    main()
