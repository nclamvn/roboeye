"""M3Q research-only independent RootSIFT endpoint/pixel verifier.

SIFT inventories are source-only and sealed before global reciprocal matching.
The learned flow is an additional independent consistency veto, not the source
of descriptor endpoints. This compound ablation changes the source selector as
well as correspondence verification; it is not a pure verifier ablation.
No thresholds from the frozen warning engine are weakened, no tracker is added,
and no quantity is a distance or a confidence interval.
"""

from collections import Counter
from copy import deepcopy
from hashlib import sha256
import json
import math
from time import perf_counter
from types import MappingProxyType

import cv2
import numpy as np

import assist_scene_global_window as frozen
import assist_scene_texture_patches as texture
import assist_scene_textured_window as geometric


POLICY = MappingProxyType({**dict(frozen.POLICY),
    "method": "rootsift-independent-endpoint-strict-flow-window",
    "selector": "global-sift-source-cell-response-v1", "maxFeatures": 5000,
    "descriptor": "L1-sqrt-RootSIFT", "ratio": .70,
    "descriptorUniqueness": "both-direction-ratio-and-mutual-nearest-global",
    "descriptorSupport": "opencv-sift-conservative-circular-radius-round-5.3033-times-size",
    "pixelVerification": dict(texture.POLICY),
    "seedDenominator": "all-original-source-selected-points-before-correspondence",
    "strictFlowAgreementPx": 1.3,
})
_OFFSETS = np.array([(x,y) for y in range(-3,4) for x in range(-3,4)], np.float32)


def canonical(value):
    return sha256(json.dumps(value,sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()


def _digest(image):
    return sha256(np.ascontiguousarray(image).tobytes()).hexdigest()


def _image(image):
    if (not isinstance(image,np.ndarray) or image.dtype!=np.uint8 or image.ndim!=2
            or not 32<=min(image.shape)<=max(image.shape)<=768):
        raise ValueError("Expected bounded uint8 grayscale32..768 source pixels")
    return image


def descriptor_radius(size):
    """OpenCV SIFT d=4, hist_width=3*sigma, sigma=keypoint.size/2.

    The descriptor implementation scans this conservative enclosing radius.
    It is not the smaller7x7 photometric verification footprint. Gaussian
    pyramid construction can draw from outside this footprint: this check is
    not a guarantee of instance segmentation or zero background influence.
    """
    if not isinstance(size,(int,float)) or not math.isfinite(size) or size<=0:
        raise ValueError("Finite positive SIFT keypoint size required")
    return int(np.rint((size/2)*3*math.sqrt(2)*(4+1)/2))


def footprint_inside(point,radius,box):
    p=np.asarray(point,float); rect=np.asarray(getattr(box,"xyxy",box),float)
    return bool(p.shape==(2,) and rect.shape==(4,) and np.isfinite(p).all()
        and np.isfinite(rect).all() and np.all(p-radius>=rect[:2]) and np.all(p+radius<=rect[2:]))


def rootsift(descriptors):
    value=np.asarray(descriptors,np.float32)
    if value.ndim!=2 or value.shape[1]!=128 or not np.isfinite(value).all() or np.any(value<0):
        raise ValueError("Finite nonnegative Nx128 SIFT descriptors required")
    norm=np.sum(value,axis=1,keepdims=True)
    return np.sqrt(np.divide(value,norm,out=np.zeros_like(value),where=norm>0)).astype(np.float32)


def _selection(image_hash,shape,points,box):
    rect=np.asarray(getattr(box,"xyxy",box),float)
    if (rect.shape!=(4,) or not np.isfinite(rect).all() or np.any(rect[2:]<=rect[:2])
            or np.any(rect[:2]<0) or np.any(rect[2:]>shape[::-1])):
        raise ValueError("Finite nonempty source rectangle within image required")
    lo=rect[:2]+.12*(rect[2:]-rect[:2]);hi=rect[2:]-.12*(rect[2:]-rect[:2]);cells={}
    positions=np.asarray([k["point"] for k in points],float).reshape(-1,2)
    eligible=np.flatnonzero(((positions>=np.maximum(lo,rect[:2]+3)).all(axis=1)
        &(positions<=np.minimum(hi,rect[2:]-3)).all(axis=1)))
    for index in eligible:
        index=int(index);k=points[index];p=positions[index]
        # Eligibility is source-only. Descriptor footprints leaving the object
        # are NOT removed here: the sealed seed later remains UNKNOWN.
        cx,cy=np.minimum(7,np.floor((p-lo)/(hi-lo)*8).astype(int))
        cell=(int(cy),int(cx));rank=(-k["response"],p[1],p[0],k["size"],k["angle"],index)
        if cell not in cells or rank<cells[cell][0]:cells[cell]=(rank,index)
    indices=[cells[c][1] for c in sorted(cells)]
    return {"sourceOnly":True,"sourceSha256":image_hash,"sourceShape":list(shape),
        "sourceBox":rect.tolist(),"indices":indices,"points":[points[i]["point"] for i in indices],
        "cells":[list(c) for c in sorted(cells)],"seedPoints":len(indices),"selectorPolicy":dict(POLICY)}


class RootSiftMatcher:
    """No imports/downloads/model work; two image inventories then one match."""

    def __init__(self):
        self._sift=cv2.SIFT_create(nfeatures=POLICY["maxFeatures"])
        self.parameters={name:getattr(self._sift,name)() for name in sorted(dir(self._sift))
            if name.startswith("get") and name!="getDefaultName"}
        self.metadata={"algorithm":"opencv-SIFT-RootSIFT-BF-L2", "opencv":cv2.__version__,
            "parameters":deepcopy(self.parameters),"policy":dict(POLICY)}
        self.prepare_calls=0;self.match_calls=0

    def prepare(self,image,boxes):
        image=_image(image);tick=perf_counter();self.prepare_calls+=1
        keypoints,descriptors=self._sift.detectAndCompute(image,None)
        # Stable ties include orientation: duplicate orientations remain in the
        # GLOBAL catalog and therefore remain possible descriptor ratio rivals.
        retained=sorted(range(len(keypoints)),key=lambda i:(-keypoints[i].response,keypoints[i].pt[1],
            keypoints[i].pt[0],keypoints[i].size,keypoints[i].angle,keypoints[i].octave,i))[:5000]
        order=sorted(retained,key=lambda i:(keypoints[i].pt[1],keypoints[i].pt[0],
            keypoints[i].size,keypoints[i].angle,-keypoints[i].response,keypoints[i].octave,i))
        points=[]
        for i in order:
            k=keypoints[i]
            points.append({"point":list(k.pt),"size":float(k.size),"angle":float(k.angle),
                "response":float(k.response),"octave":int(k.octave),"radius":descriptor_radius(float(k.size))})
        desc=(np.empty((0,128),np.float32) if descriptors is None else rootsift(descriptors[order]))
        selections=[_selection(_digest(image),image.shape,points,box) for box in boxes]
        inventory={"sourceOnly":True,"sourceSha256":_digest(image),"sourceShape":list(image.shape),
            "keypoints":points,"descriptors":desc,"descriptorsSha256":_digest(desc),
            "catalogSha256":canonical(points),"selections":selections,
            "selectionSha256s":[canonical(s) for s in selections],"prepareMs":1000*(perf_counter()-tick)}
        return inventory

    def match(self,old,new):
        self.match_calls+=1;tick=perf_counter()
        for inv in (old,new):validate_inventory(inv)
        a,b=old["descriptors"],new["descriptors"]
        maps=[];pairs=[]
        if min(len(a),len(b))>=2:
            bf=cv2.BFMatcher(cv2.NORM_L2,crossCheck=False)
            for first,second in ((a,b),(b,a)):
                result={}
                for neighbours in bf.knnMatch(first,second,k=2):
                    if len(neighbours)!=2:continue
                    x,y=neighbours
                    if math.isfinite(x.distance) and math.isfinite(y.distance) and y.distance>0:
                        result[x.queryIdx]={"index":x.trainIdx,"descriptorDistance":float(x.distance),
                            "secondDescriptorDistance":float(y.distance),"ratio":float(x.distance/y.distance),
                            "unique":x.distance<POLICY["ratio"]*y.distance}
                maps.append(result)
            for i,x in maps[0].items():
                j=x["index"];reverse=maps[1].get(j)
                if x["unique"] and reverse is not None and reverse["unique"] and reverse["index"]==i:
                    pairs.append({"oldIndex":i,"newIndex":j,"forward":x,"reverse":reverse})
        return {"oldSourceSha256":old["sourceSha256"],"newSourceSha256":new["sourceSha256"],
            "oldCatalogSha256":old["catalogSha256"],"newCatalogSha256":new["catalogSha256"],
            "oldDescriptorsSha256":old["descriptorsSha256"],"newDescriptorsSha256":new["descriptorsSha256"],
            "pairs":pairs,"pairCount":len(pairs),"matchMs":1000*(perf_counter()-tick),
            "policy":dict(POLICY),"evidence":"independent-descriptor-endpoints-not-optical-flow-or-identity-truth"}


def validate_inventory(inventory,image=None):
    try:
        desc=inventory["descriptors"];points=inventory["keypoints"];h,w=inventory["sourceShape"]
        digest=inventory["sourceSha256"]
        if (any(type(x) is not int or not 32<=x<=768 for x in (h,w)) or not isinstance(digest,str)
                or len(digest)!=64 or any(c not in "0123456789abcdef" for c in digest)):raise ValueError()
        if (inventory["sourceOnly"] is not True or not isinstance(desc,np.ndarray) or desc.dtype!=np.float32
                or desc.shape!=(len(points),128) or not np.isfinite(desc).all() or np.any(desc<0)
                or _digest(desc)!=inventory["descriptorsSha256"] or canonical(points)!=inventory["catalogSha256"]):raise ValueError()
        if len(points)>5000:raise ValueError()
        norms=np.linalg.norm(desc,axis=1)
        if np.any((norms>1e-6)&(np.abs(norms-1)>1e-5)):raise ValueError()
        for point in points:
            if (len(point["point"])!=2 or not np.isfinite(point["point"]).all()
                    or not np.all(np.asarray(point["point"])>=0) or not np.all(np.asarray(point["point"])<[w,h])
                    or not math.isfinite(point["angle"]) or not 0<=point["angle"]<360
                    or not math.isfinite(point["response"]) or point["response"]<0 or type(point["octave"]) is not int
                    or point["radius"]!=descriptor_radius(point["size"])):raise ValueError()
        if inventory["selectionSha256s"]!=[canonical(s) for s in inventory["selections"]]:raise ValueError()
        for s in inventory["selections"]:
            if (s["sourceOnly"] is not True or s["sourceSha256"]!=inventory["sourceSha256"]
                    or s["sourceShape"]!=inventory["sourceShape"] or s["selectorPolicy"]!=dict(POLICY)
                    or len(s["indices"])!=s["seedPoints"] or not 0<=s["seedPoints"]<=64
                    or len(set(s["indices"]))!=s["seedPoints"]
                    or s["points"]!=[points[i]["point"] for i in s["indices"]]):raise ValueError()
            if s!=_selection(digest,(h,w),points,s["sourceBox"]):raise ValueError()
        if image is not None and (_digest(image)!=inventory["sourceSha256"] or list(image.shape)!=inventory["sourceShape"]):raise ValueError()
    except (KeyError,IndexError,TypeError,ValueError,OverflowError) as error:
        raise ValueError("Invalid source-only RootSIFT inventory") from error
    return True


def validate_matches(matches,old,new):
    """Certificate binding, reciprocal uniqueness and actual descriptor values.

    This validates listed global matches, not that an omitted match was absent.
    Complete matching can be independently replayed from the sealed inventories.
    """
    try:
        for name,inv in (("old",old),("new",new)):
            if (matches[name+"SourceSha256"]!=inv["sourceSha256"] or matches[name+"CatalogSha256"]!=inv["catalogSha256"]
                    or matches[name+"DescriptorsSha256"]!=inv["descriptorsSha256"]):raise ValueError()
        pairs=matches["pairs"]
        if (matches["policy"]!=dict(POLICY) or matches["pairCount"]!=len(pairs)
                or len({p["oldIndex"] for p in pairs})!=len(pairs)
                or len({p["newIndex"] for p in pairs})!=len(pairs)):raise ValueError()
        for p in pairs:
            i,j=p["oldIndex"],p["newIndex"]
            if (type(i) is not int or type(j) is not int or not 0<=i<len(old["keypoints"])
                    or not 0<=j<len(new["keypoints"])):raise ValueError()
            actual=float(np.linalg.norm(old["descriptors"][i]-new["descriptors"][j]))
            for name,idx in (("forward",j),("reverse",i)):
                value=p[name];d,s=value["descriptorDistance"],value["secondDescriptorDistance"]
                if (value["index"]!=idx or value["unique"] is not True
                        or not math.isfinite(d) or not math.isfinite(s) or not 0<=d<.70*s
                        or abs(actual-d)>1e-5 or abs(value["ratio"]-d/s)>1e-8):raise ValueError()
    except (KeyError,TypeError,ValueError,OverflowError,IndexError) as error:
        raise ValueError("Invalid global reciprocal descriptor matches") from error
    return True


def _linear(first,second):
    angle=(second["angle"]-first["angle"]+180)%360-180
    ratio=second["size"]/first["size"];r=math.radians(angle)
    linear=ratio*np.array([[math.cos(r),-math.sin(r)],[math.sin(r),math.cos(r)]])
    valid=(abs(math.log(ratio))<=texture.POLICY["maxLinearLogGrowth"]
        and abs(angle)<=texture.POLICY["maxRotationDeg"])
    return linear,{"rotationDeg":angle,"linearLogGrowth":math.log(ratio),"anisotropyLog":0.},valid


def population(old_image,new_image,old_inventory,new_inventory,selection,matches,fields,*,reverse=False):
    """Every selected source seed remains in denominator, including unknowns."""
    old_image,new_image=_image(old_image),_image(new_image)
    validate_inventory(old_inventory,old_image);validate_inventory(new_inventory,new_image)
    if old_image.shape!=new_image.shape:raise ValueError("Equal working geometry required")
    first_name,last_name=("new","old") if reverse else ("old","new")
    if (matches.get(first_name+"CatalogSha256")!=old_inventory["catalogSha256"]
            or matches.get(last_name+"CatalogSha256")!=new_inventory["catalogSha256"]
            or matches.get(first_name+"DescriptorsSha256")!=old_inventory["descriptorsSha256"]
            or matches.get(last_name+"DescriptorsSha256")!=new_inventory["descriptorsSha256"]
            or matches.get("policy")!=dict(POLICY)):
        raise ValueError("Descriptor matches belong to different sealed exposures")
    validate_matches(matches,*( (new_inventory,old_inventory) if reverse else (old_inventory,new_inventory)))
    if canonical(selection) not in old_inventory["selectionSha256s"]:raise ValueError("Unsealed source selection")
    if not isinstance(fields,(tuple,list)) or len(fields)!=2:raise ValueError("Exactly two original-working fields required")
    for field in fields:
        if not isinstance(field,np.ndarray) or field.dtype!=np.float32 or field.shape!=(*old_image.shape,2) or not np.isfinite(field).all():
            raise ValueError("Finite original-working forward/reverse fields required")
    a=np.asarray(selection["points"],np.float32).reshape(-1,2);b=np.full_like(a,np.nan)
    cycles=np.full(len(a),np.inf);good=np.zeros(len(a),bool);records=[]
    key="newIndex" if reverse else "oldIndex";other="oldIndex" if reverse else "newIndex"
    lookup={p[key]:p for p in matches["pairs"]}
    for n,index in enumerate(selection["indices"]):
        first=old_inventory["keypoints"][index];start=np.asarray(first["point"],np.float32)
        source=cv2.getRectSubPix(old_image,(7,7),tuple(map(float,start)))
        source_variance=float(np.var(source.astype(np.float64)))
        rec={"pointIndex":n,"catalogIndex":index,"sourcePoint":start.tolist(),"good":False,
            "reason":"unmatched-or-ambiguous-descriptor","sourceDescriptorRadiusPx":first["radius"],
            "sourcePatchVariance":source_variance,
            "destinationPoint":None,"centerCyclePx":None,"flowEndpointAgreementPx":None,
            "correlation":None,"normProduct":None,"patchValidSamples":0,"patchCycleCount":None}
        records.append(rec)
        if source_variance<texture.POLICY["minSourceVariance"]:rec["reason"]="source-low-variance";continue
        if not footprint_inside(start,first["radius"],selection["sourceBox"]):rec["reason"]="source-descriptor-leaves-object";continue
        pair=lookup.get(index)
        if pair is None:continue
        target_index=pair[other];second=new_inventory["keypoints"][target_index];end=np.asarray(second["point"],np.float32);b[n]=end
        rec.update(destinationPoint=end.tolist(),destinationCatalogIndex=target_index,
            destinationDescriptorRadiusPx=second["radius"],descriptorMatch=deepcopy(pair))
        if not footprint_inside(end,second["radius"],[0,0,new_image.shape[1]-1,new_image.shape[0]-1]):
            rec["reason"]="destination-descriptor-leaves-image";continue
        fwd,valid,_=texture._sample(fields[0],start[None]);back,backvalid,_=texture._sample(fields[1],end[None])
        agreement=float(np.linalg.norm(start+fwd[0]-end));cycle=float(np.linalg.norm(end+back[0]-start));cycles[n]=cycle
        rec.update(centerCyclePx=cycle,flowEndpointAgreementPx=agreement)
        if not valid[0] or not backvalid[0] or max(agreement,cycle)>1.3:rec["reason"]="independent-raft-endpoint-or-return";continue
        linear,shape,shape_ok=_linear(first,second);rec.update(shape)
        if not shape_ok:rec["reason"]="descriptor-local-shape";continue
        offsets=start+_OFFSETS;mapped=np.asarray(end+_OFFSETS@linear.T,np.float32)
        delta,valid,_=texture._sample(fields[0],offsets);rewind,rev_valid,_=texture._sample(fields[1],mapped)
        in_image=((mapped>=0).all(axis=1)&(mapped<=[new_image.shape[1]-1,new_image.shape[0]-1]).all(axis=1))
        rec["patchValidSamples"]=int(np.count_nonzero(valid&rev_valid&in_image))
        if rec["patchValidSamples"]!=49:rec["reason"]="patch-out-of-bounds-or-invalid-flow";continue
        patchgood=(np.linalg.norm(offsets+delta-mapped,axis=1)<=1.3)&(np.linalg.norm(mapped+rewind-offsets,axis=1)<=1.3)
        count=int(patchgood.sum());rec.update(patchCycleCount=count,patchCycleFraction=count/49)
        if count<.70*49:rec["reason"]="patch-cycle";continue
        target=cv2.remap(new_image.astype(np.float32),mapped[:,0].reshape(7,7),mapped[:,1].reshape(7,7),
            cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
        norm,corr,ok=texture._ncc(source,target);rec.update(normProduct=norm,correlation=corr)
        rec["reason"]="verified-independent-descriptor-pixel" if ok else "patch-ncc"
        rec["good"]=bool(ok);good[n]=ok
    proof={"mode":"rootsift-independent-strict-flow","status":"measured","seedPoints":len(a),
        "verifiedPoints":int(good.sum()),"oldWorkingSha256":_digest(old_image),"newWorkingSha256":_digest(new_image),
        "selection":deepcopy(selection),"selectionSha256":canonical(selection),"points":records,
        "reasonCounts":dict(Counter(r["reason"] for r in records)),
        "evidence":"measured-working-descriptors-and-pixels-not-confidence-interval"}
    validate_source_variance(proof)
    return a,b,cycles,good,proof


def validate_source_variance(proof):
    """Fail closed on missing/forged16-variance-floor certificates.

    These numeric checks cannot certify actual pixels. Independent replay must
    recompute the fractional-center7x7 getRectSubPix variance from the source.
    """
    try:
        if len(proof["points"])!=proof["seedPoints"]:raise ValueError()
        for record in proof["points"]:
            value=record["sourcePatchVariance"]
            if type(value) not in (int,float) or not math.isfinite(value) or value<0:raise ValueError()
            if value<texture.POLICY["minSourceVariance"]:
                if record["good"] is not False or record["reason"]!="source-low-variance":raise ValueError()
            elif record["reason"]=="source-low-variance":raise ValueError()
    except (KeyError,TypeError,ValueError,OverflowError) as error:
        raise ValueError("Invalid unchanged source-variance floor certificate") from error
    return True


def direction(population_value,old_box,new_box,homography):
    """Add own-target descriptor support only after GLOBAL matching.

    A verified endpoint outside a rival box remains known negative evidence.
    An endpoint inside the proposed box whose descriptor crosses its boundary
    is UNKNOWN, never a target-conditioned seed removal or a positive match.
    """
    a,b,cycles,good,popproof=population_value
    validate_source_variance(popproof)
    good=good.copy();inside=frozen.base._inside(b,new_box.xyxy,.04);rejected=[]
    for n,record in enumerate(popproof["points"]):
        if good[n] and inside[n] and not footprint_inside(b[n],record["destinationDescriptorRadiusPx"],new_box.xyxy):
            good[n]=False;rejected.append(n)
    if not len(a):return {"seedPoints":0,"verifiedPoints":0,"assignedPoints":0,"unknownPoints":0,
        "assignedFraction":0.,"points":0,"supportFraction":0.,"supported":False,"reason":"unverifiable-source-selection","inlierIndices":[]}
    proof=geometric._direction((a,b,cycles,good),old_box,new_box,homography)
    proof["targetDescriptorSupportUnknownIndices"]=rejected
    return proof


class RootSiftGlobalWindowMotion(frozen.GlobalWindowMotion):
    """Additive method; frozen current IDs/camera/temporal/warning contracts."""

    def __init__(self,flow_provider):
        super().__init__(flow_provider);self.matcher=RootSiftMatcher();self._pending=None

    def _origin(self,old,current,diagnostics):
        first=getattr(old,"source_inventory",None);second=self._pending
        if first is None or second is None:raise ValueError("Missing pre-matching source inventories")
        validate_inventory(first,old.pixels);validate_inventory(second,current.pixels)
        tick=perf_counter();before=self.flow_provider.direction_calls
        fields=self.flow_provider(old.pixels,current.pixels);calls=self.flow_provider.direction_calls-before
        frozen._require(calls==2,"One actual forward/reverse provider execution required")
        pair=self.matcher.match(first,second);field_id=f"{old.frame['token']}->{current.frame['token']}"
        diagnostics["globalFields"].append({"fieldId":field_id,"startToken":old.frame["token"],"endToken":current.frame["token"],
            "startMs":old.at,"endMs":current.at,"startSha256":old.frame["sourceSha256"],"endSha256":current.frame["sourceSha256"],
            "oldWorkingPixelsSha256":_digest(old.pixels),"newWorkingPixelsSha256":_digest(current.pixels),
            "fieldSha256":{name:_digest(f) for name,f in zip(("forward","backward"),fields,strict=True)},
            "fieldShapes":[list(f.shape) for f in fields],"provider":deepcopy(getattr(self.flow_provider,"last_call",{})),
            "providerKind":getattr(self.flow_provider,"metadata",{}).get("kind","injected-test-provider"),
            "modelDirectionCalls":calls,"descriptorMatching":deepcopy(pair),"wallMs":1000*(perf_counter()-tick)})
        forward=[population(old.pixels,current.pixels,first,second,s,pair,fields) for s in first["selections"]]
        reverse=[population(current.pixels,old.pixels,second,first,s,pair,fields[::-1],reverse=True) for s in second["selections"]]
        entries={}
        for label,exposure,values in (("forward",old,forward),("reverse",current,reverse)):
            for index,value in enumerate(values):
                entry={"populationId":f"{field_id}|{label}|{index}","fieldId":field_id,
                    "direction":label,"detectionIndex":index,"sourceToken":exposure.frame["token"],
                    "sourceMs":exposure.at,"sourceSha256":exposure.frame["sourceSha256"],
                    "selectionSha256":value[4]["selectionSha256"],"populationSha256":canonical(value[4]),"proof":value[4]}
                diagnostics.setdefault("populations",[]).append(entry);entries[label,index]=entry
        comparisons=[]
        for j,new_box in enumerate(current.boxes):
            for i,old_box in enumerate(old.boxes):
                if not frozen.eligible_pair(old_box,new_box,old.frame,current.frame):continue
                h=frozen.rotation_homography(old.frame,current.frame)
                unusable=(frozen._small(old_box,old.pixels.shape) or frozen._small(new_box,current.pixels.shape)
                    or len(forward[i][0])<9 or len(reverse[j][0])<9)
                f,r=(direction(forward[i],old_box,new_box,h),direction(reverse[j],new_box,old_box,np.linalg.inv(h)))
                if unusable:
                    for d in (f,r):
                        n=d["seedPoints"]
                        d.update(supported=False,reason="unverifiable-object-geometry-or-source-selection",
                            verifiedPoints=0,assignedPoints=0,unknownPoints=n,assignedFraction=0.,points=0,
                            supportFraction=0.,inlierIndices=[])
                for d,label,index in ((f,"forward",i),(r,"reverse",j)):
                    d.update(**{k:entries[label,index][k] for k in ("populationId","populationSha256","selectionSha256")})
                low=0. if unusable else min(d["assignedPoints"]/d["seedPoints"] for d in (f,r))
                high=1. if unusable else min((d["assignedPoints"]+d["unknownPoints"])/d["seedPoints"] for d in (f,r))
                proof={"fieldId":field_id,"method":POLICY["method"],"label":new_box.label,
                    "startToken":old.frame["token"],"endToken":current.frame["token"],"startMs":old.at,"endMs":current.at,
                    "startSha256":old.frame["sourceSha256"],"endSha256":current.frame["sourceSha256"],"observationMs":current.at-old.at,
                    "startDetectionIndex":i,"endDetectionIndex":j,"startBox":list(old_box.xyxy),"endBox":list(new_box.xyxy),
                    "supported":False,"reason":"unverifiable-source-selection" if unusable else "insufficient-descriptor-support",
                    "unverifiable":unusable,"forward":f,"reverse":r,"scoreLower":low,"scoreUpper":high}
                if not unusable and f["supported"] and r["supported"]:
                    values=[f["linearLogGrowth"],-r["linearLogGrowth"]];lower,upper=min(values),max(values)
                    proof.update(linearLogGrowthLowerBound=lower,linearLogGrowthUpperBound=upper,growthSpan=upper-lower,growthBound=POLICY["growthBound"])
                    if upper-lower<=POLICY["maxEstimatorLogGrowthSpan"]:proof.update(supported=True,reason="bidirectional-independent-descriptor-supported")
                    else:proof["reason"]="bidirectional-estimator-disagreement"
                elif not unusable:proof["reason"]="forward-"+f["reason"] if not f["supported"] else "reverse-"+r["reason"]
                comparisons.append(proof)
        diagnostics["comparisons"].extend(comparisons)
        return frozen.associate(comparisons,len(current.boxes),len(old.boxes),old,current)

    def update(self,frame,t_ms,gray,boxes,*,native_gray=None,camera_surface=None):
        tick=perf_counter();inventory=None
        if isinstance(gray,np.ndarray) and gray.dtype==np.uint8 and gray.ndim==2 and 32<=min(gray.shape)<=max(gray.shape)<=768:
            supplied=frozen.base._boxes(boxes,gray.shape[1],gray.shape[0])
            if supplied is not None:
                inventory=self.matcher.prepare(gray,supplied)
                inventory.update(sourceToken=frame.get("token") if isinstance(frame,dict) else None,
                    sourceMs=t_ms,originalSourceSha256=frame.get("sha256") if isinstance(frame,dict) else None)
        self._pending=inventory
        try:
            result=super().update(frame,t_ms,gray,boxes,native_gray=native_gray,camera_surface=camera_surface)
            if self._latest is not None and inventory is not None and self._latest.frame["token"]==frame.get("token"):
                self._latest.source_inventory=inventory
        finally:self._pending=None
        result["diagnostics"].update(method=POLICY["method"],sourceSelectionBeforeCorrespondence=True,
            sourceSelections=None if inventory is None else {k:deepcopy(v) for k,v in inventory.items() if k!="descriptors"},
            descriptorMetadata=deepcopy(self.matcher.metadata),wallMs=1000*(perf_counter()-tick))
        for event in result["events"]:event["method"]=POLICY["method"]
        return result
