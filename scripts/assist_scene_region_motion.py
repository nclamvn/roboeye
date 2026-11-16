"""M3I research-only region measurement, consuming frozen M3H identities.

No association, persistent corner cohort, transform chaining, or detector scale
measurement lives here. Real bounded ROIs are registered directly to the current
exposure. The residual affine Jacobian is projected surface expansion, not
range, TTC, object self-motion, or proof of radial closing for turning surfaces.

ECC convention: OpenCV findTransformECC(template, input) returns template-to-
input coordinates (warp input with WARP_INVERSE_MAP to align). References:
https://docs.opencv.org/4.x/dc/d6b/group__video__track.html
Evangelidis/Psarakis 2008, doi:10.1109/TPAMI.2008.113.
Surface-orientation caveat: https://arxiv.org/abs/2210.04108 .
"""

from collections import deque
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
import math
from types import MappingProxyType

import cv2
import numpy as np

import assist_scene_window_loom as window
from assist_scene_dense_window import _sample
from assist_scene_motion import Detection
from assist_scene_scale_approach_m3e import _native_transform

base = window.base
POLICY = MappingProxyType({
    "maxTracks": 12, "maxSnapshots": 8, "maxAnchors": 7,
    "anchorCadenceMs": 160., "minWindowMs": 320., "maxWindowMs": 800.,
    "maxGapMs": 300., "maxWorkingSide": 256, "maxNativeSide": 384,
    "maxAnchorChecks": 2, "minPoints": 9, "minSupport": .70,
    "gridSide": 10, "minTextureVariance": 16., "maxCyclePx": 1.3,
    "minSpan": .24, "minHull": .035, "minCorrelation": .70,
    "maxAnisotropyLog": .20, "maxRotationDeg": 15.,
    "maxLinearLogGrowth": .40, "maxBoxLogDisagreement": .12,
    "minNetLinearGrowth": .040, "minCurrentLinearGrowth": .0005,
    "eccIterations": 60, "eccEpsilon": 1e-4,
})


@dataclass
class Snapshot:
    at: float
    box: tuple
    pixels: np.ndarray
    mask: np.ndarray
    mapping: np.ndarray
    frame: dict
    native: bool


def _snapshot(at, raw, box, others, transform, frame, native):
    rect = base._warp_rect(box.xyxy, transform)
    pad = max(12., .32*max(base._size(rect)))
    lo = np.maximum(0, np.floor(rect[:2]-pad)).astype(int)
    hi = np.minimum(raw.shape[::-1], np.ceil(rect[2:]+pad)).astype(int)
    if min(hi-lo) < 20:
        return None
    limit = POLICY["maxNativeSide"] if native else POLICY["maxWorkingSide"]
    factor = min(1., limit/float(max(hi-lo)))
    width, height = np.maximum(1, np.floor((hi-lo)*factor)).astype(int)
    mapping = np.diag((width/(hi[0]-lo[0]), height/(hi[1]-lo[1]), 1.))
    mapping = mapping @ np.array([[1., 0., -lo[0]], [0., 1., -lo[1]], [0., 0., 1.]]) @ transform
    pixels = cv2.resize(raw[lo[1]:hi[1], lo[0]:hi[0]], (width, height), interpolation=cv2.INTER_AREA)
    # A neighboring detector rectangle is not a visibility map. Only the
    # conservative own interior is used; actual occlusion must fail the pixel
    # support/cycle/spread checks. Identity ambiguity remains the caller's veto.
    mask = window._mask(pixels.shape, box.xyxy, [], mapping)
    return Snapshot(at, box.xyxy, pixels.copy(), mask, mapping, frame, native)


def _pair(old, new):
    """One common coordinate system: never resize each object to its box."""
    k = new.frame["intrinsics"]
    rotation = new.frame["cameraToWorld"][:3, :3].T @ old.frame["cameraToWorld"][:3, :3]
    homography = k @ rotation @ np.linalg.inv(k)
    old_rect = base._warp_rect(old.box, homography)
    if old_rect is None:
        return None
    pad = max(12., .32*max(*base._size(old_rect), *base._size(new.box)))
    lo = np.floor(np.minimum(old_rect[:2], new.box[:2])-pad)
    hi = np.ceil(np.maximum(old_rect[2:], new.box[2:])+pad)
    limit = POLICY["maxNativeSide"] if old.native and new.native else POLICY["maxWorkingSide"]
    factor = min(old.mapping[0, 0], old.mapping[1, 1], new.mapping[0, 0], new.mapping[1, 1],
                 limit/float(max(hi-lo)))
    width, height = np.maximum(1, np.floor((hi-lo)*factor)).astype(int)
    if min(width, height) < 20:
        return None
    mapping = np.diag((factor, factor, 1.)) @ np.array([[1., 0., -lo[0]], [0., 1., -lo[1]], [0., 0., 1.]])
    pixels, masks = [], []
    for exposure, correction in ((old, homography), (new, np.eye(3))):
        warp = mapping @ correction @ np.linalg.inv(exposure.mapping)
        pixels.append(cv2.warpPerspective(exposure.pixels, warp, (width, height)))
        masks.append(cv2.warpPerspective(exposure.mask, warp, (width, height), flags=cv2.INTER_NEAREST))
    return *pixels, *masks, base._warp_rect(old_rect, mapping), base._warp_rect(new.box, mapping)


def _grid(image, mask, rect):
    size = base._size(rect)
    xs = np.linspace(rect[0]+.16*size[0], rect[2]-.16*size[0], POLICY["gridSide"])
    ys = np.linspace(rect[1]+.16*size[1], rect[3]-.16*size[1], POLICY["gridSide"])
    pts = np.asarray([(x, y) for y in ys for x in xs], np.float32)
    ix = np.clip(np.rint(pts[:, 0]).astype(int), 0, image.shape[1]-1)
    iy = np.clip(np.rint(pts[:, 1]).astype(int), 0, image.shape[0]-1)
    values = image.astype(np.float32)
    mean = cv2.boxFilter(values, -1, (7, 7), normalize=True)
    variance = cv2.boxFilter(values*values, -1, (7, 7), normalize=True)-mean*mean
    valid = (mask[iy, ix] > 0) & (variance[iy, ix] >= POLICY["minTextureVariance"])
    valid &= base._inside(pts, (4, 4, image.shape[1]-5, image.shape[0]-5), 0.)
    return pts[valid]


def _inside_mask(points, mask):
    finite = np.isfinite(points).all(axis=1)
    clean = np.where(np.isfinite(points), points, -1.)
    xy = np.rint(clean).astype(int)
    valid = finite & (xy[:, 0] >= 0) & (xy[:, 0] < mask.shape[1]) & (xy[:, 1] >= 0) & (xy[:, 1] < mask.shape[0])
    out = np.zeros(len(points), bool)
    out[valid] = mask[xy[valid, 1], xy[valid, 0]] > 0
    return out


def _matrix3(matrix):
    return np.vstack((matrix, [0., 0., 1.]))


class RegionMotion:
    """Measurement-only adapter. identity_surface must be the M3H result dict."""

    def __init__(self, method="ecc", *, native_detail=True):
        if method not in ("ecc", "flow_affine"):
            raise ValueError("method must be ecc or flow_affine")
        self.method, self.native_detail = method, bool(native_detail)
        self.epoch = 0
        self._states = {}
        self._previous = None
        self._dis = None
        if method == "flow_affine":
            self._dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
            self._dis.setFinestScale(1)
            self._dis.setPatchSize(8)
            self._dis.setPatchStride(3)
            self._dis.setGradientDescentIterations(25)
            self._dis.setVariationalRefinementIterations(5)
            self._dis.setUseMeanNormalization(True)
            self._dis.setUseSpatialPropagation(True)

    def _clear(self):
        self._states.clear()
        self._previous = None

    def _measure(self, old, new):
        diagnostic = {"supported": False, "reason": "invalid-object-crop",
                      "startMs": old.at, "endMs": new.at, "observationMs": new.at-old.at,
                      "startToken": old.frame.get("token"), "endToken": new.frame.get("token"),
                      "method": self.method}
        pair = _pair(old, new)
        if pair is None:
            return diagnostic
        p, q, pm, qm, old_rect, rect = pair
        a = _grid(p, pm, old_rect)
        diagnostic.update(seedPoints=len(a), roiShape=list(p.shape))
        if len(a) < POLICY["minPoints"]:
            diagnostic["reason"] = "insufficient-region-texture"
            return diagnostic
        initial = np.eye(3, dtype=np.float32)[:2]
        initial[:, 2] = base._center(rect)-base._center(old_rect)
        try:
            if self.method == "ecc":
                criteria = (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS,
                            POLICY["eccIterations"], POLICY["eccEpsilon"])
                corr, forward = cv2.findTransformECC(p, q, initial.copy(), cv2.MOTION_AFFINE, criteria, qm, 5)
                reverse_initial = initial.copy(); reverse_initial[:, 2] *= -1
                reverse_corr, backward = cv2.findTransformECC(q, p, reverse_initial, cv2.MOTION_AFFINE, criteria, pm, 5)
                diagnostic.update(eccCorrelation=float(corr), reverseEccCorrelation=float(reverse_corr))
                b = base._project(a, _matrix3(forward))
                back = base._project(b, _matrix3(backward))
                keep = np.linalg.norm(a-back, axis=1) <= POLICY["maxCyclePx"]
                if min(corr, reverse_corr) < POLICY["minCorrelation"]:
                    diagnostic["reason"] = "ecc-correlation"
                    return diagnostic
            else:
                f = self._dis.calc(p, q, None)
                r = self._dis.calc(q, p, None)
                delta, ok = _sample(f, a); b = a+delta
                reverse, rev = _sample(r, b); back = b+reverse
                keep = ok & rev & (np.linalg.norm(a-back, axis=1) <= POLICY["maxCyclePx"])
                keep &= base._matching_patches(p, q, a, b)
                keep &= _inside_mask(b, qm)
                if np.count_nonzero(keep) < max(POLICY["minPoints"], POLICY["minSupport"]*len(a)):
                    diagnostic["reason"] = "insufficient-flow-support"
                    return diagnostic
                forward, inliers = cv2.estimateAffine2D(a[keep], b[keep], method=cv2.RANSAC,
                    ransacReprojThreshold=1.2, maxIters=250, confidence=.99, refineIters=6)
                if forward is None or inliers is None:
                    diagnostic["reason"] = "affine-fit-failed"
                    return diagnostic
                selected = np.flatnonzero(keep)
                keep[selected[~inliers.ravel().astype(bool)]] = False
                # Fitted affine must agree with the independently returned flow.
                keep &= np.linalg.norm(base._project(a, _matrix3(forward))-b, axis=1) <= 1.3
        except cv2.error:
            diagnostic["reason"] = "registration-unavailable"
            return diagnostic
        if not np.isfinite(forward).all():
            diagnostic["reason"] = "invalid-affine"
            return diagnostic
        det = float(np.linalg.det(forward[:, :2]))
        if det <= 0:
            diagnostic["reason"] = "reflected-affine"
            return diagnostic
        singular = np.linalg.svd(forward[:, :2], compute_uv=False)
        linear = .5*math.log(det)
        angle = abs(math.degrees(math.atan2(forward[1, 0], forward[0, 0])))
        if (abs(linear) > POLICY["maxLinearLogGrowth"] or
                math.log(singular[0]/singular[-1]) > POLICY["maxAnisotropyLog"] or angle > POLICY["maxRotationDeg"]):
            diagnostic["reason"] = "region-shape-change"
            return diagnostic
        # Affine-aligned photometry verifies actual pixels at fresh grid sites;
        # it does not require a 20% expanded patch to keep its original scale.
        fitted = base._project(a, _matrix3(forward))
        aligned = cv2.warpAffine(q, forward, p.shape[::-1], flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
        keep &= base._matching_patches(p, aligned, a, a)
        keep &= _inside_mask(fitted, qm)
        supported = int(np.count_nonzero(keep))
        diagnostic.update(points=supported, supportFraction=supported/len(a),
                          cycleP90Px=float(np.percentile(np.linalg.norm(a-back, axis=1), 90)))
        if supported < max(POLICY["minPoints"], POLICY["minSupport"]*len(a)):
            diagnostic["reason"] = "insufficient-photometric-cycle-support"
            return diagnostic
        for points, box in ((a[keep], old_rect), (fitted[keep], rect)):
            if (np.min(np.ptp(points, axis=0)/base._size(box)) < POLICY["minSpan"] or
                    cv2.contourArea(cv2.convexHull(points.astype(np.float32)))/np.prod(base._size(box)) < POLICY["minHull"]):
                diagnostic["reason"] = "localized-region-support"
                return diagnostic
        center = base._project(np.asarray([base._center(old_rect)]), _matrix3(forward))[0]
        box_growth = float(np.mean(np.log(base._size(rect)/base._size(old_rect))))
        if (np.linalg.norm(center-base._center(rect)) > max(2., .28*min(base._size(rect))) or
                abs(box_growth-linear) > POLICY["maxBoxLogDisagreement"]):
            diagnostic["reason"] = "region-box-disagreement"
            return diagnostic
        diagnostic.update(supported=True, reason="region-affine-supported", linearLogGrowth=linear,
                          logAreaGrowth=math.log(det), affine=forward.tolist())
        return diagnostic

    @staticmethod
    def _surface(surface, w, h):
        if (not isinstance(surface, Mapping) or type(surface.get("epoch")) is not int or surface["epoch"] < 0 or
                not isinstance(surface.get("tracks"), list) or len(surface["tracks"]) > POLICY["maxTracks"] or
                not isinstance(surface.get("diagnostics"), Mapping)):
            return None
        tracks, boxes, ids = deepcopy(surface["tracks"]), [], set()
        try:
            for track in tracks:
                ident, box = track["id"], track["box"]
                if type(ident) is not int or ident < 1 or ident in ids:
                    return None
                ids.add(ident)
                values = [box[k] for k in ("x", "y", "width", "height")]
                if any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
                    return None
                x, y, width, height = values
                boxes.append(Detection(track["label"], track["score"], (x*w, y*h, (x+width)*w, (y+height)*h)))
        except (KeyError, TypeError, ValueError):
            return None
        boxes = base._boxes(boxes, w, h)
        return None if boxes is None else (tracks, boxes)

    def update(self, frame, t_ms, gray, identity_surface, *, native_gray=None):
        diagnostics = {"method": self.method, "sourceStatus": None, "trackReasons": {},
                       "windowEvidence": {}, "snapshots": {}, "comparisonCount": 0}
        tracks, events = [], []
        def result(status):
            return {"status": status, "epoch": self.epoch, "tracks": tracks,
                    "events": events, "diagnostics": diagnostics}
        if (not isinstance(gray, np.ndarray) or gray.dtype != np.uint8 or gray.ndim != 2 or
                not 32 <= min(gray.shape) <= max(gray.shape) <= 768):
            self._clear(); return result("invalid-image")
        if type(t_ms) not in (int, float) or not math.isfinite(t_ms) or t_ms < 0:
            self._clear(); return result("invalid-stream-clock")
        h, w = gray.shape
        clean = self._surface(identity_surface, w, h)
        if clean is None:
            self._clear(); return result("invalid-identity-surface")
        tracks, boxes = clean
        source_status = identity_surface.get("status")
        diagnostics["sourceStatus"] = source_status
        if identity_surface["epoch"] != self.epoch:
            self._clear()
        self.epoch = identity_surface["epoch"]
        if source_status not in ("valid", "first-frame"):
            self._clear(); return result(source_status if isinstance(source_status, str) else "invalid-identity-surface")
        view, status = base._frame_view(frame, w, h)
        if view is None:
            self._clear(); return result(status)
        if abs(view["timestampUs"]-view["poseTimestampUs"]) > 20_000:
            self._clear(); return result("pose-skew")
        if self._previous is not None:
            old_frame, old_at, shape = self._previous
            bad = (t_ms <= old_at or t_ms-old_at > POLICY["maxGapMs"] or gray.shape != shape or
                   abs((t_ms-old_at)-(view["timestampUs"]-old_frame["timestampUs"])/1000.) > 1. or
                   view.get("epoch") != old_frame.get("epoch") or
                   not np.allclose(view["intrinsics"], old_frame["intrinsics"], atol=1e-4, rtol=1e-6) or
                   (view.get("token") is not None and view.get("token") == old_frame.get("token")))
            if bad:
                self._clear(); return result("stream-discontinuity")
        native = _native_transform(native_gray, gray.shape) if self.native_detail else None
        raw, transform = (native_gray, native) if native is not None else (gray, np.eye(3))
        diagnostics["nativeDetail"] = native is not None
        decisions = identity_surface["diagnostics"].get("identityDecisions", {})
        current_ids = {track["id"] for track in tracks}
        self._states = {i: state for i, state in self._states.items() if i in current_ids}
        for index, (track, box) in enumerate(zip(tracks, boxes)):
            ident, key = track["id"], str(track["id"])
            decision = decisions.get(key) if isinstance(decisions, Mapping) else None
            kept = isinstance(decision, Mapping) and decision.get("kept") is True
            if not kept or source_status == "first-frame":
                self._states.pop(ident, None)
            reason = "new-identity" if not kept else "warming-window"
            if window._too_small(box.xyxy, gray.shape, native):
                self._states.pop(ident, None)
                diagnostics["trackReasons"][key] = "small-or-truncated"
                continue
            others = [b for j, b in enumerate(boxes) if j != index]
            current = _snapshot(t_ms, raw, box, others, transform, view, native is not None)
            if current is None:
                self._states.pop(ident, None)
                diagnostics["trackReasons"][key] = "invalid-object-crop"
                continue
            state = self._states.setdefault(ident, {"latest": None, "anchors": deque(maxlen=POLICY["maxAnchors"])})
            anchors = state["anchors"]
            while anchors and t_ms-anchors[0].at > POLICY["maxWindowMs"]:
                anchors.popleft()
            evidence = {"confirmed": False, "reason": reason, "fresh": None, "anchors": [], "comparisonCount": 0}
            if state["latest"] is not None and kept:
                fresh = self._measure(state["latest"], current)
                evidence["fresh"] = fresh; evidence["comparisonCount"] += 1
                reason = fresh["reason"]
                if fresh["supported"] and fresh["linearLogGrowth"] >= POLICY["minCurrentLinearGrowth"]:
                    eligible = [a for a in anchors if POLICY["minWindowMs"] <= t_ms-a.at <= POLICY["maxWindowMs"]]
                    selected = [eligible[i] for i in sorted({0, len(eligible)//2})] if eligible else []
                    evidence["anchors"] = [self._measure(anchor, current) for anchor in selected]
                    evidence["comparisonCount"] += len(selected)
                    valid = [a for a in evidence["anchors"] if a["supported"]]
                    conflict = any(a["linearLogGrowth"] <= 0 for a in valid)
                    positives = [a for a in valid if a["linearLogGrowth"] >= POLICY["minNetLinearGrowth"]]
                    if positives and not conflict:
                        best = max(positives, key=lambda a: a["observationMs"])
                        reason = "direct-region-expansion-supported"
                        evidence.update(confirmed=True, observationMs=best["observationMs"],
                                        linearLogGrowth=best["linearLogGrowth"], logAreaGrowth=best["logAreaGrowth"])
                        events.append({"kind": "relative-optical-approach", "trackId": ident, "label": box.label,
                            "epoch": self.epoch, "timeMs": t_ms, "observationMs": best["observationMs"],
                            "linearLogGrowth": best["linearLogGrowth"], "logAreaGrowth": best["logAreaGrowth"],
                            "points": best["points"], "method": self.method})
                    else:
                        reason = "direct-anchor-disagreement" if conflict else "no-supported-long-region-expansion"
                elif fresh["supported"]:
                    reason = "no-current-region-expansion"
            evidence["reason"] = reason
            diagnostics["comparisonCount"] += evidence["comparisonCount"]
            diagnostics["windowEvidence"][key] = evidence
            diagnostics["trackReasons"][key] = reason
            if not anchors or t_ms-anchors[-1].at >= POLICY["anchorCadenceMs"]:
                anchors.append(current)
            state["latest"] = current
            unique = {id(a): a for a in [*anchors, current]}
            diagnostics["snapshots"][key] = {"count": len(unique), "anchorTimesMs": [a.at for a in anchors],
                "latestMs": current.at, "maxAgeMs": max(t_ms-a.at for a in unique.values()),
                "maxSidePx": max(max(a.pixels.shape) for a in unique.values()),
                "provenance": "real-exposures-not-claimed-pixel-verified"}
        self._previous = view, t_ms, gray.shape
        return result(source_status)
