#!/usr/bin/env python3
"""Read-only causal replay of OLD M3H measurements, not a new runtime model.

Only original M3H pixels/detections are replayed. Labels are opened afterwards.
Profiling reads return-frame locals without modifying them. Diagnostic affine
fits run after each update, so they cannot perturb the runtime RANSAC RNG.
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

from assist_scene_motion import sha256
from assist_scene_m3h_study import cached_observation
from assist_scene_cohort_loom import CohortWindowLoom, POLICY
from assist_scene_m3e_study import output, legacy_score
import assist_scene_scale_approach as base
from diagnose_assist_scene_approach import nearest, reference_history, physical_trend
from assist_scene_boreas_import import camera_calibration, sensor_poses


def count(v):
    return int(np.count_nonzero(v))


def flow_record(v, returned, cohort):
    """Compute exact pre-fit gate counts from the unmodified accepted pairs."""
    p, q, a, b, back = (v[k] for k in ("p", "q", "a", "b", "back"))
    tube = v["tube"]
    finite = np.isfinite(b).all(axis=1)
    gates = [v["ok"] & v["rev"] & finite,
             np.linalg.norm(a-back, axis=1) <= POLICY["maxFlowFbPx"],
             base._matching_patches(p, q, a, b),
             base._inside(v["global_b"], v["current"].xyxy, .04)]
    stages = {}; keep = np.ones(len(a), dtype=bool)
    for name, gate in zip(("sampledBothDirections", "forwardBackward", "photometric", "insideCurrentBox"), gates):
        keep &= gate; stages[name] = count(keep)
    for other in v["others"]:
        keep &= ~base._inside(v["global_b"], other.xyxy, 0.)
    stages["outsideOtherBoxes"] = count(keep)
    required = max(POLICY["minPoints"], POLICY["minPairSupport"]*len(a), POLICY["minSeedSupport"]*tube.initial)
    result = {"trackId": tube.id, "cohortId": cohort.id, "identityProbe": cohort.id == 0,
              "bornMs": cohort.born, "initialPoints": tube.initial, "previousPoints": len(a),
              "newBoxPixels": list(v["current"].xyxy), "label": v["current"].label,
              "stages": stages, "requiredPreFitSupport": required,
              "reason": returned[1], "acceptedPoints": 0 if returned[0] is None else len(returned[0][0])}
    if "inliers" in v and v["inliers"] is not None:
        result["similarityInliers"] = count(v["inliers"])
        result["requiredFitSupport"] = max(POLICY["minPoints"], POLICY["minPairSupport"]*count(keep))
        if v.get("fit") is not None:
            fit = v["fit"]
            scale = math.hypot(*fit[:,0])
            geometry = {"scale":scale,"angleDeg":abs(math.degrees(math.atan2(fit[1,0],fit[0,0])))}
            indexes = np.flatnonzero(keep)[v["inliers"]]
            if len(indexes):
                geometry["oldAxisSpanFraction"] = float(np.min(np.ptp(tube.points[indexes],axis=0)/base._size(tube.box.xyxy)))
                geometry["newAxisSpanFraction"] = float(np.min(np.ptp(v["global_b"][indexes],axis=0)/base._size(v["current"].xyxy)))
                warped = base._warp_rect(tube.box.xyxy,v["homography"])
                center = fit[:,:2]@base._center(warped)+fit[:,2]
                geometry["centerErrorPx"] = float(np.linalg.norm(center-base._center(v["current"].xyxy)))
                geometry["maxCenterErrorPx"] = max(2.,POLICY["maxCenterFraction"]*min(base._size(v["current"].xyxy)))
                geometry["boxLogScale"] = float(np.mean(np.log(base._size(v["current"].xyxy)/base._size(warped))))
                geometry["pointLogScale"] = math.log(scale) if scale>0 else None
            result["similarityGeometry"] = geometry
    if count(keep) >= 3:
        result["_pairs"] = (base._project(tube.points[keep], v["homography"]).copy(), v["global_b"][keep].copy())
        result["_similarity"] = None if v.get("fit") is None else v["fit"].copy()
    return result


def finish_affine(record):
    """Extra parameters can overfit; this is diagnostic geometry, not truth."""
    pair = record.pop("_pairs", None); similarity = record.pop("_similarity", None)
    if pair is None:
        return
    a, b = pair
    cv2.setRNGSeed(650999)
    affine, mask = cv2.estimateAffine2D(a, b, method=cv2.RANSAC,
        ransacReprojThreshold=1.2, maxIters=250, confidence=.99, refineIters=6)
    if affine is None or mask is None or not np.isfinite(affine).all():
        record["diagnosticAffine"] = {"valid": False}; return
    def residual(matrix):
        r = np.linalg.norm(a@matrix[:,:2].T+matrix[:,2]-b, axis=1)
        return {"medianPx": float(np.median(r)), "p95Px": float(np.percentile(r, 95)),
                "within1_2Px": count(r <= 1.2)}
    singular = np.linalg.svd(affine[:,:2], compute_uv=False)
    record["diagnosticAffine"] = {"valid": True, "inliers": count(mask), "pairs": len(a),
        "requiredSameFitSupport": max(POLICY["minPoints"], POLICY["minPairSupport"]*len(a)),
        "affineResidual": residual(affine), "similarityResidual": None if similarity is None else residual(similarity),
        "axisScaleRatio": float(max(singular)/min(singular)) if min(singular)>0 else None,
        "determinant": float(np.linalg.det(affine[:,:2]))}


@contextmanager
def inspect_calls(records):
    previous = sys.getprofile()
    def profile(frame, event, returned):
        if event != "return": return
        name = frame.f_code.co_name; filename = Path(frame.f_code.co_filename).name
        v = frame.f_locals
        if name == "_validate_flow" and filename == "assist_scene_window_loom.py":
            records["flow"].append(flow_record(v, returned, frame.f_back.f_locals["cohort"]))
        elif name == "correspondences" and frame.f_back.f_code.co_name == "_background":
            records["backgroundPairCount"] = len(returned[0])
            records["_backgroundPairs"] = (returned[0].copy(),returned[1].copy())
        elif name == "_background" and filename == "assist_scene_scale_approach.py":
            bg = {"valid": bool(returned[0]), **returned[1],
                  "lkSurvivingPairs": records.get("backgroundPairCount", 0),
                  "photometricAndCurrentBackgroundPairs": len(v["a"])}
            a,b = records.pop("_backgroundPairs")
            xx,yy = b.astype(int).T
            mask = base.mask_for(v["new"].shape,v["boxes"])
            bg["outsideCurrentForegroundPairs"] = count(mask[yy,xx]!=0)
            bg["photometricallySupportedPairs"] = count(base._matching_patches(v["old"],v["new"],a,b))
            if "agreement" in v:
                bg["poseAgreedPoints"] = count(v["agreement"])
                bg["checks"] = {"absoluteSupport": count(v["agreement"]) >= base.POLICY["minBackgroundPoints"],
                    "fractionSupport": bg["support"] >= base.POLICY["minBackgroundSupport"],
                    "occupiedCells": bg["occupiedCells"] >= base.POLICY["minBackgroundCells"],
                    "axisSpan": bg["axisSpan"] >= base.POLICY["minBackgroundSpan"]}
            if "residual" in v:
                usable = v["residual"][v["usable"]]
                bg["poseResidualThresholdPx"] = min(1.8, .65*v["pair"].floor_px)
                bg["poseResidualMedianPx"] = float(np.median(usable)) if len(usable) else None
                bg["poseResidualP95Px"] = float(np.percentile(usable,95)) if len(usable) else None
                bg["poseUsablePoints"] = count(v["usable"])
            records["background"] = bg
        elif name == "_seed_cohort" and filename == "assist_scene_cohort_loom.py":
            records.setdefault("seedAttempts",[]).append({"trackId":v["identity"].id,"timeMs":v["at"],
                "success":returned is not None,"points":0 if returned is None else len(returned.tube.points),
                "cohortId":None if returned is None else returned.id})
    sys.setprofile(profile)
    try: yield
    finally: sys.setprofile(previous)


def replay(clip, recorded, root):
    if clip["id"] != recorded["id"]: raise ValueError("Clip order mismatch")
    state = CohortWindowLoom(); rows = []
    origin = clip["frames"][0]["timestampUs"]
    for i, (f, old) in enumerate(zip(clip["frames"], recorded["frames"], strict=True)):
        if (f["token"] != old["token"] or f["timestampUs"] != old["timestampUs"]
                or i != old["index"] or abs(old["timeMs"]-(f["timestampUs"]-origin)/1000.) > 1e-6):
            raise ValueError("Exposure order/clock mismatch")
        path = root/f["path"]
        if sha256(path) != f["sha256"]: raise ValueError("Source image hash mismatch")
        raw = cv2.imread(str(path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        oh, ow = raw.shape[:2]; h, w = old["height"], old["width"]
        scaled = cv2.resize(raw,(w,h),interpolation=cv2.INTER_AREA) if (oh,ow)!=(h,w) else raw
        ok, jpeg = cv2.imencode(".jpg",scaled,[cv2.IMWRITE_JPEG_QUALITY,93])
        if not ok: raise ValueError("Staging encode failed")
        gray = cv2.imdecode(jpeg,cv2.IMREAD_GRAYSCALE)
        metadata = {**f,"intrinsics": (np.diag((w/ow,h/oh,1.))@np.asarray(f["intrinsics"])).tolist()}
        boxes,_ = cached_observation(old,w,h,ow,oh)
        calls = {"flow": []}
        cv2.setRNGSeed(650500+i)
        with inspect_calls(calls):
            current = output(state.update(metadata,old["timeMs"],gray,boxes,
                             native_gray=cv2.cvtColor(raw,cv2.COLOR_BGR2GRAY)),old["timeMs"])
        same = {k: current[k] == old["B"][k] for k in ("status","events","tracks","epoch")}
        for key in ("trackReasons","cohorts","retiredCohorts","identityDecisions","background"):
            same[key] = current["diagnostics"].get(key) == old["B"]["diagnostics"].get(key)
        for flow in calls["flow"]: finish_affine(flow)
        rows.append({"index":i,"token":f["token"],"timestampUs":f["timestampUs"],
                     "timeMs":old["timeMs"],"width":w,"height":h,"B":current,"calls":calls,"reproduced":same})
    return rows


def case_chain(target, index, rows, contract):
    anchor = target["box"]; result=[]
    for row in reversed(rows[:index+1]):
        track, iou, unique = nearest({**target,"box":anchor},row["B"]["tracks"],contract)
        item = {"index":row["index"],"timeMs":row["timeMs"],"status":row["B"]["status"],
                "matched":track is not None,"unique":unique,"iou":iou}
        if track is not None:
            key = str(track["id"]); q=row["B"]["diagnostics"]
            item.update(trackId=track["id"],reason=q["trackReasons"].get(key),
                identity=q["identityDecisions"].get(key),cohorts=q["cohorts"].get(key),
                retired=q["retiredCohorts"].get(key),
                flowCalls=[c for c in row["calls"]["flow"] if c["trackId"]==track["id"]])
            if unique: anchor=track["box"]
        result.append(item)
    return list(reversed(result))


def run(args):
    args.source=args.source.resolve(strict=True)
    inp=json.loads(args.input.read_text()); receipt=json.loads(args.receipt.read_text())
    if receipt["study"] != "M3H" or sha256(args.input) != receipt["inputSha256"]:
        raise ValueError("Only exact-bound old M3H permitted")
    if cv2.__version__ != receipt["opencv"]: raise ValueError("OpenCV runtime changed")
    for name, digest in receipt["codeSha256"].items():
        if sha256(Path(__file__).parent/name) != digest: raise ValueError("Frozen code changed: "+name)
    diagnostic_hash = sha256(Path(__file__))
    cv2.setNumThreads(1)
    image_root=(args.input.parent/inp["assetRoot"]).resolve(strict=True)
    traces={c["id"]:replay(c,r,image_root) for c,r in zip(inp["clips"],receipt["clips"],strict=True)}
    # Evaluation-only reference files are deliberately opened after replay.
    truth=json.loads(args.truth.read_text())
    if truth["inputSha256"] != receipt["inputSha256"]: raise ValueError("Truth unbound")
    raw=json.loads((args.source/"clips.json").read_text())["clips"]
    k,offset=camera_calibration(args.source,Path('.'))
    source_poses=sensor_poses(args.source,Path('.'),"camera",
        {f["timestampUs"] for c in inp["clips"] for f in c["frames"]})
    source_geometry=Counter()
    for c in inp["clips"]:
        for f in c["frames"]:
            pose=source_poses[f["timestampUs"]].copy()
            pose[:3,3]-=pose[:3,:3]@offset
            source_geometry["framesChecked"]+=1
            source_geometry["intrinsicsExactlyMatchCalibration"]+=bool(np.array_equal(np.asarray(f["intrinsics"]),k))
            source_geometry["poseExactlyMatchesOpticalOriginCorrectedSource"]+=bool(np.array_equal(np.asarray(f["cameraToWorld"]),pose))
            source_geometry["rgbPoseTimestampExact"]+=f["timestampUs"]==f["poseTimestampUs"]
    contract=legacy_score(); cases=[]; current_counts=Counter(); mismatch=[]
    for c,g,rc,original in zip(inp["clips"],truth["clips"],raw,receipt["clips"],strict=True):
        if c["id"] != g["id"] or c["id"] != rc["id"]: raise ValueError("Reference clip mismatch")
        rows=traces[c["id"]]; by_token={r["token"]:r for r in rows}
        positives=[(f,t) for f in g["frames"] for t in f["targets"] if t["approach"]=="approaching"]
        physical=reference_history(args.source,rc,c,{t["instance"] for f,t in positives})
        for row in rows:
            if not all(row["reproduced"].values()): mismatch.append({"clip":c["id"],"index":row["index"],"fields":row["reproduced"]})
        for label,target in positives:
            row=by_token[label["token"]]; index=row["index"]
            if row["timestampUs"] != label["timestampUs"]: raise ValueError("Label clock mismatch")
            det,iou,unique=nearest(target,original["frames"][index]["detections"],contract)
            track,ov,unq=nearest(target,row["B"]["tracks"],contract)
            key=None if track is None else str(track["id"]); q=row["B"]["diagnostics"]
            identity=q.get("identityDecisions",{}).get(key)
            reason=q.get("trackReasons",{}).get(key)
            cause=("no-current-detector-match" if det is None else
                   "current-camera-invalid" if row["B"]["status"]!="valid" else
                   "small-or-truncated" if reason=="small-or-truncated" else
                   "identity-unverified" if not identity or not identity["kept"] else
                   "retained-id-no-mature-supported-measurement")
            current_counts[cause]+=1
            cases.append({"clip":c["id"],"index":index,"token":row["token"],"instance":target["instance"],
                "classFamily":target["classFamily"],"truthBox":target["box"],"approachUnchanged":target["approach"],
                "detectorMatch":{"matched":det is not None,"iou":iou,"unique":unique},
                "currentCategory":cause,"trackId":key,"trackIou":ov,"uniqueTrack":unq,"reason":reason,
                "currentCamera":row["calls"].get("background"),"cohorts":q.get("cohorts",{}).get(key),
                "referenceGeometry":physical_trend(physical[target["instance"]],row["timestampUs"]),
                "exactCurrentIdentityLineage":[{"index":r["index"],"timeMs":r["timeMs"],"status":r["B"]["status"],
                    "identity":r["B"]["diagnostics"]["identityDecisions"][key],
                    "cohorts":r["B"]["diagnostics"]["cohorts"].get(key),
                    "retired":r["B"]["diagnostics"]["retiredCohorts"].get(key),
                    "seedAttempts":[a for a in r["calls"].get("seedAttempts",[]) if str(a["trackId"])==key],
                    "flowCalls":[a for a in r["calls"]["flow"] if str(a["trackId"])==key]}
                    for r in rows[:index+1] if key in r["B"]["diagnostics"].get("identityDecisions",{})],
                "precedingDiagnosticChain":case_chain(target,index,rows,contract)})
    frames=[{"clip":clip,**r} for clip,rows in traces.items() for r in rows]
    flows=[c for r in frames for c in r["calls"]["flow"] if not c["identityProbe"]]
    affine_rescues=[c for c in flows if c["reason"]=="incoherent-object-flow" and c.get("diagnosticAffine",{}).get("inliers",0)>=c.get("diagnosticAffine",{}).get("requiredSameFitSupport",float("inf"))]
    reference_files={str(p.relative_to(args.source)):sha256(p) for p in sorted(args.source.rglob("*")) if p.is_file() and p.suffix in {".csv",".txt",".json"}}
    if sha256(Path(__file__)) != diagnostic_hash or any(sha256(Path(__file__).parent/n)!=d for n,d in receipt["codeSha256"].items()):
        raise ValueError("Code changed during diagnostic replay")
    return {"schemaVersion":1,"study":"M3I diagnosis of OLD M3H only","positiveCount":len(cases),
        "provenance":{"inputSha256":sha256(args.input),"receiptSha256":sha256(args.receipt),
            "truthSha256":sha256(args.truth),"scriptSha256":sha256(Path(__file__)),
            "codeSha256":receipt["codeSha256"],"referenceSourceHashes":reference_files,
            "sourceImageHashesVerified":len(frames),"noNewInference":True,"noM3IHoldoutAccess":True},
        "replay":{"frames":len(frames),"lane":"B fresh CohortWindowLoom","mismatches":mismatch},
        "sourceGeometryRederivation":dict(source_geometry),
        "currentCategories":dict(current_counts),"flowReasonCounts":dict(Counter(c["reason"] for c in flows)),
        "measurementFlowCalls":len(flows),"diagnosticAffineSamePairsFitPassAfterSimilarityRejection":len(affine_rescues),
        "sourceGeometryAudit":dict(source_geometry),
        "cases":cases,"frames":frames,
        "limits":["Old M3H diagnosis is development evidence, not new holdout success.",
            "Backward adjacent IoU links are diagnostic and may switch physical identity; exact runtime ID/cohort histories are separately recorded.",
            "Affine fits reuse accepted same-pair pixels only, never labels; extra degrees of freedom can overfit and do not certify valid surface motion or replace any runtime gate.",
            "Pose residual disagreement does not alone distinguish calibration, timing, foreground leakage and bad optical correspondences. Source geometry error is not proved.",
            "Reference norms and optical Z are evaluation-only; only ratios are serialized and no reference geometry enters runtime.",
            "First gate failures quantify observed evidence loss; removal safety and counterfactual warning success are not established."]}


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("input","receipt","truth","source","output"): parser.add_argument("--"+name,type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists(): raise ValueError("Require new evidence path")
    result=run(args)
    args.output.write_text(json.dumps(result,indent=2,allow_nan=False)+"\n")
    print(json.dumps({k:result[k] for k in ("positiveCount","replay","currentCategories","flowReasonCounts","diagnosticAffineSamePairsFitPassAfterSimilarityRejection")},indent=2))
