#!/usr/bin/env python3
"""M3V posthoc pixel reference diagnostic, never runtime camera authority.

Reference rectangles are independently reviewed, uncertainty-bearing pixel
annotations. Pose supplies epilines, NOT a unique endpoint or object range.
No model fitting, parameter selection, detector/RAFT execution or runtime edits.
"""
import argparse
from collections import Counter
import csv
from hashlib import sha256
import json
import math
from pathlib import Path
import shutil
import platform
from time import perf_counter

import cv2
import numpy as np

import assist_scene_motion_m3c as frozen_lk
import assist_scene_scale_approach as frozen_camera
from assist_scene_m3s_camera_audit import clean,canonical,require

POLICY=dict(method="posthoc-independent-pixel-interval-audit",pairs=6,slotsPerPair=12,totalSlots=72,
    maxSeconds=120,maxBytes=32*1024**2,maxLkDirections=24,capWorkingPx=1.3,
    clockShifts=[-2,-1,1,2],wrongTargetShiftNativePx=16.,referenceIsExactHumanTruth=False)
M3U_SLICE_SHA256="16a590b7bfc5850d9078f21edda085bfaee5988ef2a5ac6ae055d4a73ec034ab"
HERE=Path(__file__).resolve().parent


def digest(path):return sha256(Path(path).read_bytes()).hexdigest()


def fingerprints():
    return {p.name:digest(p)for p in (Path(__file__),Path(frozen_lk.__file__),Path(frozen_camera.__file__),
        HERE/'assist_scene_m3s_camera_audit.py',HERE/'assist_scene_boreas_import.py',HERE/'assist_scene_m3f_study.py',
        HERE/'assist_scene_m3v_pixel_reference.py')}


def rectangle(r):
    require(isinstance(r,dict)and set(r)=={"x0","y0","x1","y1"},"invalid-reference-rectangle")
    a=np.array([r[k]for k in ("x0","y0","x1","y1")],float)
    require(np.isfinite(a).all()and a[0]<=a[2]and a[1]<=a[3],"invalid-reference-rectangle")
    return a


def vertices(r):
    x0,y0,x1,y1=rectangle(r)
    return np.array([[x0,y0,1.],[x1,y0,1.],[x1,y1,1.],[x0,y1,1.]])


def rect_from_point(point):
    x,y=map(float,point);return dict(x0=x,y0=y,x1=x,y1=y)


def png_has_exif(payload):
    require(payload.startswith(b'\x89PNG\r\n\x1a\n'),"wrong-original-PNG")
    at=8;found=False
    while at+12<=len(payload):
        size=int.from_bytes(payload[at:at+4],'big');kind=payload[at+4:at+8]
        require(at+12+size<=len(payload),"truncated-original-PNG-chunk")
        found|=kind==b'eXIf';at+=12+size
        if kind==b'IEND':break
    return bool(found)


def transformed_rectangle(r,a):
    p=vertices(r)@np.asarray(a).T
    require(np.all(p[:,2]>0),"annotation-horizon")
    p=p[:,:2]/p[:,2:3]
    return dict(x0=float(p[:,0].min()),y0=float(p[:,1].min()),x1=float(p[:,0].max()),y1=float(p[:,1].max()))


def resize_map(width,height,working_width,working_height,center):
    sx,sy=working_width/width,working_height/height
    return np.array([[sx,0.,(sx-1)/2 if center else 0.],[0.,sy,(sy-1)/2 if center else 0.],[0.,0.,1.]])


def line_norm_bounds(matrix,r,weights=(1.,1.)):
    """True affine norm extrema on rectangle: corners, edges, interior."""
    matrix=np.asarray(matrix,float);weights=np.asarray(weights,float)
    require(matrix.shape==(3,3)and np.isfinite(matrix).all()and weights.shape==(2,)and np.isfinite(weights).all()and np.all(weights>0),"invalid-line-norm-input")
    m=np.diag(weights)@matrix[:2];p=vertices(r)[:,:2]
    q=np.column_stack((p,np.ones(4)))@m.T
    norms=np.linalg.norm(q,axis=1);lower=float(norms.min());upper=float(norms.max())
    for i in range(4):
        origin=q[i];d=q[(i+1)%4]-origin;den=float(d@d)
        t=0. if den==0 else float(np.clip(-origin@d/den,0.,1.))
        lower=min(lower,float(np.linalg.norm(origin+t*d)))
    z=np.linalg.lstsq(m[:,:2],-m[:,2],rcond=None)[0];bounds=rectangle(r)
    if bounds[0]<=z[0]<=bounds[2]and bounds[1]<=z[1]<=bounds[3]:lower=min(lower,float(np.linalg.norm(m[:,:2]@z+m[:,2])))
    magnitude=np.abs(np.column_stack((p,np.ones(4))))@np.abs(m).T
    eps=128*np.finfo(float).eps*max(1.,float(np.linalg.norm(magnitude,axis=1).max()))
    return max(0.,lower-eps),upper+eps


def residual_interval(f,source,target,weights=(1.,1.)):
    """Conservative dual-MAX bounds over ALL endpoint rectangle interiors."""
    f=np.asarray(f,float);norm=np.linalg.norm(f)
    if f.shape!=(3,3)or not np.isfinite(f).all()or norm<1e-15:
        return dict(decision="unknown",reason="unobservable-fundamental",lowerWorkingPx=None,upperWorkingPx=None)
    f=f/norm;x,y=vertices(source),vertices(target);values=y@f@x.T
    magnitude=np.abs(y)@np.abs(f)@np.abs(x).T
    eps=128*np.finfo(float).eps*max(1.,float(magnitude.max()))
    lo,hi=float(values.min())-eps,float(values.max())+eps
    abslo=0. if lo<=0<=hi else min(abs(lo),abs(hi));abshi=max(abs(lo),abs(hi))
    d1=line_norm_bounds(f,source,weights);d0=line_norm_bounds(f.T,target,weights)
    if min(d0[0],d1[0])<=1e-9:
        return dict(decision="unknown",reason="line-norm-interval-reaches-epipole",signedNumeratorInterval=[lo,hi],
            lineNormBounds=[d1,d0],lowerWorkingPx=None,upperWorkingPx=None)
    lower=max(abslo/d1[1],abslo/d0[1]);upper=max(abshi/d1[0],abshi/d0[0])
    decision="pass"if upper<=1.3 else "fail"if lower>1.3 else "unknown"
    return dict(decision=decision,reason="conservative-entire-rectangle-bound",signedNumeratorInterval=[lo,hi],
        lineNormBounds=[d1,d0],lowerWorkingPx=lower,upperWorkingPx=upper)


def _pad(a,scale=None):
    eps=128*np.finfo(float).eps*max(1.,abs(a[0]),abs(a[1]),0. if scale is None else scale)
    return (a[0]-eps,a[1]+eps)
def _mul(a,b):
    v=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return _pad((min(v),max(v)))
def _sum(values):return _pad((sum(v[0]for v in values),sum(v[1]for v in values)),sum(max(abs(v[0]),abs(v[1]))for v in values))
def _sub(a,b):return _pad((a[0]-b[1],a[1]-b[0]),max(map(abs,a))+max(map(abs,b)))
def _square(a):return _pad((0. if a[0]<=0<=a[1]else min(a[0]**2,a[1]**2),max(a[0]**2,a[1]**2)))
def _dot(a,b):return _sum([_mul(x,y)for x,y in zip(a,b,strict=True)])


def cheirality_interval(source,target,k,r,t):
    """Dimensionless sign certificate only. No triangulated range serialized."""
    if np.linalg.norm(t)<=1e-15:return dict(decision="unknown",reason="zero-translation-unobservable")
    a=vertices(source)@np.linalg.inv(k).T@r.T;b=vertices(target)@np.linalg.inv(k).T
    aa=[_pad((float(v.min()),float(v.max())))for v in a.T];bb=[_pad((float(v.min()),float(v.max())))for v in b.T]
    unit=t/np.linalg.norm(t);tt=[(float(v),float(v))for v in unit]
    cross=[_sub(_mul(aa[1],bb[2]),_mul(aa[2],bb[1])),_sub(_mul(aa[2],bb[0]),_mul(aa[0],bb[2])),
        _sub(_mul(aa[0],bb[1]),_mul(aa[1],bb[0]))]
    denominator=_sum([_square(v)for v in cross])
    if denominator[0]<=1e-12:return dict(decision="unknown",reason="cheirality-not-interval-observable")
    at,bt,c=_dot(aa,tt),_dot(bb,tt),_dot(aa,bb)
    first=_sub(_mul(c,bt),_mul(_dot(bb,bb),at));second=_sub(_mul(_dot(aa,aa),bt),_mul(c,at))
    if min(first[0],second[0])>1e-12:return dict(decision="positive",reason="positive-both-view-signs-entire-rectangle")
    if first[1]<-1e-12 or second[1]<-1e-12:return dict(decision="negative",reason="nonpositive-view-sign-entire-rectangle")
    return dict(decision="unknown",reason="cheirality-sign-uncertain")


def relative(old,new):
    transform=np.linalg.inv(np.asarray(new,float))@np.asarray(old,float)
    return transform[:3,:3],transform[:3,3]


def fundamental(k,r,t):
    if np.linalg.norm(t)<=1e-15:return np.zeros((3,3))
    x,y,z=t/np.linalg.norm(t);cross=np.array([[0.,-z,y],[z,0.,-x],[-y,x,0.]])
    return np.linalg.inv(k).T@cross@r@np.linalg.inv(k)


def sdk_pose(csv_row,offset):
    """Independent direct SDK get_transform arithmetic, no vendor install."""
    roll,pitch,yaw=map(float,csv_row[7:10]);sr,cr=math.sin(roll),math.cos(roll);sp,cp=math.sin(pitch),math.cos(pitch);sy,cy=math.sin(yaw),math.cos(yaw)
    rx=np.array([[1.,0.,0.],[0.,cr,sr],[0.,-sr,cr]])
    ry=np.array([[cp,0.,-sp],[0.,1.,0.],[sp,0.,cp]])
    rz=np.array([[cy,sy,0.],[-sy,cy,0.],[0.,0.,1.]])
    pose=np.eye(4);pose[:3,:3]=rx@ry@rz;pose[:3,3]=np.array(csv_row[1:4],float)-pose[:3,:3]@offset
    return pose


def geometry_record(source,target,k,old,new,weights):
    r,t=relative(old,new);interval=residual_interval(fundamental(k,r,t),source,target,weights)
    sign=cheirality_interval(source,target,k,r,t)
    decision="fail"if interval["decision"]=="fail"or sign["decision"]=="negative"else "pass"if interval["decision"]=="pass"and sign["decision"]=="positive"else "unknown"
    return dict(epiline=interval,cheirality=sign,geometryDecision=decision,motionAuthorized=False)


def area_footprint_mean(values,start,end):
    """Discrete pixel-cell area integral; integer centers have cells±.5."""
    total=0.
    for i,value in enumerate(values):total+=float(value)*max(0.,min(end,i+.5)-max(start,i-.5))
    return total/(end-start)


def rectangle_distance(point,target,weights):
    p=np.asarray(point,float);r=rectangle(target);lo=r[:2];hi=r[2:]
    low=np.maximum(0.,np.maximum(lo-p,p-hi))*weights
    high=np.maximum(np.abs(p-lo),np.abs(p-hi))*weights
    return [float(np.linalg.norm(low)),float(np.linalg.norm(high))]


def query_lk(old,new,source_points):
    """Only SOURCE annotation centers enter LK, never target rectangles."""
    a=np.asarray(source_points,np.float32).reshape(-1,1,2);n=len(a);calls=0
    if not n:return dict(points=[],directionCalls=0,targetReferenceSeen=False)
    try:
        calls+=1;b,s,_=cv2.calcOpticalFlowPyrLK(old,new,a,None,**frozen_lk.LK)
        back=rev=None
        if b is not None and s is not None:
            calls+=1;back,rev,_=cv2.calcOpticalFlowPyrLK(new,old,b,None,**frozen_lk.LK)
        records=[]
        for i in range(n):
            endpoint=None if b is None else b[i,0];cycle=None if back is None else float(np.linalg.norm(a[i,0]-back[i,0]))
            accepted=(endpoint is not None and s is not None and rev is not None and s[i,0]==1 and rev[i,0]==1
                and np.isfinite(endpoint).all()and cycle<=1.3 and 0<=endpoint[0]<new.shape[1]-1 and 0<=endpoint[1]<new.shape[0]-1)
            photo=bool(frozen_camera._matching_patches(old,new,a[i:i+1,0],b[i:i+1,0])[0])if accepted else False
            records.append(dict(source=clean(a[i,0]),endpoint=clean(endpoint),cyclePx=clean(cycle),lkAccepted=bool(accepted),
                photometric=photo,accepted=bool(accepted and photo)))
        return dict(points=records,directionCalls=calls,targetReferenceSeen=False)
    except Exception as error:
        error.m3v_lk_calls=calls;raise


def validate_references(selection,gold,input_hash,selection_hash):
    require(selection["inputSha256"]==gold["inputSha256"]==input_hash and gold["sourceSelectionSha256"]==selection_hash,"reference-source-seal-mismatch")
    require(len(selection["pairs"])==len(gold["pairs"])==6,"wrong-pair-denominator")
    require(selection.get("sourceOnly")is True and selection.get("targetPixelReads")==0,"source-selection-read-target-pixels")
    helper=HERE/'assist_scene_m3v_pixel_reference.py'
    require(selection.get("codeSha256")==gold.get("codeSha256")==digest(helper),"changed-source-reference-helper")
    fixed=[("boreas-m3u-city",i-1,i)for i in (14,22,30,38,46)]+[("boreas-m3u-turn",21,22)]
    require([(p["clipId"],p["startIndex"],p["endIndex"])for p in selection["pairs"]]==fixed,"changed-preregistered-six-pairs")
    seen=set()
    for selected,reviewed in zip(selection["pairs"],gold["pairs"],strict=True):
        require(all(reviewed.get(k)==v for k,v in selected.items()if k not in("slots","sourcePanels","sourceSheets")),"source-pair-replaced-after-seal")
        require(len(selected["slots"])==len(reviewed["slots"])==12,"wrong-slot-denominator")
        for slot,annotation in zip(selected["slots"],reviewed["slots"],strict=True):
            require(all(annotation.get(k)==v for k,v in slot.items()),"source-slot-replaced-after-seal")
            require(slot["id"]not in seen and slot["cell"]==[len(seen)%12%4,len(seen)%12//4],"duplicated-or-reordered-slot")
            seen.add(slot["id"]);col,row=slot["cell"]
            require(slot["split"]==("analysis"if (col+row)%2==0 else "holdout"),"split-changed")
            ref=annotation["reference"];require(ref["status"]in("accepted-static-match","unknown"),"unsupported-reference-status")
            require(isinstance(ref.get("reason"),str)and bool(ref["reason"].strip()),"reference-missing-evidence-reason")
            if ref["status"]=="accepted-static-match":
                require(slot["sourceCandidate"]is not None and bool(ref.get("materialIdentity"))and bool(ref.get("staticEvidence"))
                    and ref.get("sameSelectedFeature")is True,"unjustified-static-reference")
                cx,cy=(round(v)for v in slot["sourceCandidate"])
                for key in ("sourceRectangle","targetRectangle"):
                    r=rectangle(ref[key]);require(0<=r[0]<=r[2]<selected["nativeWidth"]and 0<=r[1]<=r[3]<selected["nativeHeight"],"reference-outside-native-image")
                    require(r[2]-r[0]>=4 and r[3]-r[1]>=4,"reference-uncertainty-below-nominal")
                    require(cx-120<=r[0]<=r[2]<cx+121 and cy-120<=r[1]<=r[3]<cy+121,"reference-escaped-fixed-context")
    require(len(seen)==72,"missing-original-slot")


def _variants(frames,start,end,k,ad,ac,sdk):
    native=np.eye(3);variants=[]
    def add(name,pose0,pose1,calibration,a,weights,eligible,**extra):
        variants.append(dict(name=name,old=np.asarray(pose0).copy(),new=np.asarray(pose1).copy(),k=np.asarray(calibration).copy(),
            a=np.asarray(a).copy(),weights=np.asarray(weights).copy(),runtimeEligible=eligible,**extra))
    weights=np.array([1/ad[0,0],1/ad[1,1]])
    add("native-nominal-sdk-working-metric",sdk(start),sdk(end),k,native,weights,True)
    add("native-input-runtime-working-metric",np.asarray(frames[start]["cameraToWorld"]),np.asarray(frames[end]["cameraToWorld"]),k,native,weights,True)
    add("working-legacy-K-actual-center-pixels",sdk(start),sdk(end),ad@k,ac,np.ones(2),True)
    add("working-consistent-pixel-center",sdk(start),sdk(end),ac@k,ac,np.ones(2),False,diagnosticCorrectionOnly=True)
    add("working-diagonal-conjugacy-algebra-only",sdk(start),sdk(end),ad@k,ad,np.ones(2),False,algebraOnly=True)
    for shift in (-2,-1,1,2):
        if 0<=start+shift<end+shift<len(frames):
            p0,p1=frames[start+shift],frames[end+shift]
            add(f"clock-both-endpoints-{shift:+d}-frames",sdk(start+shift),sdk(end+shift),k,native,weights,False,
                sourcePoseTimestampUs=p0["poseTimestampUs"],targetPoseTimestampUs=p1["poseTimestampUs"],
                sourceSkewUs=p0["poseTimestampUs"]-frames[start]["timestampUs"],targetSkewUs=p1["poseTimestampUs"]-frames[end]["timestampUs"],
                reason="clock-counterfactual-always-ineligible-not-renamed-timestamps")
        else:variants.append(dict(name=f"clock-both-endpoints-{shift:+d}-frames",unavailable=True,runtimeEligible=False))
    r,t=relative(sdk(start),sdk(end));pose0=np.eye(4);pose1=np.eye(4)
    # Encode desired relative transform via inv(Tcur)@Told, not fake clocks.
    pose0[:3,:3]=r.T;pose0[:3,3]=t
    add("wrong-relative-R-transpose",pose0,pose1,k,native,weights,False,falsification=True)
    pose0[:3,:3]=r;pose0[:3,3]=-t
    add("wrong-translation-sign",pose0.copy(),pose1,k,native,weights,False,falsification=True)
    wrong=k.copy();wrong[0,0]*=1.05
    add("wrong-fx-times1.05",sdk(start),sdk(end),wrong,native,weights,False,falsification=True)
    return variants


def run(args):
    tick=perf_counter();before=fingerprints();progress=dict(completedPairs=[],actualLkDirections=0,phase="sealed-input-binding")
    try:
        cv2.setNumThreads(1)
        for path,expected in ((args.input,args.input_sha256),(args.receipt,args.receipt_sha256),
            (args.reference,args.reference_sha256),(args.source_selection,args.source_selection_sha256)):
            require(digest(path)==expected,"invalid-or-unapproved-SHA-binding")
        inputs=json.loads(args.input.read_text());receipt=json.loads(args.receipt.read_text())
        selection=json.loads(args.source_selection.read_text());gold=json.loads(args.reference.read_text())
        require(receipt["study"]=="M3U"and receipt["inputSha256"]==args.input_sha256,"wrong-cached-M3U-receipt")
        validate_references(selection,gold,args.input_sha256,args.source_selection_sha256)
        root=(args.input.parent/inputs["assetRoot"]).resolve();csv_path=root/'applanix/camera_poses.csv';p_path=root/'calib/P_camera.txt'
        require(digest(root/'slice.json')==M3U_SLICE_SHA256,"original-M3U-source-manifest-changed")
        slice_manifest=json.loads((root/'slice.json').read_text());require(slice_manifest["complete"]is True,"incomplete-original-source")
        source_files={f["path"]:f["sha256"]for f in slice_manifest["files"]}
        require(digest(csv_path)==source_files['applanix/camera_poses.csv']and digest(p_path)==source_files['calib/P_camera.txt'],"original-pose-calibration-metadata-changed")
        with csv_path.open()as stream:csv_rows={int(r[0]):r for r in list(csv.reader(stream))[1:]if r}
        p=np.loadtxt(p_path);p=p[:3];k=p[:,:3]/p[2,2];offset=np.linalg.solve(k,p[:,3]/p[2,2])
        input_by={c["id"]:c for c in inputs["clips"]};recorded_by={c["id"]:c for c in receipt["clips"]}
        progress.update(inputSha256=args.input_sha256,referenceSha256=args.reference_sha256,sourceSelectionSha256=args.source_selection_sha256,
            cachedReceiptSha256=args.receipt_sha256,metadataSha256={str(csv_path.relative_to(root)):digest(csv_path),str(p_path.relative_to(root)):digest(p_path)})
        for approved in gold["pairs"]:
            require(perf_counter()-tick<=120,"diagnostic-wall-budget")
            progress.update(phase="source-and-pixel-reference",activePairId=approved["id"]);clip=input_by[approved["clipId"]];old_i,new_i=approved["startIndex"],approved["endIndex"]
            frames=clip["frames"];old,new=frames[old_i],frames[new_i]
            require(approved["sourceToken"]==old["token"]and approved["targetToken"]==new["token"]
                and approved["sourceSha256"]==old["sha256"]and approved["targetSha256"]==new["sha256"],"reference-wrong-exposure")
            original=[];working=[];exif=[];records=[recorded_by[clip["id"]]["frames"][i]for i in (old_i,new_i)]
            for source,record in zip((old,new),records,strict=True):
                path=root/source["path"];payload=path.read_bytes();require(sha256(payload).hexdigest()==source["sha256"]==record["sourceSha256"],"source-image-SHA-changed")
                exif.append(png_has_exif(payload));image=cv2.imdecode(np.frombuffer(payload,np.uint8),cv2.IMREAD_COLOR|cv2.IMREAD_IGNORE_ORIENTATION)
                require(image is not None and image.shape[:2]==(approved["nativeHeight"],approved["nativeWidth"]),"native-image-geometry-changed")
                require(record["token"]==source["token"]and record["timestampUs"]==source["timestampUs"]and record["sourcePoseTimestampUs"]==source["poseTimestampUs"]
                    and np.array_equal(record["cameraToWorld"],source["cameraToWorld"]),"cached-source-metadata-changed")
                width,height=record["width"],record["height"]
                resized=cv2.resize(image,(width,height),interpolation=cv2.INTER_AREA);ok,jpeg=cv2.imencode('.jpg',resized,[cv2.IMWRITE_JPEG_QUALITY,93]);require(ok,"JPEG-stage-failed")
                gray=cv2.imdecode(jpeg,cv2.IMREAD_GRAYSCALE)
                require(sha256(gray.tobytes()).hexdigest()==record["workingPixelsSha256"],"cached-working-JPEG-SHA-mismatch")
                original.append(cv2.cvtColor(image,cv2.COLOR_BGR2GRAY));working.append(gray)
            ad=resize_map(approved["nativeWidth"],approved["nativeHeight"],records[0]["width"],records[0]["height"],False)
            ac=resize_map(approved["nativeWidth"],approved["nativeHeight"],records[0]["width"],records[0]["height"],True)
            require(np.array_equal(ad@np.asarray(old["intrinsics"]),np.asarray(records[0]["cameraIntrinsics"]))
                and np.array_equal(ad@np.asarray(new["intrinsics"]),np.asarray(records[1]["cameraIntrinsics"]))
                and np.array_equal(k,np.asarray(old["intrinsics"]))and np.array_equal(k,np.asarray(new["intrinsics"])),"cached-native-or-working-K-changed")
            sdk=lambda index:sdk_pose(csv_rows[frames[index]["timestampUs"]],offset)
            variants=_variants(frames,old_i,new_i,k,ad,ac,sdk)
            pair=dict(id=approved["id"],clipId=approved["clipId"],startIndex=old_i,endIndex=new_i,
                sourceToken=old["token"],targetToken=new["token"],slots=[],variants=[{q:clean(v)for q,v in item.items()if q not in("old","new","k","a","weights")}for item in variants],
                coordinateMaps=dict(legacy=ad.tolist(),pixelCenter=ac.tolist()),
                sdkInputPoseMaxAbs=[float(np.max(np.abs(sdk(i)-np.asarray(frames[i]["cameraToWorld"]))))for i in (old_i,new_i)],
                originalPngHasExifChunks=exif,
                preprocessing="native BGR→gray; working exact INTER_AREA +JPEG93→gray, EXIF orientation ignored consistently")
            for slot in approved["slots"]:
                ref=slot["reference"];item=dict(id=slot["id"],cell=slot["cell"],split=slot["split"],referenceStatus=ref["status"],geometry={})
                if ref["status"]!="accepted-static-match":item["reason"]=ref.get("reason","unknown-reference");pair["slots"].append(item);continue
                for variant in variants:
                    if variant.get("unavailable"):
                        item["geometry"][variant["name"]]=dict(geometryDecision="unknown",reason="retained-pose-exposure-unavailable");continue
                    a=variant["a"];s=transformed_rectangle(ref["sourceRectangle"],a);t=transformed_rectangle(ref["targetRectangle"],a)
                    result=geometry_record(s,t,variant["k"],variant["old"],variant["new"],variant["weights"])
                    controls={}
                    for axis in ("x","y"):
                        shifted=dict(ref["targetRectangle"])
                        for end in ('0','1'):shifted[axis+end]+=16.
                        rr=rectangle(ref["targetRectangle"]);qq=rectangle(shifted)
                        overlap=not(rr[2]<qq[0]or qq[2]<rr[0]or rr[3]<qq[1]or qq[3]<rr[1])
                        inside=0<=qq[0]<=qq[2]<approved["nativeWidth"]and 0<=qq[1]<=qq[3]<approved["nativeHeight"]
                        controls[axis]=dict(knownWrong=not overlap and inside,diagnosticSynthetic=True,
                            result=geometry_record(s,transformed_rectangle(shifted,a),variant["k"],variant["old"],variant["new"],variant["weights"])if not overlap and inside
                                else dict(geometryDecision="unknown",reason="shift-overlaps-reference-uncertainty"if overlap else "shift-outside-current-image"))
                    result["wrongTargetRectangleControls"]=controls;item["geometry"][variant["name"]]=result
                pair["slots"].append(item)
            if args.with_lk:
                accepted=[s for s in approved["slots"]if s["reference"]["status"]=="accepted-static-match"]
                native_points=[(rectangle(s["reference"]["sourceRectangle"])[:2]+rectangle(s["reference"]["sourceRectangle"])[2:])/2 for s in accepted]
                for name,images,a in (("native",original,np.eye(3)),("working-JPEG93",working,ac)):
                    points=[(a@np.r_[p,1.])[:2].tolist()for p in native_points]
                    queried=query_lk(*images,points);progress["actualLkDirections"]+=queried["directionCalls"]
                    require(progress["actualLkDirections"]<=24,"LK-direction-budget")
                    queried.update(imageDomain=name,cycleThresholdPixelsInThatDomain=1.3,patchSidePixelsInThatDomain=7,
                        lkWindowPixelsInThatDomain=[21,21],sameParametersDoNotMeanSameNativeFootprint=True)
                    for source_slot,out in zip(accepted,queried["points"],strict=True):
                        target=transformed_rectangle(source_slot["reference"]["targetRectangle"],a)
                        weights=np.array([ad[0,0],ad[1,1]])if name=="native"else np.ones(2)
                        bounds=None if out["endpoint"]is None else rectangle_distance(out["endpoint"],target,weights)
                        out.update(slotId=source_slot["id"],endpointErrorWorkingPx=bounds,
                            acceptanceStage="lk-status-cycle-or-bounds-rejected"if not out["lkAccepted"]else "photometric-rejected"if not out["photometric"]else "accepted",
                            outcome="missed-reference"if not out["accepted"]else "accepted-wrong-conditional-reference"if bounds[0]>1.3 else "compatible-with-reference"if bounds[1]<=1.3 else "uncertain-reference-endpoint")
                        if out["endpoint"]is not None and np.isfinite(np.asarray(out["endpoint"],float)).all():
                            observed_source=rect_from_point(out["source"]);observed_target=rect_from_point(out["endpoint"])
                            candidates=[("native-nominal",k,np.array([1/ad[0,0],1/ad[1,1]]))]if name=="native"else[
                                ("working-legacy-K-fixed-observations",ad@k,np.ones(2)),("working-center-K-fixed-observations",ac@k,np.ones(2))]
                            out["fixedObservedEndpointGeometry"]={label:geometry_record(observed_source,observed_target,calibration,
                                sdk(old_i),sdk(new_i),metric)for label,calibration,metric in candidates}
                    pair.setdefault("oracleSourceLk",{})[name]=queried
            progress["completedPairs"].append(pair)
        require(len(progress["completedPairs"])==6 and perf_counter()-tick<=120,"incomplete-or-over-budget")
        require(before==fingerprints(),"source-code-drift")
        for path,expected in ((args.input,args.input_sha256),(args.receipt,args.receipt_sha256),(args.reference,args.reference_sha256),(args.source_selection,args.source_selection_sha256)):
            require(digest(path)==expected,"sealed-input-drift")
        unknown=sum(s["referenceStatus"]!="accepted-static-match"for p in progress["completedPairs"]for s in p["slots"])
        unknown_splits=Counter(s["split"]for p in progress["completedPairs"]for s in p["slots"]if s["referenceStatus"]!="accepted-static-match")
        summary={v["name"]:dict(originalSlots=72,unscorableReference=unknown,referenceAccepted=0,passCount=0,failCount=0,unknownCount=0,
            knownWrongCompatible=0,knownWrongRejected=0,knownWrongUnknown=0,
            bySplit={split:dict(originalSlots=36,unscorableReference=unknown_splits[split],referenceAccepted=0,
                epiline={},cheirality={},combined={})for split in ('analysis','holdout')})for v in progress["completedPairs"][0]["variants"]}
        for pair in progress["completedPairs"]:
            for slot in pair["slots"]:
                if slot["referenceStatus"]!="accepted-static-match":continue
                for name,value in slot["geometry"].items():
                    bucket=summary[name]
                    bucket["referenceAccepted"]+=1;bucket[value["geometryDecision"]+"Count"]+=1
                    split=bucket["bySplit"][slot["split"]];split["referenceAccepted"]+=1
                    for kind,decision in (('epiline',value.get('epiline',{}).get('decision','unknown')),
                        ('cheirality',value.get('cheirality',{}).get('decision','unknown')),('combined',value['geometryDecision'])):
                        split[kind][decision]=split[kind].get(decision,0)+1
                    for ctrl in value.get("wrongTargetRectangleControls",{}).values():
                        key={"pass":"knownWrongCompatible","fail":"knownWrongRejected","unknown":"knownWrongUnknown"}[ctrl["result"]["geometryDecision"]]
                        bucket[key]+=1
        oracle_summary={}
        for name in ('native','working-JPEG93'):
            points=[point for pair in progress["completedPairs"]for point in pair.get('oracleSourceLk',{}).get(name,{}).get('points',[])]
            if args.with_lk:
                oracle_summary[name]=dict(originalSlots=72,unknownReference=unknown,sourceCenterQueries=len(points),
                    acceptanceStages=dict(Counter(p['acceptanceStage']for p in points)),conditionalEndpointOutcomes=dict(Counter(p['outcome']for p in points)))
        result=clean(dict(schemaVersion=1,study="M3V-pixel-diagnostic",complete=True,policy=POLICY,
            **{k:v for k,v in progress.items()if k!="phase"},codeSha256=before,codeAfterSha256=fingerprints(),
            summary=summary,oracleSourceLkSummary=oracle_summary,originalSlotCount=72,unknownReferenceSlots=unknown,
            learnedModelCalls=0,newTrafficModelRuns=0,motionAuthorized=False,events=[],wallMs=1000*(perf_counter()-tick),
            software=dict(opencv=cv2.__version__,opencvThreadsRequested=1,opencvThreadsReported=cv2.getNumThreads(),numpy=np.__version__,python=platform.python_version()),
            analyticTestDefinition=dict(path='tests/test_assist_scene_m3v_pixel_audit.py',
                sha256=digest(HERE.parent/'tests/test_assist_scene_m3v_pixel_audit.py'),
                INTER_AREA='authored discrete-cell footprint control; execution reported separately by preflight QA'),
            limits=["AI-authored cross-reviewed uncertainty rectangles are not exact human/physical pixel truth.",
                "Posthoc six selected cases, not fresh warning quality. Cached M3U traffic13FN/0FP is unchanged.",
                "Clock/convention/K variants and shifted target rectangles are fixed diagnostics, never automatically selected corrections.",
                "Pose constrains epilines, not unique endpoints. Cheirality exports signs only, no object range.",
                "Oracle-source LK component query differs from production seed inventory. Source rectangle center is queried once, not swept over its uncertainty; EPE conclusions are conditional on that query.",
                "Identical 21px LK windows/pyramids and 7px patches cover different native footprints at native versus working resolution. Outcome differences cannot isolate JPEG/resize causality.",
                "INTER_AREA footprint is checked by authored analytic tests, not measured natural-image pixel ground truth.",
                "Twelve source-selected slots per pair do not certify the production24/.70/5cell/.40span camera gate.",
                "Consistent Ad/Ad and Ac/Ac conjugacy is an algebra sanity control, not evidence of pixel accuracy improvement."]))
        require(len(json.dumps(result,separators=(",",":" )).encode())<=32*1024**2,"receipt-byte-budget")
        return result
    except Exception as error:
        progress["actualLkDirections"]+=getattr(error,"m3v_lk_calls",0)
        error.m3v_progress=clean(dict(study="M3V-pixel-diagnostic-incomplete",complete=False,**progress,
            codeSha256=before,codeAfterSha256=fingerprints(),errorType=type(error).__name__,errorMessage=str(error),
            learnedModelCalls=0,motionAuthorized=False,events=[],wallMs=1000*(perf_counter()-tick)))
        raise


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('input','receipt','reference','source-selection'):
        p.add_argument('--'+name,type=Path,required=True);p.add_argument('--'+name+'-sha256',required=True)
    p.add_argument('--with-lk',action='store_true');p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    incomplete=args.output.with_name(args.output.stem+'-incomplete.json')
    require(all(not x.exists()and not x.is_symlink()for x in (args.output,incomplete)),"new-output-required")
    require(shutil.disk_usage(args.output.parent).free>=10*1024**3,"disk-floor10GiB")
    try:value=run(args)
    except Exception as error:
        payload=json.dumps(error.m3v_progress,separators=(",",":"),allow_nan=False).encode();require(len(payload)<=32*1024**2,"prefix-budget")
        with incomplete.open('xb')as stream:stream.write(payload)
        raise
    with args.output.open('x')as stream:json.dump(value,stream,separators=(",",":"),allow_nan=False)
