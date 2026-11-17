"""M3R positive object-identity chains, separate from optical measurement.

This research overlay does not run a detector, tracker, RootSIFT or flow model.
Existing T handles are proposals only: every adjacent identity transition is
reconstructed from the full reciprocal box matrix and actual coarse pixels.
Chosen A measurement proofs retain their original thresholds/denominators.
Point upper bounds are not rewritten as physical-identity negative evidence.
"""

from collections import deque
from copy import deepcopy
from hashlib import sha256
import json
import math
from time import perf_counter
from types import MappingProxyType

import cv2
import numpy as np

import assist_scene_cohort_loom as identity
import assist_scene_window_loom as identity_geometry
import assist_scene_global_window as geometry
import assist_scene_textured_window as measurement
from assist_scene_scale_approach_m3e import _native_transform
from assist_scene_motion import Detection


POLICY = MappingProxyType({**dict(geometry.POLICY),
    "method": "positive-adjacent-identity-chain-with-frozen-measurement",
    "identityIou": identity_geometry.POLICY["associationIou"],
    "identityReciprocalMargin": identity_geometry.POLICY["associationMargin"],
    "identityCorrelation": identity.POLICY["identityPatchCorrelation"],
    "identityPatchStdFloor": identity.POLICY["identityPatchStdFloor"],
    "identityPatchSide": identity.POLICY["identityPatchSide"],
    "identityInset": identity.POLICY["identityInset"],
    "identityBlurKernel": identity.POLICY["identityBlurKernel"],
    "identityBlurSigma": identity.POLICY["identityBlurSigma"],
    "maxIdentityExposures": 69,
    "identityBranch": "appearance-and-reciprocal-box-only-no-pixel-fallback",
    "additionalFlowCalls": 0,
    "identityIsNotPhysicalTruth": True,
})


def require(value, message):
    if not value: raise ValueError(message)


def canonical(value):
    return sha256(json.dumps(value,sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()


def pixels_sha(value):
    return sha256(np.ascontiguousarray(value).tobytes()).hexdigest()


def digest(value):
    return isinstance(value,str) and len(value)==64 and all(c in "0123456789abcdef" for c in value)


def number(value):
    return type(value) in (int,float) and math.isfinite(value)


def _patch(raw, box, transform):
    """Exact frozen T patch; additional metadata never adjusts its pixels."""
    rect=identity.base._warp_rect(box.xyxy,transform)
    if rect is None:return {"valid":False,"reason":"invalid-patch-rectangle"}
    size=identity.base._size(rect)
    a=np.maximum(0,np.ceil(rect[:2]+POLICY["identityInset"]*size)).astype(int)
    b=np.minimum(raw.shape[::-1],np.floor(rect[2:]-POLICY["identityInset"]*size)).astype(int)
    if min(b-a)<4:return {"valid":False,"reason":"insufficient-patch-pixels","roi":[*a.tolist(),*b.tolist()]}
    before=cv2.resize(raw[a[1]:b[1],a[0]:b[0]],(32,32),interpolation=cv2.INTER_AREA).astype(np.float32)
    std=float(np.std(before));value=identity._appearance(raw,box,transform)
    result={"valid":value is not None,"roi":[*a.tolist(),*b.tolist()],"sourceStd":std}
    if value is None:return {**result,"reason":"insufficient-patch-contrast"}
    return {**result,"reason":"actual-native-coarse-identity-patch", "shape":[32,32],
        "values":value.ravel().tolist(),"sha256":pixels_sha(value)}


def observe(frame, at, gray, boxes, native, surface):
    require(isinstance(gray,np.ndarray) and gray.dtype==np.uint8 and gray.ndim==2
        and 32<=min(gray.shape)<=max(gray.shape)<=768,"Bounded grayscale image required")
    h,w=gray.shape;clean=identity.base._boxes(boxes,w,h)
    require(clean is not None and isinstance(surface,dict),"Identity requires current camera surface")
    tracks=surface.get("tracks",[])
    require(len(tracks)==len(clean) and len(tracks)<=12
        and len({t["id"] for t in tracks})==len(tracks)
        and all(type(t["id"]) is int and t["id"]>=0 for t in tracks),"Duplicate/invalid current identity handles")
    for track,box in zip(tracks,clean,strict=True):
        require(geometry._same({k:track[k] for k in ("label","score","box")},box.record(w,h)),"T boxes differ from actual detector")
    transform=_native_transform(native,gray.shape)
    used_native=transform is not None
    require(surface.get("diagnostics",{}).get("nativeDetail") is used_native,
        "Identity pixels do not match camera authority's native/working mode")
    raw=native if used_native else gray
    transform=transform if used_native else np.eye(3)
    decisions=surface.get("diagnostics",{}).get("identityDecisions",{})
    view,status=identity.base._frame_view(frame,w,h)
    require(view is not None and number(at) and digest(frame.get("sha256")),"Unbound identity exposure")
    result={"token":view["token"],"timestampUs":view["timestampUs"],"poseTimestampUs":view["poseTimestampUs"],
        "timeMs":at,"epoch":surface["epoch"],"status":surface["status"],
        "sourceSha256":frame["sha256"],"workingSha256":pixels_sha(gray),"workingShape":[h,w],
        "rawSha256":pixels_sha(raw),"rawShape":list(raw.shape),"nativeDetail":used_native,
        "workingToRaw":transform.tolist(),"intrinsics":view["intrinsics"].tolist(),
        "cameraToWorld":view["cameraToWorld"].tolist(),
        "cameraPoseIntervalUs":surface.get("diagnostics",{}).get("pose",{}).get("intervalUs"),
        "tracks":[{"id":t["id"],"label":b.label,"score":b.score,"xyxy":list(b.xyxy)} for t,b in zip(tracks,clean,strict=True)],
        "patches":[_patch(raw,b,transform) for b in clean],
        "cameraIdentityDecisions":{str(t["id"]):{k:decisions.get(str(t["id"]),{}).get(k)
            for k in ("kept","reason","appearanceCorrelation")} for t in tracks}}
    validate_observation(result)
    return result


def validate_observation(obs):
    require(isinstance(obs,dict) and isinstance(obs.get("token"),str) and obs["token"]
        and number(obs.get("timeMs")) and type(obs.get("timestampUs")) is int
        and type(obs.get("poseTimestampUs")) is int and type(obs.get("epoch")) is int
        and all(digest(obs.get(k)) for k in ("sourceSha256","workingSha256","rawSha256")),"Malformed bound identity observation")
    require(len(obs["tracks"])==len(obs["patches"])<=12
        and len({t["id"] for t in obs["tracks"]})==len(obs["tracks"]),"Invalid identity inventory")
    for t,p in zip(obs["tracks"],obs["patches"],strict=True):
        require(type(t["id"]) is int and t["id"]>=0 and len(t["xyxy"])==4
            and np.isfinite(t["xyxy"]).all() and min(np.subtract(t["xyxy"][2:],t["xyxy"][:2]))>0,
            "Invalid identity handle/rectangle")
        if not p["valid"]:continue
        a=np.asarray(p["values"],np.float32)
        require(a.shape==(1024,) and np.isfinite(a).all() and p["shape"]==[32,32]
            and digest(p["sha256"]) and pixels_sha(a.reshape(32,32))==p["sha256"]
            and number(p["sourceStd"]) and p["sourceStd"]>=3.
            and abs(float(np.linalg.norm(a))-1.)<1e-5 and abs(float(a.mean()))<1e-5,
            "Unverifiable unchanged32-patch identity evidence")
    return True


def transition(old, new):
    """Full frozen T geometry competition, then actual independent NCC."""
    validate_observation(old);validate_observation(new)
    result={"startToken":old["token"],"endToken":new["token"],"startMs":old["timeMs"],"endMs":new["timeMs"],
        "startSha256":canonical(old),"endSha256":canonical(new),"supported":False,"reason":"identity-stream-discontinuity",
        "geometryMatrix":[],"eligibleEdges":[],"links":[]}
    dt=new["timeMs"]-old["timeMs"]
    if (not 12.<=dt<=300. or old["epoch"]!=new["epoch"] or new["status"]!="valid"
            or old["status"] not in ("valid","first-frame") or new["nativeDetail"]!=old["nativeDetail"]
            or old["workingShape"]!=new["workingShape"] or old["rawShape"]!=new["rawShape"]
            or new["token"]==old["token"] or abs(dt-(new["timestampUs"]-old["timestampUs"])/1000.)>1.
            or new["cameraPoseIntervalUs"]!=new["timestampUs"]-old["timestampUs"]
            or not np.allclose(old["intrinsics"],new["intrinsics"],atol=1e-4,rtol=1e-6)):
        return result
    h=geometry.rotation_homography(old,new)
    matrix=[];edges=[]
    for i,a in enumerate(old["tracks"]):
        warped=identity.base._warp_rect(a["xyxy"],h);row=[]
        for j,b in enumerate(new["tracks"]):
            value=None if warped is None or a["label"]!=b["label"] else float(identity.base._iou(warped,b["xyxy"]))
            row.append(value)
            if value is not None and value>=.25:edges.append((value,i,j))
        matrix.append(row)
    source={};target={}
    for score,i,j in sorted(edges,reverse=True):
        source.setdefault(i,[]).append((score,j));target.setdefault(j,[]).append((score,i))
    links=[]
    for j,b in enumerate(new["tracks"]):
        ranked=target.get(j,[])
        link={"currentIndex":j,"currentId":b["id"],"supported":False,"reason":"no-reciprocal-box-source",
            "eligibleSourceIndices":[i for _,i in ranked]}
        if not ranked:links.append(link);continue
        score,i=ranked[0];back=source[i]
        rm=None if len(ranked)==1 else score-ranked[1][0]
        cm=None if len(back)==1 else score-back[1][0]
        link.update(previousIndex=i,previousId=old["tracks"][i]["id"],iou=score,
            rowRunnerIou=None if len(ranked)==1 else ranked[1][0],rowMargin=rm,
            columnRunnerIou=None if len(back)==1 else back[1][0],columnMargin=cm,
            reciprocalCurrentIndex=back[0][1],eligibleCurrentIndices=[k for _,k in back])
        if back[0][1]!=j or rm is not None and rm<.12 or cm is not None and cm<.12:
            link["reason"]="ambiguous-reciprocal-box";links.append(link);continue
        if old["tracks"][i]["id"]!=b["id"]:
            link["reason"]="identity-handle-not-continued";links.append(link);continue
        a_patch,b_patch=old["patches"][i],new["patches"][j]
        if not a_patch["valid"] or not b_patch["valid"]:
            link["reason"]="identity-patch-unavailable";links.append(link);continue
        corr=identity._correlation(np.asarray(a_patch["values"],np.float32).reshape(32,32),
                                   np.asarray(b_patch["values"],np.float32).reshape(32,32))
        decision=new["cameraIdentityDecisions"].get(str(b["id"]),{})
        link.update(correlation=corr,oldPatchSha256=a_patch["sha256"],newPatchSha256=b_patch["sha256"])
        if corr is None or corr<.70:
            link["reason"]="identity-patch-correlation";links.append(link);continue
        if (decision.get("kept") is not True or decision.get("reason")!="fresh-appearance-and-reciprocal-box"
                or not number(decision.get("appearanceCorrelation")) or abs(decision["appearanceCorrelation"]-corr)>1e-6):
            link["reason"]="camera-identity-not-appearance-verified";links.append(link);continue
        link.update(supported=True,reason="measured-adjacent-positive-identity")
        links.append(link)
    result.update(supported=True,reason="measured-identity-transition",rotationHomography=h.tolist(),
        geometryMatrix=matrix,eligibleEdges=[list(e) for e in sorted(edges,reverse=True)],links=links)
    return result


def chain(records, source_token, current_index):
    current=records[-1]["observation"];identifier=current["tracks"][current_index]["id"]
    proof={"supported":False,"reason":"missing-identity-source-exposure","identityId":identifier,
        "startToken":source_token,"endToken":current["token"],"currentIndex":current_index}
    start=next((i for i,r in enumerate(records) if r["observation"]["token"]==source_token),None)
    if start is None or start==len(records)-1:return proof
    origin=records[start]["observation"]
    candidates=[i for i,t in enumerate(origin["tracks"]) if t["id"]==identifier]
    if len(candidates)!=1:return proof
    previous=candidates[0];links=[]
    for row in records[start+1:]:
        obs=row["observation"];tr=row["transition"]
        indices=[i for i,t in enumerate(obs["tracks"]) if t["id"]==identifier]
        if len(indices)!=1 or tr is None or tr["supported"] is not True:
            proof["reason"]="interrupted-identity-chain";return proof
        now=indices[0];link=next((a for a in tr["links"] if a["currentIndex"]==now),None)
        if link is None or link["supported"] is not True or link["previousIndex"]!=previous:
            proof["reason"]="unverified-adjacent-identity";return proof
        links.append({"startToken":tr["startToken"],"endToken":tr["endToken"],"transitionSha256":canonical(tr),
            "previousIndex":previous,"currentIndex":now,"linkSha256":canonical(link)})
        previous=now
    if previous!=current_index:return proof
    proof.update(supported=True,reason="uninterrupted-measured-positive-identity-chain",
        sourceIndex=candidates[0],startMs=origin["timeMs"],endMs=current["timeMs"],
        observationSha256s=[canonical(r["observation"]) for r in records[start:]],
        exposureTokens=[r["observation"]["token"] for r in records[start:]],links=links)
    return proof


def _pair_reference(pair):
    return {**{k:pair[k] for k in ("fieldId","startToken","endToken","startDetectionIndex","endDetectionIndex")},
        "pairSha256":canonical(pair)}


def compose(records, surface, camera):
    current=records[-1]["observation"];diag=surface["diagnostics"]
    lookup={(p["startToken"],p["startDetectionIndex"],p["endDetectionIndex"]):p for p in diag["comparisons"]}
    require(len(lookup)==len(diag["comparisons"]),"Duplicate actual measurement comparison")
    events=[];evidence={};reasons={}
    snapshot=diag["snapshotSelection"]
    for j,t in enumerate(camera["tracks"]):
        proof={"confirmed":False,"currentToken":current["token"],"currentMs":current["timeMs"],"identityId":t["id"]}
        reason="no-fresh-source-exposure"
        for role in ("fresh","anchor"):
            origin=snapshot.get(role)
            if origin is None:proof[role]=None;break
            cert=chain(records,origin["token"],j)
            part={"identityChain":cert,"supported":False,"measurementPair":None}
            proof[role]=part
            if not cert["supported"]:reason=role+"-"+cert["reason"];break
            source=next(r["observation"] for r in records if r["observation"]["token"]==origin["token"])
            require(source["timeMs"]==origin["timeMs"] and source["sourceSha256"]==origin["sourceSha256"],"Identity source differs from actual A snapshot")
            pair=lookup.get((origin["token"],cert["sourceIndex"],j))
            if pair is None:reason=role+"-no-eligible-measurement-pair";break
            part["measurementPair"]=_pair_reference(pair)
            if not pair["supported"]:reason=role+"-"+pair["reason"];break
            measurement.validate_pair_proof(pair,populations=diag["populations"])
            part.update(supported=True,linearLogGrowthLowerBound=pair["linearLogGrowthLowerBound"],
                linearLogGrowthUpperBound=pair["linearLogGrowthUpperBound"],startMs=pair["startMs"],observationMs=pair["observationMs"])
            reason="no-long-source-exposure" if role=="fresh" else "candidate-three-exposure-evidence"
        fresh,anchor=proof.get("fresh"),proof.get("anchor")
        if fresh is not None and anchor is not None and fresh["supported"] and anchor["supported"]:
            if len({fresh["startMs"],anchor["startMs"],current["timeMs"]})!=3:reason="insufficient-distinct-source-exposures"
            elif fresh["linearLogGrowthLowerBound"]<POLICY["minCurrentLinearGrowth"]:reason="no-current-global-expansion"
            elif anchor["linearLogGrowthLowerBound"]<POLICY["minNetLinearGrowth"]:reason="no-long-global-expansion"
            elif camera["status"]!="valid":reason="camera-veto"
            else:
                lower=anchor["linearLogGrowthLowerBound"]
                proof.update(confirmed=True,linearLogGrowth=lower,linearLogGrowthLowerBound=lower,
                    linearLogGrowthUpperBound=anchor["linearLogGrowthUpperBound"],growthBound=POLICY["growthBound"],
                    observationMs=anchor["observationMs"])
                pair=lookup[(anchor["measurementPair"]["startToken"],anchor["measurementPair"]["startDetectionIndex"],j)]
                events.append({"kind":"relative-optical-approach","trackId":t["id"],"label":t["label"],
                    "epoch":camera["epoch"],"timeMs":current["timeMs"],"method":POLICY["method"],
                    "observationMs":anchor["observationMs"],"linearLogGrowth":lower,"linearLogGrowthLowerBound":lower,
                    "logAreaGrowth":2*lower,"growthBound":POLICY["growthBound"],
                    "points":min(pair["forward"]["points"],pair["reverse"]["points"]),
                    "measurementPairSha256":canonical(pair),"identityChainSha256":canonical(anchor["identityChain"])})
                reason="identity-chain-and-frozen-measurement-supported"
        proof["reason"]=reason;evidence[str(t["id"])]=proof;reasons[str(t["id"])]=reason
    return events,evidence,reasons


class IdentityChainWindowMotion:
    def __init__(self):
        self._records=deque(maxlen=POLICY["maxIdentityExposures"])

    def update(self,frame,t_ms,gray,boxes,*,native_gray=None,camera_surface=None,measurement_surface=None):
        tick=perf_counter();require(isinstance(measurement_surface,dict) and isinstance(camera_surface,dict),"Actual A/T surfaces required")
        require(geometry._same(measurement_surface["tracks"],camera_surface["tracks"]) and measurement_surface["epoch"]==camera_surface["epoch"]
            and measurement_surface["diagnostics"].get("sourceStatus")==camera_surface["status"],"Measurement/camera authority mismatch")
        before=canonical(measurement_surface);obs=observe(frame,t_ms,gray,boxes,native_gray,camera_surface)
        if self._records and t_ms<=self._records[-1]["observation"]["timeMs"]:self._records.clear()
        while self._records and t_ms-self._records[0]["observation"]["timeMs"]>POLICY["maxWindowMs"]:self._records.popleft()
        trans=None if not self._records else transition(self._records[-1]["observation"],obs)
        self._records.append({"observation":obs,"transition":trans})
        events,evidence,reasons=compose(list(self._records),measurement_surface,camera_surface)
        require(before==canonical(measurement_surface),"Identity overlay mutated A measurements")
        return {"status":measurement_surface["status"],"epoch":camera_surface["epoch"],"tracks":deepcopy(camera_surface["tracks"]),
            "events":events,"diagnostics":{"method":POLICY["method"],"policy":dict(POLICY),
                "sourceStatus":camera_surface["status"],"measurementSurfaceSha256":before,
                "measurementComparisonsSha256":canonical(measurement_surface["diagnostics"]["comparisons"]),
                "identityObservation":obs,"identityTransition":trans,"windowEvidence":evidence,"trackReasons":reasons,
                "additionalModelDirectionCalls":0,"identityIsNotPhysicalTruth":True,
                "bank":{"count":len(self._records),"tokens":[r["observation"]["token"] for r in self._records],
                    "nativeImagesRetained":False},"wallMs":1000*(perf_counter()-tick)}}


def validate_frame(row,history):
    """Numeric/source consistency. Actual patch pixels need independent image QA."""
    b=row["B"];a=row["A"];camera=row["T"];diag=b["diagnostics"];obs=diag["identityObservation"]
    validate_observation(obs)
    require(diag["method"]==POLICY["method"] and diag["policy"]==dict(POLICY)
        and diag["additionalModelDirectionCalls"]==0 and diag["measurementSurfaceSha256"]==canonical(a)
        and diag["measurementComparisonsSha256"]==canonical(a["diagnostics"]["comparisons"]),"Unbound/mutated measurement plane")
    require(obs["token"]==row["token"] and obs["timestampUs"]==row["timestampUs"] and obs["timeMs"]==row["timeMs"]
        and obs["sourceSha256"]==row["sourceSha256"] and obs["workingSha256"]==row["workingPixelsSha256"]
        and obs["workingShape"]==[row["height"],row["width"]]
        and geometry._same(obs["intrinsics"],row["cameraIntrinsics"])
        and geometry._same(obs["cameraToWorld"],row["cameraToWorld"])
        and obs["epoch"]==camera["epoch"] and obs["status"]==camera["status"],"Wrong identity source frame")
    decisions=camera.get("diagnostics",{}).get("identityDecisions",{})
    expected_decisions={str(t["id"]):{k:decisions.get(str(t["id"]),{}).get(k)
        for k in ("kept","reason","appearanceCorrelation")} for t in camera["tracks"]}
    require(obs["cameraIdentityDecisions"]==expected_decisions
        and obs["cameraPoseIntervalUs"]==camera.get("diagnostics",{}).get("pose",{}).get("intervalUs")
        and obs["nativeDetail"] is camera.get("diagnostics",{}).get("nativeDetail"),"Identity authority metadata changed")
    raw_shape=[row["nativeHeight"],row["nativeWidth"]] if obs["nativeDetail"] else [row["height"],row["width"]]
    transform=np.diag((raw_shape[1]/row["width"],raw_shape[0]/row["height"],1.)).tolist()
    require(obs["rawShape"]==raw_shape and geometry._same(obs["workingToRaw"],transform),"Wrong actual identity source geometry")
    require(obs["rawSha256"]==(row.get("nativeGraySha256") if obs["nativeDetail"] else row["workingPixelsSha256"]),
        "Identity patch source pixels not bound to actual raw exposure")
    expected_tracks=[{"id":t["id"],"label":t["label"],"score":t["score"],
        "xyxy":[t["box"]["x"]*row["width"],t["box"]["y"]*row["height"],
            (t["box"]["x"]+t["box"]["width"])*row["width"],(t["box"]["y"]+t["box"]["height"])*row["height"]]}for t in camera["tracks"]]
    require(geometry._same(obs["tracks"],expected_tracks),"Changed identity proposal boxes/handles")
    recent=[r for r in [*history,row] if 0<=row["timeMs"]-r["timeMs"]<=POLICY["maxWindowMs"]][-POLICY["maxIdentityExposures"]:]
    records=[]
    for r in recent:
        current=r["B"]["diagnostics"]["identityObservation"]
        actual=r["B"]["diagnostics"]["identityTransition"]
        # The first retained exposure's incoming edge may precede this window;
        # no chain beginning here consumes it. Every consumed edge is checked.
        if records:
            trans=transition(records[-1]["observation"],current)
            require(geometry._same(trans,actual),"Adjacent identity transition does not reproduce full rival matrix/NCC")
        records.append({"observation":current,"transition":actual})
    events,evidence,reasons=compose(records,a,camera)
    require(geometry._same(events,b["events"]) and geometry._same(evidence,diag["windowEvidence"])
        and reasons==diag["trackReasons"] and b["tracks"]==camera["tracks"]
        and b["epoch"]==camera["epoch"] and b["status"]==a["status"]
        and diag["bank"]=={"count":len(records),"tokens":[r["observation"]["token"]for r in records],"nativeImagesRetained":False},
        "Identity warning did not reproduce independent chain plus unchanged measurement proof")
    return True
