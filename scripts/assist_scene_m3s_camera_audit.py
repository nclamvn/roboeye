#!/usr/bin/env python3
"""M3S evidence only: source-bound camera disagreement, never a motion authority.

The old camera validator is executed unchanged. Image-fitted models are spatial
cross-validation diagnostics, not replacements for pose or permission to alert.
The raw metadata ledger intentionally has a different lifetime from certificates.
"""
import argparse
from collections import Counter, deque
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import sys
from time import perf_counter
from types import MappingProxyType

import cv2
import numpy as np

import assist_scene_scale_approach as frozen
from assist_scene_motion import Detection
from assist_scene_pose_motion import pose_pair, point_residuals

POLICY = MappingProxyType(dict(method="camera-source-crossfit-audit-not-authority", maxPairs=147,
    maxSeconds=300, maxBytes=16*1024**2, maxLedgerMs=800., maxLedgerExposures=69,
    gridColumns=4, gridRows=3, folds=2, residualPx=1.8, confidence=.99,
    maxIters=1000, randomSeed=650999, minBackgroundPoints=24,
    minBackgroundSupport=.70, minBackgroundCells=5, minBackgroundSpan=.40))


def require(value, message):
    if not value: raise ValueError(message)


def clean(value):
    if isinstance(value, np.ndarray): return clean(value.tolist())
    if isinstance(value, (np.integer, np.bool_)): return value.item()
    if isinstance(value, (float, np.floating)): return float(value) if np.isfinite(value) else None
    if isinstance(value, dict): return {str(k):clean(v) for k,v in value.items()}
    if isinstance(value, (tuple,list)): return [clean(v) for v in value]
    return value


def canonical(value):
    return sha256(json.dumps(clean(value),sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()


def digest(path): return sha256(Path(path).read_bytes()).hexdigest()


def code_fingerprints():
    modules=(__name__,"assist_scene_scale_approach","assist_scene_pose_motion",
        "assist_scene_motion_m3c","assist_scene_motion")
    return {Path(sys.modules[name].__file__).name:digest(sys.modules[name].__file__) for name in modules}


def metadata(row):
    out=dict(token=row["token"],timestampUs=row["timestampUs"],poseTimestampUs=row["sourcePoseTimestampUs"],
             intrinsics=row["cameraIntrinsics"],cameraToWorld=row["cameraToWorld"])
    if row.get("sourcePoseEpoch") is not None: out["epoch"]=row["sourcePoseEpoch"]
    return out


def boxes(row):
    w,h=row["width"],row["height"]
    return [Detection(t["label"],t["score"],tuple(map(float,(t["box"]["x"]*w,t["box"]["y"]*h,
        (t["box"]["x"]+t["box"]["width"])*w,(t["box"]["y"]+t["box"]["height"])*h)))) for t in row["T"]["tracks"]]


class RawExposureLedger:
    """No pixels/proofs/IDs, and NEVER motion authority across a soft veto."""
    def __init__(self): self.rows=deque(maxlen=POLICY["maxLedgerExposures"])

    def observe(self,row):
        reset=None
        try:
            require(type(row["timeMs"]) in (int,float) and np.isfinite(row["timeMs"]) and row["timeMs"]>=0,"invalid-stream-clock")
            require(isinstance(row["token"],str) and bool(row["token"]),"invalid-source-token")
            view,status=frozen._frame_view(metadata(row),row["width"],row["height"])
            require(view is not None,status)
            require(all(isinstance(row[k],str) and len(row[k])==64 and all(c in "0123456789abcdef"for c in row[k])
                for k in ("sourceSha256","workingPixelsSha256")),"unbound-source")
            require(abs(row["timestampUs"]-row["sourcePoseTimestampUs"])<=20_000,"pose-skew")
            if self.rows:
                old=self.rows[-1];delta=row["timestampUs"]-old["timestampUs"]
                require(0<delta<=300_000 and abs((row["timeMs"]-old["timeMs"])-delta/1000.)<=1.,"clock-discontinuity")
                require(row["token"] not in {x["token"] for x in self.rows},"duplicate-token")
                require([row["width"],row["height"]]==old["shape"],"geometry-changed")
                require(row.get("sourcePoseEpoch")==old["sourcePoseEpoch"],"source-epoch-changed")
                require(np.allclose(row["cameraIntrinsics"],old["intrinsics"],atol=1e-4,rtol=1e-6),"calibration-changed")
        except (ValueError,TypeError,KeyError) as error:
            reset=str(error);self.rows.clear()
            return dict(retained=False,hardReset=reset,count=0,motionAuthorized=False,certificateReady=False)
        item=dict(token=row["token"],timestampUs=row["timestampUs"],timeMs=row["timeMs"],
            sourceSha256=row["sourceSha256"],workingPixelsSha256=row["workingPixelsSha256"],
            shape=[row["width"],row["height"]],intrinsics=deepcopy(row["cameraIntrinsics"]),
            sourcePoseEpoch=row.get("sourcePoseEpoch"),cameraStatus=row["T"]["status"],
            cameraEpoch=row["T"]["epoch"],certificateReady=row["T"]["status"]=="valid",
            motionAuthorized=False)
        self.rows.append(item)
        while self.rows and row["timeMs"]-self.rows[0]["timeMs"]>POLICY["maxLedgerMs"]:self.rows.popleft()
        return dict(retained=True,hardReset=reset,count=len(self.rows),tokens=[x["token"]for x in self.rows],
            retainedSoftVetoes=sum(not x["certificateReady"] for x in self.rows),
            certificateReady=item["certificateReady"],motionAuthorized=False,rawMetadataOnly=True)


def folds(points,shape):
    h,w=shape
    cells=np.floor(points/np.array([w/4,h/3])).astype(int)
    cells=np.clip(cells,[0,0],[3,2])
    return (cells[:,0]+cells[:,1])%2


def _residual(model,kind,a,b):
    if kind=="H":return np.linalg.norm(frozen._project(a,model)-b,axis=1)
    x=np.column_stack((a,np.ones(len(a))));y=np.column_stack((b,np.ones(len(b))))
    l1=x@model.T;l0=y@model
    denom=np.maximum(np.linalg.norm(l1[:,:2],axis=1),np.linalg.norm(l0[:,:2],axis=1))
    return np.divide(np.abs(np.sum(y*l1,axis=1)),denom,out=np.full(len(a),np.inf),where=denom>1e-9)


def crossfit_models(a,b,shape):
    """Fit only train coordinates. Entire held-out population stays denominator."""
    a=np.asarray(a,dtype=float).reshape(-1,2);b=np.asarray(b,dtype=float).reshape(-1,2)
    require(a.shape==b.shape and np.isfinite(a).all() and np.isfinite(b).all(),"invalid-crossfit-pairs")
    assignment=folds(a,shape);results=[]
    for fold in range(2):
        train=np.flatnonzero(assignment!=fold);test=np.flatnonzero(assignment==fold)
        for kind,minimum in (("F",8),("H",4)):
            rec=dict(kind=kind,fold=fold,trainIndexes=train.tolist(),holdoutIndexes=test.tolist(),
                trainingPairsSha256=canonical(dict(a=a[train],b=b[train])),model=None,
                fitAttempted=False,diagnosticOnly=True,motionAuthorized=False)
            rank_a=int(np.linalg.matrix_rank(a[train]-a[train].mean(axis=0))) if len(train) else 0
            rank_b=int(np.linalg.matrix_rank(b[train]-b[train].mean(axis=0))) if len(train) else 0
            rec.update(trainSourceRank=rank_a,trainCurrentRank=rank_b,
                trainGeometryDegenerate=rank_a<2 or rank_b<2,
                trainSpatialCells=frozen._spread(a[train],shape[1],shape[0])[0],
                holdoutSpatialCells=frozen._spread(a[test],shape[1],shape[0])[0])
            if kind=="F" and len(train):
                u=a[train]/np.array(shape[::-1]);v=b[train]/np.array(shape[::-1])
                design=np.column_stack((v[:,0]*u[:,0],v[:,0]*u[:,1],v[:,0],v[:,1]*u[:,0],
                    v[:,1]*u[:,1],v[:,1],u[:,0],u[:,1],np.ones(len(train))))
                rec["epipolarDesignRank"]=int(np.linalg.matrix_rank(design))
                rec["epipolarDesignDegenerate"]=rec["epipolarDesignRank"]<8
            model=None
            if len(train)>=minimum and not rec["trainGeometryDegenerate"]:
                rec["fitAttempted"]=True
                cv2.setRNGSeed(POLICY["randomSeed"]+fold)
                if kind=="F":model,_=cv2.findFundamentalMat(a[train],b[train],cv2.FM_RANSAC,1.8,.99,1000)
                else:model,_=cv2.findHomography(a[train],b[train],cv2.RANSAC,1.8,maxIters=1000,confidence=.99)
            if model is not None and model.shape==(3,3) and np.isfinite(model).all():
                errors=_residual(model,kind,a[test],b[test]);agree=np.isfinite(errors)&(errors<=1.8)
                cells,span=frozen._spread(b[test][agree],shape[1],shape[0])
                supported=(np.count_nonzero(agree)>=24 and len(test)>0 and np.mean(agree)>=.70 and cells>=5 and span>=.40)
                rec.update(model=model.tolist(),holdoutResidualPx=clean(errors),holdoutAgreement=agree.tolist(),
                    fittedModelRank=int(np.linalg.matrix_rank(model)),
                    holdoutPoints=len(test),holdoutSupport=float(np.mean(agree)) if len(test) else 0.,
                    occupiedCells=cells,axisSpan=span,passesUnchangedBackgroundFloors=bool(supported))
            else:rec.update(reason="insufficient-train-model",passesUnchangedBackgroundFloors=False)
            results.append(rec)
    return results


def validate_crossfit(record,a,b,shape):
    require(canonical(record)==canonical(crossfit_models(a,b,shape)),"crossfit model/pair/split changed or holdout used for fitting")
    return True


def audit_pair(old,new,old_gray,new_gray):
    """Observe frozen arithmetic rather than replace/copy camera verification."""
    for row,image in ((old,old_gray),(new,new_gray)):
        require(image.shape==(row["height"],row["width"]) and image.dtype==np.uint8,"wrong-image-geometry")
        require(sha256(image.tobytes()).hexdigest()==row["workingPixelsSha256"],"forged-working-pixels")
    h,w=new_gray.shape;pair,pose=pose_pair(metadata(old),metadata(new),w,h)
    homography=None if pair is None else pair.homography
    if pair is None and pose["status"]=="epipolar-baseline-too-small" and pose["translationM"]<.025:
        k=np.asarray(new["cameraIntrinsics"]);r=np.asarray(new["cameraToWorld"])[:3,:3].T@np.asarray(old["cameraToWorld"])[:3,:3]
        homography=k@r@np.linalg.inv(k)
    rec=dict(startToken=old["token"],endToken=new["token"],startSourceSha256=old["sourceSha256"],
        endSourceSha256=new["sourceSha256"],oldWorkingSha256=old["workingPixelsSha256"],
        newWorkingSha256=new["workingPixelsSha256"],pose=pose,motionAuthorized=False,events=[])
    if homography is None:return {**rec,"reason":"pose-model-unavailable"}
    capture={};prior=sys.getprofile()
    def profile(frame,event,returned):
        if event!="return":return
        v=frame.f_locals
        if frame.f_code is frozen.correspondences.__code__:
            capture["correspondences"]={k:deepcopy(v.get(k)) for k in ("a","b","back","s","rev","keep")}
            capture["survivors"]=deepcopy(returned)
        elif frame.f_code is frozen._background.__code__:
            capture["background"]={k:deepcopy(v.get(k))for k in ("a","b","derotated","residual","usable","agreement")}
    try:
        sys.setprofile(profile)
        cv2.setRNGSeed(650500+new["index"])
        valid,q=frozen._background(pair,homography,old_gray,new_gray,boxes(old),boxes(new))
    finally:sys.setprofile(prior)
    raw=capture["correspondences"];a0,b0=capture["survivors"];v=capture["background"]
    seed=np.asarray(raw["a"] if raw["a"] is not None else [],dtype=float).reshape(-1,2)
    # Frozen return locals retain every original seed, including rejected LK rows.
    status={k:clean(raw[k]) for k in ("s","rev","keep")}
    status.update(sourceSeeds=clean(seed),forwardPoints=clean(raw["b"]),backwardPoints=clean(raw["back"]))
    if raw["back"] is not None and len(seed):
        cycle=np.linalg.norm(seed-np.asarray(raw["back"]).reshape(-1,2),axis=1)
        forward=np.asarray(raw["b"]).reshape(-1,2)
        status.update(cyclePx=clean(cycle),cyclePass=(cycle<=1.3).tolist(),
            finiteForward=np.isfinite(forward).all(axis=1).tolist(),
            inBounds=((forward[:,0]>=0)&(forward[:,0]<w-1)&(forward[:,1]>=0)&(forward[:,1]<h-1)).tolist())
    mask=frozen.mask_for(new_gray.shape,boxes(new));xx,yy=b0.astype(int).T
    photo=frozen._matching_patches(old_gray,new_gray,a0,b0);current=mask[yy,xx]!=0
    a,b=np.asarray(v["a"]),np.asarray(v["b"])
    residual,usable=point_residuals(pair,a,b) if pair is not None else (np.linalg.norm(b-v["derotated"],axis=1),np.ones(len(a),bool))
    rec.update(sourceSeedInventory=dict(sourceOnly=True,sourceWorkingSha256=old["workingPixelsSha256"],
        sourceMaskSha256=sha256(frozen.mask_for(old_gray.shape,boxes(old)).tobytes()).hexdigest(),
        maxCorners=256,qualityLevel=.012,minDistance=4,points=clean(seed),inventorySha256=canonical(seed)),
        lk=status,lkSurvivorIndexes=np.flatnonzero(raw["keep"]).tolist() if raw["keep"] is not None else [],
        survivorPhotometry=photo.tolist(),survivorCurrentBackgroundMask=current.tolist(),
        poseControlPoints=clean(a),currentControlPoints=clean(b),poseResidualPx=clean(residual),poseUsable=usable.tolist(),
        poseAgreement=clean(v["agreement"]),frozenBackgroundValid=bool(valid),frozenBackground=q,
        recordedBackground=new["T"]["diagnostics"].get("background"),backgroundReproduces=canonical(q)==canonical(new["T"]["diagnostics"].get("background")),
        frozenPoseResidualCriterionPx=1.3 if pair is None or pair.mode=="rotation" else min(1.8,.65*pair.floor_px),
        diagnosticResidualCriterionPx=1.8,
        crossfit=crossfit_models(a,b,new_gray.shape),reason="diagnostic-only-no-camera-authority")
    return clean(rec)


def run(input_path,receipt_path):
    tick=perf_counter();before=code_fingerprints();progress=dict(clips=[],completedPairs=0,phase="input-binding")
    try:
        result=_run(input_path,receipt_path,tick,progress)
        after=code_fingerprints();require(before==after,"source-code-changed-during-audit")
        result.update(codeSha256=before,codeAfterSha256=after)
        require(len(json.dumps(result,separators=(",",":")).encode())<=POLICY["maxBytes"],"receipt-byte-budget-exceeded")
        return result
    except Exception as error:
        error.m3s_progress=clean(dict(schemaVersion=1,study="M3S-camera-evidence-incomplete",complete=False,
            **progress,codeSha256=before,codeAfterSha256=code_fingerprints(),policy=dict(POLICY),
            actualCpuWallMs=1000*(perf_counter()-tick),errorType=type(error).__name__,errorMessage=str(error),
            newModelCalls=0,motionAuthorized=False,events=[]))
        raise


def _run(input_path,receipt_path,tick,progress):
    cv2.setNumThreads(1)
    input_path=Path(input_path);inp=json.loads(input_path.read_text());receipt=json.loads(Path(receipt_path).read_text())
    require(receipt["inputSha256"]==digest(input_path),"wrong-input-receipt")
    require(sum(len(c["frames"])-1 for c in inp["clips"])==POLICY["maxPairs"],"expected-exactly147-pairs")
    progress.update(inputSha256=digest(input_path),historicalReceiptSha256=digest(receipt_path))
    root=(input_path.parent/inp["assetRoot"]).resolve();clips=[];count=0
    for src,recorded in zip(inp["clips"],receipt["clips"],strict=True):
        require(src["id"]==recorded["id"],"wrong-clip")
        previous=None;ledger=RawExposureLedger();pairs=[];rows=[]
        clip=dict(id=src["id"],pairs=pairs,rawLedger=rows);clips.append(clip);progress["clips"]=clips
        for original,row in zip(src["frames"],recorded["frames"],strict=True):
            progress.update(clipId=src["id"],frameIndex=row["index"],phase="source-binding")
            require(perf_counter()-tick<=POLICY["maxSeconds"],"camera audit time budget exceeded")
            path=root/original["path"];require(digest(path)==original["sha256"]==row["sourceSha256"],"forged-source-image")
            require(original["token"]==row["token"] and original["timestampUs"]==row["timestampUs"] and original["poseTimestampUs"]==row["sourcePoseTimestampUs"],"wrong-source-clock")
            require(original.get("epoch")==row.get("sourcePoseEpoch"),"wrong-source-pose-epoch")
            raw=cv2.imread(str(path),cv2.IMREAD_COLOR|cv2.IMREAD_IGNORE_ORIENTATION);require(raw is not None,"decode-failed")
            require(raw.shape[:2]==(row["nativeHeight"],row["nativeWidth"]),"wrong-native-size")
            k=np.diag((row["width"]/raw.shape[1],row["height"]/raw.shape[0],1.))@np.asarray(original["intrinsics"])
            require(np.array_equal(k,np.asarray(row["cameraIntrinsics"])) and original["cameraToWorld"]==row["cameraToWorld"],"wrong-source-calibration-pose")
            scaled=cv2.resize(raw,(row["width"],row["height"]),interpolation=cv2.INTER_AREA)
            ok,jpeg=cv2.imencode('.jpg',scaled,[cv2.IMWRITE_JPEG_QUALITY,93]);require(ok,"encode-failed")
            gray=cv2.imdecode(jpeg,cv2.IMREAD_GRAYSCALE);require(sha256(gray.tobytes()).hexdigest()==row["workingPixelsSha256"],"working-stage-mismatch")
            rows.append(dict(token=row["token"],ledger=ledger.observe(row)))
            if previous is not None:
                count+=1;require(count<=POLICY["maxPairs"],"pair-budget-exceeded")
                progress["phase"]="frozen-camera-and-crossfit"
                pairs.append(audit_pair(previous[0],row,previous[1],gray))
                progress["completedPairs"]=count
            previous=(row,gray)
    progress["phase"]="receipt-finalization"
    require(count==147,"incomplete-pair-inventory")
    require(perf_counter()-tick<=POLICY["maxSeconds"],"camera audit time budget exceeded")
    pairs=[p for c in clips for p in c["pairs"]]
    result=clean(dict(schemaVersion=1,study="M3S-camera-evidence-only",policy=dict(POLICY),inputSha256=digest(input_path),
        historicalReceiptSha256=digest(receipt_path),clips=clips,pairs=count,complete=True,
        newModelCalls=0,newModelCallsScope="learned detector/flow/VLM inference; excludes actual geometric RANSAC fits",motionAuthorized=False,events=[],actualCpuWallMs=1000*(perf_counter()-tick),
        summary=dict(completeSourceSeedInventories=sum("sourceSeedInventory"in p for p in pairs),
            originalSeeds=sum(len(p.get("sourceSeedInventory",{}).get("points",[]))for p in pairs),
            exactBackgroundReproductions=sum(p.get("backgroundReproduces",False)for p in pairs),
            rawMetadataRetainedExposures=sum(x["ledger"]["retained"]for c in clips for x in c["rawLedger"]),
            geometricFitAttempts=sum(x["fitAttempted"] for p in pairs for x in p.get("crossfit",[])),
            geometricModelsReturned=sum(x["model"] is not None for p in pairs for x in p.get("crossfit",[])),
            crossVetoMotionAuthorizations=0,newAuthorizedMeasurements=0),
        software=dict(opencv=cv2.__version__,opencvThreads=cv2.getNumThreads(),numpy=np.__version__,python=sys.version),
        limits=["Posthoc M3R inputs already inspected; no fresh performance/quality claim.",
            "F/H are held-out image diagnostics, not camera or motion authority.",
            "Raw metadata retained across soft veto does not authorize use of vetoed measurements or coast alerts."]))
    require(len(json.dumps(result,separators=(",",":")).encode())<=POLICY["maxBytes"],"receipt-byte-budget-exceeded")
    return result


if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument('--input',type=Path,required=True);parser.add_argument('--receipt',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    incomplete=args.output.with_name(args.output.stem+'-incomplete'+args.output.suffix)
    require(all(not p.exists() and not p.is_symlink()for p in (args.output,incomplete)),"new-output-path-required")
    try:value=run(args.input,args.receipt)
    except Exception as error:
        value=getattr(error,'m3s_progress',dict(complete=False,errorType=type(error).__name__,newModelCalls=0))
        payload=json.dumps(value,separators=(",",":"),allow_nan=False)
        require(len(payload.encode())<=POLICY["maxBytes"],"incomplete-prefix-byte-budget-exceeded")
        with incomplete.open('x')as stream:stream.write(payload)
        raise
    with args.output.open('x')as stream:json.dump(value,stream,separators=(",",":"),allow_nan=False)
