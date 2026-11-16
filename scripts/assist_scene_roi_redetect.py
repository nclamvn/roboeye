"""Bounded original-pixel detector recovery, not a distance or motion model.

Proposals come only from current/one-frame prior detector boxes. A crop cannot
create a track or warning directly. Every accepted rectangle still traverses
the ordinary calibrated camera/optical evidence gates in the caller.
"""

from collections import Counter
from dataclasses import dataclass
import math
from types import MappingProxyType

import numpy as np

from assist_scene_motion import Detection
from assist_scene_scale_approach import _center, _intersection, _iou, _size


POLICY = MappingProxyType({
    "maxCropsPerFrame": 2, "maxCropSidePx": 512, "minCropSidePx": 160,
    "nativeContextFactor": 3.0, "minSourceRatio": 1.15,
    "minWorkingTargetSidePx": 10., "maxWorkingTargetSidePx": 56.,
    "maxNativeSidePx": 4096, "maxNativePixels": 12_000_000,
    "cropEdgeFraction": .035, "cropEdgeMinPx": 4.,
    "minimumCropScore": .60, "anchorIou": .35, "replacementIou": .45,
    "duplicateIou": .55, "ambiguityMargin": .12, "maxOutputBoxes": 12,
    "maxPriorGapMs": 220.,
})
LABELS = frozenset({"person", "car", "truck", "bus", "bicycle", "motorcycle", "train"})


@dataclass(frozen=True)
class Crop:
    """Native pixel x0,y0,x1,y1, anchor in working coordinates."""
    rect: tuple[int, int, int, int]
    anchor: Detection
    source: str
    current_index: int | None


def valid_box(box, w, h):
    return (isinstance(box, Detection) and isinstance(box.label, str)
            and isinstance(box.score, (int, float)) and math.isfinite(box.score) and 0<=box.score<=1
            and len(box.xyxy)==4 and all(isinstance(a, (int,float)) and math.isfinite(a) for a in box.xyxy)
            and 0<=box.xyxy[0]<box.xyxy[2]<=w and 0<=box.xyxy[1]<box.xyxy[3]<=h)


def geometry(native_shape, working_shape):
    if (not isinstance(native_shape, (tuple,list)) or not isinstance(working_shape, (tuple,list))
            or len(native_shape)!=2 or len(working_shape)!=2
            or not all(type(x) is int and x>=32 for x in (*native_shape,*working_shape))):
        raise ValueError("Expected bounded source and working geometry")
    nh,nw=native_shape; h,w=working_shape
    if (max(nh,nw)>POLICY["maxNativeSidePx"] or nh*nw>POLICY["maxNativePixels"]
            or max(h,w)>768 or nh<h or nw<w or abs(nh/nw-h/w)>.003):
        raise ValueError("Source and working frame geometry differ")
    return nw/w, nh/h


class RoiRedetector:
    """Stateless planner; caller bounds prior boxes to one exact preceding frame."""

    def plan(self, current, previous, native_shape, working_shape, *, gap_ms=None):
        sx,sy=geometry(native_shape,working_shape)
        h,w=working_shape; nh,nw=native_shape
        if len(current)>12 or len(previous)>12 or not all(valid_box(b,w,h) for b in (*current,*previous)):
            raise ValueError("Malformed detector boxes")
        if min(sx,sy)<POLICY["minSourceRatio"]:
            return []
        prior=previous if (isinstance(gap_ms,(int,float)) and math.isfinite(gap_ms)
                           and 0<gap_ms<=POLICY["maxPriorGapMs"]) else []
        seeds=[]
        for j,b in enumerate(current):
            side=min(_size(b.xyxy))
            if (b.label in LABELS and POLICY["minWorkingTargetSidePx"]<=side<=POLICY["maxWorkingTargetSidePx"]
                    and min(b.xyxy[0],b.xyxy[1],w-b.xyxy[2],h-b.xyxy[3])>=4.):
                seeds.append((1, side, -b.score, j, b, "current"))
        for b in prior:
            side=min(_size(b.xyxy))
            if (b.label in LABELS and POLICY["minWorkingTargetSidePx"]<=side<=POLICY["maxWorkingTargetSidePx"]
                    and min(b.xyxy[0],b.xyxy[1],w-b.xyxy[2],h-b.xyxy[3])>=4.
                    and not any(_iou(b.xyxy,c.xyxy)>=POLICY["anchorIou"] for c in current)):
                seeds.append((0, side, -b.score, -1, b, "previous"))
        seeds.sort(key=lambda s:s[:4])
        planned=[]
        for _,_,_,idx,b,source in seeds:
            cx,cy=_center(b.xyxy)*[sx,sy]
            width,height=_size(b.xyxy)*[sx,sy]
            side=int(math.ceil(max(width,height)*POLICY["nativeContextFactor"]))
            side=min(POLICY["maxCropSidePx"],max(POLICY["minCropSidePx"],side))
            # Never upscale pixels or pad beyond sensor boundaries.
            side=min(side,nw,nh)
            x=max(0,min(nw-side,round(cx-side/2))); y=max(0,min(nh-side,round(cy-side/2)))
            rect=(x,y,x+side,y+side)
            if any(_iou(rect,c.rect)>=.50 for c in planned):
                continue
            planned.append(Crop(rect,b,source,idx if source=="current" else None))
            if len(planned)>=POLICY["maxCropsPerFrame"]:
                break
        return planned

    def merge(self, current, crops, crop_detections, native_shape, working_shape):
        sx,sy=geometry(native_shape,working_shape)
        h,w=working_shape
        if len(crops)>POLICY["maxCropsPerFrame"] or len(crops)!=len(crop_detections):
            raise ValueError("Unbounded or unbound crop detections")
        if len(current)>12 or not all(valid_box(b,w,h) for b in current):
            raise ValueError("Malformed shared detector boxes")
        proposals=[]; reasons=Counter()
        for crop,detected in zip(crops,crop_detections,strict=True):
            x,y,r,b=crop.rect
            cw,ch=r-x,b-y
            if (cw<32 or ch<32 or max(cw,ch)>POLICY["maxCropSidePx"] or min(x,y)<0
                    or r>native_shape[1] or b>native_shape[0] or len(detected)>12
                    or not all(valid_box(d,cw,ch) for d in detected)):
                raise ValueError("Malformed crop output")
            candidates=[]
            for det in detected:
                if det.label not in LABELS or det.score<POLICY["minimumCropScore"]:
                    reasons["class-or-score"]+=1; continue
                dx,dy,dr,db=det.xyxy
                margin=max(POLICY["cropEdgeMinPx"],min(cw,ch)*POLICY["cropEdgeFraction"])
                if min(dx,dy,cw-dr,ch-db)<margin:
                    reasons["crop-edge"]+=1; continue
                mapped=Detection(det.label,det.score,((x+dx)/sx,(y+dy)/sy,(x+dr)/sx,(y+db)/sy))
                overlap=_iou(mapped.xyxy,crop.anchor.xyxy)
                if overlap>=POLICY["anchorIou"]:
                    candidates.append((overlap,mapped))
            candidates.sort(key=lambda c:c[0],reverse=True)
            if not candidates:
                reasons["no-anchor-match"]+=1; continue
            # An apparently matching competing class is a reason to abstain,
            # not an excuse to change the label from a crop-only observation.
            if (len(candidates)>1 and candidates[0][0]-candidates[1][0]<POLICY["ambiguityMargin"]
                    or candidates[0][1].label!=crop.anchor.label):
                reasons["ambiguous-or-conflicting-class"]+=1; continue
            overlap,mapped=candidates[0]
            matches=[(j,_iou(mapped.xyxy,c.xyxy)) for j,c in enumerate(current)
                     if _iou(mapped.xyxy,c.xyxy)>=POLICY["anchorIou"]]
            if any(current[j].label!=mapped.label for j,_ in matches) or len(matches)>1:
                reasons["current-ambiguity"]+=1; continue
            idx=crop.current_index
            if crop.source=="current":
                if (idx is None or idx>=len(current) or current[idx]!=crop.anchor
                        or len(matches)!=1 or matches[0][0]!=idx):
                    reasons["lost-current-binding"]+=1; continue
                if overlap<POLICY["replacementIou"]:
                    reasons["replacement-shape-disagreement"]+=1; continue
            elif matches:
                reasons["prior-no-longer-missing"]+=1; continue
            proposals.append((idx,mapped,crop.source))
        output=list(current); accepted=[]
        for idx,mapped,source in proposals:
            if any(_iou(mapped.xyxy,b.xyxy)>=POLICY["anchorIou"] for _,b,_ in accepted):
                reasons["cross-crop-duplicate"]+=1; continue
            if idx is None:
                if len(output)>=POLICY["maxOutputBoxes"]:
                    reasons["output-budget"]+=1; continue
                output.append(mapped)
            else:
                output[idx]=mapped
            accepted.append((idx,mapped,source))
        reasons["replaced"]=sum(idx is not None for idx,_,_ in accepted)
        reasons["recovered"]=sum(idx is None for idx,_,_ in accepted)
        return output,{"accepted":len(accepted),"reasons":dict(reasons),
                       "acceptedSources":[s for _,_,s in accepted]}
