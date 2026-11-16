"""M3J research-only SIFT-initialized ECC, with frozen M3I safety gates.

Only pairwise pixel correspondence changes. RegionMotion owns identities,
camera/source vetoes, real snapshot lifetime, direct anchors and current proof.
No feature cohort or descriptor survives a measurement. Failure has no fallback.
"""

import math
from types import MappingProxyType

import cv2
import numpy as np

import assist_scene_region_motion as region

POLICY = region.POLICY
FEATURE_POLICY = MappingProxyType({
    "maxFeatures": 600, "ratio": .75, "minMatches": 12,
    "minInlierFraction": .60, "ransacReprojectionPx": 1.5,
    "ransacIterations": 500, "ransacConfidence": .99,
})


def _shape_valid(matrix):
    if matrix is None or not np.isfinite(matrix).all():
        return False
    det = float(np.linalg.det(matrix[:, :2]))
    if det <= 0:
        return False
    singular = np.linalg.svd(matrix[:, :2], compute_uv=False)
    return (abs(.5*math.log(det)) <= POLICY["maxLinearLogGrowth"] and
            math.log(singular[0]/singular[-1]) <= POLICY["maxAnisotropyLog"] and
            abs(math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))) <= POLICY["maxRotationDeg"])


def _spread(points, box):
    return (np.ptp(points, axis=0)/region.base._size(box),
            cv2.contourArea(cv2.convexHull(points.astype(np.float32)))/np.prod(region.base._size(box)))


def _ratio_matches(descriptors, other):
    """Strict Lowe ratio; duplicate/equal alternatives cannot pass."""
    pairs = cv2.BFMatcher(cv2.NORM_L2).knnMatch(descriptors, other, k=2)
    return {m.queryIdx: (m.trainIdx, float(m.distance/n.distance))
            for pair in pairs if len(pair) == 2
            for m, n in [pair] if n.distance > 0 and m.distance < FEATURE_POLICY["ratio"]*n.distance}


def _bounded_features(sift, image, mask):
    keys, descriptors = sift.detectAndCompute(image, mask)
    if descriptors is None:
        return keys, None
    # OpenCV's nfeatures may retain >n tied responses. Bound both storage and
    # quadratic descriptor comparisons deterministically, without a cohort.
    selected = sorted(range(len(keys)), key=lambda i: (
        -keys[i].response, *keys[i].pt, keys[i].size, keys[i].angle,
        keys[i].octave, keys[i].class_id, i))[:FEATURE_POLICY["maxFeatures"]]
    return [keys[i] for i in selected], descriptors[selected]


class FeatureRegionMotion(region.RegionMotion):
    """Measurement-only adapter: frozen M3H identity result is required."""

    def __init__(self, method="feature_ecc", *, native_detail=True):
        if method != "feature_ecc":
            raise ValueError("method must be feature_ecc")
        super().__init__("ecc", native_detail=native_detail)
        self.method = method
        self._sift = cv2.SIFT_create(nfeatures=FEATURE_POLICY["maxFeatures"])

    def _initialize(self, p, q, pm, qm, old_rect, rect, diagnostic):
        keys, desc = _bounded_features(self._sift, p, pm)
        other_keys, other_desc = _bounded_features(self._sift, q, qm)
        diagnostic.update(featureKeypoints=[len(keys), len(other_keys)],
                          featureMatchCount=0, featureInlierCount=0,
                          featureRatioThreshold=FEATURE_POLICY["ratio"])
        if desc is None or other_desc is None or min(len(desc), len(other_desc)) < 2:
            diagnostic["reason"] = "insufficient-feature-matches"
            return None
        forward, reverse = _ratio_matches(desc, other_desc), _ratio_matches(other_desc, desc)
        matches = [(a, b, max(ratio, reverse[b][1])) for a, (b, ratio) in forward.items()
                   if b in reverse and reverse[b][0] == a]
        diagnostic["featureMatchCount"] = len(matches)
        if matches:
            diagnostic["featureRatioP90"] = float(np.percentile([m[2] for m in matches], 90))
        if len(matches) < FEATURE_POLICY["minMatches"]:
            diagnostic["reason"] = "insufficient-feature-matches"
            return None
        a = np.asarray([keys[m[0]].pt for m in matches], np.float32)
        b = np.asarray([other_keys[m[1]].pt for m in matches], np.float32)
        initial, selected = cv2.estimateAffine2D(a, b, method=cv2.RANSAC,
            ransacReprojThreshold=FEATURE_POLICY["ransacReprojectionPx"],
            maxIters=FEATURE_POLICY["ransacIterations"],
            confidence=FEATURE_POLICY["ransacConfidence"], refineIters=6)
        if initial is None or selected is None:
            diagnostic["reason"] = "feature-affine-fit-failed"
            return None
        selected = selected.ravel().astype(bool)
        # RANSAC's final refined fit must retain its stated pixel residual bound.
        selected &= np.linalg.norm(region.base._project(a, region._matrix3(initial))-b, axis=1) <= FEATURE_POLICY["ransacReprojectionPx"]
        count = int(np.count_nonzero(selected))
        fraction = count/len(matches)
        diagnostic.update(featureInlierCount=count, featureInlierFraction=fraction)
        # .60 is the descriptor-match denominator, not final fresh-grid support.
        if count < FEATURE_POLICY["minMatches"] or fraction < FEATURE_POLICY["minInlierFraction"]:
            diagnostic["reason"] = "insufficient-feature-inliers"
            return None
        spread = [_spread(points[selected], box) for points, box in ((a, old_rect), (b, rect))]
        diagnostic.update(featureSpan=[v[0].tolist() for v in spread], featureHull=[float(v[1]) for v in spread])
        if any(np.min(span) < POLICY["minSpan"] or hull < POLICY["minHull"] for span, hull in spread):
            diagnostic["reason"] = "localized-feature-support"
            return None
        if not _shape_valid(initial):
            diagnostic["reason"] = "feature-region-shape-change"
            return None
        diagnostic["featureInitialAffine"] = initial.tolist()
        return initial.astype(np.float32)

    def _measure(self, old, new):
        diagnostic = {"supported": False, "reason": "invalid-object-crop",
                      "startMs": old.at, "endMs": new.at, "observationMs": new.at-old.at,
                      "startToken": old.frame.get("token"), "endToken": new.frame.get("token"),
                      "method": self.method}
        pair = region._pair(old, new)
        if pair is None:
            return diagnostic
        p, q, pm, qm, old_rect, rect = pair
        a = region._grid(p, pm, old_rect)
        diagnostic.update(seedPoints=len(a), roiShape=list(p.shape))
        if len(a) < POLICY["minPoints"]:
            diagnostic["reason"] = "insufficient-region-texture"
            return diagnostic
        try:
            initial = self._initialize(p, q, pm, qm, old_rect, rect, diagnostic)
            if initial is None:
                return diagnostic
            criteria = (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS,
                        POLICY["eccIterations"], POLICY["eccEpsilon"])
            corr, forward = cv2.findTransformECC(p, q, initial.copy(), cv2.MOTION_AFFINE, criteria, qm, 5)
            reverse_initial = np.linalg.inv(region._matrix3(initial))[:2].astype(np.float32)
            reverse_corr, backward = cv2.findTransformECC(q, p, reverse_initial, cv2.MOTION_AFFINE, criteria, pm, 5)
            diagnostic.update(eccCorrelation=float(corr), reverseEccCorrelation=float(reverse_corr))
            b = region.base._project(a, region._matrix3(forward))
            back = region.base._project(b, region._matrix3(backward))
            keep = np.linalg.norm(a-back, axis=1) <= POLICY["maxCyclePx"]
            if min(corr, reverse_corr) < POLICY["minCorrelation"]:
                diagnostic["reason"] = "ecc-correlation"
                return diagnostic
        except cv2.error:
            diagnostic["reason"] = "registration-unavailable"
            return diagnostic
        # Frozen M3I final acceptance gates below: the feature fit is only an
        # initializer. It cannot stand in for independent fresh-grid proof.
        if not _shape_valid(forward):
            diagnostic["reason"] = "region-shape-change"
            return diagnostic
        det = float(np.linalg.det(forward[:, :2]))
        linear = .5*math.log(det)
        fitted = region.base._project(a, region._matrix3(forward))
        aligned = cv2.warpAffine(q, forward, p.shape[::-1], flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
        keep &= region.base._matching_patches(p, aligned, a, a)
        keep &= region._inside_mask(fitted, qm)
        supported = int(np.count_nonzero(keep))
        diagnostic.update(points=supported, supportFraction=supported/len(a),
                          cycleP90Px=float(np.percentile(np.linalg.norm(a-back, axis=1), 90)))
        if supported < max(POLICY["minPoints"], POLICY["minSupport"]*len(a)):
            diagnostic["reason"] = "insufficient-photometric-cycle-support"
            return diagnostic
        if any(np.min(span) < POLICY["minSpan"] or hull < POLICY["minHull"]
               for span, hull in (_spread(a[keep], old_rect), _spread(fitted[keep], rect))):
            diagnostic["reason"] = "localized-region-support"
            return diagnostic
        center = region.base._project(np.asarray([region.base._center(old_rect)]), region._matrix3(forward))[0]
        box_growth = float(np.mean(np.log(region.base._size(rect)/region.base._size(old_rect))))
        if (np.linalg.norm(center-region.base._center(rect)) > max(2., .28*min(region.base._size(rect))) or
                abs(box_growth-linear) > POLICY["maxBoxLogDisagreement"]):
            diagnostic["reason"] = "region-box-disagreement"
            return diagnostic
        diagnostic.update(supported=True, reason="region-affine-supported", linearLogGrowth=linear,
                          logAreaGrowth=math.log(det), affine=forward.tolist())
        return diagnostic
