"""M3O bounded correspondence comparators and analytic pixel-ground-truth audit.

Authored affine fixtures are not real-object flow ground truth or detector
acceptance. Endpoint error is measured independently of NCC and reversibility:
a reversible repeated-texture alias can pass those checks and still be wrong.
No model is loaded, downloaded or executed on import. No thresholds are tuned.

OpenCV method: https://docs.opencv.org/4.x/d2/d4b/classcv_1_1VariationalRefinement.html
"""

from copy import deepcopy
from hashlib import sha256
import json
from time import perf_counter
from types import MappingProxyType

import cv2
import numpy as np


VR_DEFAULTS = {"getAlpha": 20., "getDelta": 5., "getEpsilon": .0010000000474974513,
    "getFixedPointIterations": 5, "getGamma": 10., "getOmega": 1.600000023841858, "getSorIterations": 5}
POLICY = MappingProxyType({"maxWorkingSide": 768, "directionsPerPair": 2,
    "refinement": "opencv-original-working-pixel-fixed-defaults", "refinementParameters": VR_DEFAULTS,
    "auditEpePx": 1.3, "auditPoints": 64, "auditEvidence": "authored-affine-pixel-ground-truth-not-real-object-motion"})


def _images(old, new):
    if (not isinstance(old, np.ndarray) or not isinstance(new, np.ndarray)
            or old.dtype != np.uint8 or new.dtype != np.uint8 or old.ndim != 2
            or old.shape != new.shape or min(old.shape) < 32 or max(old.shape) > 768):
        raise ValueError("Equal uint8 grayscale working frames, sides32..768, required")


def _fields(values, shape):
    if (not isinstance(values, (tuple, list)) or len(values) != 2
            or any(not isinstance(f, np.ndarray) or f.dtype != np.float32
                   or f.shape != (*shape, 2) or not np.isfinite(f).all() for f in values)):
        raise ValueError("Two finite original-working-coordinate float32 H,W,2 fields required")


def _parameters(algorithm):
    return {name: getattr(algorithm, name)() for name in sorted(dir(algorithm))
            if name.startswith("get") and name != "getDefaultName"}


class VariationalRefinedRaft:
    """One existing RAFT pair, then two independent full-working-pixel refinements.

    direction_calls counts actual learned directions, not CPU refinement calls.
    The wrapped model remains single-resident and must be used sequentially.
    No setter, ROI, box normalization, intensity fit or quality-floor change.
    """

    def __init__(self, base_provider):
        if not callable(base_provider) or not hasattr(base_provider, "direction_calls"):
            raise TypeError("An explicitly loaded shared global RAFT provider is required")
        self._base = base_provider
        self._refine = cv2.VariationalRefinement_create()
        parameters = _parameters(self._refine)
        if parameters != VR_DEFAULTS: raise RuntimeError("OpenCV refinement defaults differ from frozen policy")
        self.direction_calls = 0; self.refinement_calls = 0; self.last_call = {}
        self._metadata = {"kind": "opencv-variational-refinement-of-global-provider",
            "algorithm": "raft-small-global-plus-opencv-variational-defaults", "opencv": cv2.__version__,
            "baseline": deepcopy(getattr(base_provider, "metadata", {})), "refinement": parameters,
            "refinementCoordinates": "original-working-pixels", "modelSharing": "same-sequential-global-provider",
            "counterScope": "wrapper-learned-directions-and-separate-cpu-refinements"}

    @property
    def metadata(self): return deepcopy(self._metadata)

    def __call__(self, old, new):
        _images(old, new)
        tick = perf_counter(); before = self._base.direction_calls; refined_before = self.refinement_calls
        self.last_call = {"status": "started", "roiShape": list(old.shape)}
        refinement_ms = 0.
        try:
            initial = self._base(old, new)
            _fields(initial, old.shape)
            if self._base.direction_calls-before != 2: raise RuntimeError("Baseline did not execute exactly two learned directions")
            self.last_call.update(deepcopy(getattr(self._base, "last_call", {})), status="refining")
            result = []
            for first, second, flow in ((old, new, initial[0]), (new, old, initial[1])):
                started = perf_counter(); self.refinement_calls += 1
                try: result.append(self._refine.calc(first, second, np.ascontiguousarray(flow.copy())))
                finally: refinement_ms += 1000*(perf_counter()-started)
            _fields(result, old.shape)
            self.last_call.update(status="field-supported", outputShape=list(result[0].shape))
            return tuple(result)
        except Exception as error:
            self.last_call.update(status="runtime-error", error=f"{type(error).__name__}: {error}")
            raise
        finally:
            learned = self._base.direction_calls-before
            self.direction_calls += learned
            self.last_call.update(modelDirectionCalls=learned,
                refinementDirectionCalls=self.refinement_calls-refined_before,
                refinementWallMs=refinement_ms, baselineProvider=deepcopy(getattr(self._base, "last_call", {})),
                wallMs=1000*(perf_counter()-tick))


class NativeDis:
    """CPU DIS MEDIUM comparator, full working INPUT; finest default is reported.

    Do not call these directions learned/model calls. Default pyramid processing
    is not a claim of native-resolution optimization at every pyramid level.
    """

    def __init__(self):
        self._dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self.direction_calls = 0; self.refinement_calls = 0; self.last_call = {}
        self._metadata = {"kind": "opencv-dis-full-working-input", "algorithm": "opencv-dis-medium-defaults",
            "opencv": cv2.__version__, "device": "cpu", "parameters": _parameters(self._dis),
            "flowCoordinates": "original-working-pixels", "counterScope": "cpu-dis-directions-not-model-inference"}

    @property
    def metadata(self): return deepcopy(self._metadata)

    def __call__(self, old, new):
        _images(old, new); tick = perf_counter(); before = self.direction_calls
        self.last_call = {"status": "started", "roiShape": list(old.shape), "device": "cpu"}
        try:
            result = []
            for first, second in ((old, new), (new, old)):
                self.direction_calls += 1; result.append(self._dis.calc(first, second, None))
            _fields(result, old.shape)
            self.last_call.update(status="field-supported", outputShape=list(result[0].shape))
            return tuple(result)
        except Exception as error:
            self.last_call.update(status="runtime-error", error=f"{type(error).__name__}: {error}")
            raise
        finally:
            self.last_call.update(directionCalls=self.direction_calls-before, modelDirectionCalls=0,
                refinementDirectionCalls=0, wallMs=1000*(perf_counter()-tick))


def analytic_fields(matrix, shape):
    matrix = np.asarray(matrix, float)
    if matrix.shape != (2, 3) or not np.isfinite(matrix).all() or abs(np.linalg.det(matrix[:, :2])) < 1e-9:
        raise ValueError("Finite invertible affine required")
    yy, xx = np.mgrid[:shape[0], :shape[1]]; grid = np.stack((xx, yy), axis=-1)
    inverse = cv2.invertAffineTransform(matrix)
    return tuple((grid@m[:, :2].T+m[:, 2]-grid).astype(np.float32) for m in (matrix, inverse))


def authored_case(name, *, seed=650801, shape=(160, 224)):
    """Known whole-image transforms. No real labels, camera truth or object IDs."""
    if name not in ("static", "translation", "expansion", "rotation", "occlusion", "periodic-static"):
        raise ValueError("Unknown fixed authored case")
    h, w = shape
    if min(shape) < 64 or max(shape) > 768: raise ValueError("Authored shape must be64..768")
    rng = np.random.default_rng(seed)
    old = cv2.GaussianBlur(rng.integers(0, 256, shape, np.uint8), (3, 3), .6)
    matrix = np.array([[1., 0., 0.], [0., 1., 0.]])
    if name == "translation": matrix[:, 2] = [4., -3.]
    if name in ("expansion", "occlusion"):
        matrix = cv2.getRotationMatrix2D(((w-1)/2, (h-1)/2), 0., 1.08); matrix[:, 2] += [2., -1.]
    if name == "rotation": matrix = cv2.getRotationMatrix2D(((w-1)/2, (h-1)/2), 5., 1.)
    if name == "periodic-static":
        yy, xx = np.mgrid[:h, :w]; old = np.where(((xx//4)+(yy//4)) % 2, 220, 25).astype(np.uint8)
    new = cv2.warpAffine(old, matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    yy, xx = np.meshgrid(np.linspace(24, h-25, 8), np.linspace(24, w-25, 8), indexing="ij")
    points = np.column_stack((xx.ravel(), yy.ravel()))
    target = points@matrix[:, :2].T+matrix[:, 2]
    visible = ((target >= 3) & (target <= [w-4, h-4])).all(axis=1)
    occlusion = None
    if name == "occlusion":
        occlusion = [w//3, h//3, 2*w//3, 2*h//3]
        x,y,r,b = occlusion; new[y:b, x:r] = 128
        visible &= ~((target[:, 0] >= x) & (target[:, 0] < r) & (target[:, 1] >= y) & (target[:, 1] < b))
    meta = {"case": name, "seed": seed, "shape": list(shape), "affine": matrix.tolist(), "occlusion": occlusion,
        "oldSha256": sha256(old.tobytes()).hexdigest(), "newSha256": sha256(new.tobytes()).hexdigest(),
        "evidence": POLICY["auditEvidence"], "pixelConvention": "OpenCV-integer-pixel-centers"}
    meta["manifestSha256"] = sha256(json.dumps(meta,sort_keys=True,separators=(",", ":")).encode()).hexdigest()
    return {"old": old, "new": new, "points": points, "target": target, "visible": visible,
            "matrix": matrix, "metadata": meta}


def _sample_independent(field, points):
    """Numpy continuous bilinear sampler, not the production remap helper."""
    h, w = field.shape[:2]; p = np.asarray(points, float)
    valid = np.isfinite(p).all(axis=1) & (p >= 0).all(axis=1) & (p <= [w-1, h-1]).all(axis=1)
    safe = np.where(valid[:, None], p, 0.); low = np.floor(safe).astype(int)
    high = np.minimum(low+1, [w-1, h-1]); weight = safe-low
    x,y = low.T; r,b = high.T; dx,dy = weight.T
    result = (field[y,x]*(1-dx)[:,None]*(1-dy)[:,None]+field[y,r]*dx[:,None]*(1-dy)[:,None]
              +field[b,x]*(1-dx)[:,None]*dy[:,None]+field[b,r]*dx[:,None]*dy[:,None])
    valid &= np.isfinite(result).all(axis=1)
    return result, valid


def known_map_case(old, matrix, case_id, *, source_box=None, occlusion_xyxy=None,
                   brightness_gain=1., brightness_offset=0., source_metadata=None):
    """Caller pixels + authored map, not real-motion GT. Seal seeds before flow.

    Geometric visibility and photometric patch scorability are distinct known
    masks. Brightness clipping does not remove geometric ground truth.
    """
    from assist_scene_texture_patches import select_seeds
    _images(old,old)
    if not isinstance(case_id,str) or not case_id: raise ValueError("Explicit known-map case ID required")
    matrix=np.asarray(matrix,float); analytic_fields(matrix,old.shape)
    if np.linalg.det(matrix[:,:2]) <= 0: raise ValueError("Known map requires positive orientation")
    if not np.isfinite([brightness_gain,brightness_offset]).all() or brightness_gain <= 0:
        raise ValueError("Finite positive brightness gain required")
    h,w=old.shape
    box=[0.,0.,float(w-1),float(h-1)] if source_box is None else list(map(float,getattr(source_box,"xyxy",source_box)))
    selection=select_seeds(old,box)
    points=np.asarray(selection["points"],float).reshape(-1,2)
    target=points@matrix[:,:2].T+matrix[:,2]
    new=cv2.warpAffine(old,matrix,(w,h),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
    intensities=new.astype(float)*brightness_gain+brightness_offset
    clipped=(intensities<0)|(intensities>255)
    new=np.clip(np.rint(intensities),0,255).astype(np.uint8)
    visible=((target>=0)&(target<=[w-1,h-1])).all(axis=1)
    offsets=np.array([(x,y) for y in range(-3,4) for x in range(-3,4)],float)
    patch_target=(points[:,None,:]+offsets)@matrix[:,:2].T+matrix[:,2]
    patch_in_bounds=((patch_target>=0)&(patch_target<=[w-1,h-1])).all(axis=(1,2))
    patch_occluded=np.zeros(len(points),bool)
    if occlusion_xyxy is not None:
        rect=np.asarray(occlusion_xyxy,float)
        if rect.shape!=(4,) or not np.isfinite(rect).all() or np.any(rect[2:]<=rect[:2]): raise ValueError("Invalid authored occluder")
        x,y,r,b=rect; mask_y,mask_x=np.mgrid[:h,:w]
        new[(mask_x>=x)&(mask_x<r)&(mask_y>=y)&(mask_y<b)]=128
        visible &= ~((target[:,0]>=x)&(target[:,0]<r)&(target[:,1]>=y)&(target[:,1]<b))
        patch_occluded=((patch_target[:,:,0]>=x)&(patch_target[:,:,0]<r)&(patch_target[:,:,1]>=y)&(patch_target[:,:,1]<b)).any(axis=1)
    clip_values,clip_valid=_sample_independent(np.repeat(clipped[:,:,None],2,axis=2).astype(np.float32),patch_target.reshape(-1,2))
    patch_clipped=((clip_values[:,0]>0)|~clip_valid).reshape(-1,49).any(axis=1)
    metadata={"case":case_id,"shape":list(old.shape),"affine":matrix.tolist(),
        "oldSha256":sha256(old.tobytes()).hexdigest(),"newSha256":sha256(new.tobytes()).hexdigest(),
        "brightnessGain":float(brightness_gain),"brightnessOffset":float(brightness_offset),
        "occlusion":None if occlusion_xyxy is None else list(map(float,occlusion_xyxy)),
        "sourceMetadata":deepcopy(source_metadata),"sourceBox":box,
        "evidence":"caller-pixels-authored-map-not-real-motion-ground-truth",
        "pixelConvention":"OpenCV-integer-pixel-centers",
        "selectionSha256":sha256(json.dumps(selection,sort_keys=True,separators=(",", ":")).encode()).hexdigest()}
    metadata["manifestSha256"]=sha256(json.dumps(metadata,sort_keys=True,separators=(",", ":")).encode()).hexdigest()
    return {"old":old.copy(),"new":new,"points":points,"target":target,"visible":visible,"matrix":matrix,
        "metadata":metadata,"selection":selection,"sourceBox":box,
        "patchScorable":patch_in_bounds&~patch_occluded&~patch_clipped,
        "patchScorability":{"inBounds":patch_in_bounds.tolist(),"occluded":patch_occluded.tolist(),"brightnessClipped":patch_clipped.tolist()}}


def _validate_case(case):
    _images(case["old"],case["new"])
    metadata=case["metadata"]
    if (sha256(case["old"].tobytes()).hexdigest()!=metadata["oldSha256"]
            or sha256(case["new"].tobytes()).hexdigest()!=metadata["newSha256"]):
        raise ValueError("Known-map source pixels changed")
    plain={k:v for k,v in metadata.items() if k!="manifestSha256"}
    if sha256(json.dumps(plain,sort_keys=True,separators=(",", ":")).encode()).hexdigest()!=metadata["manifestSha256"]:
        raise ValueError("Known-map manifest changed")
    matrix=np.asarray(case["matrix"],float);points=np.asarray(case["points"],float)
    if (matrix.shape!=(2,3) or not np.isfinite(matrix).all() or np.linalg.det(matrix[:,:2])<=0
            or matrix.tolist()!=metadata["affine"] or points.ndim!=2 or points.shape[1]!=2
            or not np.isfinite(points).all() or case["target"].shape!=points.shape
            or not np.allclose(case["target"],points@matrix[:,:2].T+matrix[:,2],atol=1e-10,rtol=0)
            or case["visible"].shape!=(len(points),) or case["visible"].dtype!=bool):
        raise ValueError("Malformed analytic ground truth")
    if "selection" in case:
        from assist_scene_texture_patches import validate_selection
        selection=case["selection"];validate_selection(selection)
        digest=sha256(json.dumps(selection,sort_keys=True,separators=(",", ":")).encode()).hexdigest()
        if (digest!=metadata["selectionSha256"] or selection["sourceSha256"]!=metadata["oldSha256"]
                or selection["sourceBox"]!=metadata["sourceBox"] or selection["sourceBox"]!=case["sourceBox"]
                or not np.array_equal(points,np.asarray(selection["points"],float).reshape(-1,2))):
            raise ValueError("Ground truth audit changed sealed source inventory")


def audit_fields(case, forward, backward):
    """Independent GT errors; invalid predictions never disappear from rates."""
    _validate_case(case)
    shape = case["old"].shape
    for field in (forward, backward):
        if not isinstance(field,np.ndarray) or field.shape != (*shape,2) or field.dtype != np.float32:
            raise ValueError("Expected original-coordinate float32 fields")
    points, expected, visible = case["points"], case["target"], case["visible"]
    displacement, valid = _sample_independent(forward,points); predicted = points+displacement
    reverse, rev_valid = _sample_independent(backward,predicted)
    true_reverse, true_rev_valid = _sample_independent(backward,expected)
    epe = np.linalg.norm(predicted-expected,axis=1); cycles = np.linalg.norm(displacement+reverse,axis=1)
    reverse_epe = np.linalg.norm(expected+true_reverse-points,axis=1)
    denominator = int(visible.sum()); finite = visible & valid
    correct = finite & (epe <= POLICY["auditEpePx"])
    reversible = visible & valid & rev_valid & (cycles <= 1.3)
    all_finite = denominator > 0 and int(finite.sum()) == denominator
    matrix = None; growth = None
    if finite.sum() >= 3:
        design = np.column_stack((points[finite],np.ones(int(finite.sum()))))
        if np.linalg.matrix_rank(design) == 3:
            matrix = np.linalg.lstsq(design,predicted[finite],rcond=None)[0].T
            determinant = float(np.linalg.det(matrix[:,:2]))
            if determinant > 0: growth = float(.5*np.log(determinant))
    expected_growth = float(.5*np.log(np.linalg.det(case["matrix"][:,:2])))
    def number(value): return float(value) if np.isfinite(value) else None
    return {"metadata": deepcopy(case["metadata"]), "originalPoints": len(points), "gtVisiblePoints": denominator,
        "gtPatchScorablePoints":int(case["patchScorable"].sum()) if "patchScorable" in case else None,
        "invalidPredictionPoints": int(np.count_nonzero(visible & ~valid)),
        "allVisibleEpeMean": float(epe[visible].mean()) if all_finite else None,
        "finiteOnlyEpeMean": float(epe[finite].mean()) if finite.any() else None,
        "epeWithin1_3Fraction": int(correct.sum())/denominator if denominator else None,
        "cycleWithin1_3Fraction": int(reversible.sum())/denominator if denominator else None,
        "reversibleButWrongPoints": int(np.count_nonzero(reversible & ~correct)),
        "reverseEpeAtTrueEndpointsMean": float(reverse_epe[visible].mean()) if denominator and np.all(true_rev_valid[visible]) else None,
        "fittedLinearLogGrowth": growth, "expectedLinearLogGrowth": expected_growth,
        "growthBias": None if growth is None else growth-expected_growth,
        "growthFitUsesFiniteSubset": not all_finite,
        "points": [{"source": p.tolist(), "expected": q.tolist(), "predicted": z.tolist() if valid[i] else None,
            "gtVisible": bool(visible[i]), "endpointErrorPx": number(epe[i]) if valid[i] else None,
            "cyclePx": number(cycles[i]) if valid[i] and rev_valid[i] else None}
                   for i,(p,q,z) in enumerate(zip(points,expected,predicted,strict=True))]}


def audit_provider(provider, case):
    """Explicit caller-triggered execution. Caller owns model/device authority."""
    _validate_case(case)
    before = provider.direction_calls; refined_before = getattr(provider,"refinement_calls",0)
    tick = perf_counter(); fields = provider(case["old"],case["new"])
    report = audit_fields(case,*fields)
    if "selection" in case:
        from assist_scene_texture_patches import population
        report["patchChecks"]={}
        for mode in ("raw","warped"):
            _,_,_,good,proof=population(case["old"],case["new"],case["sourceBox"],*fields,
                mode=mode,selection=deepcopy(case["selection"]))
            correct=np.asarray([p["endpointErrorPx"] is not None and p["endpointErrorPx"]<=1.3
                and p["gtVisible"] for p in report["points"]],bool)
            report["patchChecks"][mode]={"originalPoints":len(good),"verifiedPoints":int(good.sum()),
                "verifiedCorrectVisiblePoints":int(np.count_nonzero(good&correct)),
                "verifiedWrongVisiblePoints":int(np.count_nonzero(good&~correct&case["visible"])),
                "reasonCounts":proof["reasonCounts"],"selectionSha256":proof["selectionSha256"]}
    report.update(provider=deepcopy(getattr(provider,"metadata",{})),
        actualDirectionCalls=provider.direction_calls-before,
        actualRefinementCalls=getattr(provider,"refinement_calls",0)-refined_before,
        lastCall=deepcopy(getattr(provider,"last_call",{})),wallMs=1000*(perf_counter()-tick))
    return report
