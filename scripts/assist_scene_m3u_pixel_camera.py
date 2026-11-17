"""M3U supplied-pose camera qualification by observed pixels, not metres.

No fitted F/H accepts a camera. Rotation means low observed background impact,
not physical zero translation. Epipolar acceptance also needs nonrotation
signal, both-view positive cheirality and unchanged full-seed support/spread.
"""
from copy import deepcopy
from hashlib import sha256
import math
import sys
from time import perf_counter
from types import MappingProxyType

import cv2
import numpy as np

import assist_scene_scale_approach as base
import assist_scene_pose_motion as geometry
from assist_scene_m3s_camera_audit import clean, canonical, require

POLICY=MappingProxyType(dict(method="supplied-pose-pixel-impact-camera",maxSeeds=256,
    maxResidualPx=1.3,minPoints=24,minSupport=.70,minCells=5,minSpan=.40,
    minRayBaselineSin=.025,minLineDenominator=1e-9,minCheiralityDenominator=1e-9,
    maxImageSide=768,commonScaleMinSupport=.80,commonScaleStepLog=.016,
    commonScaleWindowLog=.035,commonScaleHorizonMs=640.,persistentIdentity=False))


def candidate_pose(previous,current,w,h):
    """Only an old baseline-too-small rejection permits honest reconstruction."""
    pair,info=geometry.pose_pair(previous,current,w,h)
    if pair is not None:return pair,{**info,"frozenPoseStatus":info["status"]}
    if info["status"]!="epipolar-baseline-too-small":return None,info
    k0,k1=(np.asarray(f["intrinsics"],float)for f in (previous,current))
    p0,p1=(np.asarray(f["cameraToWorld"],float)for f in (previous,current))
    r=p1[:3,:3].T@p0[:3,:3];t=p1[:3,:3].T@(p0[:3,3]-p1[:3,3]);direction=t/np.linalg.norm(t)
    ik0,ik1=np.linalg.inv(k0),np.linalg.inv(k1)
    floor=max(geometry.POLICY["minFloorPixels"],geometry.POLICY["floorPixelsAt768"]*max(w,h)/768.)
    if info["maxSkewUs"]:
        floor+=float(max(k0[0,0],k0[1,1])*math.radians(info["rotationDeg"])*2*info["maxSkewUs"]/info["intervalUs"])
    fundamental=ik1.T@geometry._cross_matrix(direction)@r@ik0
    result=geometry.PosePair("epipolar",w,h,floor,k1@r@ik0,fundamental,ik0,ik1,r.T@direction,direction)
    return result,{**info,"status":"valid-pending-pixel-qualification","mode":"epipolar","floorPx":floor,
        "frozenPoseStatus":"epipolar-baseline-too-small"}


def source_controls(old,new,old_boxes,new_boxes):
    """Frozen source corner/LK/FB/NCC arithmetic, original N never shrinks."""
    v={};prior=sys.getprofile();directions=0
    def profile(frame,event,value):
        nonlocal directions
        if event=="c_call"and value is cv2.calcOpticalFlowPyrLK:directions+=1
        if event=="return"and frame.f_code is base.correspondences.__code__:
            v.update({k:deepcopy(frame.f_locals.get(k))for k in ("a","b","back","s","rev","keep")})
    try:
        sys.setprofile(profile)
        base.correspondences(old,new,base.mask_for(old.shape,old_boxes),256)
    finally:sys.setprofile(prior)
    a=np.asarray(v.get("a")if v.get("a")is not None else [],float).reshape(-1,2);n=len(a)
    b=np.asarray(v["b"],float).reshape(-1,2)if v.get("b")is not None else np.full_like(a,np.nan)
    keep=np.asarray(v["keep"],bool).ravel()if v.get("keep")is not None else np.zeros(n,bool)
    photo=np.zeros(n,bool);outside=np.zeros(n,bool)
    selected=np.flatnonzero(keep)
    if len(selected):
        photo[selected]=base._matching_patches(old,new,a[selected],b[selected])
        mask=base.mask_for(new.shape,new_boxes);xy=b[selected].astype(int)
        outside[selected]=mask[xy[:,1],xy[:,0]]!=0
    return clean(dict(sourceSeeds=a,endpoints=b,backwardEndpoints=v.get("back"),forwardStatus=v.get("s"),
        backwardStatus=v.get("rev"),lkAccepted=keep,photometric=photo,outsideCurrentForeground=outside,
        originalSeedCount=n,lkDirectionCalls=directions,sourceOnly=True,
        sourceGraySha256=sha256(old.tobytes()).hexdigest(),currentGraySha256=sha256(new.tobytes()).hexdigest(),
        sourceMaskSha256=sha256(base.mask_for(old.shape,old_boxes).tobytes()).hexdigest(),
        currentMaskSha256=sha256(base.mask_for(new.shape,new_boxes).tobytes()).hexdigest()))


def quality(mask,points,shape):
    mask=np.asarray(mask,bool);n=len(mask);count=int(np.count_nonzero(mask))
    cells,span=base._spread(np.asarray(points)[mask],shape[1],shape[0])
    return dict(originalSeeds=n,points=count,support=count/n if n else 0.,occupiedCells=cells,axisSpan=span,
        supported=bool(count>=24 and n>0 and count/n>=.70 and cells>=5 and span>=.40))


def evaluate(controls,pair,shape):
    """No fitted model or scene labels enter any acceptance branch."""
    a=np.asarray(controls["sourceSeeds"],float).reshape(-1,2);b=np.asarray(controls["endpoints"],float).reshape(-1,2);n=len(a)
    good=np.asarray(controls["lkAccepted"],bool)&np.asarray(controls["photometric"],bool)&np.asarray(controls["outsideCurrentForeground"],bool)
    x=np.column_stack((a,np.ones(n)));y=np.column_stack((b,np.ones(n)))
    rotated=base._project(a,pair.homography);rotation=np.linalg.norm(rotated-b,axis=1)
    rmask=good&np.isfinite(rotation)&(rotation<=1.3)
    dual=np.full(n,np.nan);safe=np.zeros(n,bool);positive=np.zeros(n,bool)
    if pair.mode=="epipolar":
        l1=x@pair.fundamental.T;l0=y@pair.fundamental
        d1,d0=np.linalg.norm(l1[:,:2],axis=1),np.linalg.norm(l0[:,:2],axis=1)
        ray0=x@pair.inv_k_prev.T;ray1=y@pair.inv_k_current.T
        sin0=np.linalg.norm(np.cross(ray0,pair.baseline_prev),axis=1)/np.linalg.norm(ray0,axis=1)
        sin1=np.linalg.norm(np.cross(ray1,pair.baseline_current),axis=1)/np.linalg.norm(ray1,axis=1)
        safe=(d0>1e-9)&(d1>1e-9)&(sin0>=.025)&(sin1>=.025)&np.isfinite(b).all(axis=1)
        residual=np.abs(np.sum(y*l1,axis=1))
        dual[safe]=residual[safe]/np.minimum(d0[safe],d1[safe])
        # Unit-baseline depths are used ONLY for signs, never serialized as range.
        r=pair.inv_k_current@pair.homography@np.linalg.inv(pair.inv_k_prev)
        u=ray0@r.T;u/=np.linalg.norm(u,axis=1)[:,None];v=ray1/np.linalg.norm(ray1,axis=1)[:,None]
        c=np.sum(u*v,axis=1);ut=u@pair.baseline_current;vt=v@pair.baseline_current;denom=1-c*c
        observable=np.isfinite(denom)&(denom>1e-9)
        first=np.zeros(n);second=np.zeros(n)
        first[observable]=(c[observable]*vt[observable]-ut[observable])/denom[observable]
        second[observable]=(vt[observable]-c[observable]*ut[observable])/denom[observable]
        positive=observable&(first>0)&(second>0)
    emask=good&safe&positive&np.isfinite(dual)&(dual<=1.3)&(rotation>1.3)
    rq,eq=quality(rmask,b,shape),quality(emask,b,shape)
    mode="rotation-low-observed-impact"if rq["supported"]else "epipolar-observed-parallax"if eq["supported"]else None
    common=None;common_model=None;indices=np.flatnonzero(good&np.isfinite(rotated).all(axis=1))
    if len(indices)>=24:
        fit,inliers=base._similarity(rotated[indices],b[indices],.8)
        if fit is not None:
            selected=indices[inliers];q=quality(np.isin(np.arange(n),selected),b,shape)
            scale=math.hypot(*fit[:,0])
            # Veto keeps its OLD plausible-control denominator. Using full N
            # here would weaken it when failed LK seeds coexist with zoom.
            if len(selected)>=24 and len(selected)>=.80*len(indices) and q["occupiedCells"]>=5 and q["axisSpan"]>=.40 and scale>0:
                common=math.log(scale);common_model=fit.tolist()
    return clean(dict(rotationResidualPx=rotation,maxDualEpipolarResidualPx=dual,epipolarUsable=safe,
        positiveCheiralityBoth=positive,rotationAgreement=rmask,epipolarParallaxAgreement=emask,
        rotationQuality=rq,epipolarQuality=eq,selectedMode=mode,commonLogScale=common,
        commonScaleVetoModel=common_model,acceptedBeforeScaleVeto=mode is not None))


class PixelCameraAuthority:
    def __init__(self):
        self.epoch=0;self._previous=None;self._serial=0;self._scale=base.ScaleApproach()

    def _reset(self):
        self.epoch+=1;self._previous=None;self._scale=base.ScaleApproach()

    def update(self,frame,t_ms,gray,boxes):
        tick=perf_counter();diag=dict(method=POLICY["method"],policy=dict(POLICY),controls=None,evidence=None,
            persistentIdentity=False,physicalZeroTranslationClaim=False)
        self._serial+=1;tracks=[]
        def result(status):
            diag["wallMs"]=1000*(perf_counter()-tick)
            return dict(status=status,epoch=self.epoch,tracks=tracks,events=[],diagnostics=diag)
        if not isinstance(gray,np.ndarray)or gray.dtype!=np.uint8 or gray.ndim!=2 or not 32<=min(gray.shape)<=max(gray.shape)<=768:
            self._reset();return result("invalid-image")
        if type(t_ms)not in (int,float)or not math.isfinite(t_ms)or t_ms<0:
            self._reset();return result("invalid-stream-clock")
        h,w=gray.shape;view,status=base._frame_view(frame,w,h);clean_boxes=base._boxes(boxes,w,h)
        if view is None or clean_boxes is None:
            self._reset();return result(status if view is None else "invalid-detections")
        if not isinstance(view.get("token"),str)or not view["token"]:
            self._reset();return result("unbound-source-token")
        if abs(view["timestampUs"]-view["poseTimestampUs"])>20000:
            self._reset();return result("pose-skew")
        if not isinstance(frame.get("sha256"),str)or len(frame["sha256"])!=64 or any(c not in "0123456789abcdef"for c in frame["sha256"]):
            self._reset();return result("unbound-source-exposure")
        diag.update(sourceToken=view.get("token"),sourceSha256=frame["sha256"],sourceTimestampUs=view["timestampUs"],
            workingPixelsSha256=sha256(gray.tobytes()).hexdigest(),presentationExposure=self._serial)
        tracks=[dict(id=self._serial*12+j+1,**box.record(w,h))for j,box in enumerate(clean_boxes)]
        status="first-frame"
        if self._previous is not None:
            old,old_at,old_image,old_boxes=self._previous
            hard=(old_image.shape!=gray.shape or view.get("token")==old.get("token")or t_ms<=old_at
                or abs(t_ms-old_at-(view["timestampUs"]-old["timestampUs"])/1000.)>1.)
            if hard:self._reset();return result("stream-discontinuity")
            pair,pose=candidate_pose(old,view,w,h);diag["pose"]=pose
            if pair is None:
                self._reset();return result(pose["status"])
            controls=source_controls(old_image,gray,old_boxes,clean_boxes);evidence=evaluate(controls,pair,gray.shape)
            diag.update(controls=controls,evidence=evidence,previousToken=old.get("token"),previousTimestampUs=old["timestampUs"])
            ambiguous=self._scale._update_common_scale(t_ms,evidence)
            status="scale-ambiguous"if ambiguous else "valid"if evidence["acceptedBeforeScaleVeto"]else "insufficient-pixel-camera-evidence"
            if status!="valid":self._reset()
        self._previous=(view,t_ms,gray.copy(),tuple(clean_boxes))
        return result(status)


def validate_surface(surface,row,history):
    previous=history[-1]if history else None
    diag=surface["diagnostics"]
    require(diag["method"]==POLICY["method"]and diag["policy"]==dict(POLICY)and surface["events"]==[],"wrong-camera-contract")
    if diag.get("sourceToken")is not None:
        require(diag["sourceToken"]==row["token"]and diag["sourceSha256"]==row["sourceSha256"]
            and diag["workingPixelsSha256"]==row["workingPixelsSha256"]and diag["sourceTimestampUs"]==row["timestampUs"],"camera-source-not-bound")
    require(surface["status"]!="valid"or diag.get("sourceToken")==row["token"]and diag["controls"]is not None,"unbound-valid-camera")
    if diag.get("presentationExposure")is not None:
        require(diag["presentationExposure"]==row["index"]+1 and surface["tracks"]==[
            {"id":(row["index"]+1)*12+j+1,**t}for j,t in enumerate(row["detections"])],"current-handles-borrowed-or-not-bound")
    if diag["controls"]is not None:
        require(previous is not None and diag["previousToken"]==previous["token"],"camera-skipped-exposure")
        controls=diag["controls"];n=controls["originalSeedCount"]
        require(n==len(controls["sourceSeeds"])and 0<=n<=256 and all(len(controls[k])==n for k in
            ("endpoints","lkAccepted","photometric","outsideCurrentForeground")),"camera-dropped-original-seeds")
        if n:
            a=np.asarray(controls["sourceSeeds"],float);b=np.asarray(controls["endpoints"],float)
            expected=np.zeros(n,bool)
            if all(controls[k]is not None for k in ("forwardStatus","backwardStatus","backwardEndpoints")):
                back=np.asarray(controls["backwardEndpoints"],float).reshape(-1,2)
                expected=(np.asarray(controls["forwardStatus"]).ravel()==1)&(np.asarray(controls["backwardStatus"]).ravel()==1)
                expected&=np.isfinite(b).all(axis=1)&(np.linalg.norm(a-back,axis=1)<=1.3)
                expected&=(b[:,0]>=0)&(b[:,0]<row["width"]-1)&(b[:,1]>=0)&(b[:,1]<row["height"]-1)
            require(expected.tolist()==controls["lkAccepted"],"LK-failures-promoted")
        def view(r):
            out=dict(token=r["token"],timestampUs=r["timestampUs"],poseTimestampUs=r["sourcePoseTimestampUs"],intrinsics=r["cameraIntrinsics"],cameraToWorld=r["cameraToWorld"])
            if r.get("sourcePoseEpoch")is not None:out["epoch"]=r["sourcePoseEpoch"]
            return out
        pair,pose=candidate_pose(view(previous),view(row),row["width"],row["height"])
        require(pair is not None and canonical(pose)==canonical(diag["pose"]),"unbound-camera-pose")
        cv2.setRNGSeed(650500+row["index"])
        require(canonical(evaluate(controls,pair,(row["height"],row["width"])))==canonical(diag["evidence"]),"pixel-camera-gate-does-not-reproduce")
        require(controls["sourceGraySha256"]==previous["workingPixelsSha256"]and controls["currentGraySha256"]==row["workingPixelsSha256"],"camera-controls-wrong-pixels")
        value=diag["evidence"]["commonLogScale"];common=[]
        if value is not None:
            for old in reversed(history):
                cam=old["T_B"];e=cam["diagnostics"].get("evidence")
                if cam["status"]!="valid"or e is None or e["commonLogScale"]is None or row["timeMs"]-old["timeMs"]>640.:break
                common.append(e["commonLogScale"])
                if len(common)==7:break
            common.append(value)
        net=abs(sum(common));total=sum(abs(v)for v in common)
        ambiguous=value is not None and (abs(value)>=.016 or net>=.035 and net>=.8*total)
        expected="scale-ambiguous"if ambiguous else "valid"if diag["evidence"]["acceptedBeforeScaleVeto"]else "insufficient-pixel-camera-evidence"
        require(surface["status"]==expected,"camera-common-scale-veto-or-quality-bypassed")
        require(surface["epoch"]==previous["T_B"]["epoch"]+(expected!="valid"),"camera-quality-epoch-does-not-reproduce")
    elif surface["status"]=="first-frame":
        require(previous is None or previous["T_B"]["status"]not in
            {"first-frame","valid","scale-ambiguous","insufficient-pixel-camera-evidence"},"first-frame-bypassed-previous-exposure")
        require(surface["epoch"]==(0 if previous is None else previous["T_B"]["epoch"]),"wrong-first-camera-epoch")
    else:
        require(surface["status"]!="valid"and surface["epoch"]==(1 if previous is None else previous["T_B"]["epoch"]+1),"wrong-hard-camera-reset")
    return True
