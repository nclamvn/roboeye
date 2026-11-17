#!/usr/bin/env python3
"""M3T static RGB-D/mocap reference audit. No detector, alerts or runtime range.

RGB/LK runs first with RGB alone. Registered depth and independently timestamped
mocap are reference-only, never a seed selector or a way to correct endpoints.
These are approximate sensor references, not exact pixel or physical truth.
"""
import argparse
from collections import Counter
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import sys
from time import perf_counter
from types import MappingProxyType

import cv2
import numpy as np

import assist_scene_motion_m3c as lk
import assist_scene_scale_approach as background
import assist_scene_pose_motion as geometry
from assist_scene_m3s_camera_audit import clean, canonical, require

POLICY=MappingProxyType(dict(method="static-sensor-reference-audit-not-motion-authority",pairs=48,
    maxSeconds=600,maxBytes=32*1024**2,maxSeeds=256,shape=[480,640],depthScale=5000.,
    maxDepthRgbSkewUs=20000,maxPoseSkewUs=5000,minIntervalUs=65000,maxIntervalUs=300000,
    minReferenceDepthM=.3,maxReferenceDepthM=6.,depthSensitivityMinM=.01,
    depthSensitivityQuadratic=.01,translationSensitivityM=.01,rotationSensitivityDeg=.10,
    sampleSensitivityPx=.5,poseNegativeYawDeg=1.,poseNegativeClockUs=40000,
    calibrationNegativeFxFactor=1.05,endpointNegativeOffsetPx=[10.,10.]))
PROFILES=MappingProxyType({"primary-fr3":((535.4,0.,320.1),(0.,539.2,247.6),(0.,0.,1.)),
    "documented-ros-default-sensitivity":((525.,0.,319.5),(0.,525.,239.5),(0.,0.,1.))})
PLAN_SHA256="cdf35cbc8c310bc99f5dfb9d2dba3fe5b44064533f01a4ee72b633f7040da02a"
DATA_CODE=("assist_scene_m3t_tum_import.py","fetch_assist_scene_m3t_tum.py")


def digest(path):return sha256(Path(path).read_bytes()).hexdigest()


def fingerprints():
    result={Path(m.__file__).name:digest(m.__file__) for m in
        (sys.modules[__name__],lk,background,geometry,sys.modules[clean.__module__])}
    result.update({name:digest(Path(__file__).parent/name)for name in DATA_CODE})
    return result


def pose_transform(sensor):
    """T_world_camera, TUM active quaternion qx,qy,qz,qw; no interpolation."""
    pose=sensor.get("pose",{})
    if pose.get("status")!="valid":return None
    stamp,sample=sensor.get("timestampUs"),pose.get("timestampUs")
    if type(stamp)is not int or type(sample)is not int or abs(stamp-sample)>5000:return None
    q=np.asarray(pose.get("quaternion"),dtype=float);t=np.asarray(pose.get("translation"),dtype=float)
    if q.shape!=(4,)or t.shape!=(3,)or not np.isfinite(q).all()or not np.isfinite(t).all():return None
    norm=np.linalg.norm(q)
    if abs(norm-1)>1e-3:return None
    x,y,z,w=q/norm
    r=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
        [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
        [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    result=np.eye(4);result[:3,:3]=r;result[:3,3]=t
    return result


def rgb_evidence(old,new):
    """Only RGB arrays enter this branch. No poses, depth or reference inputs."""
    require(old.dtype==new.dtype==np.uint8 and old.shape==new.shape==(480,640),"wrong-rgb-geometry")
    observed={};prior=sys.getprofile();directions=0
    def profile(frame,event,returned):
        nonlocal directions
        if event=="c_call"and returned is cv2.calcOpticalFlowPyrLK:directions+=1
        if event=="return"and frame.f_code is lk.correspondences.__code__:
            observed.update({k:deepcopy(frame.f_locals.get(k))for k in ("a","b","back","s","rev","keep")})
            observed["forwardAttempted"]="b"in frame.f_locals
            observed["reverseAttempted"]="back"in frame.f_locals
    try:
        sys.setprofile(profile)
        lk.correspondences(old,new,background.mask_for(old.shape,[]),256)
    finally:sys.setprofile(prior)
    seeds=np.asarray(observed.get("a")if observed.get("a")is not None else [],float).reshape(-1,2)
    forward=np.asarray(observed["b"],float).reshape(-1,2)if observed.get("b")is not None else np.full_like(seeds,np.nan)
    photo=[None]*len(seeds);correlations=[None]*len(seeds)
    keep=np.asarray(observed.get("keep"),bool).ravel()if observed.get("keep")is not None else np.zeros(len(seeds),bool)
    if np.any(keep):
        for i,value in zip(np.flatnonzero(keep),background._matching_patches(old,new,seeds[keep],forward[keep]),strict=True):
            photo[int(i)]=bool(value)
            pa=cv2.getRectSubPix(old,(7,7),tuple(map(float,seeds[i]))).astype(float)
            pb=cv2.getRectSubPix(new,(7,7),tuple(map(float,forward[i]))).astype(float)
            pa-=pa.mean();pb-=pb.mean();norm=np.linalg.norm(pa)*np.linalg.norm(pb)
            correlations[int(i)]=float(np.sum(pa*pb)/norm)if norm>0 else None
    cycle=None if observed.get("back")is None else np.linalg.norm(seeds-np.asarray(observed["back"]).reshape(-1,2),axis=1)
    return clean(dict(sourceSeeds=seeds,forwardEndpoints=forward,backwardEndpoints=observed.get("back"),
        forwardStatus=observed.get("s"),backwardStatus=observed.get("rev"),lkAccepted=keep,
        photometricDiagnostic=photo,photometricCorrelation=correlations,cyclePx=cycle,originalSeedCount=len(seeds),
        sourceGraySha256=sha256(old.tobytes()).hexdigest(),currentGraySha256=sha256(new.tobytes()).hexdigest(),
        calcOpticalFlowDirectionCalls=directions,
        referenceInputsSeen=False,motionAuthorized=False))


def frozen_camera_guard(old,new,source,current,index):
    """Actual unchanged primary guard. Explicit additional RGB-only LK cost."""
    op,np_=pose_transform(source["rgb"]),pose_transform(current["rgb"])
    result=dict(status="rgb-pose-unavailable",background=None,correspondenceCalls=0,lkDirectionCalls=0)
    if op is None or np_ is None:return result
    k=np.asarray(PROFILES["primary-fr3"])
    def meta(sensor,pose):return dict(timestampUs=sensor["timestampUs"],poseTimestampUs=sensor["pose"]["timestampUs"],intrinsics=k,cameraToWorld=pose)
    pose,info=geometry.pose_pair(meta(source["rgb"],op),meta(current["rgb"],np_),640,480)
    homography=None if pose is None else pose.homography
    if pose is None and info["status"]=="epipolar-baseline-too-small"and info["translationM"]<.025:
        homography=k@np_[:3,:3].T@op[:3,:3]@np.linalg.inv(k)
    if homography is None:return {**result,"status":info["status"],"pose":info}
    prior=sys.getprofile();directions=0;correspondences=0
    def profile(frame,event,returned):
        nonlocal directions,correspondences
        if event=="c_call"and returned is cv2.calcOpticalFlowPyrLK:directions+=1
        if event=="call"and frame.f_code is lk.correspondences.__code__:correspondences+=1
    try:
        sys.setprofile(profile);cv2.setRNGSeed(650500+index)
        valid,q=background._background(pose,homography,old,new,[],[])
    finally:sys.setprofile(prior)
    return dict(status="valid"if valid else "insufficient-background-agreement",pose=info,background=q,
        correspondenceCalls=correspondences,lkDirectionCalls=directions,
        modelMode="checked-near-rotation-fallback"if pose is None else pose.mode,
        actualResidualCriterionPx=1.3 if pose is None or pose.mode=="rotation"else min(1.8,.65*pose.floor_px))


def association_valid(frame):
    depth=frame.get("depth",{});rgb=frame.get("rgb",{});assoc=frame.get("association",{})
    return (depth.get("status")!="unavailable"and assoc.get("status")=="valid"
        and type(depth.get("timestampUs"))is int and type(rgb.get("timestampUs"))is int
        and abs(depth["timestampUs"]-rgb["timestampUs"])<=20000
        and assoc.get("deltaUs")==depth["timestampUs"]-rgb["timestampUs"])


def registered_depth_at_rgb(depth,frame,k):
    """Own depth pose -> world -> own RGB pose, nearest z-buffer, NO filling."""
    out=np.full((480,640),np.nan,dtype=float)
    samples=np.full((480,640,2),np.nan,dtype=float)
    original_points=np.full((480,640,3),np.nan,dtype=float)
    if not association_valid(frame):return out,"rgb-depth-association-unavailable",samples,original_points
    td,tr=pose_transform(frame["depth"]),pose_transform(frame["rgb"])
    if td is None or tr is None:return out,"depth-or-rgb-pose-unavailable",samples,original_points
    if depth is None:return out,"depth-image-unavailable",samples,original_points
    require(depth.shape==(480,640)and depth.dtype==np.uint16,"wrong-depth-Z-image")
    y,x=np.nonzero(depth);z=depth[y,x].astype(float)/5000.
    rays=np.column_stack((x,y,np.ones(len(x))))@np.linalg.inv(k).T
    points=rays*z[:,None];transform=np.linalg.inv(tr)@td
    moved=points@transform[:3,:3].T+transform[:3,3]
    projected=moved@k.T
    valid=np.isfinite(moved).all(axis=1)&(moved[:,2]>0)
    pixels=np.full((len(points),2),-1,int)
    pixels[valid]=np.floor(projected[valid,:2]/projected[valid,2:3]+.5).astype(int)
    valid&=(pixels[:,0]>=0)&(pixels[:,0]<640)&(pixels[:,1]>=0)&(pixels[:,1]<480)
    flat=np.full(480*640,np.inf);indices=pixels[valid,1]*640+pixels[valid,0]
    np.minimum.at(flat,indices,moved[valid,2])
    valid_ids=np.flatnonzero(valid);closest=moved[valid,2]==flat[indices]
    winners=np.full(480*640,len(points),dtype=int)
    np.minimum.at(winners,indices[closest],valid_ids[closest])
    occupied=np.flatnonzero(winners<len(points));win=winners[occupied]
    samples.reshape(-1,2)[occupied]=projected[win,:2]/projected[win,2:3]
    original_points.reshape(-1,3)[occupied]=points[win]
    out=flat.reshape(480,640);out[~np.isfinite(out)]=np.nan
    return out,"timestamp-aware-zbuffer-no-hole-filling",samples,original_points


def registration_sensitivity(points,frame,k):
    """Perturb only actual winning depth samples, never rerender/fill holes."""
    points=np.asarray(points,float).reshape(-1,3)
    td,tr=pose_transform(frame["depth"]),pose_transform(frame["rgb"])
    def mapped(d,r):
        t=np.linalg.inv(r)@d;q=points@t[:3,:3].T+t[:3,3];p=q@k.T
        return p[:,:2]/p[:,2:3],q[:,2]
    xy,z=mapped(td,tr);xy_radius=np.zeros(len(points));z_radius=np.zeros(len(points))
    for which in (0,1):
        for kind in ("translation","rotation"):
            for axis in range(3):
                dr=[];dz=[]
                for sign in (-1,1):
                    poses=[td.copy(),tr.copy()]
                    if kind=="translation":poses[which][axis,3]+=sign*.01
                    else:
                        angle=np.zeros(3);angle[axis]=sign*np.deg2rad(.10);rot,_=cv2.Rodrigues(angle)
                        poses[which][:3,:3]=poses[which][:3,:3]@rot
                    u,v=mapped(*poses);dr.append(np.linalg.norm(u-xy,axis=1));dz.append(np.abs(v-z))
                xy_radius+=np.max(dr,axis=0);z_radius+=np.max(dz,axis=0)
    return xy_radius,z_radius


def project(seeds,z,old_pose,new_pose,k):
    a=np.asarray(seeds,float).reshape(-1,2);z=np.asarray(z,float).reshape(-1)
    points=np.column_stack((a,np.ones(len(a))))@np.linalg.inv(k).T*z[:,None]
    transform=np.linalg.inv(new_pose)@old_pose
    current=points@transform[:3,:3].T+transform[:3,3];p=current@k.T
    xy=np.divide(p[:,:2],p[:,2:3],out=np.full((len(a),2),np.nan),where=p[:,2:3]>0)
    return xy,current[:,2]


def sensitivity(seeds,z,old_pose,new_pose,k):
    """Axiswise L1 finite-perturbation sensitivity, NOT a certified bound/CI.

    Conditions on the selected static surface. Does not cover wrong surface,
    occlusion timing, mocap calibration bias or nonlinear joint extremes.
    """
    base,base_z=project(seeds,z,old_pose,new_pose,k);radius=np.full(len(z),np.sqrt(2)*.5);zr=np.zeros(len(z))
    def add(variants):
        nonlocal radius,zr
        distances=[];depths=[]
        for a,depth,old,new in variants:
            p,q=project(a,depth,old,new,k);distances.append(np.linalg.norm(p-base,axis=1));depths.append(np.abs(q-base_z))
        radius+=np.max(distances,axis=0);zr+=np.max(depths,axis=0)
    dz=np.maximum(.01,.01*np.square(z))
    add([(seeds,z+s*dz,old_pose,new_pose)for s in (-1,1)])
    for axis in range(2):
        variants=[]
        for sign in (-1,1):
            a=np.asarray(seeds,float).copy();a[:,axis]+=sign*.5;variants.append((a,z,old_pose,new_pose))
        add(variants)
    for which in (0,1):
        for kind in ("translation","rotation"):
            for axis in range(3):
                variants=[]
                for sign in (-1,1):
                    poses=[old_pose.copy(),new_pose.copy()]
                    if kind=="translation":poses[which][axis,3]+=sign*.01
                    else:
                        angle=np.zeros(3);angle[axis]=sign*np.deg2rad(.10)
                        rotation,_=cv2.Rodrigues(angle);poses[which][:3,:3]=poses[which][:3,:3]@rotation
                    variants.append((seeds,z,*poses))
                add(variants)
    return radius,zr


def reference(seeds,source,current,old_depth,new_depth,k):
    """Reference branch has no RGB or LK endpoints. Keep ALL original seeds."""
    seeds=np.asarray(seeds,float).reshape(-1,2);n=len(seeds)
    old_pose,new_pose=pose_transform(source["rgb"]),pose_transform(current["rgb"])
    result=dict(originalSeedCount=n,expectedEndpoints=[None]*n,expectedDepth=[None]*n,
        sensitivityRadiusPx=[None]*n,sensitivityDepthM=[None]*n,status=["rgb-pose-unavailable"]*n,
        sourceSamplingOffsetPx=[None]*n,currentSamplingOffsetPx=[None]*n,
        sourceRegistrationSensitivity=[None]*n,currentRegistrationSensitivity=[None]*n,
        samplingQuantizationPx=.5,sensitivityIsCertifiedConfidence=False,motionAuthorized=False)
    if old_pose is None or new_pose is None:return result
    oldmap,oldreason,old_samples,old_points=registered_depth_at_rgb(old_depth,source,k)
    newmap,newreason,new_samples,new_points=registered_depth_at_rgb(new_depth,current,k)
    result.update(sourceDepthReprojection=oldreason,currentDepthReprojection=newreason)
    pixels=np.floor(seeds+.5).astype(int)
    inside=(pixels[:,0]>=0)&(pixels[:,0]<640)&(pixels[:,1]>=0)&(pixels[:,1]<480)
    z=np.full(n,np.nan);z[inside]=oldmap[pixels[inside,1],pixels[inside,0]]
    supported=np.isfinite(z)&(z>=.3)&(z<=6.)
    status=np.full(n,"source-depth-unavailable",dtype=object)
    status[~inside]="source-outside-image"
    status[np.isfinite(z)&~supported]="source-depth-outside-evaluation-range"
    selected=np.flatnonzero(supported)
    if len(selected):
        expected,pz=project(seeds[selected],z[selected],old_pose,new_pose,k)
        radius,zr=sensitivity(seeds[selected],z[selected],old_pose,new_pose,k)
        reg_xy,reg_z=registration_sensitivity(old_points[pixels[selected,1],pixels[selected,0]],source,k)
        plus,pzplus=project(seeds[selected],z[selected]+reg_z,old_pose,new_pose,k)
        minus,pzminus=project(seeds[selected],z[selected]-reg_z,old_pose,new_pose,k)
        radius+=np.maximum(np.linalg.norm(plus-expected,axis=1),np.linalg.norm(minus-expected,axis=1))
        radius+=reg_xy*np.maximum(1.,np.abs(z[selected]/pz))
        zr+=np.maximum(np.abs(pzplus-pz),np.abs(pzminus-pz))
        current_reg_xy=np.full(len(selected),np.nan);current_reg_z=np.full(len(selected),np.nan)
        finite_expected=np.isfinite(expected).all(axis=1)&(pz>0)
        cp=np.full((len(selected),2),-1,int);cp[finite_expected]=np.floor(expected[finite_expected]+.5).astype(int)
        possible=finite_expected&(cp[:,0]>=0)&(cp[:,0]<640)&(cp[:,1]>=0)&(cp[:,1]<480)
        candidates=np.flatnonzero(possible)
        if len(candidates):
            candidates=candidates[np.isfinite(newmap[cp[candidates,1],cp[candidates,0]])]
        if len(candidates):
            rx,rz=registration_sensitivity(new_points[cp[candidates,1],cp[candidates,0]],current,k)
            current_reg_xy[candidates]=rx;current_reg_z[candidates]=rz
        for j,index in enumerate(selected):
            source_sample=old_samples[pixels[index,1],pixels[index,0]]
            source_offset=seeds[index]-source_sample
            result["sourceSamplingOffsetPx"][int(index)]=clean(source_offset)
            result["sourceRegistrationSensitivity"][int(index)]=dict(pixelRadius=clean(reg_xy[j]),depthRadiusM=clean(reg_z[j]))
            radius[j]+=np.linalg.norm(source_offset)
            result["expectedEndpoints"][int(index)]=clean(expected[j]);result["expectedDepth"][int(index)]=clean(pz[j])
            result["sensitivityRadiusPx"][int(index)]=clean(radius[j]);result["sensitivityDepthM"][int(index)]=clean(zr[j])
            sx,sy=pixels[index];source_local=oldmap[max(0,sy-1):min(480,sy+2),max(0,sx-1):min(640,sx+2)]
            source_finite=source_local[np.isfinite(source_local)]
            if len(source_finite)<9 or np.ptp(source_finite)>2*max(.01,.01*z[index]**2):
                status[index]="source-depth-edge-or-hole-reference-unknown";continue
            if not np.isfinite(expected[j]).all()or pz[j]<=0:status[index]="behind-current-camera";continue
            u,v=np.floor(expected[j]+.5).astype(int)
            if not(0<=u<640 and 0<=v<480):status[index]="outside-current-image";continue
            actual=newmap[v,u]
            if not np.isfinite(actual):status[index]="current-depth-unavailable";continue
            result["currentSamplingOffsetPx"][int(index)]=clean(expected[j]-new_samples[v,u])
            result["currentRegistrationSensitivity"][int(index)]=dict(pixelRadius=clean(current_reg_xy[j]),depthRadiusM=clean(current_reg_z[j]))
            local=newmap[max(0,v-1):min(480,v+2),max(0,u-1):min(640,u+2)]
            finite=local[np.isfinite(local)]
            current_dz=max(.01,.01*actual**2)
            if len(finite)<9 or np.ptp(finite)>2*current_dz:status[index]="depth-edge-or-hole-visibility-unknown";continue
            uncertainty=current_dz+zr[j]+current_reg_z[j]
            if actual<pz[j]-uncertainty:status[index]="occluded-by-nearer-depth"
            elif abs(actual-pz[j])<=uncertainty:status[index]="approximately-visible-static-reference"
            else:status[index]="depth-inconsistent-visibility-unknown"
    result["status"]=status.tolist()
    return clean(result)


def percentiles(values):
    a=np.asarray([v for v in values if v is not None and np.isfinite(v)],float)
    return dict(count=len(a),medianPx=float(np.median(a))if len(a)else None,
        p90Px=float(np.percentile(a,90))if len(a)else None,p95Px=float(np.percentile(a,95))if len(a)else None,
        within1Px=int(np.count_nonzero(a<=1)),within2Px=int(np.count_nonzero(a<=2)),within5Px=int(np.count_nonzero(a<=5)))


def compare(rgb,ref,source,current,k):
    n=rgb["originalSeedCount"];require(n==ref["originalSeedCount"],"reference-changed-original-seed-denominator")
    a=np.asarray(rgb["sourceSeeds"],float).reshape(-1,2);forward=np.asarray(rgb["forwardEndpoints"],float).reshape(-1,2)
    expected=np.array([p if p is not None else [np.nan,np.nan]for p in ref["expectedEndpoints"]],float).reshape(-1,2)
    finite=np.isfinite(forward).all(axis=1)&np.isfinite(expected).all(axis=1)
    epe=np.full(n,np.nan);epe[finite]=np.linalg.norm(forward[finite]-expected[finite],axis=1)
    kept=np.asarray(rgb["lkAccepted"],bool);visible=np.array([s=="approximately-visible-static-reference"for s in ref["status"]])
    radius=np.array([r if r is not None else np.nan for r in ref["sensitivityRadiusPx"]])
    def pose_meta(sensor):
        pose=pose_transform(sensor)
        return dict(timestampUs=sensor["timestampUs"],poseTimestampUs=sensor.get("pose",{}).get("timestampUs"),
            cameraToWorld=None if pose is None else pose.tolist(),intrinsics=k.tolist())
    old,new=pose_meta(source["rgb"]),pose_meta(current["rgb"])
    def errors(first,last,calibration):
        first={**first,"intrinsics":calibration.tolist()};last={**last,"intrinsics":calibration.tolist()}
        if any(type(s.get("poseTimestampUs"))is not int or abs(s["poseTimestampUs"]-s["timestampUs"])>5000 for s in (first,last)):
            return dict(status="reference-pose-skew-exceeds5ms",residualPx=[None]*n,usable=[False]*n)
        pair,info=geometry.pose_pair(first,last,640,480)
        if pair is None:return dict(status=info["status"],residualPx=[None]*n,usable=[False]*n)
        values,usable=geometry.point_residuals(pair,a,expected)
        return dict(status=info["status"],residualPx=clean(values),usable=usable.tolist(),pose=info)
    baseline=errors(old,new,k)
    actual_endpoint_pair,actual_pose=geometry.pose_pair(old,new,640,480)
    actual_residual,actual_usable=geometry.point_residuals(actual_endpoint_pair,a,forward)
    yaw=deepcopy(new)
    if yaw["cameraToWorld"]is not None:
        t=np.asarray(yaw["cameraToWorld"]);r,_=cv2.Rodrigues(np.array([0.,np.deg2rad(1.),0.]));t[:3,:3]=t[:3,:3]@r;yaw["cameraToWorld"]=t.tolist()
    wrong_clock=deepcopy(new)
    if type(wrong_clock["poseTimestampUs"])is int:wrong_clock["poseTimestampUs"]+=40000
    wrong_k=k.copy();wrong_k[0,0]*=1.05
    offset=np.linalg.norm(forward[finite]+np.array([10.,10.])-expected[finite],axis=1)
    return clean(dict(allSeedCount=n,statusCounts=dict(Counter(ref["status"])),finiteEndpointAndReference=int(np.count_nonzero(finite)),
        visibleReferenceCount=int(np.count_nonzero(visible)),visibleReferenceAcceptedLkCount=int(np.count_nonzero(visible&kept&finite)),
        allApproximateReferenceEpePx=epe,visibleAcceptedEpe=percentiles(epe[visible&kept&finite]),
        visibleAllForwardEpe=percentiles(epe[visible&finite]),
        visibleAcceptedOutsideSensitivity=int(np.count_nonzero(visible&kept&finite&(epe>radius))),
        sensitivityInterpretation="Axiswise perturbation sensitivity only, not a certified CI or definitive bad-LK label.",
        projectionGeometrySelfConsistency={**baseline,"byConstruction":True,"independentCameraValidation":False},poseVersusActualLk=dict(pose=actual_pose,
            residualPx=clean(actual_residual),usable=clean(actual_usable)),negativeControls=dict(yawPlus1Deg=errors(old,yaw,k),
            poseClockPlus40Ms=errors(old,wrong_clock,k),fxTimes105=errors(old,new,wrong_k),
            shiftedLkEndpoints=percentiles(offset)),motionAuthorized=False))


def run(manifest_path,expected_manifest_sha256):
    tick=perf_counter();before=fingerprints();progress=dict(completedPairs=0,sequences=[],phase="manifest-binding")
    try:
        require(digest(manifest_path)==expected_manifest_sha256,"unapproved-manifest-hash")
        progress["expectedManifestSha256"]=expected_manifest_sha256
        value=_run(Path(manifest_path),tick,progress)
        after=fingerprints();require(before==after,"source-code-changed-during-audit")
        value.update(codeSha256=before,codeAfterSha256=after)
        require(len(json.dumps(value,separators=(",",":")).encode())<=POLICY["maxBytes"],"receipt-byte-budget")
        return value
    except Exception as error:
        error.m3t_progress=clean(dict(schemaVersion=1,study="M3T-static-controls-incomplete",complete=False,
            **progress,codeSha256=before,codeAfterSha256=fingerprints(),policy=dict(POLICY),
            elapsedMs=1000*(perf_counter()-tick),errorType=type(error).__name__,errorMessage=str(error),
            learnedModelCalls=0,motionAuthorized=False,events=[]))
        raise


def _run(path,tick,progress):
    cv2.setNumThreads(1);manifest=json.loads(path.read_text());root=(path.parent/manifest["assetRoot"]).resolve()
    require(manifest.get("schemaVersion")==1 and manifest.get("study")=="M3T-TUM-static-controls"
        and manifest.get("planSha256")==PLAN_SHA256,"unapproved-manifest-schema-or-plan")
    require(manifest.get("codeSha256")=={name:digest(Path(__file__).parent/name)for name in DATA_CODE},"changed-importer-or-fetch-source")
    require(manifest["imageShape"]==[480,640]and manifest["depthScale"]==5000,"wrong-source-geometry-scale")
    require(manifest["intrinsics"]==[list(r)for r in PROFILES["primary-fr3"]],"wrong-primary-calibration")
    require(sum(len(s["pairs"])for s in manifest["sequences"])==48,"expected48-fixed-pairs")
    progress["manifestSha256"]=digest(path)
    def load(sensor,mode):
        if sensor.get("status")=="unavailable":return None
        asset=(root/sensor["path"]).resolve();require(asset.is_relative_to(root),"asset-outside-root")
        require(digest(asset)==sensor["sha256"],"forged-source-image")
        image=cv2.imread(str(asset),mode|cv2.IMREAD_IGNORE_ORIENTATION);require(image is not None,"source-image-decode")
        return image
    for sequence in manifest["sequences"]:
        frames={f["id"]:f for f in sequence["frames"]};require(len(frames)==len(sequence["frames"]),"duplicate-frame-id")
        out=dict(id=sequence["id"],pairs=[]);progress["sequences"].append(out)
        for index,pair in enumerate(sequence["pairs"]):
            require(perf_counter()-tick<=600,"time-budget-exceeded")
            source,current=frames[pair["startId"]],frames[pair["endId"]]
            if any(f.get("rgb",{}).get("status")=="unavailable"or not f.get("rgb",{}).get("path")or type(f.get("rgb",{}).get("timestampUs"))is not int for f in (source,current)):
                out["pairs"].append(dict(id=pair["id"],startId=pair["startId"],endId=pair["endId"],
                    sourceMetadata=source,currentMetadata=current,rgbEvidence=None,
                    unavailableReason="fixed-pair-RGB-unavailable-no-source-seeds",frozenPrimaryCameraGuard=dict(status="rgb-unavailable",background=None,correspondenceCalls=0,lkDirectionCalls=0),
                    profiles={name:dict(reference=dict(originalSeedCount=0,status=[],unavailableReason="rgb-unavailable"),
                        comparison=dict(allSeedCount=0,unavailableReason="rgb-unavailable",motionAuthorized=False))for name in PROFILES}))
                progress["completedPairs"]+=1;continue
            dt=current["rgb"]["timestampUs"]-source["rgb"]["timestampUs"];require(65000<=dt<=300000,"fixed-pair-interval")
            progress.update(sequenceId=sequence["id"],pairId=pair["id"],phase="rgb-only-LK")
            old,new=load(source["rgb"],cv2.IMREAD_GRAYSCALE),load(current["rgb"],cv2.IMREAD_GRAYSCALE)
            rgb=rgb_evidence(old,new);rgb_hash=canonical(rgb)
            guard=frozen_camera_guard(old,new,source,current,index)
            progress["phase"]="independent-depth-pose-reference"
            old_depth,new_depth=load(source["depth"],cv2.IMREAD_UNCHANGED),load(current["depth"],cv2.IMREAD_UNCHANGED)
            record=dict(id=pair["id"],startId=pair["startId"],endId=pair["endId"],intervalUs=dt,
                sourceMetadata=source,currentMetadata=current,rgbEvidence=rgb,rgbEvidenceSha256=rgb_hash,
                frozenPrimaryCameraGuard=guard,profiles={})
            for name,intrinsics in PROFILES.items():
                k=np.asarray(intrinsics);ref=reference(rgb["sourceSeeds"],source,current,old_depth,new_depth,k)
                record["profiles"][name]=dict(reference=ref,comparison=compare(rgb,ref,source,current,k))
                require(canonical(rgb)==rgb_hash,"oracle-leaked-into-RGB-evidence")
            out["pairs"].append(record);progress["completedPairs"]+=1
    require(progress["completedPairs"]==48 and perf_counter()-tick<=600,"incomplete-or-over-budget")
    require(digest(path)==progress["expectedManifestSha256"],"approved-manifest-changed-during-audit")
    rgb_calls=sum(p["rgbEvidence"]is not None for s in progress["sequences"]for p in s["pairs"])
    guard_calls=sum(p["frozenPrimaryCameraGuard"]["background"]is not None for s in progress["sequences"]for p in s["pairs"])
    return clean(dict(schemaVersion=1,study="M3T-static-sensor-controls",complete=True,manifestSha256=digest(path),
        policy=dict(POLICY),calibrationProfiles=dict(PROFILES),sequences=progress["sequences"],pairs=48,
        learnedModelCalls=0,expectedManifestSha256=progress["expectedManifestSha256"],actualRgbLkPairs=rgb_calls,actualReferenceProfileEvaluations=2*rgb_calls,
        actualFrozenCameraGuardCalls=guard_calls,actualCorrespondenceCalls=rgb_calls+guard_calls,
        standaloneLkDirectionCalls=sum(p["rgbEvidence"]["calcOpticalFlowDirectionCalls"]for s in progress["sequences"]for p in s["pairs"]if p["rgbEvidence"]is not None),
        guardLkDirectionCalls=sum(p["frozenPrimaryCameraGuard"]["lkDirectionCalls"]for s in progress["sequences"]for p in s["pairs"]),
        guardRepeatsRgbOnlyLk=True,
        actualDepthReprojections=sum(r["reference"].get(k)=="timestamp-aware-zbuffer-no-hole-filling"
            for s in progress["sequences"]for p in s["pairs"]for r in p["profiles"].values()
            for k in ("sourceDepthReprojection","currentDepthReprojection")),
        elapsedMs=1000*(perf_counter()-tick),software=dict(opencv=cv2.__version__,opencvThreads=cv2.getNumThreads(),numpy=np.__version__,python=sys.version),
        motionAuthorized=False,events=[],limits=["Approximate registered-depth plus mocap sensor-derived references, not exact pixel truth.",
            "No interpolation, hole filling, GT-driven seed/endpoint selection, camera-model fitting or runtime changes.",
            "Two fixed calibration profiles are reported separately; no best-profile selection or pooled quality counts.",
            "Depth RGB association and nearest poses retain timing offsets; sensitivity is conditional and does not cover all timing/occlusion effects.",
            "Projection epipolar self-consistency uses the same mocap used to construct reference endpoints: agreement is by construction, not independent camera validation.",
            "Known yaw/clock/calibration/endpoint corruptions are controlled mathematical falsifications, not natural bad-camera alarm accuracy.",
            "No object approach/false-alarm/miss quality certification, no runtime metric range, no iPhone evidence."]))


if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    incomplete=args.output.with_name(args.output.stem+'-incomplete'+args.output.suffix)
    require(all(not f.exists()and not f.is_symlink()for f in (args.output,incomplete)),"new-output-path-required")
    try:value=run(args.manifest,args.manifest_sha256)
    except Exception as error:
        value=getattr(error,'m3t_progress',dict(complete=False,errorType=type(error).__name__,learnedModelCalls=0))
        payload=json.dumps(value,separators=(",",":"),allow_nan=False);require(len(payload.encode())<=32*1024**2,"prefix-byte-budget")
        with incomplete.open('x')as stream:stream.write(payload)
        raise
    with args.output.open('x')as stream:json.dump(value,stream,separators=(",",":"),allow_nan=False)
