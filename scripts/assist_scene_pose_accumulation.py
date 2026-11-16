"""M3D Mac-only causal, disjoint longer-baseline visual pose evidence."""

from collections import Counter, deque
from collections.abc import Mapping
from dataclasses import dataclass
import math

import cv2
import numpy as np

from assist_scene_motion import registered
from assist_scene_motion_m3c import background, correspondences, inside, POLICY as OBJECT_POLICY
from assist_scene_pose_motion import POLICY as GEOMETRY_POLICY, _intrinsics, _timestamp, _transform, pose_pair, point_residuals


POLICY = {"minLongBaselineMs": 180., "maxLongBaselineMs": 300., "minTemporalDisjointGapMs": 30.,
          "maxEvidenceAgeMs": 1100., "maxFrames": 18, "maxTracks": 24, "maxPointsPerTrack": 52,
          "maxExternalClockErrorMs": .8, "minAppearancePoints": 16, "minAppearanceFraction": .62,
          "minDirectionCosine": .35}


@dataclass(frozen=True)
class Snapshot:
    frame: dict
    at: float
    gray: np.ndarray
    boxes: tuple
    ids: tuple


@dataclass(frozen=True)
class Vote:
    start: float
    end: float
    mode: str
    unit: np.ndarray
    residual: float
    points: int


def frame_status(frame, w, h):
    if not isinstance(frame, Mapping) or any(frame.get(k) is None for k in ("cameraToWorld", "poseTimestampUs")):
        return "missing-frame-pose"
    t, q = frame.get("timestampUs"), frame.get("poseTimestampUs")
    if not _timestamp(t) or not _timestamp(q):
        return "invalid-pose-clock"
    if abs(t-q) > GEOMETRY_POLICY["maxSkewUs"]:
        return "pose-skew"
    if _intrinsics(frame.get("intrinsics"),w,h) is None:
        return "invalid-intrinsics"
    if _transform(frame.get("cameraToWorld")) is None:
        return "invalid-camera-transform"
    if "epoch" in frame and (type(frame["epoch"]) is not int or frame["epoch"]<0):
        return "pose-epoch-mismatch"
    return None


def source_mask(image, box):
    h,w = image.shape
    a,b,c,d = box.xyxy
    x,y = .14*(c-a), .14*(d-b)
    mask = np.zeros(image.shape,np.uint8)
    mask[max(0,math.ceil(b+y)):min(h,math.floor(d-y)),max(0,math.ceil(a+x)):min(w,math.floor(c-x))] = 255
    return mask


def spread(points, box):
    a,b,c,d = box.xyxy
    return float(np.min(np.ptp(points,axis=0)/[c-a,d-b])) if len(points) else 0.


def appearance_ok(old, new):
    """A bounded image-similarity veto, independent of foreground tracks.

    Pair evidence uses a separate masked holdout. A frame with too few
    consistent patches is treated as a potential cut, never a new pose vote.
    """
    # Full-frame mask is only for this cut veto. No pose or motion is ever
    # fit from these correspondences; geometry uses masked background below.
    a,b = correspondences(old,new,np.full(old.shape,255,np.uint8),72)
    h,w = old.shape
    score = []
    for ox,oy,cx,cy in np.column_stack((a,b)):
        if not all(5 <= x <= w-6 for x in (ox,cx)) or not all(5 <= y <= h-6 for y in (oy,cy)):
            continue
        patch0=cv2.getRectSubPix(old,(7,7),(float(ox),float(oy))).astype(float)
        patch1=cv2.getRectSubPix(new,(7,7),(float(cx),float(cy))).astype(float)
        patch0-=patch0.mean()
        patch1-=patch1.mean()
        norm=float(np.linalg.norm(patch0)*np.linalg.norm(patch1))
        if norm>35:
            score.append(float(np.sum(patch0*patch1)/norm))
    yes = sum(s>=.74 for s in score)
    return yes>=POLICY["minAppearancePoints"] and yes>=POLICY["minAppearanceFraction"]*len(score), len(score)


def unique_assoc(old, current, current_boxes):
    edges=[]
    for i, source in enumerate(old.boxes):
        candidates=[j for j, box in enumerate(current_boxes) if box.label==source.label]
        if not candidates:
            continue
        a,b=correspondences(old.gray,current,source_mask(old.gray,source),POLICY["maxPointsPerTrack"])
        for j in candidates:
            selected=inside(b,current_boxes[j].xyxy)
            if (np.count_nonzero(selected)>=OBJECT_POLICY["minObjectPoints"] and
                    np.mean(selected)>=OBJECT_POLICY["minObjectSupport"] and
                    min(spread(a[selected],source),spread(b[selected],current_boxes[j]))>=OBJECT_POLICY["minObjectSpan"]):
                edges.append((i,j))
    sources, targets=Counter(a for a,_ in edges),Counter(b for _,b in edges)
    return {j:old.ids[i] for i,j in edges if sources[i]==targets[j]==1}


def vectors(pair, a, b):
    if pair.mode == "rotation":
        warped=np.column_stack((a,np.ones(len(a))))@pair.homography.T
        return b-warped[:,:2]/warped[:,2:]
    line=np.column_stack((a,np.ones(len(a))))@pair.fundamental.T
    direction=line[:,:2]/np.linalg.norm(line[:,:2],axis=1)[:,None]
    error=np.sum(np.column_stack((b,np.ones(len(b))))*line,axis=1)
    return direction*np.sign(error)[:,None]


def object_vote(pair, floor, prior, gray, old, box):
    a,b=correspondences(prior.gray,gray,source_mask(prior.gray,old),POLICY["maxPointsPerTrack"])
    kept=inside(b,box.xyxy)
    n=OBJECT_POLICY["minObjectPoints"]
    ratio=OBJECT_POLICY["minObjectSupport"]
    if np.count_nonzero(kept)<n or np.mean(kept)<ratio:
        return None
    a,b=a[kept],b[kept]
    residual,usable=point_residuals(pair,a,b)
    strong=usable & (residual>floor)
    if np.count_nonzero(strong)<n or np.mean(strong)<ratio:
        return None
    if min(spread(a[strong],old),spread(b[strong],box))<OBJECT_POLICY["minObjectSpan"]:
        return None
    d=vectors(pair,a[strong],b[strong]); norm=np.linalg.norm(d,axis=1)
    if not np.isfinite(d).all() or np.min(norm)<=1e-9:
        return None
    d/=norm[:,None]
    axis=np.mean(d,axis=0); magnitude=float(np.linalg.norm(axis))
    if magnitude<.55:
        return None
    axis/=magnitude
    if np.mean(d @ axis >=.55)<ratio:
        return None
    return axis,float(np.median(residual[strong])),int(np.count_nonzero(strong))


class PoseAccumulation:
    """One instance per stream; no shared or future frames, no metres output."""

    def __init__(self):
        self.epoch=0
        self.next_id=1
        self.history=deque(maxlen=POLICY["maxFrames"])
        self.votes={}

    def reset(self):
        self.epoch+=1
        self.history.clear()
        self.votes.clear()

    def _ids(self, boxes, matched=None):
        out=[]
        for j,_ in enumerate(boxes):
            if matched is not None and j in matched:
                out.append(matched[j])
            else:
                out.append(self.next_id)
                self.next_id+=1
        return tuple(out)

    def _result(self,status,boxes,ids,w,h,diagnostics=None,events=None):
        return {"status":status,"epoch":self.epoch,"diagnostics":diagnostics or {},"events":events or [],
                "tracks":[{"id":i,**box.record(w,h)} for box,i in zip(boxes,ids)]}

    def update(self,frame,t_ms,gray,boxes):
        if (not isinstance(gray,np.ndarray) or gray.ndim!=2 or gray.dtype!=np.uint8 or
                not 32<=min(gray.shape)<=max(gray.shape)<=768):
            self.reset()
            return self._result("invalid-image-size",(),(),1,1)
        h,w=gray.shape
        boxes=tuple(boxes) if boxes is not None else ()
        if len(boxes)>POLICY["maxTracks"]:
            self.reset()
            return self._result("track-budget",(),(),w,h)
        if not isinstance(t_ms,(float,int)) or not math.isfinite(t_ms) or t_ms<0:
            self.reset()
            return self._result("invalid-stream-clock",boxes,self._ids(boxes),w,h)
        reject=frame_status(frame,w,h)
        if reject:
            self.reset()
            return self._result(reject,boxes,self._ids(boxes),w,h)
        # Own pose and image buffers for exactly the bounded history window.
        metadata={key:frame[key] for key in ("timestampUs","poseTimestampUs")}
        metadata.update(cameraToWorld=np.asarray(frame["cameraToWorld"]).copy(),
                        intrinsics=_intrinsics(frame["intrinsics"],w,h).copy())
        if "epoch" in frame:
            metadata["epoch"]=frame["epoch"]

        def seed(status,info=None):
            self.reset()
            ids=self._ids(boxes)
            self.history.append(Snapshot(metadata,t_ms,gray.copy(),boxes,ids))
            return self._result(status,boxes,ids,w,h,info)

        if not self.history:
            return seed("warming-up")
        prev=self.history[-1]
        tm=(frame["timestampUs"]-prev.frame["timestampUs"])/1000
        if t_ms<=prev.at or abs(t_ms-prev.at-tm)>POLICY["maxExternalClockErrorMs"] or gray.shape!=prev.gray.shape:
            return seed("stream-discontinuity")
        if prev.frame.get("epoch")!=frame.get("epoch"):
            return seed("pose-epoch-mismatch")
        adjacent, adj_q=pose_pair(prev.frame,metadata,w,h)
        if adjacent is None and adj_q["status"]!="epipolar-baseline-too-small":
            return seed(adj_q["status"],{"adjacent":adj_q})
        if adjacent is not None and adjacent.mode=="rotation" and adj_q["maxSkewUs"]!=0:
            return seed("rotation-requires-exact-clock",{"adjacent":adj_q})
        appearance,count=appearance_ok(prev.gray,gray)
        adj_q["appearancePoints"]=count
        if not appearance:
            return seed("cut-or-insufficient-appearance",{"adjacent":adj_q})
        if adjacent is not None:
            verified,bg=background(adjacent,prev.gray,gray,prev.boxes,boxes,adjacent.floor_px)
            adj_q["background"]=bg
            if not verified:
                return seed("adjacent-background-mismatch",{"adjacent":adj_q})
        else:
            # A sub-floor nonzero baseline is never treated as pure rotation.
            # Strict RGB registration only verifies visual continuity here.
            matrix,q=registered(prev.gray,gray,prev.boxes,boxes)
            adj_q["visualContinuity"]=q["status"]
            if matrix is None:
                return seed("adjacent-background-mismatch",{"adjacent":adj_q})

        ids=self._ids(boxes,unique_assoc(prev,gray,boxes))
        self.votes={i:q for i,q in self.votes.items() if i in ids}
        while self.history and t_ms-self.history[0].at>POLICY["maxEvidenceAgeMs"]:
            self.history.popleft()
        candidates=[s for s in self.history
                    if POLICY["minLongBaselineMs"]<=t_ms-s.at<=POLICY["maxLongBaselineMs"]]
        # One deterministic baseline per frame (longest in policy). No vote
        # shopping across anchors and no fallback to older cached positives.
        diagnostic={"adjacent":adj_q,"candidateCount":len(candidates),"retainedFrames":len(self.history),"longPair":None}
        self.history.append(Snapshot(metadata,t_ms,gray.copy(),boxes,ids))
        if not candidates:
            return self._result("warming-up",boxes,ids,w,h,diagnostic)
        prior=candidates[0]
        pair,q=pose_pair(prior.frame,metadata,w,h)
        diagnostic["longPair"]={"startMs":prior.at,"endMs":t_ms,**q}
        if pair is None:
            return self._result("no-valid-long-pair",boxes,ids,w,h,diagnostic)
        if pair.mode=="rotation" and q["maxSkewUs"]!=0:
            return self._result("rotation-requires-exact-clock",boxes,ids,w,h,diagnostic)
        verified,bg=background(pair,prior.gray,gray,prior.boxes,boxes,pair.floor_px)
        diagnostic["longPair"]["background"]=bg
        if not verified:
            return self._result("long-background-mismatch",boxes,ids,w,h,diagnostic)
        floor=pair.floor_px+max(0.,bg["p90Px"] or 0.)
        diagnostic["longPair"]["objectFloorPx"]=floor
        old_boxes=dict(zip(prior.ids,prior.boxes))
        events=[]
        for i,box in zip(ids,boxes):
            if i not in old_boxes:
                continue
            received=object_vote(pair,floor,prior,gray,old_boxes[i],box)
            if received is None:
                continue
            votes=self.votes.setdefault(i,deque(maxlen=16))
            while votes and t_ms-votes[0].end>POLICY["maxEvidenceAgeMs"]:
                votes.popleft()
            axis,px,n=received
            found=next((v for v in reversed(votes) if v.mode==pair.mode and
                        prior.at-v.end>=POLICY["minTemporalDisjointGapMs"] and
                        t_ms-v.start<=POLICY["maxEvidenceAgeMs"] and
                        float(v.unit@axis)>=POLICY["minDirectionCosine"]),None)
            votes.append(Vote(prior.at,t_ms,pair.mode,axis,px,n))
            if found is not None:
                events.append({"trackId":i,"label":box.label,"epoch":self.epoch,"timeMs":t_ms,"pairCount":2,
                               "lastResidualPx":px,"lastPoints":n,
                               "disjointPairsMs":[[found.start,found.end],[prior.at,t_ms]]})
        return self._result("valid",boxes,ids,w,h,diagnostic,events)
