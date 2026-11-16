"""M3G: verified identity tubes and robust angular expansion over a time window.

This is a Mac replay experiment. Unit-ray pair expansion is invariant to camera
rotation but is NOT a metric range measurement, self-motion, TTC, or a guarantee
of radial closing for a deforming/turning surface. Camera/control uncertainty
and missing pixels still veto. No warning is coasted through a missing frame.
"""

from collections import deque
from dataclasses import dataclass, field
import math
from types import MappingProxyType

import cv2
import numpy as np

import assist_scene_scale_approach as base
from assist_scene_scale_approach_m3e import _native_transform


POLICY = MappingProxyType({
    "maxTracks": 12, "maxPoints": 64, "maxHistory": 12, "maxAnchorChecks": 4,
    "minWorkingSidePx": 10., "minRepresentedSidePx": 18.,
    "maxTileSidePx": 384, "tilePaddingFraction": .32,
    "minPoints": 9, "minSeedSupport": .60, "minPairSupport": .70,
    "minSpan": .24, "minHull": .035, "maxFlowFbPx": 1.3,
    "associationIou": .25, "associationMargin": .12,
    "maxLocalRotationDeg": 15., "maxStepLogScale": .20,
    "maxCenterFraction": .28, "maxPointBoxLogDifference": .12,
    "minFrames": 5, "minWindowMs": 320., "maxWindowMs": 800.,
    "minNetAngularGrowth": .040, "minNetBoxGrowth": .012,
    "maxAngularLogMad": .025, "maxGrowthDisagreement": .10,
    "minCurrentAngularGrowth": .0005, "edgeMarginPx": 4.,
})


@dataclass
class Tube:
    box: object
    id: int
    points: np.ndarray
    initial: int
    history: deque  # consecutive verified observation times (no extrapolation)
    anchors: deque = field(default_factory=deque)


@dataclass
class Exposure:
    at: float
    box: object
    pixels: np.ndarray
    mapping: np.ndarray  # working-image pixels to this bounded source ROI
    points: np.ndarray
    rotation: np.ndarray


def _exposure(at, raw, box, transform, points, frame):
    tile = _tile(raw, raw, box.xyxy, box.xyxy, transform)
    if tile is None or len(points) < POLICY["minPoints"]:
        return None
    pixels, _, mapping = tile
    return Exposure(at, box, pixels.copy(), mapping, points.copy(), frame["cameraToWorld"][:3,:3].copy())


def _exposure_pair(old, new):
    """Put two independently bounded ROIs on a shared, non-upsampled canvas.

    An anchor is a real stored exposure, not extrapolated feature locations. The
    masks in _flow require matches inside the actual object in both exposures.
    """
    a, b = old.box.xyxy, new.box.xyxy
    pad = max(12., POLICY["tilePaddingFraction"]*max(*base._size(a), *base._size(b)))
    lo = np.floor(np.minimum(a[:2], b[:2])-pad)
    hi = np.ceil(np.maximum(a[2:], b[2:])+pad)
    factor = min(old.mapping[0,0], old.mapping[1,1], new.mapping[0,0], new.mapping[1,1],
                 POLICY["maxTileSidePx"]/max(hi-lo))
    width, height = np.maximum(1, np.floor((hi-lo)*factor)).astype(int)
    mapping = np.diag((factor,factor,1.)) @ np.array([[1.,0.,-lo[0]],[0.,1.,-lo[1]],[0.,0.,1.]])
    exposures = [cv2.warpPerspective(e.pixels, mapping@np.linalg.inv(e.mapping), (width,height),
                                     flags=cv2.INTER_LINEAR) for e in (old,new)]
    return *exposures, mapping


def _too_small(rect, shape, native):
    h, w = shape
    x, y, r, b = rect
    if min(x, y, w-r, h-b) < POLICY["edgeMarginPx"]:
        return True
    if min(r-x, b-y) < POLICY["minWorkingSidePx"]:
        return True
    ratio = min(native[0,0], native[1,1]) if native is not None else 1.
    return min(r-x, b-y)*ratio < POLICY["minRepresentedSidePx"]


def _tile(old, new, a, b, transform):
    """Shared crop origin/scale for both exposures; downsample, never upscale."""
    ta, tb = base._warp_rect(a, transform), base._warp_rect(b, transform)
    pad = max(12., POLICY["tilePaddingFraction"]*max(*base._size(ta), *base._size(tb)))
    lo = np.maximum(0, np.floor(np.minimum(ta[:2], tb[:2])-pad)).astype(int)
    hi = np.minimum(old.shape[::-1], np.ceil(np.maximum(ta[2:], tb[2:])+pad)).astype(int)
    if min(hi-lo) < 20:
        return None
    x,y = lo; r,bottom = hi
    old_crop, new_crop = old[y:bottom, x:r], new[y:bottom, x:r]
    factor = min(1., POLICY["maxTileSidePx"]/max(hi-lo))
    nw, nh = max(1,round((r-x)*factor)), max(1,round((bottom-y)*factor))
    if factor < 1.:
        old_crop = cv2.resize(old_crop,(nw,nh),interpolation=cv2.INTER_AREA)
        new_crop = cv2.resize(new_crop,(nw,nh),interpolation=cv2.INTER_AREA)
    scale = np.diag((nw/(r-x), nh/(bottom-y), 1.)) @ np.array([[1.,0.,-x],[0.,1.,-y],[0.,0.,1.]]) @ transform
    return np.ascontiguousarray(old_crop), np.ascontiguousarray(new_crop), scale


def _mask(shape, rect, others, transform):
    mask = np.zeros(shape, np.uint8)
    transformed = base._warp_rect(rect, transform)
    lo = np.ceil(transformed[:2]+.12*base._size(transformed)).astype(int)
    hi = np.floor(transformed[2:]-.12*base._size(transformed)).astype(int)
    lo = np.maximum(0,lo); hi = np.minimum(shape[::-1],hi)
    mask[lo[1]:hi[1],lo[0]:hi[0]] = 255
    for box in others:
        other = base._warp_rect(box.xyxy,transform)
        a = np.maximum(0,np.floor(other[:2])).astype(int)
        b = np.minimum(shape[::-1],np.ceil(other[2:])).astype(int)
        if np.all(b>a): mask[a[1]:b[1],a[0]:b[0]] = 0
    return mask


def _seed(image, box, others, transform):
    tile = _tile(image,image,box,box,transform)
    if tile is None: return None
    raw,_,mapping = tile
    mask = _mask(raw.shape,box,others,mapping)
    seeds = cv2.goodFeaturesToTrack(raw,maxCorners=POLICY["maxPoints"],qualityLevel=.012,
                                   minDistance=3,mask=mask)
    if seeds is None or len(seeds)<POLICY["minPoints"]: return None
    return base._project(seeds[:,0],np.linalg.inv(mapping)).astype(np.float32)


def angular_growth(a, b, k):
    """Robust pair separation on unit rays; no translation or metric scale."""
    inv = np.linalg.inv(k)
    rays = []
    for points in (a,b):
        p = np.column_stack((points,np.ones(len(points)))) @ inv.T
        p /= np.linalg.norm(p,axis=1)[:,None]
        rays.append(p)
    i,j = np.triu_indices(len(a),1)
    d0,d1 = [np.linalg.norm(r[i]-r[j],axis=1) for r in rays]
    # Closely spaced pairs amplify subpixel noise; use spread-out pairs only.
    usable = d0 >= max(1e-5, float(np.percentile(d0,40)))
    values = np.log(d1[usable]/d0[usable])
    if len(values)<POLICY["minPoints"] or not np.isfinite(values).all():
        return None
    median = float(np.median(values)); mad=float(np.median(abs(values-median)))
    return median,mad


def _flow(old, new, tube, current, homography, transform, others):
    if len(tube.points)<POLICY["minPoints"]:
        return None,"insufficient-object-flow"
    tile = _tile(old,new,tube.box.xyxy,current.xyxy,transform)
    if tile is None: return None,"invalid-object-crop"
    p,q,mapping = tile
    a = base._project(tube.points,mapping).astype(np.float32)
    seeds = a.reshape(-1,1,2)
    lk = {**base.LK,"winSize":(15,15),"maxLevel":3}
    end,ok,_ = cv2.calcOpticalFlowPyrLK(p,q,seeds,None,**lk)
    if end is None or ok is None: return None,"insufficient-object-flow"
    back,rev,_ = cv2.calcOpticalFlowPyrLK(q,p,end,None,**lk)
    if back is None or rev is None: return None,"insufficient-object-flow"
    return _validate_flow(p,q,a,end[:,0],back[:,0],ok.ravel()==1,rev.ravel()==1,
                          tube,current,homography,mapping,others)


def _validate_flow(p,q,a,b,back,ok,rev,tube,current,homography,mapping,others):
    """Identical geometry, photometry and support floors for LK and DIS."""
    keep = (ok&rev&np.isfinite(b).all(axis=1)
            &(np.linalg.norm(a-back,axis=1)<=POLICY["maxFlowFbPx"]))
    keep &= base._matching_patches(p,q,a,b)
    global_b = base._project(b,np.linalg.inv(mapping)).astype(np.float32)
    keep &= base._inside(global_b,current.xyxy,.04)
    for other in others: keep &= ~base._inside(global_b,other.xyxy,0.)
    if np.count_nonzero(keep)<max(POLICY["minPoints"],POLICY["minPairSupport"]*len(a),POLICY["minSeedSupport"]*tube.initial):
        return None,"insufficient-object-flow"
    old_pts,new_pts = tube.points[keep], global_b[keep]
    corrected = base._project(old_pts,homography)
    fit,inliers = base._similarity(corrected,new_pts,1.2)
    if fit is None or np.count_nonzero(inliers)<max(POLICY["minPoints"],POLICY["minPairSupport"]*np.count_nonzero(keep)):
        return None,"incoherent-object-flow"
    indexes = np.flatnonzero(keep)[inliers]
    old_pts,new_pts = tube.points[indexes],global_b[indexes]
    for pts,rect in ((old_pts,tube.box.xyxy),(new_pts,current.xyxy)):
        if (np.min(np.ptp(pts,axis=0)/base._size(rect)) < POLICY["minSpan"]
                or cv2.contourArea(cv2.convexHull(pts.astype(np.float32)))/float(np.prod(base._size(rect)))<POLICY["minHull"]):
            return None,"localized-object-flow"
    scale=math.hypot(*fit[:,0]); angle=abs(math.degrees(math.atan2(fit[1,0],fit[0,0])))
    if scale<=0 or abs(math.log(scale))>POLICY["maxStepLogScale"] or angle>POLICY["maxLocalRotationDeg"]:
        return None,"object-shape-change"
    warped=base._warp_rect(tube.box.xyxy,homography)
    center=fit[:,:2]@base._center(warped)+fit[:,2]
    if np.linalg.norm(center-base._center(current.xyxy))>max(2.,POLICY["maxCenterFraction"]*min(base._size(current.xyxy))):
        return None,"object-flow-box-disagreement"
    # A tube may tolerate detector jitter, not a completely inconsistent box.
    detector=float(np.mean(np.log(base._size(current.xyxy)/base._size(warped))))
    if abs(detector-math.log(scale))>POLICY["maxPointBoxLogDifference"]:
        return None,"object-scale-disagreement"
    return (indexes,new_pts),"identity-supported"


def _best_links(prior, boxes, homography, blocked):
    edges=[]
    for i,tube in enumerate(prior):
        rect=base._warp_rect(tube.box.xyxy,homography)
        if rect is None: continue
        for j,box in enumerate(boxes):
            overlap=base._iou(rect,box.xyxy)
            if j not in blocked and box.label==tube.box.label and overlap>=POLICY["associationIou"]:
                edges.append((overlap,i,j))
    source={}; target={}
    for score,i,j in sorted(edges,reverse=True):
        source.setdefault(i,[]).append((score,j));target.setdefault(j,[]).append((score,i))
    links={}
    for i,ranked in source.items():
        score,j=ranked[0]; back=target[j]
        if (back[0][1]==i and (len(ranked)==1 or score-ranked[1][0]>=POLICY["associationMargin"])
                and (len(back)==1 or score-back[1][0]>=POLICY["associationMargin"])):
            links[j]=i
    return links


class _WindowEngine(base.ScaleApproach):
    """Fresh-only angular looming experiment with bounded per-object histories."""

    def __init__(self, *, native_detail=True):
        super().__init__()
        self.native_detail=native_detail
        self._native=None

    def _reset(self):
        super()._reset();self._native=None

    def _track_flow(self,*args):
        return _flow(*args)

    def _new_points(self,*args):
        return _seed(*args)

    def update(self,frame,t_ms,gray,boxes,*,native_gray=None):
        def result(status,diagnostics=None,tracks=None,events=None):
            return {"status":status,"diagnostics":diagnostics or {},"tracks":tracks or [],"events":events or [],"epoch":self.epoch}
        if (not isinstance(gray,np.ndarray) or gray.dtype!=np.uint8 or gray.ndim!=2
                or not 32<=min(gray.shape)<=max(gray.shape)<=768):
            self._reset();return result("invalid-image")
        if type(t_ms) not in (int,float) or not math.isfinite(t_ms) or t_ms<0:
            self._reset();return result("invalid-stream-clock")
        h,w=gray.shape
        frame,status=base._frame_view(frame,w,h)
        boxes=base._boxes(boxes,w,h)
        if frame is None or boxes is None:
            self._reset();return result(status if frame is None else "invalid-detections")
        native=_native_transform(native_gray,gray.shape) if self.native_detail else None
        raw=native_gray if native is not None else gray
        transform=native if native is not None else np.eye(3)
        blocked={i:"small-or-truncated" for i,b in enumerate(boxes) if _too_small(b.xyxy,gray.shape,native)}
        diagnostics={"trackReasons":{},"windowEvidence":{},"nativeDetail":native is not None}
        prior=[];homography=None;status="first-frame"
        if self._previous is not None:
            old_frame,old_at,old_image,prior=self._previous
            if old_image.shape!=gray.shape:
                status="image-geometry-changed"
            elif frame.get("token") is not None and frame.get("token")==old_frame.get("token"):
                self._reset();return result("duplicate-frame")
            elif t_ms<=old_at or abs((t_ms-old_at)-(frame["timestampUs"]-old_frame["timestampUs"])/1000)>1.:
                self._reset();return result("stream-clock-mismatch")
            else:
                pair,q=base.pose_pair(old_frame,frame,w,h)
                diagnostics["pose"]=q;status=q["status"]
                if pair is not None: homography=pair.homography
                elif status=="epipolar-baseline-too-small" and q["translationM"]<base.POLICY["maxNearRotationBaselineM"]:
                    k=frame["intrinsics"]
                    rotation=frame["cameraToWorld"][:3,:3].T@old_frame["cameraToWorld"][:3,:3]
                    homography=k@rotation@np.linalg.inv(k);status="valid"
                if homography is not None:
                    valid,bg=base._background(pair,homography,old_image,gray,[p.box for p in prior],boxes)
                    diagnostics["background"]=bg
                    ambiguous=self._update_common_scale(t_ms,bg)
                    if not valid or ambiguous:
                        homography=None;status="scale-ambiguous" if ambiguous else "insufficient-background-agreement"
            if homography is None:
                self._reset();prior=[]
        links=_best_links(prior,boxes,homography,blocked) if homography is not None else {}
        active=[];tracks=[];events=[]
        native_pair=(native is not None and self._native is not None and self._native.shape==raw.shape)
        old_raw=self._native if native_pair else (old_image if prior else None)
        pair_transform=transform if native_pair else np.eye(3)
        for j,box in enumerate(boxes):
            tube=None;reason=blocked.get(j,"new-or-unmatched-object")
            others=[b for index,b in enumerate(boxes) if index!=j]
            if j in links:
                old=prior[links[j]]
                # Changing source representations must not silently connect two
                # coordinate systems or reuse a stale native exposure.
                answer,reason=self._track_flow(old_raw,raw if native_pair else gray,old,box,homography,pair_transform,others)
                if answer is not None:
                    indexes,points=answer
                    if self.anchor_mode:
                        recent=angular_growth(old.points[indexes],points,frame["intrinsics"])
                        # Replenished corners are never spliced into old paths.
                        history=deque(old.history,maxlen=POLICY["maxHistory"])
                        history.append(t_ms)
                        while len(history)>1 and t_ms-history[0]>POLICY["maxWindowMs"]:
                            history.popleft()
                        fresh=self._new_points(raw,box.xyxy,others,transform)
                        points=points if fresh is None else fresh
                        anchors=deque((a for a in old.anchors if t_ms-a.at<=POLICY["maxWindowMs"]),maxlen=POLICY["maxHistory"])
                        exposure=_exposure(t_ms,raw,box,transform,points,frame)
                        evidence=self._anchor_evidence(anchors,exposure,recent,history,frame,others)
                        if exposure is not None: anchors.append(exposure)
                        tube=Tube(box,old.id,points,len(points),history,anchors)
                    else:
                        # Original R1 cumulative trajectory estimator. Its
                        # aligned feature histories stay separate from R2.
                        history=deque(((at,p[indexes],size) for at,p,size in old.history),maxlen=POLICY["maxHistory"])
                        history.append((t_ms,points.copy(),base._size(box.xyxy)))
                        while len(history)>1 and t_ms-history[0][0]>POLICY["maxWindowMs"]:
                            history.popleft()
                        tube=Tube(box,old.id,points,old.initial,history)
                        evidence=self._cumulative_evidence(tube,frame["intrinsics"])
                    diagnostics["windowEvidence"][str(tube.id)]=evidence
                    reason=evidence["reason"]
                    if evidence["confirmed"]:
                        events.append({"kind":"relative-optical-approach","trackId":tube.id,"label":box.label,
                                       "epoch":self.epoch,"timeMs":t_ms,"observationMs":evidence["observationMs"],
                                       "angularLogGrowth":evidence["angularLogGrowth"],"points":len(points)})
            if tube is None:
                points=None if j in blocked else self._new_points(raw,box.xyxy,others,transform)
                ident=self._next_id;self._next_id+=1
                if points is None:
                    points=np.empty((0,2),np.float32)
                    if j not in blocked: reason="insufficient-object-seeds"
                first=t_ms if self.anchor_mode else (t_ms,points.copy(),base._size(box.xyxy))
                tube=Tube(box,ident,points,len(points),deque([first],maxlen=POLICY["maxHistory"]))
                if self.anchor_mode:
                    exposure=_exposure(t_ms,raw,box,transform,points,frame)
                    if exposure is not None: tube.anchors.append(exposure)
            active.append(tube);tracks.append({"id":tube.id,**box.record(w,h)})
            diagnostics["trackReasons"][str(tube.id)]=reason
        self._previous=frame,t_ms,gray.copy(),active
        self._native=raw.copy() if native is not None else None
        diagnostics["anchorBytes"]=sum(a.pixels.nbytes for tube in active for a in tube.anchors)
        return result(status,diagnostics,tracks,events)

    @staticmethod
    def _anchor_evidence(anchors,current,recent,history,frame,others):
        q={"confirmed":False,"reason":"warming-window",
           "observationMs":history[-1]-history[0],"anchorChecks":0}
        if (current is None or recent is None or len(history)<POLICY["minFrames"]
                or q["observationMs"]<POLICY["minWindowMs"]):
            return q
        # A small deterministic spread of actual keyframes bounds work. Each
        # direct match has independent start corners; no chained scale drift or
        # hidden extrapolated feature recovery is used as warning evidence.
        selected=np.unique(np.linspace(0,len(anchors)-1,min(len(anchors),POLICY["maxAnchorChecks"])).astype(int))
        observations=[]
        k=frame["intrinsics"]
        for index in selected:
            anchor=anchors[index]
            if current.at<=anchor.at: continue
            old_image,new_image,mapping=_exposure_pair(anchor,current)
            homography=k@current.rotation.T@anchor.rotation@np.linalg.inv(k)
            # A longer-baseline patch must be compared at a common apparent
            # scale: unnormalised NCC rejects correct expanding texture. The
            # detector supplies a search warp ONLY. Fresh bidirectional KLT and
            # photometry must recover actual pixels; its box scale is never the
            # measured point scale. Detector-only jitter remains a negative test.
            ratio=base._size(current.box.xyxy)/base._size(anchor.box.xyxy)
            prediction=np.diag((*ratio,1.))
            prediction[:2,2]=base._center(current.box.xyxy)-ratio*base._center(anchor.box.xyxy)
            old_image=cv2.warpPerspective(old_image,mapping@prediction@np.linalg.inv(mapping),
                                          old_image.shape[::-1],flags=cv2.INTER_LINEAR)
            predicted_points=base._project(anchor.points,prediction).astype(np.float32)
            predicted_box=type(current.box)(current.box.label,current.box.score,base._warp_rect(anchor.box.xyxy,prediction))
            tube=Tube(predicted_box,0,predicted_points,len(predicted_points),deque())
            matched,_=_flow(old_image,new_image,tube,current.box,homography@np.linalg.inv(prediction),mapping,others)
            q["anchorChecks"]+=1
            if matched is None: continue
            indexes,points=matched
            estimate=angular_growth(anchor.points[indexes],points,k)
            if estimate is None: continue
            net,mad=estimate
            age=current.at-anchor.at
            box=float(np.mean(np.log(base._size(current.box.xyxy)/base._size(anchor.box.xyxy))))
            observations.append((age,net,mad,box,len(points)))
        q["supportedAnchors"]=len(observations)
        if len(observations)<3 or max(v[0] for v in observations)<POLICY["minWindowMs"]:
            return {**q,"reason":"insufficient-direct-anchor-evidence"}
        age,net,mad,_,count=max(observations,key=lambda v:v[0])
        point_net=float(np.median([n/a for a,n,_,_,_ in observations]))*age
        box_net=float(np.median([b/a for a,_,_,b,_ in observations]))*age
        # MAD across correlated point pairs is an engineering consistency bound,
        # not an independent-sample confidence interval or metric uncertainty.
        q.update(observationMs=age,angularLogGrowth=net,angularLogMad=mad,
                 robustPointGrowth=point_net,robustBoxGrowth=box_net,
                 currentAngularLogGrowth=recent[0],points=count)
        supported=(mad<=POLICY["maxAngularLogMad"] and net>=max(POLICY["minNetAngularGrowth"],3*mad)
                   and point_net>=POLICY["minNetAngularGrowth"]
                   and np.percentile([n/a for a,n,_,_,_ in observations],25)>0
                   and box_net>=POLICY["minNetBoxGrowth"]
                   and abs(box_net-point_net)<=POLICY["maxGrowthDisagreement"]
                   and recent[0]>=POLICY["minCurrentAngularGrowth"])
        return {**q,"confirmed":bool(supported),"reason":"window-expansion-supported" if supported else "no-supported-window-expansion"}

    @staticmethod
    def _cumulative_evidence(tube,k):
        """R1 only: all samples share the same surviving point identities."""
        history=list(tube.history)
        q={"confirmed":False,"reason":"warming-window","observationMs":history[-1][0]-history[0][0]}
        if len(history)<POLICY["minFrames"] or q["observationMs"]<POLICY["minWindowMs"]:
            return q
        estimate=angular_growth(history[0][1],history[-1][1],k)
        recent=angular_growth(history[-2][1],history[-1][1],k)
        if estimate is None or recent is None:
            return {**q,"reason":"insufficient-angular-pairs"}
        net,mad=estimate
        box_logs=np.asarray([np.mean(np.log(size/history[0][2])) for _,_,size in history])
        growths=[angular_growth(history[0][1],p,k) for _,p,_ in history]
        if any(g is None for g in growths):
            return {**q,"reason":"insufficient-angular-pairs"}
        point_logs=np.asarray([g[0] for g in growths])
        times=np.asarray([at for at,_,_ in history])/1000.
        a,b=np.triu_indices(len(times),1)
        point_slopes=(point_logs[b]-point_logs[a])/(times[b]-times[a])
        box_slopes=(box_logs[b]-box_logs[a])/(times[b]-times[a])
        box_net=float(np.median(box_slopes))*q["observationMs"]/1000.
        point_net=float(np.median(point_slopes))*q["observationMs"]/1000.
        q.update(angularLogGrowth=net,angularLogMad=mad,robustPointGrowth=point_net,robustBoxGrowth=box_net,
                 currentAngularLogGrowth=recent[0],points=len(tube.points))
        supported=(mad<=POLICY["maxAngularLogMad"] and net>=max(POLICY["minNetAngularGrowth"],3*mad)
                   and point_net>=POLICY["minNetAngularGrowth"] and np.percentile(point_slopes,25)>0
                   and box_net>=POLICY["minNetBoxGrowth"] and abs(box_net-point_net)<=POLICY["maxGrowthDisagreement"]
                   and recent[0]>=POLICY["minCurrentAngularGrowth"])
        return {**q,"confirmed":bool(supported),"reason":"window-expansion-supported" if supported else "no-supported-window-expansion"}


class CumulativeWindowLoom(_WindowEngine):
    """R1: persistent sparse trajectories and robust cumulative angular trend."""
    anchor_mode=False


class AnchorWindowLoom(_WindowEngine):
    """R2: real bounded keyframe ROIs, not cumulative synthetic trajectories."""
    anchor_mode=True


# Public default restores the initial R1 candidate; R2 remains an explicit lane.
WindowLoom=CumulativeWindowLoom

