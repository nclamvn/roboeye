"""M3L fixed-lag direct pixel registration, not a persistent identity tracker.

Raw exposure/detection-index snapshots survive ephemeral ID replacement. Every
selected temporal origin is matched anew with reciprocal appearance competition.
Only real three-timestamp direct measurements may support a current notice.
This deliberately changes the measurement contract, not camera/zoom authority.
Separate grid verification is not a statistically held-out pixel experiment.
"""

from collections import deque
from copy import deepcopy
from dataclasses import dataclass
import math
from time import perf_counter
from types import MappingProxyType

import cv2
import numpy as np

import assist_scene_region_motion as region
from assist_scene_motion import Detection
from assist_scene_scale_approach_m3e import _native_transform

window = region.window
base = region.base
POLICY = MappingProxyType({**dict(region.POLICY),
    "method": "direct-template-window", "bankCadenceMs": 160.,
    "maxBankTimestamps": 7, "maxSparseTimestamps": 6,
    "minFreshMs": 12., "maxGapMs": 300.,
    "logScales": tuple(float(x) for x in np.linspace(-.4, .4, 17)),
    "rotationsDeg": (-10., 0., 10.), "maxCandidatesPerObject": 3,
    "spatialCenterDiagonals": 1.5, "associationMargin": .08,
    "minInitializerCorrelation": .70, "minPeakMargin": .04,
    "equivalentTranslationPx": 2., "equivalentTranslationFraction": .03,
    "equivalentLogScale": .075, "equivalentRotationDeg": 12.,
    "maxPairsPerOrigin": 36, "maxPairsPerFrame": 72,
    "maxInitializerWarpsPerDirection": 51,
    "maxTemplateCallsPerWarp": 4, "maxEccCallsPerPair": 2,
    "maxCenterFraction": .28,
})


@dataclass
class Exposure:
    at: float
    frame: dict
    crops: list


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _rotation_homography(old, new):
    k = new["intrinsics"]
    rotation = new["cameraToWorld"][:3, :3].T @ old["cameraToWorld"][:3, :3]
    return k @ rotation @ np.linalg.inv(k)


def _eligible(old, new):
    if old is None or new is None or old.frame["label"] != new.frame["label"]:
        return False
    warped = base._warp_rect(old.box, _rotation_homography(old.frame, new.frame))
    if warped is None:
        return False
    limit = POLICY["spatialCenterDiagonals"]*max(np.linalg.norm(base._size(warped)), np.linalg.norm(base._size(new.box)))
    return bool(np.linalg.norm(base._center(warped)-base._center(new.box)) <= limit)


def _affine_shape(matrix):
    try:
        matrix = np.asarray(matrix, dtype=float)
    except (TypeError, ValueError):
        return False
    if matrix.shape != (2, 3) or not np.isfinite(matrix).all():
        return False
    det = float(np.linalg.det(matrix[:, :2]))
    if det <= 0:
        return False
    singular = np.linalg.svd(matrix[:, :2], compute_uv=False)
    return bool(abs(.5*math.log(det)) <= POLICY["maxLinearLogGrowth"]
        and math.log(singular[0]/singular[-1]) <= POLICY["maxAnisotropyLog"]
        and abs(math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))) <= POLICY["maxRotationDeg"])


def _equivalent(a, b, rect):
    tolerance = max(POLICY["equivalentTranslationPx"], POLICY["equivalentTranslationFraction"]*min(base._size(rect)))
    return (np.linalg.norm(np.asarray(a["center"])-b["center"]) <= tolerance
        and abs(a["logScale"]-b["logScale"]) <= POLICY["equivalentLogScale"]+1e-9
        and abs(a["rotationDeg"]-b["rotationDeg"]) <= POLICY["equivalentRotationDeg"])


def _initialize(p, q, pm, qm, old_rect, rect, cost):
    """Finite pixel-only scale/rotation search, never bbox-derived scale."""
    ys, xs = np.nonzero(pm)
    if len(xs) < 49:
        return None, {"reason": "insufficient-template-pixels"}
    x0, x1, y0, y1 = min(xs), max(xs)+1, min(ys), max(ys)+1
    pixels, mask = p[y0:y1, x0:x1], pm[y0:y1, x0:x1]
    center = np.array([(pixels.shape[1]-1)/2., (pixels.shape[0]-1)/2.])
    candidates = []
    yy, xx = np.indices(q.shape)
    values = q.astype(np.float32)
    target_mask = (qm > 0).astype(np.float32)
    expected = base._center(rect)
    translation_limit = max(2., POLICY["maxCenterFraction"]*min(base._size(rect)))
    for log_scale in POLICY["logScales"]:
        for angle in POLICY["rotationsDeg"]:
            cost["initializerWarps"] += 1
            scale = math.exp(log_scale)
            theta = math.radians(angle)
            linear = scale*np.array([[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]])
            corners = np.array([[0, 0], [pixels.shape[1]-1, 0], [0, pixels.shape[0]-1], [pixels.shape[1]-1, pixels.shape[0]-1]])
            warped = (corners-center) @ linear.T
            lo, hi = np.floor(np.min(warped, axis=0)), np.ceil(np.max(warped, axis=0))
            width, height = (hi-lo+1).astype(int)
            if min(width, height) < 7 or width > q.shape[1] or height > q.shape[0]:
                continue
            affine = np.column_stack((linear, -linear@center-lo)).astype(np.float32)
            template = cv2.warpAffine(pixels, affine, (width, height), flags=cv2.INTER_LINEAR)
            valid = cv2.warpAffine(mask, affine, (width, height), flags=cv2.INTER_NEAREST) > 0
            weights = valid.astype(np.float32)
            count = int(np.count_nonzero(valid))
            if count < 49:
                continue
            template = template.astype(np.float32)
            template = (template-float(np.mean(template[valid])))*weights
            energy = float(np.sum(template*template))
            if energy < count*POLICY["minTextureVariance"]:
                continue
            cross = cv2.matchTemplate(values, template, cv2.TM_CCORR)
            total = cv2.matchTemplate(values, weights, cv2.TM_CCORR)
            square = cv2.matchTemplate(values*values, weights, cv2.TM_CCORR)
            overlap = cv2.matchTemplate(target_mask, weights, cv2.TM_CCORR)
            cost["templateCalls"] += 4
            denominator = np.sqrt(energy*np.maximum(0., square-total*total/count))
            scores = np.full(cross.shape, -1., np.float32)
            usable = (denominator >= count*POLICY["minTextureVariance"]) & (overlap >= POLICY["minSupport"]*count)
            centers_x, centers_y = xx[:cross.shape[0], :cross.shape[1]]-lo[0], yy[:cross.shape[0], :cross.shape[1]]-lo[1]
            usable &= (centers_x-expected[0])**2+(centers_y-expected[1])**2 <= translation_limit**2
            scores[usable] = np.clip(cross[usable]/denominator[usable], -1., 1.)
            # Retain two spatially separated maxima per warp. Nearby samples
            # of one smooth maximum are not independent competing solutions.
            for _ in range(2):
                _, best, _, point = cv2.minMaxLoc(scores)
                if best < 0:
                    break
                c = np.array(point, dtype=float)-lo
                full_affine = np.column_stack((linear, c-linear@(center+[x0, y0])))
                candidates.append({"score": float(best), "center": c.tolist(), "logScale": log_scale,
                                   "rotationDeg": angle, "affine": full_affine.tolist()})
                radius = max(POLICY["equivalentTranslationPx"], POLICY["equivalentTranslationFraction"]*min(base._size(rect)))
                sy, sx = np.indices(scores.shape)
                scores[(sx-point[0])**2+(sy-point[1])**2 <= radius**2] = -1.
    if not candidates:
        return None, {"reason": "template-search-unavailable"}
    candidates.sort(key=lambda c: (-c["score"], abs(c["logScale"]), abs(c["rotationDeg"]), c["center"]))
    best = candidates[0]
    other = next((c for c in candidates[1:] if not _equivalent(best, c, rect)), None)
    runner_up = -1. if other is None else other["score"]
    proof = {"reason": "template-initialized", "correlation": best["score"],
             "runnerUpCorrelation": runner_up, "peakMargin": best["score"]-runner_up,
             "logScale": best["logScale"], "rotationDeg": best["rotationDeg"],
             "center": best["center"], "affine": best["affine"]}
    if best["score"] < POLICY["minInitializerCorrelation"]:
        proof["reason"] = "template-correlation"
    elif best["score"]-runner_up < POLICY["minPeakMargin"]:
        proof["reason"] = "ambiguous-template-peak"
    else:
        return np.asarray(best["affine"], np.float32), proof
    return None, proof


def measure_pair(old, new):
    """Register two actual exposures directly; no chained transform/points."""
    started = perf_counter()
    proof = {"supported": False, "reason": "invalid-object-crop", "method": POLICY["method"],
             "startMs": old.at, "endMs": new.at, "observationMs": new.at-old.at,
             "startToken": old.frame["token"], "endToken": new.frame["token"],
             "startSha256": old.frame["sourceSha256"], "endSha256": new.frame["sourceSha256"],
             "startDetectionIndex": old.frame["detectionIndex"], "endDetectionIndex": new.frame["detectionIndex"],
             "startBox": list(old.box), "endBox": list(new.box),
             "cost": {"initializerWarps": 0, "templateCalls": 0, "eccCalls": 0}}
    try:
        pair = region._pair(old, new)
        if pair is None:
            return proof
        p, q, pm, qm, old_rect, rect = pair
        a = region._grid(p, pm, old_rect)
        proof.update(seedPoints=len(a), roiShape=list(p.shape),
                     oldRect=[float(v) for v in old_rect], currentRect=[float(v) for v in rect])
        if len(a) < POLICY["minPoints"]:
            proof["reason"] = "insufficient-region-texture"
            return proof
        forward_initial, fp = _initialize(p, q, pm, qm, old_rect, rect, proof["cost"])
        proof["forwardInitialization"] = fp
        if forward_initial is None:
            proof["reason"] = fp["reason"]
            return proof
        reverse_initial, rp = _initialize(q, p, qm, pm, rect, old_rect, proof["cost"])
        proof["reverseInitialization"] = rp
        if reverse_initial is None:
            proof["reason"] = "reverse-"+rp["reason"]
            return proof
        criteria = (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS,
                    POLICY["eccIterations"], POLICY["eccEpsilon"])
        proof["cost"]["eccCalls"] += 1
        corr, forward = cv2.findTransformECC(p, q, forward_initial, cv2.MOTION_AFFINE, criteria, qm, 5)
        proof["cost"]["eccCalls"] += 1
        reverse_corr, backward = cv2.findTransformECC(q, p, reverse_initial, cv2.MOTION_AFFINE, criteria, pm, 5)
        proof.update(eccCorrelation=float(corr), reverseEccCorrelation=float(reverse_corr))
        if min(corr, reverse_corr) < POLICY["minCorrelation"]:
            proof["reason"] = "ecc-correlation"
            return proof
        if not _affine_shape(forward) or not _affine_shape(backward):
            proof["reason"] = "region-shape-change"
            return proof
        b = base._project(a, region._matrix3(forward))
        back = base._project(b, region._matrix3(backward))
        cycles = np.linalg.norm(a-back, axis=1)
        keep = cycles <= POLICY["maxCyclePx"]
        aligned = cv2.warpAffine(q, forward, p.shape[::-1], flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
        keep &= base._matching_patches(p, aligned, a, a)
        keep &= region._inside_mask(b, qm)
        count = int(np.count_nonzero(keep))
        proof.update(points=count, supportFraction=count/len(a), cycleP90Px=float(np.percentile(cycles, 90)),
                     affine=forward.tolist(), reverseAffine=backward.tolist())
        if count < max(POLICY["minPoints"], POLICY["minSupport"]*len(a)):
            proof["reason"] = "insufficient-region-support"
            return proof
        spreads = []
        for points, box in ((a[keep], old_rect), (b[keep], rect)):
            span = np.ptp(points, axis=0)/base._size(box)
            hull = cv2.contourArea(cv2.convexHull(points.astype(np.float32)))/float(np.prod(base._size(box)))
            spreads.append({"span": span.tolist(), "hull": float(hull)})
        proof["spread"] = spreads
        if any(min(s["span"]) < POLICY["minSpan"] or s["hull"] < POLICY["minHull"] for s in spreads):
            proof["reason"] = "localized-region-support"
            return proof
        det = float(np.linalg.det(forward[:, :2]))
        linear = .5*math.log(det)
        center_error = float(np.linalg.norm(base._project(np.array([base._center(old_rect)]), region._matrix3(forward))[0]-base._center(rect)))
        box_growth = float(np.mean(np.log(base._size(rect)/base._size(old_rect))))
        proof.update(linearLogGrowth=linear, logAreaGrowth=math.log(det), boxLogGrowth=box_growth,
                     centerErrorPx=center_error, maxSupportedCyclePx=float(max(cycles[keep])))
        if (center_error > max(2., POLICY["maxCenterFraction"]*min(base._size(rect)))
                or abs(box_growth-linear) > POLICY["maxBoxLogDisagreement"]):
            proof["reason"] = "region-box-disagreement"
            return proof
        proof.update(supported=True, reason="direct-region-supported")
        return proof
    except cv2.error as error:
        proof.update(reason="registration-unavailable", error=str(error).splitlines()[0][:300])
        return proof
    finally:
        proof["wallMs"] = 1000.*(perf_counter()-started)


def _pair_score(proof):
    forward = proof.get("forwardInitialization", {}).get("correlation")
    reverse = proof.get("reverseInitialization", {}).get("correlation")
    # An unresolved eligible rival cannot disappear merely because its local
    # peak or later geometry failed. Unknown direction correlation has the
    # conservative upper bound 1, independent of growth/support/ECC outcome.
    return min(forward if _finite(forward) else 1., reverse if _finite(reverse) else 1.)


def validate_pair_proof(pair):
    """Score-time numeric gate, not a claim to rerun image registration."""
    if not isinstance(pair, dict) or pair.get("supported") is not True or pair.get("method") != POLICY["method"]:
        raise ValueError("Missing supported direct-pair measurement")
    def require(condition, reason):
        if not condition:
            raise ValueError(reason)
    times = [pair.get(k) for k in ("startMs", "endMs", "observationMs")]
    require(all(_finite(v) for v in times) and 0 <= times[0] < times[1]
            and abs(times[2]-(times[1]-times[0])) <= 1e-6, "Invalid direct exposure interval")
    require(isinstance(pair.get("startToken"), str) and isinstance(pair.get("endToken"), str)
            and pair["startToken"] != pair["endToken"], "Not two real exposure tokens")
    for key in ("startSha256", "endSha256"):
        value = pair.get(key)
        require(isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value), "Invalid exposure digest")
    for key in ("startDetectionIndex", "endDetectionIndex"):
        require(type(pair.get(key)) is int and 0 <= pair[key] < POLICY["maxTracks"], "Invalid raw detection index")
    for key in ("startBox", "endBox", "oldRect", "currentRect"):
        box = pair.get(key)
        require(isinstance(box, list) and len(box) == 4 and all(_finite(v) for v in box)
                and box[2] > box[0] and box[3] > box[1], "Invalid direct pixel rectangle")
    seeds, points, fraction = pair.get("seedPoints"), pair.get("points"), pair.get("supportFraction")
    require(type(seeds) is int and type(points) is int and POLICY["minPoints"] <= points <= seeds <= POLICY["gridSide"]**2
            and points >= POLICY["minSupport"]*seeds and _finite(fraction)
            and abs(fraction-points/seeds) <= 1e-6, "Invalid fresh-grid support denominator")
    shape = pair.get("roiShape")
    require(isinstance(shape, list) and len(shape) == 2 and all(type(n) is int and 20 <= n <= POLICY["maxNativeSide"] for n in shape), "Unbounded direct ROI")
    for key in ("affine", "reverseAffine"):
        require(_affine_shape(pair.get(key)), "Invalid direct affine shape")
    det = float(np.linalg.det(np.asarray(pair["affine"])[:, :2]))
    growth, area = pair.get("linearLogGrowth"), pair.get("logAreaGrowth")
    require(_finite(growth) and _finite(area) and abs(area-math.log(det)) <= 1e-6
            and abs(growth-.5*area) <= 1e-6, "Direct growth is not the actual affine Jacobian")
    require(all(_finite(pair.get(k)) and pair[k] >= POLICY["minCorrelation"]
                for k in ("eccCorrelation", "reverseEccCorrelation")), "Insufficient two-way ECC proof")
    require(_finite(pair.get("maxSupportedCyclePx")) and 0 <= pair["maxSupportedCyclePx"] <= POLICY["maxCyclePx"], "Invalid supported-cycle bound")
    require(_finite(pair.get("cycleP90Px")) and pair["cycleP90Px"] >= 0, "Missing cycle diagnostic")
    spread = pair.get("spread")
    require(isinstance(spread, list) and len(spread) == 2, "Missing two-exposure support spread")
    for value in spread:
        require(isinstance(value, dict) and isinstance(value.get("span"), list) and len(value["span"]) == 2
                and all(_finite(n) and n >= POLICY["minSpan"] for n in value["span"])
                and _finite(value.get("hull")) and value["hull"] >= POLICY["minHull"], "Localized direct-pair support")
    require(_finite(pair.get("boxLogGrowth")) and abs(pair["boxLogGrowth"]-growth) <= POLICY["maxBoxLogDisagreement"]
            and _finite(pair.get("centerErrorPx")) and 0 <= pair["centerErrorPx"] <= max(2., POLICY["maxCenterFraction"]*min(base._size(pair["currentRect"]))), "Direct fit/box disagreement")
    for key in ("forwardInitialization", "reverseInitialization"):
        init = pair.get(key)
        require(isinstance(init, dict) and init.get("reason") == "template-initialized", "Missing actual pixel initializer")
        corr, runner, margin = (init.get(k) for k in ("correlation", "runnerUpCorrelation", "peakMargin"))
        require(all(_finite(v) for v in (corr, runner, margin)) and POLICY["minInitializerCorrelation"] <= corr <= 1.
                and -1. <= runner <= 1. and abs(margin-(corr-runner)) <= 1e-6 and margin >= POLICY["minPeakMargin"], "Ambiguous direct template peak")
        require(init.get("logScale") in POLICY["logScales"] and init.get("rotationDeg") in POLICY["rotationsDeg"], "Unregistered initializer search")
    cost = pair.get("cost", {})
    require(cost.get("initializerWarps") == 2*POLICY["maxInitializerWarpsPerDirection"]
            and type(cost.get("templateCalls")) is int and 8 <= cost["templateCalls"] <= cost["initializerWarps"]*POLICY["maxTemplateCallsPerWarp"]
            and cost.get("eccCalls") == 2 and _finite(pair.get("wallMs")) and pair["wallMs"] >= 0, "Invalid actual direct registration cost")


def validate_association_proof(proof):
    """Validate reciprocal bounded appearance competition, independent of IDs."""
    if not isinstance(proof, dict) or proof.get("supported") is not True:
        raise ValueError("Missing direct anchor appearance certificate")
    current, selected = proof.get("currentDetectionIndex"), proof.get("anchorDetectionIndex")
    candidates, competitors = proof.get("eligibleAnchorIndices"), proof.get("eligibleCompetitors")
    if (type(current) is not int or type(selected) is not int or not 0 <= current < POLICY["maxTracks"]
            or not isinstance(candidates, list) or not 1 <= len(candidates) <= POLICY["maxCandidatesPerObject"]
            or len(set(candidates)) != len(candidates) or selected not in candidates
            or any(type(n) is not int or not 0 <= n < POLICY["maxTracks"] for n in candidates)
            or not isinstance(competitors, dict) or set(competitors) != {str(i) for i in candidates}
            or proof.get("reciprocalCurrentIndex") != current):
        raise ValueError("Invalid reciprocal candidate indexes/budget")
    for column in competitors.values():
        if (not isinstance(column, list) or not 1 <= len(column) <= POLICY["maxCandidatesPerObject"]
                or len(set(column)) != len(column) or current not in column
                or any(type(n) is not int or not 0 <= n < POLICY["maxTracks"] for n in column)):
            raise ValueError("Invalid reciprocal competitor population")
    score = proof.get("correlation")
    if not _finite(score) or not POLICY["minInitializerCorrelation"] <= score <= 1.:
        raise ValueError("Missing anchor appearance correlation")
    for key, margin in (("runnerUpCorrelation", "associationMargin"), ("reverseRunnerUpCorrelation", "reverseAssociationMargin")):
        runner, gap = proof.get(key), proof.get(margin)
        if (not _finite(runner) or not -1 <= runner <= 1 or not _finite(gap)
                or abs(gap-(score-runner)) > 1e-6 or gap < POLICY["associationMargin"]):
            raise ValueError("Ambiguous reciprocal anchor appearance")


def match_origin(origin, current, comparisons):
    """Reciprocal appearance competition, with no persistent association state."""
    eligible = [[_eligible(old, new) for old in origin.crops] for new in current.crops]
    rows = [[i for i, keep in enumerate(row) if keep] for row in eligible]
    columns = [[j for j, row in enumerate(eligible) if row[i]] for i in range(len(origin.crops))]
    cap = POLICY["maxCandidatesPerObject"]
    allowed = []
    for candidates in rows:
        allowed.append(bool(candidates) and len(candidates) <= cap
            and all(len(columns[i]) <= cap and all(len(rows[j]) <= cap for j in columns[i]) for i in candidates))
    needed = set()
    for j, permitted in enumerate(allowed):
        if permitted:
            for i in rows[j]:
                needed.update((other, i) for other in columns[i])
    if len(needed) > POLICY["maxPairsPerOrigin"]:
        raise RuntimeError("Deterministic pair budget violated")
    pairs = {}
    for j, i in sorted(needed):
        proof = measure_pair(origin.crops[i], current.crops[j])
        comparisons.append(proof)
        pairs[j, i] = proof
    answers = []
    for j, candidates in enumerate(rows):
        certificate = {"supported": False, "reason": "no-eligible-anchor-object",
                       "originToken": origin.frame["token"], "originMs": origin.at,
                       "currentToken": current.frame["token"], "currentMs": current.at,
                       "currentDetectionIndex": j, "eligibleAnchorIndices": candidates,
                       "eligibleCompetitors": {str(i): columns[i] for i in candidates}}
        if not candidates:
            answers.append(certificate); continue
        if not allowed[j]:
            certificate["reason"] = "appearance-competitor-budget"
            answers.append(certificate); continue
        ranked = sorted(((_pair_score(pairs[j, i]), i) for i in candidates), key=lambda v: (-v[0], v[1]))
        score, selected = ranked[0]
        runner_up = ranked[1][0] if len(ranked) > 1 else -1.
        reverse = sorted(((_pair_score(pairs[other, selected]), other) for other in columns[selected]), key=lambda v: (-v[0], v[1]))
        reciprocal_score, reciprocal_index = reverse[0]
        reverse_runner = reverse[1][0] if len(reverse) > 1 else -1.
        pair = pairs[j, selected]
        certificate.update(anchorDetectionIndex=selected, correlation=score,
            runnerUpCorrelation=runner_up, associationMargin=score-runner_up,
            reciprocalCurrentIndex=reciprocal_index, reverseRunnerUpCorrelation=reverse_runner,
            reverseAssociationMargin=reciprocal_score-reverse_runner, pair=pair)
        if (reciprocal_index != j or score-runner_up < POLICY["associationMargin"]
                or reciprocal_score-reverse_runner < POLICY["associationMargin"]):
            certificate["reason"] = "ambiguous-anchor-appearance"
        elif not pair["supported"]:
            certificate["reason"] = pair["reason"]
        else:
            certificate.update(supported=True, reason="reciprocal-direct-appearance")
        answers.append(certificate)
    return answers


class DirectWindowMotion:
    """Measurement adapter; frozen camera surface supplies current handles only."""

    def __init__(self, *, native_detail=True):
        self.native_detail = bool(native_detail)
        self.epoch = 0
        self._bank = deque(maxlen=POLICY["maxSparseTimestamps"])
        self._latest = None
        self._previous = None

    def _clear(self):
        self._bank.clear()
        self._latest = None
        self._previous = None

    def update(self, frame, t_ms, gray, boxes, *, native_gray=None, camera_surface=None):
        started = perf_counter()
        diagnostics = {"method": POLICY["method"], "sourceStatus": None, "trackReasons": {},
                       "windowEvidence": {}, "comparisons": [], "snapshotSelection": {},
                       "comparisonCount": 0, "bank": {"count": 0, "timestampsMs": []}}
        tracks, events = [], []
        def result(status):
            diagnostics["comparisonCount"] = len(diagnostics["comparisons"])
            diagnostics["cost"] = {name: sum(p["cost"][name] for p in diagnostics["comparisons"])
                                   for name in ("initializerWarps", "templateCalls", "eccCalls")}
            diagnostics["wallMs"] = 1000.*(perf_counter()-started)
            return {"status": status, "epoch": self.epoch, "tracks": tracks,
                    "events": events, "diagnostics": diagnostics}
        if (not isinstance(gray, np.ndarray) or gray.dtype != np.uint8 or gray.ndim != 2
                or not 32 <= min(gray.shape) <= max(gray.shape) <= 768):
            self._clear(); return result("invalid-image")
        if not _finite(t_ms) or t_ms < 0:
            self._clear(); return result("invalid-stream-clock")
        h, w = gray.shape
        clean = region.RegionMotion._surface(camera_surface, w, h)
        supplied = base._boxes(boxes, w, h)
        if clean is None or supplied is None:
            self._clear(); return result("invalid-camera-surface")
        tracks, source_boxes = clean
        if (len(supplied) != len(source_boxes)
                or any(a.label != b.label or a.score != b.score
                       or not np.allclose(a.xyxy, b.xyxy, atol=1e-8, rtol=1e-10)
                       for a, b in zip(supplied, source_boxes))):
            self._clear(); return result("camera-detection-mismatch")
        if camera_surface["epoch"] != self.epoch:
            self._clear()
        self.epoch = camera_surface["epoch"]
        source_status = camera_surface.get("status")
        diagnostics["sourceStatus"] = source_status
        if source_status not in ("valid", "first-frame"):
            self._clear(); return result(source_status if isinstance(source_status, str) else "invalid-camera-surface")
        view, status = base._frame_view(frame, w, h)
        fingerprint = frame.get("sha256") if isinstance(frame, dict) else None
        if view is None:
            self._clear(); return result(status)
        if (not isinstance(view.get("token"), str) or not view["token"]
                or not isinstance(fingerprint, str) or len(fingerprint) != 64
                or any(c not in "0123456789abcdef" for c in fingerprint)):
            self._clear(); return result("unbound-source-exposure")
        view = deepcopy({**view, "sourceSha256": fingerprint})
        if abs(view["timestampUs"]-view["poseTimestampUs"]) > 20_000:
            self._clear(); return result("pose-skew")
        if self._previous is not None:
            old, old_at, old_shape = self._previous
            if (t_ms <= old_at or t_ms-old_at > POLICY["maxGapMs"] or gray.shape != old_shape
                    or abs((t_ms-old_at)-(view["timestampUs"]-old["timestampUs"])/1000.) > 1.
                    or view.get("epoch") != old.get("epoch") or view["token"] == old["token"]
                    or not np.allclose(view["intrinsics"], old["intrinsics"], atol=1e-4, rtol=1e-6)):
                self._clear(); return result("stream-discontinuity")
        if source_status == "first-frame":
            self._clear()
        if not supplied:
            self._clear()
            self._previous = view, t_ms, gray.shape
            return result(source_status)
        native = _native_transform(native_gray, gray.shape) if self.native_detail else None
        raw, transform = (native_gray, native) if native is not None else (gray, np.eye(3))
        diagnostics["nativeDetail"] = native is not None
        crops = []
        for index, box in enumerate(supplied):
            if window._too_small(box.xyxy, gray.shape, native):
                crops.append(None); continue
            metadata = {**view, "label": box.label, "detectionIndex": index}
            crops.append(region._snapshot(t_ms, raw, box, [], transform, metadata, native is not None))
        current = Exposure(t_ms, view, crops)
        while self._bank and t_ms-self._bank[0].at > POLICY["maxWindowMs"]:
            self._bank.popleft()
        eligible = [old for old in self._bank if POLICY["minWindowMs"] <= t_ms-old.at <= POLICY["maxWindowMs"]]
        anchor = eligible[0] if eligible else None
        fresh = self._latest
        if fresh is not None and not POLICY["minFreshMs"] <= t_ms-fresh.at <= POLICY["maxGapMs"]:
            fresh = None
        diagnostics["snapshotSelection"] = {
            "current": {"token": view["token"], "timeMs": t_ms, "sourceSha256": fingerprint},
            "fresh": None if fresh is None else {"token": fresh.frame["token"], "timeMs": fresh.at, "sourceSha256": fresh.frame["sourceSha256"]},
            "anchor": None if anchor is None else {"token": anchor.frame["token"], "timeMs": anchor.at, "sourceSha256": anchor.frame["sourceSha256"]},
            "rule": "oldest-eligible-cadence-origin-plus-immediately-previous-actual-exposure"}
        # A fresh origin and the fixed long origin are chosen BEFORE matching,
        # not selected retrospectively from the origins producing growth.
        fresh_matches = match_origin(fresh, current, diagnostics["comparisons"]) if fresh is not None else None
        long_matches = match_origin(anchor, current, diagnostics["comparisons"]) if anchor is not None and fresh is not None else None
        if len(diagnostics["comparisons"]) > POLICY["maxPairsPerFrame"]:
            raise RuntimeError("Direct measurement pair budget violated")
        for index, track in enumerate(tracks):
            key = str(track["id"])
            def pair_record(certificate):
                if certificate is None:
                    return None
                association = {k: deepcopy(v) for k, v in certificate.items() if k != "pair"}
                return {**deepcopy(certificate.get("pair", {"supported": False, "reason": certificate["reason"]})),
                        "association": association}
            evidence = {"confirmed": False,
                        "fresh": pair_record(None if fresh_matches is None else fresh_matches[index]),
                        "anchor": pair_record(None if long_matches is None else long_matches[index]),
                        "timestampCount": 0, "currentToken": view["token"], "currentMs": t_ms,
                        "selectedPreviousToken": None if fresh is None else fresh.frame["token"],
                        "selectedPreviousMs": None if fresh is None else fresh.at,
                        "selectedAnchorToken": None if anchor is None else anchor.frame["token"],
                        "selectedAnchorMs": None if anchor is None else anchor.at,
                        "realExposureTokens": [] if fresh is None or anchor is None else [anchor.frame["token"], fresh.frame["token"], view["token"]]}
            if crops[index] is None:
                reason = "small-or-invalid-object-crop"
            elif fresh_matches is None:
                reason = "no-fresh-source-exposure"
            elif not fresh_matches[index]["supported"]:
                reason = "fresh-"+fresh_matches[index]["reason"]
            elif long_matches is None:
                reason = "no-long-source-exposure"
            elif not long_matches[index]["supported"]:
                reason = "anchor-"+long_matches[index]["reason"]
            else:
                first = long_matches[index]["pair"]
                previous = fresh_matches[index]["pair"]
                stamps = {first["startMs"], previous["startMs"], t_ms}
                evidence["timestampCount"] = len(stamps)
                if len(stamps) != 3:
                    reason = "insufficient-distinct-source-exposures"
                elif first["linearLogGrowth"] <= 0 or previous["linearLogGrowth"] <= 0:
                    reason = "direct-pair-disagreement"
                elif previous["linearLogGrowth"] < POLICY["minCurrentLinearGrowth"]:
                    reason = "no-current-region-expansion"
                elif first["linearLogGrowth"] < POLICY["minNetLinearGrowth"]:
                    reason = "no-long-region-expansion"
                else:
                    reason = "direct-window-expansion-supported"
                    evidence.update(confirmed=True, observationMs=first["observationMs"],
                                    linearLogGrowth=first["linearLogGrowth"], logAreaGrowth=first["logAreaGrowth"])
                    events.append({"kind": "relative-optical-approach", "trackId": track["id"], "label": track["label"],
                        "epoch": self.epoch, "timeMs": t_ms, "observationMs": first["observationMs"],
                        "linearLogGrowth": first["linearLogGrowth"], "logAreaGrowth": first["logAreaGrowth"],
                        "points": first["points"], "method": POLICY["method"]})
            evidence["reason"] = reason
            diagnostics["windowEvidence"][key] = evidence
            diagnostics["trackReasons"][key] = reason
        if not self._bank or t_ms-self._bank[-1].at >= POLICY["bankCadenceMs"]:
            self._bank.append(current)
        self._latest = current
        retained = {e.at: e for e in [*self._bank, current]}
        diagnostics["bank"] = {"count": len(retained), "timestampsMs": sorted(retained),
            "tokens": [retained[at].frame["token"] for at in sorted(retained)],
            "maxAgeMs": max(t_ms-at for at in retained),
            "cropCount": sum(c is not None for e in retained.values() for c in e.crops),
            "maxSidePx": max((max(c.pixels.shape) for e in retained.values() for c in e.crops if c is not None), default=0),
            "provenance": "raw-timestamp-detection-index-not-identity-age"}
        self._previous = view, t_ms, gray.shape
        return result(source_status)
