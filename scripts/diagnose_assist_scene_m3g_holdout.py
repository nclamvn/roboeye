#!/usr/bin/env python3
"""Post-lock B/D attribution; frozen detections, no inference or policy changes."""
import argparse
from collections import Counter
from contextlib import contextmanager
import json
from pathlib import Path
import sys

import cv2
import numpy as np

from assist_scene_motion import sha256
from assist_scene_m3e_study import legacy_score
from assist_scene_window_loom import CumulativeWindowLoom, POLICY
from assist_scene_dense_window import DenseWindowLoom
from diagnose_assist_scene_approach import detections, nearest


@contextmanager
def inspect_flow(calls):
    previous = sys.getprofile()
    def profile(frame, event, result):
        if (event != "return" or frame.f_code.co_name != "_validate_flow"
                or Path(frame.f_code.co_filename).name != "assist_scene_window_loom.py"):
            return
        v = frame.f_locals
        tube = v["tube"]
        call = {"oldTrackId": tube.id, "oldPointCount": len(tube.points),
                "initialPointCount": tube.initial, "reason": result[1],
                "label": v["current"].label, "newBoxPixels": list(v["current"].xyxy)}
        for key in ("keep", "inliers"):
            if isinstance(v.get(key), np.ndarray):
                call[key+"Count"] = int(np.count_nonzero(v[key]))
        if "keepCount" in call:
            call["supportChecks"] = {
                "enoughAbsolutePoints": call["keepCount"] >= POLICY["minPoints"],
                "enoughCurrentPairFraction": call["keepCount"] >= POLICY["minPairSupport"]*len(tube.points),
                "enoughOriginalSeedFraction": call["keepCount"] >= POLICY["minSeedSupport"]*tube.initial}
        if result[0] is not None:
            call["acceptedPointCount"] = len(result[0][1])
        calls.append(call)
    sys.setprofile(profile)
    try:
        yield
    finally:
        sys.setprofile(previous)


def replay(clip, recorded, root):
    states = {"B": CumulativeWindowLoom(), "D": DenseWindowLoom()}
    rows = []
    for source, row in zip(clip["frames"], recorded["frames"], strict=True):
        assert source["token"] == row["token"]
        path = root/source["path"]
        if sha256(path) != source["sha256"]:
            raise ValueError("Source image changed")
        raw = cv2.imread(str(path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        h,w,oh,ow = row["height"],row["width"],row["nativeHeight"],row["nativeWidth"]
        if raw.shape[:2] != (oh,ow):
            raise ValueError("Source dimensions changed")
        small = cv2.resize(raw,(w,h),interpolation=cv2.INTER_AREA) if (oh,ow)!=(h,w) else raw
        ok,jpeg = cv2.imencode(".jpg",small,[cv2.IMWRITE_JPEG_QUALITY,93])
        assert ok
        gray = cv2.imdecode(jpeg,cv2.IMREAD_GRAYSCALE)
        native = cv2.cvtColor(raw,cv2.COLOR_BGR2GRAY)
        frame = {**source,"intrinsics": (np.diag((w/ow,h/oh,1.))@np.asarray(source["intrinsics"])).tolist()}
        boxes = detections(row["detections"],w,h)
        observed = {"index":row["index"],"timeMs":row["timeMs"],"token":row["token"]}
        for name,state in states.items():
            calls = []
            cv2.setRNGSeed(650500+row["index"])
            with inspect_flow(calls):
                result = state.update(frame,row["timeMs"],gray,boxes,native_gray=native)
            exact = {key: result[key] == row[name][key] for key in ("status","events")}
            exact["trackReasons"] = result["diagnostics"].get("trackReasons") == row[name]["diagnostics"].get("trackReasons")
            history = {}
            for tube in state._previous[-1] if state._previous else []:
                history[str(tube.id)] = {"frames":len(tube.history),"points":len(tube.points),
                    "initialPoints":tube.initial,"timesMs":[v[0] for v in tube.history],
                    "observationMs":tube.history[-1][0]-tube.history[0][0]}
            observed[name] = {**result,"history":history,"flowCalls":calls,"reproduced":exact}
        rows.append(observed)
    return rows


def growth_checks(e):
    if "angularLogGrowth" not in (e or {}):
        return None
    return {"angularMadWithinFloor":e["angularLogMad"]<=POLICY["maxAngularLogMad"],
            "netExceedsGrowthAndThreeMad":e["angularLogGrowth"]>=max(POLICY["minNetAngularGrowth"],3*e["angularLogMad"]),
            "robustPointGrowth":e["robustPointGrowth"]>=POLICY["minNetAngularGrowth"],
            "robustBoxGrowth":e["robustBoxGrowth"]>=POLICY["minNetBoxGrowth"],
            "pointBoxAgreement":abs(e["robustBoxGrowth"]-e["robustPointGrowth"])<=POLICY["maxGrowthDisagreement"],
            "currentGrowthPositive":e["currentAngularLogGrowth"]>=POLICY["minCurrentAngularGrowth"]}


def run(args):
    receipt = json.loads(args.receipt.read_text())
    inputs = json.loads(args.input.read_text())
    if sha256(args.input) != receipt["inputSha256"]:
        raise ValueError("Unbound input")
    for name,value in receipt["codeSha256"].items():
        if sha256(Path(__file__).parent/name) != value:
            raise ValueError("Frozen algorithm source changed: "+name)
    cv2.setNumThreads(1)
    traced = {c["id"]:replay(c,r,args.source) for c,r in zip(inputs["clips"],receipt["clips"],strict=True)}
    # Only after causal replay is complete do we open target labels for attribution.
    truth = json.loads(args.truth.read_text())
    if truth["inputSha256"] != receipt["inputSha256"]:
        raise ValueError("Unbound truth")
    contract = legacy_score()
    cases=[]; counts={n:Counter() for n in ("B","D")}
    mismatch=[]
    for clip in receipt["clips"]:
        for row in traced[clip["id"]]:
            for lane in ("B","D"):
                if not all(row[lane]["reproduced"].values()):
                    mismatch.append({"clip":clip["id"],"index":row["index"],"lane":lane,"fields":row[lane]["reproduced"]})
    for labels in truth["clips"]:
        rows=traced[labels["id"]]
        recorded=next(c for c in receipt["clips"] if c["id"]==labels["id"])
        lookup={f["token"]:f for f in recorded["frames"]}
        for labelled in labels["frames"]:
            original=lookup[labelled["token"]];current=rows[original["index"]]
            for target in labelled["targets"]:
                if target["approach"]!="approaching":continue
                detection,iou,unique=nearest(target,original["detections"],contract)
                case={"clip":labels["id"],"index":original["index"],"token":original["token"],
                      "instance":target["instance"],"classFamily":target["classFamily"],
                      "truthBox":target["box"],"detectorMatch":{"matched":detection is not None,"iou":iou,"unique":unique}}
                for lane in ("B","D"):
                    track,overlap,unambiguous=nearest(target,current[lane]["tracks"],contract)
                    ident=None if track is None else str(track["id"])
                    diagnostics=current[lane]["diagnostics"]
                    reason=diagnostics.get("trackReasons",{}).get(ident)
                    evidence=diagnostics.get("windowEvidence",{}).get(ident)
                    event=track is not None and any(e["trackId"]==track["id"] for e in current[lane]["events"])
                    timeline=[];anchor=target["box"]
                    for previous in reversed(rows[max(0,original["index"]-12):original["index"]+1]):
                        matched,ov,unq=nearest({**target,"box":anchor},previous[lane]["tracks"],contract)
                        if matched is None:
                            timeline.append({"index":previous["index"],"matched":False,"status":previous[lane]["status"]});continue
                        key=str(matched["id"]);anchor=matched["box"]
                        flow,_,_=nearest({**target,"box":anchor},[
                            {"label":c["label"],"box":{"x":c["newBoxPixels"][0]/original["width"],"y":c["newBoxPixels"][1]/original["height"],
                            "width":(c["newBoxPixels"][2]-c["newBoxPixels"][0])/original["width"],"height":(c["newBoxPixels"][3]-c["newBoxPixels"][1])/original["height"]},"call":c}
                            for c in previous[lane]["flowCalls"]],contract)
                        timeline.append({"index":previous["index"],"matched":True,"iou":ov,"unique":unq,"trackId":matched["id"],
                            "status":previous[lane]["status"],"reason":previous[lane]["diagnostics"].get("trackReasons",{}).get(key),
                            "history":previous[lane]["history"].get(key),"flow":None if flow is None else flow["call"]})
                    timeline.reverse()
                    counts[lane]["true-positive" if event else reason or "unmatched"]+=1
                    case[lane]={"status":current[lane]["status"],"trackId":ident,"trackIou":overlap,"unique":unambiguous,
                        "event":event,"reason":reason,"history":current[lane]["history"].get(ident),
                        "evidence":evidence,"growthChecks":growth_checks(evidence),"precedingDiagnosticChain":timeline}
                cases.append(case)
    return {"schemaVersion":1,"unit":"reviewed positive target-checkpoint, not episode","positiveCount":len(cases),
        "provenance":{"inputSha256":sha256(args.input),"receiptSha256":sha256(args.receipt),"truthSha256":sha256(args.truth),
        "scriptSha256":sha256(Path(__file__)),"codeSha256":receipt["codeSha256"],"noNewInference":True},
        "replay":{"frames":sum(map(len,traced.values())),"lanes":["B","D"],"mismatches":mismatch},
        "reasonCounts":counts,"cases":cases,
        "limits":["Labels unchanged; physical relative closing and optical angular expansion are different claims.",
                  "Backward IoU chain is diagnostic association, not independently verified object identity.",
                  "First failing validator gate is observed, not a causal proof that removing it is safe.",
                  "No thresholds or detections changed. Missing metric evidence is never converted to metres."]}


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("input","receipt","truth","source","output"):
        parser.add_argument("--"+name,type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists():raise ValueError("New evidence path required")
    result=run(args)
    args.output.write_text(json.dumps(result,indent=2,allow_nan=False)+"\n")
    print(json.dumps({"positiveCount":result["positiveCount"],"reasonCounts":result["reasonCounts"],"replay":result["replay"]},indent=2))
