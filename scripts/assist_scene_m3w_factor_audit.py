"""M3W evidence-only factor controls. RGB observation precedes oracle access.

The scene oracle below is independent of the renderer: it solves material-ray
intersections and projects world points using the exported camera transforms.
Authored exact controls, conditional HPatches homographies and cached traffic
are different evidence populations. Nothing here emits a product warning.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from hashlib import sha256
import json
import math
from pathlib import Path
import platform
import shutil
import sys
from time import perf_counter

import cv2
import numpy as np

import assist_scene_m3u_pixel_camera as camera
import assist_scene_scale_approach as frozen

HERE = Path(__file__).resolve().parent
POLICY = dict(schemaVersion=1, method="M3W-independent-factor-audit", authoredPairs=12,
    hpatchesPairs=2, maxSeeds=256, endpointCapPx=1.3, wrongEndpointPx=8.,
    clockOffsetsUs=[-40000,-10000,10000,40000], maxObserveSeconds=180.,
    maxEvaluateSeconds=120., maxReceiptBytes=32*1024*1024, maxLkDirections=32,
    observeReadsGold=False, runtimeAuthority=False, learnedModelCalls=0)
FROZEN = [HERE / n for n in ("assist_scene_m3u_pixel_camera.py", "assist_scene_scale_approach.py",
    "assist_scene_pose_motion.py", "assist_scene_m3s_camera_audit.py", "assist_scene_motion_m3c.py", "assist_scene_motion.py")]


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def clean(value):
    if isinstance(value, np.ndarray): return clean(value.tolist())
    if isinstance(value, np.generic): return clean(value.item())
    if isinstance(value, float) and not math.isfinite(value): return None
    if isinstance(value, dict): return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [clean(v) for v in value]
    return value


def digest(path):
    return sha256(Path(path).read_bytes()).hexdigest()


def code_hashes():
    return {str(p.name): digest(p) for p in [Path(__file__), *FROZEN]}


def read_sealed(path, expected):
    require(isinstance(expected, str) and len(expected)==64 and all(c in "0123456789abcdef" for c in expected), "invalid-expected-sha")
    data=Path(path).read_bytes()
    require(sha256(data).hexdigest()==expected, "source-seal-mismatch")
    return json.loads(data)


def write_new(path, value):
    data=(json.dumps(clean(value), ensure_ascii=False, indent=2, allow_nan=False)+"\n").encode()
    require(len(data)<=POLICY["maxReceiptBytes"], "receipt-size-budget")
    path=Path(path);path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream: stream.write(data)


def new_output_preflight(path):
    for candidate in (Path(path),Path(str(path)+"-incomplete.json")):
        require(not candidate.exists() and not candidate.is_symlink(),"output-or-failure-prefix-already-exists")
    parent=Path(path).resolve().parent
    while not parent.exists():parent=parent.parent
    require(shutil.disk_usage(parent).free>=10*1024**3,"disk-floor10GiB")


def image_asset(root, item):
    path=(root/item["path"]).resolve()
    require(Path(item["path"]).is_absolute() or path.is_relative_to(root.resolve()), "asset-outside-root")
    require(digest(path)==item["sha256"], "image-sha-mismatch")
    image=cv2.imread(str(path), cv2.IMREAD_GRAYSCALE | cv2.IMREAD_IGNORE_ORIENTATION)
    require(image is not None and image.dtype==np.uint8 and image.ndim==2, "invalid-image")
    return image


def patch_metrics(old, new, a, b):
    """Same 7x7 zero-mean numeric NCC as frozen veto; not another match."""
    a=np.asarray(a,float).reshape(-1,2);b=np.asarray(b,float).reshape(-1,2)
    result=[];h,w=old.shape;hn,wn=new.shape
    for p,q in zip(a,b,strict=True):
        interior=bool(np.isfinite(p).all() and np.isfinite(q).all() and
            3<=p[0]<=w-4 and 3<=p[1]<=h-4 and 3<=q[0]<=wn-4 and 3<=q[1]<=hn-4)
        row=dict(interior=interior, correlation=None, normProduct=None,
            dotProduct=None,sourceCenteredNorm=None, targetCenteredNorm=None, supported=False)
        if interior:
            pa=cv2.getRectSubPix(old,(7,7),tuple(map(float,p))).astype(np.float32)
            pb=cv2.getRectSubPix(new,(7,7),tuple(map(float,q))).astype(np.float32)
            pa-=pa.mean();pb-=pb.mean();na=float(np.linalg.norm(pa));nb=float(np.linalg.norm(pb))
            norm=float(np.linalg.norm(pa)*np.linalg.norm(pb));dot=float(np.sum(pa*pb));corr=dot/norm if norm else None
            row.update(correlation=corr,normProduct=norm,dotProduct=dot,sourceCenteredNorm=na,targetCenteredNorm=nb,
                supported=bool(norm>=49*4**2 and dot>=norm*frozen.POLICY["minPatchCorrelation"]))
        result.append(row)
    return clean(result)


def observe_pair(old,new):
    # Frozen RGB-only correspondence function, instrumented without changing its
    # arguments/arithmetic. This wrapper additionally retains actual calls even
    # if the C function throws before the normal return capture.
    locals_seen={};prior=sys.getprofile();directions=0;target_code=getattr(frozen.correspondences,"__code__",None)
    def profile(frame,event,value):
        nonlocal directions
        if event=="c_call" and value is cv2.calcOpticalFlowPyrLK:directions+=1
        if event=="return" and frame.f_code is target_code:
            locals_seen.update({key:deepcopy(frame.f_locals.get(key))for key in ("a","b","back","s","rev","keep")})
    try:
        sys.setprofile(profile)
        frozen.correspondences(old,new,frozen.mask_for(old.shape,()),256)
    except Exception as error:
        error.m3w_lk_directions=directions
        raise
    finally:sys.setprofile(prior)
    try:return finish_observation(old,new,locals_seen,directions)
    except Exception as error:
        error.m3w_lk_directions=directions
        raise


def finish_observation(old,new,locals_seen,directions):
    a=np.asarray(locals_seen.get("a")if locals_seen.get("a")is not None else [],float).reshape(-1,2)
    n=len(a);b=np.asarray(locals_seen["b"],float).reshape(-1,2)if locals_seen.get("b")is not None else np.full_like(a,np.nan)
    keep=np.asarray(locals_seen["keep"],bool).ravel()if locals_seen.get("keep")is not None else np.zeros(n,bool)
    photo=np.zeros(n,bool);selected=np.flatnonzero(keep)
    if len(selected):photo[selected]=frozen._matching_patches(old,new,a[selected],b[selected])
    controls=clean(dict(sourceSeeds=a,endpoints=b,backwardEndpoints=locals_seen.get("back"),forwardStatus=locals_seen.get("s"),
        backwardStatus=locals_seen.get("rev"),lkAccepted=keep,photometric=photo,outsideCurrentForeground=keep,
        originalSeedCount=n,lkDirectionCalls=directions,sourceOnly=True,
        sourceGraySha256=sha256(old.tobytes()).hexdigest(),currentGraySha256=sha256(new.tobytes()).hexdigest(),
        sourceMaskSha256=sha256(frozen.mask_for(old.shape,()).tobytes()).hexdigest(),
        currentMaskSha256=sha256(frozen.mask_for(new.shape,()).tobytes()).hexdigest()))
    n=controls["originalSeedCount"]
    a=np.asarray(controls["sourceSeeds"],float).reshape(-1,2)
    b=np.asarray(controls["endpoints"],float).reshape(-1,2)
    raw=controls["backwardEndpoints"]
    back=np.asarray(raw,float).reshape(-1,2) if raw is not None else np.full_like(a,np.nan)
    controls["cyclePx"]=clean(np.linalg.norm(a-back,axis=1))
    controls["patchMetrics"]=patch_metrics(old,new,a,b)
    keep=np.asarray(controls["lkAccepted"],bool)
    expected=keep&np.array([p["supported"] for p in controls["patchMetrics"]],bool)
    require(expected.tolist()==controls["photometric"], "frozen-photometry-mismatch")
    require(n==len(back)==len(b), "dropped-source-seeds")
    return controls


def validate_rgb_manifest(manifest):
    require(manifest.get("schemaVersion")==1 and manifest.get("study")=="M3W-RGB-only-input", "not-rgb-only-input")
    allowed={"schemaVersion","study","datasetId","assetRoot","controlsManifestSha256","imageShape","pairs","authority","policy","codeSha256"}
    require(set(manifest)<=allowed,"unexpected-rgb-top-field")
    pairs=manifest.get("pairs",[])
    require(len(pairs)==14 and len({p["id"] for p in pairs})==14,"wrong-rgb-pair-denominator")
    expected_ids=[f"m3w-{i:02d}"for i in range(12)]+["i_londonbridge","v_abstract"]
    require([p["id"]for p in pairs]==expected_ids,"changed-fixed-pair-identities")
    require(manifest.get("datasetId")=="m3w-fixed-v1" and manifest.get("imageShape")==[480,640],"changed-RGB-dataset")
    for i,p in enumerate(pairs):
        require(set(p)<={"id","split","kind","source","target","imageShape"}, "oracle-field-in-rgb-pair")
        for key in ("source","target"):
            require(set(p[key])<={"path","sha256","bytes","timestampUs"}, "oracle-field-in-rgb-exposure")
        require(p.get("kind","authored")==("authored"if i<12 else "hpatches") and
            p["split"]==("analysis"if i<6 else "holdout"if i<12 else "external-planar-reference"),"changed-RGB-pair-stratum")
    require(sum(p.get("kind","authored")=="authored" for p in pairs)==12,"wrong-authored-denominator")
    return pairs


def validate_controls(controls,shape):
    """Replay retained statuses/cycles/NCC thresholds, no RGB or oracle read."""
    n=controls["originalSeedCount"];h,w=shape
    require(type(n)is int and 0<=n<=256,"invalid-original-seed-count")
    require(all(len(controls[k])==n for k in ("sourceSeeds","endpoints","lkAccepted","photometric",
        "outsideCurrentForeground","cyclePx","patchMetrics")),"dropped-observation-denominator")
    a=np.asarray(controls["sourceSeeds"],float).reshape(-1,2);b=np.asarray(controls["endpoints"],float).reshape(-1,2)
    require(np.isfinite(a).all()and np.all((a[:,0]>=0)&(a[:,0]<w)&(a[:,1]>=0)&(a[:,1]<h)),"invalid-original-source-seeds")
    expected=np.zeros(n,bool);cycles=np.full(n,np.nan)
    if controls["backwardEndpoints"]is not None:
        back=np.asarray(controls["backwardEndpoints"],float).reshape(-1,2)
        require(len(back)==n,"dropped-backward-endpoints");cycles=np.linalg.norm(a-back,axis=1)
    if all(controls[key]is not None for key in ("forwardStatus","backwardStatus","backwardEndpoints")):
        forward=np.asarray(controls["forwardStatus"]).ravel();reverse=np.asarray(controls["backwardStatus"]).ravel()
        require(len(forward)==len(reverse)==n,"dropped-status-denominator")
        expected=(forward==1)&(reverse==1)&np.isfinite(b).all(axis=1)&(cycles<=1.3)
        expected&=(b[:,0]>=0)&(b[:,0]<w-1)&(b[:,1]>=0)&(b[:,1]<h-1)
    require(expected.tolist()==controls["lkAccepted"]==controls["outsideCurrentForeground"],"raw-LK-failure-promoted")
    require(np.allclose(np.asarray(controls["cyclePx"],float),cycles,equal_nan=True,rtol=0,atol=1e-12),"cycle-not-bound-to-backflow")
    photo=[]
    for i,metric in enumerate(controls["patchMetrics"]):
        supported=bool(metric["interior"]and metric["normProduct"]is not None and metric["dotProduct"]is not None
            and metric["normProduct"]>=49*4**2 and metric["dotProduct"]>=metric["normProduct"]*.70)
        require(supported==metric["supported"],"NCC-numeric-proof-mismatch")
        photo.append(bool(expected[i]and supported))
    require(photo==controls["photometric"],"NCC-veto-promoted")
    require(type(controls["lkDirectionCalls"])is int and controls["lkDirectionCalls"]in (0,1,2),"invalid-observation-call-count")
    return True


def observe(path, expected, output):
    new_output_preflight(output)
    tick=perf_counter();initial=code_hashes();progress=dict(schemaVersion=1,study="M3W-RGB-observations",
        policy=POLICY,inputSha256=expected,codeSha256=initial,pairs=[],goldFileOpens=0,
        learnedModelCalls=0,actualLkDirections=0,complete=False)
    try:
        manifest=read_sealed(path,expected);pairs=validate_rgb_manifest(manifest)
        root=(Path(path).parent/manifest.get("assetRoot",".")).resolve()
        cv2.setNumThreads(1)
        for p in pairs:
            require(perf_counter()-tick<=POLICY["maxObserveSeconds"],"observe-time-budget")
            old,new=(image_asset(root,p[k]) for k in ("source","target"))
            require(old.shape==new.shape,"different-image-shapes")
            if p.get("kind","authored")=="authored": require(old.shape==(480,640),"wrong-authored-shape")
            controls=observe_pair(old,new)
            progress["actualLkDirections"]+=controls["lkDirectionCalls"]
            validate_controls(controls,old.shape)
            require(progress["actualLkDirections"]<=POLICY["maxLkDirections"],"LK-call-budget")
            progress["pairs"].append({**p,"imageShape":list(old.shape),"controls":controls})
        require(digest(path)==expected and code_hashes()==initial,"observation-source-drift")
        require(perf_counter()-tick<=POLICY["maxObserveSeconds"],"observe-time-budget-final")
        progress.update(complete=True,elapsedMs=1000*(perf_counter()-tick),
            controlsManifestSha256=manifest["controlsManifestSha256"],
            software=dict(opencv=cv2.__version__,opencvThreadsRequested=1,opencvThreadsReported=cv2.getNumThreads(),
                numpy=np.__version__,python=platform.python_version()),
            truthAccess="No combined scene, camera, H, material or visibility file was opened.")
        write_new(output,progress);return progress
    except Exception as error:
        progress["actualLkDirections"]+=getattr(error,"m3w_lk_directions",0)
        progress.update(elapsedMs=1000*(perf_counter()-tick),errorType=type(error).__name__,
            error=str(error),failurePhase="RGB-observation",codeSha256After=code_hashes())
        write_new(str(output)+"-incomplete.json",progress);raise


def transform_pose(pose):
    pose=np.asarray(pose,float)
    require(pose.shape==(4,4) and np.isfinite(pose).all() and np.allclose(pose[3],[0,0,0,1]),"invalid-SE3")
    require(np.allclose(pose[:3,:3].T@pose[:3,:3],np.eye(3),atol=1e-9) and
        abs(np.linalg.det(pose[:3,:3])-1)<1e-9,"invalid-camera-rotation")
    return pose


def material_rays(points,K,pose,planes):
    """Independent analytic source ray -> nearest material plane, no renderer import."""
    points=np.asarray(points,float).reshape(-1,2);K=np.asarray(K,float);pose=transform_pose(pose)
    require(K.shape==(3,3) and np.isfinite(K).all() and abs(np.linalg.det(K))>1e-9,"invalid-K")
    rays=np.linalg.solve(K,np.column_stack((points,np.ones(len(points)))).T).T@pose[:3,:3].T
    center=pose[:3,3];best=np.full(len(points),np.inf);ids=np.full(len(points),-1,int)
    world=np.full((len(points),3),np.nan)
    for j,plane in enumerate(planes):
        with np.errstate(divide="ignore",invalid="ignore"):
            lam=(float(plane["z"])-center[2])/rays[:,2]
        xyz=center+lam[:,None]*rays
        ok=np.isfinite(lam)&(lam>0)&(lam<best)
        if plane["boundsXY"] is not None:
            xmin,ymin,xmax,ymax=plane["boundsXY"]
            ok&=(xyz[:,0]>=xmin)&(xyz[:,0]<=xmax)&(xyz[:,1]>=ymin)&(xyz[:,1]<=ymax)
        best[ok]=lam[ok];ids[ok]=j;world[ok]=xyz[ok]
    return world,ids


def project_material(world,K,pose):
    """World material -> camera -> image. Does not solve a ray or use RGB."""
    pose=transform_pose(pose);world=np.asarray(world,float).reshape(-1,3)
    xyz=(world-pose[:3,3])@pose[:3,:3]
    hom=xyz@np.asarray(K,float).T
    with np.errstate(divide="ignore",invalid="ignore"):
        uv=hom[:,:2]/hom[:,2,None]
    return uv,xyz[:,2]


def trajectory_pose(trajectory,timestamp_us):
    """Independent closed-form SE3, not imported from controls renderer."""
    u=(timestamp_us-1000000)/1e6
    pose=np.eye(4)
    if trajectory["kind"]=="world-polynomial-euler":
        poly=lambda coeff:sum(float(v)*u**j for j,v in enumerate(coeff))
        pose[:3,3]=[poly(c)for c in trajectory["center"]]
        yaw,pitch,roll=[poly(c)for c in trajectory["angles"]]
        cy,sy=math.cos(yaw),math.sin(yaw);cp,sp=math.cos(pitch),math.sin(pitch);cr,sr=math.cos(roll),math.sin(roll)
        pose[:3,:3]=np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]])@np.array([[1,0,0],[0,cp,-sp],[0,sp,cp]])@np.array([[cr,-sr,0],[sr,cr,0],[0,0,1]])
    elif trajectory["kind"]=="constant-body-twist":
        w=np.asarray(trajectory["bodyAngular"],float)*u;v=np.asarray(trajectory["bodyLinear"],float)*u
        x,y,z=w;hat=np.array([[0,-z,y],[z,0,-x],[-y,x,0]],float);theta=float(np.linalg.norm(w))
        if theta<1e-8:
            rotation=np.eye(3)+hat+.5*hat@hat;V=np.eye(3)+.5*hat+(hat@hat)/6
        else:
            rotation=np.eye(3)+math.sin(theta)/theta*hat+(1-math.cos(theta))/theta**2*(hat@hat)
            V=np.eye(3)+(1-math.cos(theta))/theta**2*hat+(theta-math.sin(theta))/theta**3*(hat@hat)
        pose[:3,:3]=rotation;pose[:3,3]=V@v
    else:raise ValueError("unknown-authored-trajectory")
    return pose


def validate_scene_pair(pair):
    require(pair["target"]["timestampUs"]-pair["source"]["timestampUs"]==100000,"changed-authored-timing")
    require([v["offsetUs"]for v in pair["clockVariants"]]==POLICY["clockOffsetsUs"],"changed-clock-controls")
    require(len({p["id"]for p in pair["planes"]})==len(pair["planes"]),"duplicate-material-IDs")
    for plane in pair["planes"]:
        require(math.isfinite(plane["z"]) and plane["z"]>0,"invalid-plane")
    for offset,endpoints in [(0,pair),*[(v["offsetUs"],v)for v in pair["clockVariants"]]]:
        for key in ("source","target"):
            item=endpoints[key]
            require(item["poseTimestampUs"]==pair[key]["timestampUs"]+offset,"clock-control-relabelled")
            expected=trajectory_pose(pair["trajectory"],item["poseTimestampUs"])
            require(np.allclose(transform_pose(item["cameraToWorld"]),expected,rtol=0,atol=1e-10),"exported-pose-not-independent-trajectory")


def oracle_centers(points,K,source_pose,target_pose,planes,shape):
    points=np.asarray(points,float).reshape(-1,2);h,w=shape
    world,ids=material_rays(points,K,source_pose,planes)
    target,z=project_material(world,K,target_pose)
    nearest,tid=material_rays(target,K,target_pose,planes)
    statuses=[]
    for i,(p,q) in enumerate(zip(points,target,strict=True)):
        if not np.isfinite(p).all() or not(0<=p[0]<w and 0<=p[1]<h) or ids[i]<0:status="source-unavailable"
        elif not math.isfinite(z[i]) or z[i]<=0:status="target-behind"
        elif not np.isfinite(q).all() or not(0<=q[0]<w and 0<=q[1]<h):status="target-out-of-view"
        elif tid[i]!=ids[i] or np.linalg.norm(nearest[i]-world[i])>1e-7:status="occluded"
        else:status="visible"
        statuses.append(status)
    return dict(endpoints=clean(target),materialIds=ids.tolist(),status=statuses)


def patch_strata(points,targets,ids,K,source_pose,target_pose,planes,shape,radius):
    """All nonzero bilinear lattice support of one 7/21px window.

    These are full-resolution sampler footprints, not the larger LK pyramid.
    A fractional getRectSubPix center can involve8x8 rather than7x7 pixels.
    """
    points=np.asarray(points,float).reshape(-1,2);targets=np.asarray(targets,float).reshape(-1,2)
    offsets=np.array([(x,y)for y in range(-radius,radius+2)for x in range(-radius,radius+2)],float)
    n=len(points);h,w=shape;result=np.ones(n,bool)
    for centers,pose in ((points,source_pose),(targets,target_pose)):
        origins=np.floor(centers)
        active=(offsets[None,:,0]<=radius+(centers[:,None,0]>origins[:,None,0]))&(
            offsets[None,:,1]<=radius+(centers[:,None,1]>origins[:,None,1]))
        grid=(origins[:,None,:]+offsets[None,:,:]).reshape(-1,2)
        _,material=material_rays(grid,K,pose,planes);material=material.reshape(n,len(offsets))
        inbounds=((grid[:,0]>=0)&(grid[:,0]<w)&(grid[:,1]>=0)&(grid[:,1]<h)).reshape(n,len(offsets))
        result&=np.all(~active|(inbounds&(material==np.asarray(ids)[:,None])&(material>=0)),axis=1)
    return result.tolist()


def endpoint_counts(controls,reference,patch7):
    n=controls["originalSeedCount"];b=np.asarray(controls["endpoints"],float).reshape(-1,2)
    q=np.asarray(reference["endpoints"],float).reshape(-1,2)
    accepted=np.asarray(controls["lkAccepted"],bool)&np.asarray(controls["photometric"],bool)
    visible=np.array([s=="visible"for s in reference["status"]]);error=np.linalg.norm(b-q,axis=1)
    right=visible&np.isfinite(error)&(error<=1.3)
    rows=[dict(index=i,status=reference["status"][i],patch7SingleMaterial=bool(patch7[i]),
        lkAccepted=bool(accepted[i]),epePx=clean(error[i])if visible[i]else None,
        classification="accepted-right"if accepted[i]and right[i]else "accepted-wrong"if accepted[i]and visible[i]
        else "missed-valid"if visible[i]else "accepted-invisible"if accepted[i]else "reference-unavailable")for i in range(n)]
    counts={key:sum(r["classification"]==key for r in rows)for key in
        ("accepted-right","accepted-wrong","missed-valid","accepted-invisible","reference-unavailable")}
    known_unmatchable={"occluded","target-out-of-view","target-behind"}
    known_fp=sum(r["status"]in known_unmatchable and r["lkAccepted"]for r in rows)
    known_tn=sum(r["status"]in known_unmatchable and not r["lkAccepted"]for r in rows)
    source_unknown=sum(r["status"]=="source-unavailable"for r in rows)
    return dict(originalSeeds=n,visibleReferences=int(visible.sum()),counts=counts,points=rows,
        acceptedInvisibleByStatus={s:sum(r["classification"]=="accepted-invisible"and r["status"]==s for r in rows)
            for s in sorted(set(reference["status"])-{"visible"})},
        componentConfusion=dict(tp=counts["accepted-right"],fpVisible=counts["accepted-wrong"],
            fpIncludingInvisible=counts["accepted-wrong"]+counts["accepted-invisible"],
            knownUnmatchableFP=known_fp,knownUnmatchableTN=known_tn,fpTotalKnown=counts["accepted-wrong"]+known_fp,
            fn=counts["missed-valid"]+counts["accepted-wrong"],tn=known_tn,
            acceptedInvisible=counts["accepted-invisible"],sourceUnavailableUnknown=source_unknown,
            unknown=source_unknown),
        semantics="Exact center error for authored visible static material; mixed finite footprints remain labeled separately.")


def frames_for(K,pair,offset=0):
    variants={v["offsetUs"]:v for v in pair.get("clockVariants",[])}
    endpoints=(pair["source"],pair["target"])if offset==0 else (variants[offset]["source"],variants[offset]["target"])
    out=[]
    for original,item in zip((pair["source"],pair["target"]),endpoints,strict=True):
        out.append(dict(timestampUs=original["timestampUs"],poseTimestampUs=item["poseTimestampUs"],
            cameraToWorld=np.asarray(item["cameraToWorld"],float),intrinsics=np.asarray(K,float),epoch=0))
    return out


def gate(controls,K,pair,shape,offset=0):
    previous,current=frames_for(K,pair,offset);h,w=shape
    model,pose=camera.candidate_pose(previous,current,w,h)
    if model is None:return dict(status=pose["status"],qualified=False,pose=pose,evidence=None,geometricGateEvaluations=0,similarityFitAttempts=0)
    cv2.setRNGSeed(650700)
    evidence=camera.evaluate(controls,model,shape)
    ambiguous=frozen.ScaleApproach()._update_common_scale(100.,evidence)
    return dict(status="scale-ambiguous"if ambiguous else "qualified-component"if evidence["acceptedBeforeScaleVeto"]else
        "insufficient-pixel-camera-evidence",qualified=bool(evidence["acceptedBeforeScaleVeto"]and not ambiguous),
        pose=pose,evidence=evidence,independentPairScaleHistory=True,geometricGateEvaluations=1,
        similarityFitAttempts=int(sum(np.asarray(controls["lkAccepted"],bool)&np.asarray(controls["photometric"],bool)&
            np.asarray(controls["outsideCurrentForeground"],bool)&np.isfinite(frozen._project(np.asarray(controls["sourceSeeds"],float).reshape(-1,2),model.homography)).all(axis=1))>=24))


def oracle_controls(measured,reference,patch7):
    n=measured["originalSeedCount"]
    eligible=[s=="visible"and p for s,p in zip(reference["status"],patch7,strict=True)]
    return dict(sourceSeeds=deepcopy(measured["sourceSeeds"]),endpoints=deepcopy(reference["endpoints"]),
        originalSeedCount=n,lkAccepted=eligible,photometric=eligible,outsideCurrentForeground=[True]*n,
        authority="oracle-component-only-not-measured-LK",lkDirectionCalls=0)


def wrong_endpoints(oracle,K,pair,direction):
    controls=deepcopy(oracle);a=np.asarray(controls["sourceSeeds"],float).reshape(-1,2)
    b=np.asarray(controls["endpoints"],float).reshape(-1,2)
    model,_=camera.candidate_pose(*frames_for(K,pair),640,480)
    if model is None or model.fundamental is None:
        return None
    lines=np.column_stack((a,np.ones(len(a))))@model.fundamental.T
    normals=lines[:,:2];norm=np.linalg.norm(normals,axis=1);safe=norm>1e-9
    unit=np.zeros_like(normals);unit[safe]=normals[safe]/norm[safe,None]
    if direction=="along":unit=np.column_stack((-unit[:,1],unit[:,0]))
    b+=8*unit;valid=safe&np.isfinite(b).all(axis=1)&(b[:,0]>=0)&(b[:,0]<640)&(b[:,1]>=0)&(b[:,1]<480)
    controls["endpoints"]=clean(b)
    for key in ("lkAccepted","photometric"):controls[key]=(np.asarray(controls[key],bool)&valid).tolist()
    return controls


def evaluate_pair(pair,observed,K,shape):
    validate_scene_pair(pair)
    controls=observed["controls"];points=controls["sourceSeeds"]
    reference=oracle_centers(points,K,pair["source"]["cameraToWorld"],pair["target"]["cameraToWorld"],pair["planes"],shape)
    patch7=patch_strata(points,reference["endpoints"],reference["materialIds"],K,
        pair["source"]["cameraToWorld"],pair["target"]["cameraToWorld"],pair["planes"],shape,3)
    patch21=patch_strata(points,reference["endpoints"],reference["materialIds"],K,
        pair["source"]["cameraToWorld"],pair["target"]["cameraToWorld"],pair["planes"],shape,10)
    oracle=oracle_controls(controls,reference,patch7)
    variants=[]
    for label,calibration,offset,fault in [("nominal",np.asarray(K,float),0,False),
            ("fx-times1.05",np.asarray(K,float)*np.array([[1.05,1,1],[1,1,1],[1,1,1]]),0,True),
            ("cx-plus8",np.asarray(K,float)+np.array([[0,0,8],[0,0,0],[0,0,0]]),0,True),
            *[(f"clock{offset:+d}us",np.asarray(K,float),offset,True)for offset in POLICY["clockOffsetsUs"]]]:
        variants.append(dict(id=label,injectedFault=fault,clockOffsetUs=offset,
            runtimeClockEligible=abs(offset)<=20000,
            oracleComponent=gate(oracle,calibration,pair,shape,offset),
            measuredComponent=gate(controls,calibration,pair,shape,offset),
            interpretation="Known injection; compatibility need not identify its cause. No correction is selected."))
    nominal=variants[0]["oracleComponent"]["qualified"]
    for variant in variants:
        invariant_clock=bool(variant["clockOffsetUs"] and pair["motionType"]in ("stationary","lateral","constant-body-twist"))
        invariant_calibration=variant["id"]in ("fx-times1.05","cx-plus8")and pair["motionType"]in ("stationary","lateral")
        invariant=invariant_clock or invariant_calibration
        if not variant["injectedFault"]:outcome="nominal-qualified"if nominal else "nominal-component-FN"
        elif abs(variant["clockOffsetUs"])>20000:outcome="hard-clock-contract-rejected"if not variant["oracleComponent"]["qualified"]else "hard-clock-invalid-accepted"
        elif invariant:outcome="not-identifiable-known-invariant-control"
        elif not nominal:outcome="unknown-nominal-oracle-component-not-qualified"
        else:outcome="injected-error-false-compatible"if variant["oracleComponent"]["qualified"]else "injected-error-rejected"
        variant["oracleFaultOutcome"]=outcome
        variant["knownUnobservableControl"]=invariant
        variant["observabilityStratum"]="known-relative-transform-invariant-clock"if invariant_clock else "known-H-epiline-invariant-calibration"if invariant_calibration else "no-a-priori-identifiability-guarantee"
    wrong=[]
    for direction in ("perpendicular","along"):
        altered=wrong_endpoints(oracle,K,pair,direction)
        wrong.append(dict(direction=direction,exactInjectedEpePx=8.,status="epipolar-unobservable"if altered is None else "evaluated",
            component=None if altered is None else gate(altered,K,pair,shape),
            originalSeeds=controls["originalSeedCount"],eligibleWrongPoints=0 if altered is None else sum(altered["lkAccepted"])))
    return dict(id=pair["id"],split=pair["split"],motionType=pair["motionType"],reference=reference,
        patch7SingleMaterial=patch7,patch21SingleMaterial=patch21,
        endpointAccuracy=endpoint_counts(controls,reference,patch7),variants=variants,wrongEndpointControls=wrong,
        observability="Stationary and constant-body-twist timing are not identifiable; epiline compatibility is not a complete match proof.")


def hpatches_result(pair,observed):
    controls=observed["controls"];a=np.asarray(controls["sourceSeeds"],float).reshape(-1,2)
    hom=np.column_stack((a,np.ones(len(a))))@np.asarray(pair["H"],float).T
    with np.errstate(divide="ignore",invalid="ignore"):b=hom[:,:2]/hom[:,2,None]
    h,w=observed["imageShape"]
    visible=np.isfinite(b).all(axis=1)&(hom[:,2]>0)&(b[:,0]>=0)&(b[:,0]<w)&(b[:,1]>=0)&(b[:,1]<h)
    reference=dict(endpoints=clean(b),status=["visible"if v else "target-out-of-view"for v in visible])
    accuracy=endpoint_counts(controls,reference,[False]*len(a))
    accuracy["semantics"]="Conditional transfer error to external estimated H, not exact physical endpoint error. Only image-bound visibility, no occlusion truth."
    accuracy["componentConfusion"]["referenceAuthority"]="Conditional on estimated H; wrong/missed labels do not establish physical matching error."
    return dict(id=pair["id"],split="external-planar-reference",referenceAuthority="Estimated external HPatches H, not exact physical correspondence",
        pixelMetric="Native image pixels; no resize; not pooled with authored controls",endpointAccuracy=accuracy,
        occlusionTruthAvailable=False)


def summarize(rows,external):
    summary={}
    for split in ("analysis","holdout"):
        selected=[r for r in rows if r["split"]==split]
        counts={k:sum(r["endpointAccuracy"]["counts"][k]for r in selected)for k in
            ("accepted-right","accepted-wrong","missed-valid","accepted-invisible","reference-unavailable")}
        arms={}
        for name in ("nominal","fx-times1.05","cx-plus8",*[f"clock{x:+d}us"for x in POLICY["clockOffsetsUs"]]):
            cases=[next(v for v in r["variants"]if v["id"]==name)for r in selected]
            arms[name]={key:dict(qualified=sum(v[key]["qualified"]for v in cases),rejected=sum(not v[key]["qualified"]for v in cases))
                for key in ("oracleComponent","measuredComponent")}
            arms[name]["oracleFaultOutcomes"]={outcome:sum(v["oracleFaultOutcome"]==outcome for v in cases)
                for outcome in sorted({v["oracleFaultOutcome"]for v in cases})}
        summary[split]=dict(pairs=len(selected),originalSeeds=sum(r["endpointAccuracy"]["originalSeeds"]for r in selected),
            endpointCounts=counts,gateComponents=arms)
    return dict(authored=summary,externalEstimatedH=external,
        componentDefinitions=dict(endpointFN="Visible correct correspondence missed: rejected LK/NCC OR accepted endpoint farther than1.3px; not traffic warning FN",
            endpointFP="fpVisible: accepted endpoint >1.3px from exact visible material; fpIncludingInvisible additionally counts accepted occluded/out-of-view endpoints, with per-status detail",
            nominalGateFN="Correct authored metadata/oracle component rejected; source support/observability still reported",
            metadataFalseCompatibility="Injected metadata error accepted by component gate, not natural traffic FP"),
        cachedTrafficUnchanged=dict(tp=0,fn=13,fp=0,tn=18,unknown=2,provenance="Previously completed M3U traffic; no new detector/RAFT inference"),
        runtimePromotion=False,limitations=["Authored geometry/radiance is not road or phone validation",
            "A center material endpoint does not certify a finite patch or camera estimator identifiability",
            "Estimated HPatches H is a separate conditional reference, not exact 3D pose or occlusion gold"])


def evaluate(path,expected,observations_path,observations_sha,output,plan_sha):
    new_output_preflight(output)
    tick=perf_counter();initial=code_hashes();progress=dict(schemaVersion=1,study="M3W-factor-evaluation",policy=POLICY,
        inputSha256=expected,observationSha256=observations_sha,codeSha256=initial,pairs=[],external=[],complete=False,
        actualLkDirections=0,learnedModelCalls=0)
    try:
        obs=read_sealed(observations_path,observations_sha)
        require(obs.get("complete")is True and obs.get("study")=="M3W-RGB-observations" and obs.get("goldFileOpens")==0,"unsealed-or-oracle-leaked-observations")
        require(obs.get("controlsManifestSha256")==expected,"observations-wrong-gold-seal")
        require(obs["codeSha256"]==initial,"observation-code-drift")
        manifest=read_sealed(path,expected)
        require(manifest.get("schemaVersion")==1 and manifest.get("study")=="M3W-authored-controls", "wrong-gold-manifest")
        require(isinstance(plan_sha,str) and len(plan_sha)==64 and manifest.get("planSha256")==plan_sha,"wrong-approved-plan-seal")
        require(manifest.get("datasetId")=="m3w-fixed-v1","wrong-fixed-dataset")
        require(manifest["imageShape"]==[480,640] and len(manifest["pairs"])==12,"wrong-authored-plan")
        require(len(manifest.get("externalPairs",[]))==2,"wrong-external-denominator")
        byid={r["id"]:r for r in obs["pairs"]};require(len(byid)==14,"observation-denominator-changed")
        cv2.setNumThreads(1)
        for pair in manifest["pairs"]:
            require(perf_counter()-tick<=POLICY["maxEvaluateSeconds"],"evaluation-time-budget")
            observed=byid[pair["id"]]
            validate_controls(observed["controls"],observed["imageShape"])
            for key in ("source","target"):
                require(all(observed[key][k]==pair[key][k]for k in ("path","sha256","timestampUs")),"observation-image-not-bound")
            require(observed["split"]==pair["split"],"observation-plan-not-bound")
            progress["pairs"].append(evaluate_pair(pair,observed,manifest["K"],manifest["imageShape"]))
        for raw_pair in manifest["externalPairs"]:
            pair=dict(id=raw_pair["id"],H=raw_pair["H_1_2"],source=raw_pair["old"],target=raw_pair["new"])
            observed=byid[pair["id"]]
            validate_controls(observed["controls"],observed["imageShape"])
            for key in ("source","target"):
                require(all(observed[key][k]==pair[key][k]for k in ("path","sha256")),"external-image-not-bound")
            progress["external"].append(hpatches_result(pair,observed))
        require(code_hashes()==initial and digest(path)==expected and digest(observations_path)==observations_sha,"evaluation-source-drift")
        components=[v[key]for p in progress["pairs"]for v in p["variants"]for key in ("oracleComponent","measuredComponent")]
        components += [v["component"]for p in progress["pairs"]for v in p["wrongEndpointControls"]if v["component"]is not None]
        require(perf_counter()-tick<=POLICY["maxEvaluateSeconds"],"evaluation-time-budget-final")
        progress.update(complete=True,planSha256=plan_sha,elapsedMs=1000*(perf_counter()-tick),summary=summarize(progress["pairs"],progress["external"]),
            requiredPriorLkDirections=obs["actualLkDirections"],geometricGateEvaluations=sum(c["geometricGateEvaluations"]for c in components),
            similarityFitAttempts=sum(c["similarityFitAttempts"]for c in components),
            software=dict(opencv=cv2.__version__,opencvThreadsRequested=1,opencvThreadsReported=cv2.getNumThreads(),numpy=np.__version__))
        write_new(output,progress);return progress
    except Exception as error:
        progress.update(elapsedMs=1000*(perf_counter()-tick),errorType=type(error).__name__,error=str(error),
            failurePhase="oracle-evaluation",codeSha256After=code_hashes())
        write_new(str(output)+"-incomplete.json",progress);raise


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("phase",choices=("observe","evaluate"))
    parser.add_argument("--input",required=True,type=Path);parser.add_argument("--input-sha256",required=True)
    parser.add_argument("--observations",type=Path);parser.add_argument("--observations-sha256")
    parser.add_argument("--plan-sha256")
    parser.add_argument("--output",required=True,type=Path);args=parser.parse_args()
    if args.phase=="observe":result=observe(args.input,args.input_sha256,args.output)
    else:
        require(args.observations is not None and args.observations_sha256 is not None,"observations-seal-required")
        result=evaluate(args.input,args.input_sha256,args.observations,args.observations_sha256,args.output,args.plan_sha256)
    print(json.dumps(dict(complete=result["complete"],pairs=len(result["pairs"]),elapsedMs=result["elapsedMs"],output=str(args.output))))


if __name__=="__main__":main()
