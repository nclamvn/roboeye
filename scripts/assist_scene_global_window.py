"""M3M: shared full-frame correspondence, disposable source-index association.

No persistent tracker or detector is introduced. Frozen A supplies current IDs
and camera vetoes. Fields are computed once per selected source timestamp, not
once per object. Verification is on working pixels only; native images are not
silently substituted for the provider's declared working-resolution evidence.
"""

from collections import deque
from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
import math
from time import perf_counter
from types import MappingProxyType

import cv2
import numpy as np

from assist_scene_dense_window import _sample
import assist_scene_region_motion as region


base = region.base
POLICY = MappingProxyType({**dict(region.POLICY),
    "method": "global-raft-window", "gridSide": 8, "seedPoints": 64,
    "bankCadenceMs": 160., "maxSparseTimestamps": 6, "maxBankTimestamps": 7,
    "minFreshMs": 12., "maxGapMs": 300., "maxWorkingSide": 768,
    "maxOriginsPerFrame": 2, "maxDirectionCallsPerFrame": 4,
    "maxComparisonsPerOrigin": 144, "maxComparisonsPerFrame": 288,
    "spatialCenterDiagonals": 1.5, "associationMargin": .08,
    "maxFlowFbPx": 1.3, "seedInset": .12, "ransacThresholdPx": 1.2,
    "maxCenterFraction": .28, "maxEstimatorLogGrowthSpan": .005,
    "minRepresentedWorkingSidePx": 18., "verification": "working-gray-only",
    "growthBound": "forward-reverse-estimator-envelope",
})


def _require(condition, message):
    if not condition: raise ValueError(message)


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _same(a, b):
    if _finite(a) and _finite(b): return abs(a-b) <= 1e-8
    if isinstance(a, dict) and isinstance(b, dict): return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list): return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b, strict=True))
    return type(a) is type(b) and a == b


def rotation_homography(old_frame, new_frame):
    k = np.asarray(new_frame["intrinsics"], dtype=float)
    first, last = (np.asarray(frame["cameraToWorld"], dtype=float) for frame in (old_frame, new_frame))
    return k @ (last[:3, :3].T @ first[:3, :3]) @ np.linalg.inv(k)


def eligible_pair(old_box, new_box, old_frame, new_frame):
    """All same-label spatial rivals, including too-small/unverifiable ones."""
    if old_box.label != new_box.label: return False
    warped = base._warp_rect(old_box.xyxy, rotation_homography(old_frame, new_frame))
    if warped is None: return False
    limit = POLICY["spatialCenterDiagonals"]*max(np.linalg.norm(base._size(warped)), np.linalg.norm(base._size(new_box.xyxy)))
    return bool(np.linalg.norm(base._center(warped)-base._center(new_box.xyxy)) <= limit)


def _small(box, shape):
    h, w = shape; x, y, r, b = box.xyxy
    return min(x, y, w-r, h-b) < 4 or min(r-x, b-y) < POLICY["minRepresentedWorkingSidePx"]


def _seeds(box):
    x, y, r, b = box.xyxy; dx, dy = POLICY["seedInset"]*(r-x), POLICY["seedInset"]*(b-y)
    xx, yy = np.meshgrid(np.linspace(x+dx, r-dx, POLICY["gridSide"]),
                         np.linspace(y+dy, b-dy, POLICY["gridSide"]))
    return np.column_stack((xx.ravel(), yy.ravel())).astype(np.float32)


def _population(old, new, box, forward, backward):
    a = _seeds(box)
    displacement, first = _sample(forward, a); b = a+displacement
    rewind, second = _sample(backward, b); returned = b+rewind
    cycles = np.linalg.norm(a-returned, axis=1)
    good = first & second & np.isfinite(b).all(axis=1) & np.isfinite(cycles) & (cycles <= POLICY["maxFlowFbPx"])
    good &= base._matching_patches(old, new, a, b)
    return a, b, cycles, good


def _affine_shape(matrix):
    try: matrix = np.asarray(matrix, dtype=float)
    except (TypeError, ValueError): return False
    if matrix.shape != (2, 3) or not np.isfinite(matrix).all(): return False
    determinant = float(np.linalg.det(matrix[:, :2]))
    if determinant <= 0: return False
    singular = np.linalg.svd(matrix[:, :2], compute_uv=False)
    return bool(abs(.5*math.log(determinant)) <= POLICY["maxLinearLogGrowth"]
        and math.log(singular[0]/singular[-1]) <= POLICY["maxAnisotropyLog"]
        and abs(math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))) <= POLICY["maxRotationDeg"])


def _direction(population, old_box, new_box, homography):
    a, b, cycles, good = population
    inside = base._inside(b, new_box.xyxy, .04)
    assigned = good & inside
    proof = {"seedPoints": len(a), "verifiedPoints": int(np.count_nonzero(good)),
             "assignedPoints": int(np.count_nonzero(assigned)), "unknownPoints": int(np.count_nonzero(~good)),
             "assignedFraction": float(np.count_nonzero(assigned)/len(a)), "points": 0,
             "supportFraction": 0., "supported": False, "reason": "insufficient-grid-support"}
    # Every failed FB/NCC/grid sample remains in the ORIGINAL denominator.
    if proof["assignedPoints"] < max(POLICY["minPoints"], POLICY["minSupport"]*len(a)): return proof
    corrected = base._project(a[assigned], homography)
    matrix, inliers = cv2.estimateAffine2D(corrected, b[assigned], method=cv2.RANSAC,
        ransacReprojThreshold=POLICY["ransacThresholdPx"], maxIters=2000, confidence=.995, refineIters=10)
    if matrix is None or inliers is None or not _affine_shape(matrix):
        proof["reason"] = "invalid-robust-affine"; return proof
    final_residuals = np.linalg.norm(corrected@matrix[:, :2].T+matrix[:, 2]-b[assigned], axis=1)
    consistent = inliers.ravel().astype(bool) & np.isfinite(final_residuals) & (final_residuals <= POLICY["ransacThresholdPx"])
    selected = np.flatnonzero(assigned)[consistent]
    proof.update(points=len(selected), supportFraction=len(selected)/len(a), affine=matrix.tolist())
    if len(selected) < max(POLICY["minPoints"], POLICY["minSupport"]*len(a)):
        proof["reason"] = "insufficient-robust-grid-support"; return proof
    spreads = []
    for points, rect in ((a[selected], old_box.xyxy), (b[selected], new_box.xyxy)):
        spreads.append({"span": (np.ptp(points, axis=0)/base._size(rect)).tolist(),
            "hull": float(cv2.contourArea(cv2.convexHull(points.astype(np.float32)))/np.prod(base._size(rect)))})
    proof["spread"] = spreads
    if any(min(s["span"]) < POLICY["minSpan"] or s["hull"] < POLICY["minHull"] for s in spreads):
        proof["reason"] = "localized-grid-support"; return proof
    warped = base._warp_rect(old_box.xyxy, homography)
    if warped is None: proof["reason"] = "invalid-camera-rectangle"; return proof
    linear = .5*math.log(float(np.linalg.det(matrix[:, :2])))
    box_growth = float(np.mean(np.log(base._size(new_box.xyxy)/base._size(warped))))
    center = matrix[:, :2]@base._center(warped)+matrix[:, 2]
    center_error = float(np.linalg.norm(center-base._center(new_box.xyxy)))
    proof.update(linearLogGrowth=linear, logAreaGrowth=2*linear, boxLogGrowth=box_growth,
                 centerErrorPx=center_error, maxSupportedCyclePx=float(max(cycles[selected])),
                 maxSupportedFitResidualPx=float(max(final_residuals[consistent])))
    if (abs(box_growth-linear) > POLICY["maxBoxLogDisagreement"]
            or center_error > max(2., POLICY["maxCenterFraction"]*min(base._size(new_box.xyxy)))):
        proof["reason"] = "verified-grid-box-disagreement"; return proof
    proof.update(supported=True, reason="verified-global-grid")
    return proof


def _unknown_direction():
    return {"seedPoints": POLICY["seedPoints"], "verifiedPoints": 0, "assignedPoints": 0,
            "unknownPoints": POLICY["seedPoints"], "assignedFraction": 0., "points": 0,
            "supportFraction": 0., "supported": False, "reason": "unverifiable-object-geometry"}


def measure_candidate(old, current, i, j, fields, field_id, forward_population, reverse_population):
    started = perf_counter(); before, after = old.boxes[i], current.boxes[j]
    proof = {"fieldId": field_id, "method": POLICY["method"], "label": after.label,
        "startToken": old.frame["token"], "endToken": current.frame["token"], "startMs": old.at, "endMs": current.at,
        "startSha256": old.frame["sourceSha256"], "endSha256": current.frame["sourceSha256"], "observationMs": current.at-old.at,
        "startDetectionIndex": i, "endDetectionIndex": j, "startBox": list(before.xyxy), "endBox": list(after.xyxy),
        "supported": False, "reason": "unverifiable-object-geometry"}
    if forward_population is None or reverse_population is None:
        fwd, rev = _unknown_direction(), _unknown_direction()
    else:
        homography = rotation_homography(old.frame, current.frame)
        fwd = _direction(forward_population, before, after, homography)
        rev = _direction(reverse_population, after, before, np.linalg.inv(homography))
    proof.update(forward=fwd, reverse=rev,
        scoreLower=min(d["assignedPoints"]/d["seedPoints"] for d in (fwd, rev)),
        scoreUpper=min((d["assignedPoints"]+d["unknownPoints"])/d["seedPoints"] for d in (fwd, rev)))
    if fwd["supported"] and rev["supported"]:
        estimates = [fwd["linearLogGrowth"], -rev["linearLogGrowth"]]
        lower, upper = min(estimates), max(estimates)
        proof.update(linearLogGrowthLowerBound=lower, linearLogGrowthUpperBound=upper,
                     growthSpan=upper-lower, growthBound=POLICY["growthBound"])
        if upper-lower <= POLICY["maxEstimatorLogGrowthSpan"]:
            proof.update(supported=True, reason="bidirectional-global-grid-supported")
        else: proof["reason"] = "bidirectional-estimator-disagreement"
    elif forward_population is not None and reverse_population is not None:
        proof["reason"] = "forward-"+fwd["reason"] if not fwd["supported"] else "reverse-"+rev["reason"]
    proof["wallMs"] = 1000.*(perf_counter()-started)
    return proof


def associate(comparisons, current_count, old_count, origin, current):
    """Winner lower support must beat every rival's upper support, both ways."""
    pairs = {(p["endDetectionIndex"], p["startDetectionIndex"]): p for p in comparisons}
    rows = [[i for i in range(old_count) if (j, i) in pairs] for j in range(current_count)]
    columns = [[j for j in range(current_count) if (j, i) in pairs] for i in range(old_count)]
    out = []
    for j, candidates in enumerate(rows):
        certificate = {"supported": False, "reason": "no-eligible-source-object", "currentDetectionIndex": j,
            "originToken": origin.frame["token"], "originMs": origin.at,
            "currentToken": current.frame["token"], "currentMs": current.at,
            "eligibleAnchorIndices": candidates, "eligibleCompetitors": {str(i): columns[i] for i in candidates}}
        if not candidates: out.append(certificate); continue
        selected = sorted(candidates, key=lambda i: (-pairs[j, i]["scoreLower"], i))[0]
        pair = pairs[j, selected]; lower = pair["scoreLower"]
        runner = max((pairs[j, i]["scoreUpper"] for i in candidates if i != selected), default=-1.)
        reverse = sorted(columns[selected], key=lambda other: (-pairs[other, selected]["scoreLower"], other))[0]
        reverse_runner = max((pairs[other, selected]["scoreUpper"] for other in columns[selected] if other != j), default=-1.)
        certificate.update(anchorDetectionIndex=selected, scoreLower=lower, runnerUpUpper=runner,
            associationMargin=lower-runner, reciprocalCurrentIndex=reverse,
            reverseRunnerUpUpper=reverse_runner, reverseAssociationMargin=lower-reverse_runner, pair=pair)
        if reverse != j or min(lower-runner, lower-reverse_runner) < POLICY["associationMargin"]:
            certificate["reason"] = "ambiguous-or-unverifiable-rival"
        elif not pair["supported"]: certificate["reason"] = pair["reason"]
        else: certificate.update(supported=True, reason="reciprocal-verified-global-support")
        out.append(certificate)
    return out


@dataclass
class Exposure:
    at: float
    frame: dict
    pixels: np.ndarray
    boxes: tuple


class GlobalWindowMotion:
    def __init__(self, flow_provider):
        if not callable(flow_provider): raise TypeError("An explicit global field provider is required")
        self.flow_provider = flow_provider
        self.epoch = 0
        self._bank = deque(maxlen=POLICY["maxSparseTimestamps"])
        self._latest = None
        self._previous = None

    def _clear(self):
        self._bank.clear(); self._latest = None; self._previous = None

    def _origin(self, old, current, diagnostics):
        started = perf_counter(); before = self.flow_provider.direction_calls
        fields = self.flow_provider(old.pixels, current.pixels)
        calls = self.flow_provider.direction_calls-before
        _require(calls == 2, "Global provider must execute exactly forward and reverse once per origin")
        _require(isinstance(fields, (tuple, list)) and len(fields) == 2 and all(isinstance(f, np.ndarray)
            and f.dtype == np.float32 and f.shape == (*old.pixels.shape, 2) and np.isfinite(f).all() for f in fields),
            "Global provider returned invalid working-coordinate fields")
        field_id = f"{old.frame['token']}->{current.frame['token']}"
        record = {"fieldId": field_id, "startToken": old.frame["token"], "endToken": current.frame["token"],
            "startMs": old.at, "endMs": current.at, "startSha256": old.frame["sourceSha256"], "endSha256": current.frame["sourceSha256"],
            "oldWorkingPixelsSha256": sha256(old.pixels.tobytes()).hexdigest(),
            "newWorkingPixelsSha256": sha256(current.pixels.tobytes()).hexdigest(),
            "fieldSha256": {direction: sha256(np.ascontiguousarray(field, dtype=np.float32).tobytes()).hexdigest()
                            for direction, field in zip(("forward", "backward"), fields, strict=True)},
            "fieldShapes": [list(field.shape) for field in fields],
            "providerKind": getattr(self.flow_provider, "metadata", {}).get("kind", "injected-test-provider"),
            "provider": deepcopy(getattr(self.flow_provider, "last_call", {})), "modelDirectionCalls": calls,
            "wallMs": 1000.*(perf_counter()-started)}
        diagnostics["globalFields"].append(record)
        fwd = [None if _small(box, old.pixels.shape) else _population(old.pixels, current.pixels, box, *fields) for box in old.boxes]
        rev = [None if _small(box, current.pixels.shape) else _population(current.pixels, old.pixels, box, fields[1], fields[0]) for box in current.boxes]
        comparisons = []
        for j, new_box in enumerate(current.boxes):
            for i, old_box in enumerate(old.boxes):
                if eligible_pair(old_box, new_box, old.frame, current.frame):
                    comparisons.append(measure_candidate(old, current, i, j, fields, field_id, fwd[i], rev[j]))
        diagnostics["comparisons"].extend(comparisons)
        return associate(comparisons, len(current.boxes), len(old.boxes), old, current)

    def update(self, frame, t_ms, gray, boxes, *, native_gray=None, camera_surface=None):
        started = perf_counter(); tracks = []; events = []
        diagnostics = {"method": POLICY["method"], "sourceStatus": None, "verification": POLICY["verification"],
            "trackReasons": {}, "windowEvidence": {}, "comparisons": [], "globalFields": [], "snapshotSelection": {},
            "bank": {"count": 0, "timestampsMs": [], "tokens": []}}
        def result(status):
            diagnostics["cost"] = {"globalPairs": len(diagnostics["globalFields"]),
                "globalDirectionCalls": sum(r["modelDirectionCalls"] for r in diagnostics["globalFields"]),
                "candidateComparisons": len(diagnostics["comparisons"])}
            _require(diagnostics["cost"]["globalPairs"] <= POLICY["maxOriginsPerFrame"]
                and diagnostics["cost"]["globalDirectionCalls"] <= POLICY["maxDirectionCallsPerFrame"]
                and len(diagnostics["comparisons"]) <= POLICY["maxComparisonsPerFrame"], "Global window execution budget exceeded")
            diagnostics["wallMs"] = 1000.*(perf_counter()-started)
            return {"status": status, "epoch": self.epoch, "tracks": tracks, "events": events, "diagnostics": diagnostics}
        if (not isinstance(gray, np.ndarray) or gray.dtype != np.uint8 or gray.ndim != 2
                or not 32 <= min(gray.shape) <= max(gray.shape) <= POLICY["maxWorkingSide"]):
            self._clear(); return result("invalid-image")
        if not _finite(t_ms) or t_ms < 0: self._clear(); return result("invalid-stream-clock")
        h, w = gray.shape; clean = region.RegionMotion._surface(camera_surface, w, h); supplied = base._boxes(boxes, w, h)
        if clean is None or supplied is None: self._clear(); return result("invalid-camera-surface")
        tracks, observed = clean
        if len(supplied) != len(observed) or any(a.label != b.label or a.score != b.score
                or not np.allclose(a.xyxy, b.xyxy, atol=1e-8, rtol=1e-10) for a, b in zip(supplied, observed)):
            self._clear(); return result("camera-detection-mismatch")
        if camera_surface["epoch"] != self.epoch: self._clear()
        self.epoch = camera_surface["epoch"]; source_status = camera_surface.get("status")
        diagnostics["sourceStatus"] = source_status
        if source_status not in {"valid", "first-frame"}:
            self._clear(); return result(source_status if isinstance(source_status, str) else "invalid-camera-surface")
        view, status = base._frame_view(frame, w, h); fingerprint = frame.get("sha256") if isinstance(frame, dict) else None
        if view is None: self._clear(); return result(status)
        if (not isinstance(view.get("token"), str) or not view["token"]
                or not isinstance(fingerprint, str) or len(fingerprint) != 64
                or any(c not in "0123456789abcdef" for c in fingerprint)):
            self._clear(); return result("unbound-source-exposure")
        view = deepcopy({**view, "sourceSha256": fingerprint})
        if abs(view["timestampUs"]-view["poseTimestampUs"]) > 20_000: self._clear(); return result("pose-skew")
        if self._previous is not None:
            old, old_at, old_shape = self._previous
            if (t_ms <= old_at or t_ms-old_at > POLICY["maxGapMs"] or gray.shape != old_shape
                    or abs((t_ms-old_at)-(view["timestampUs"]-old["timestampUs"])/1000.) > 1.
                    or view.get("epoch") != old.get("epoch") or view.get("token") == old.get("token")
                    or not np.allclose(view["intrinsics"], old["intrinsics"], atol=1e-4, rtol=1e-6)):
                self._clear(); return result("stream-discontinuity")
        if source_status == "first-frame": self._clear()
        if not supplied:
            self._clear(); self._previous = view, t_ms, gray.shape
            return result(source_status)
        current = Exposure(t_ms, view, gray.copy(), tuple(supplied))
        while self._bank and t_ms-self._bank[0].at > POLICY["maxWindowMs"]: self._bank.popleft()
        eligible = [old for old in self._bank if POLICY["minWindowMs"] <= t_ms-old.at <= POLICY["maxWindowMs"]]
        anchor, fresh = eligible[0] if eligible else None, self._latest
        if fresh is not None and not POLICY["minFreshMs"] <= t_ms-fresh.at <= POLICY["maxGapMs"]: fresh = None
        def origin_record(old):
            return None if old is None else {"token": old.frame["token"], "timeMs": old.at, "sourceSha256": old.frame["sourceSha256"]}
        diagnostics["snapshotSelection"] = {"current": origin_record(current), "fresh": origin_record(fresh),
            "anchor": origin_record(anchor), "rule": "oldest-eligible-cadence-origin-plus-immediately-previous-actual-exposure"}
        fresh_matches = self._origin(fresh, current, diagnostics) if fresh is not None else None
        anchor_matches = self._origin(anchor, current, diagnostics) if anchor is not None and fresh is not None else None
        for index, track in enumerate(tracks):
            key = str(track["id"])
            def pair_record(certificate):
                if certificate is None: return None
                return {**deepcopy(certificate.get("pair", {"supported": False, "reason": certificate["reason"]})),
                    "association": {k: deepcopy(v) for k, v in certificate.items() if k != "pair"}}
            proof = {"confirmed": False, "currentToken": view["token"], "currentMs": t_ms,
                "fresh": pair_record(None if fresh_matches is None else fresh_matches[index]),
                "anchor": pair_record(None if anchor_matches is None else anchor_matches[index]),
                "selectedPreviousToken": None if fresh is None else fresh.frame["token"], "selectedPreviousMs": None if fresh is None else fresh.at,
                "selectedAnchorToken": None if anchor is None else anchor.frame["token"], "selectedAnchorMs": None if anchor is None else anchor.at,
                "realExposureTokens": [] if fresh is None or anchor is None else [anchor.frame["token"], fresh.frame["token"], view["token"]]}
            reason = "no-fresh-source-exposure" if fresh_matches is None else "fresh-"+fresh_matches[index]["reason"]
            if fresh_matches is not None and fresh_matches[index]["supported"]:
                reason = "no-long-source-exposure" if anchor_matches is None else "anchor-"+anchor_matches[index]["reason"]
                if anchor_matches is not None and anchor_matches[index]["supported"]:
                    first, adjacent = anchor_matches[index]["pair"], fresh_matches[index]["pair"]
                    if len({first["startMs"], adjacent["startMs"], t_ms}) != 3: reason = "insufficient-distinct-source-exposures"
                    elif adjacent["linearLogGrowthLowerBound"] < POLICY["minCurrentLinearGrowth"]: reason = "no-current-global-expansion"
                    elif first["linearLogGrowthLowerBound"] < POLICY["minNetLinearGrowth"]: reason = "no-long-global-expansion"
                    else:
                        lower, upper = first["linearLogGrowthLowerBound"], first["linearLogGrowthUpperBound"]
                        proof.update(confirmed=True, linearLogGrowth=lower, linearLogGrowthLowerBound=lower,
                            linearLogGrowthUpperBound=upper, growthBound=POLICY["growthBound"], observationMs=first["observationMs"])
                        reason = "global-window-expansion-supported"
                        events.append({"kind": "relative-optical-approach", "trackId": track["id"], "label": track["label"],
                            "epoch": self.epoch, "timeMs": t_ms, "method": POLICY["method"], "observationMs": first["observationMs"],
                            "linearLogGrowth": lower, "linearLogGrowthLowerBound": lower, "logAreaGrowth": 2*lower,
                            "growthBound": POLICY["growthBound"], "points": min(first["forward"]["points"], first["reverse"]["points"])})
            proof["reason"] = reason; diagnostics["windowEvidence"][key] = proof; diagnostics["trackReasons"][key] = reason
        if not self._bank or t_ms-self._bank[-1].at >= POLICY["bankCadenceMs"]: self._bank.append(current)
        self._latest = current; self._previous = view, t_ms, gray.shape
        retained = {old.at: old for old in [*self._bank, current]}
        diagnostics["bank"] = {"count": len(retained), "timestampsMs": sorted(retained),
            "tokens": [retained[at].frame["token"] for at in sorted(retained)], "maxAgeMs": max(t_ms-at for at in retained),
            "maxSidePx": max(gray.shape), "provenance": "raw-working-pixels-timestamp-detection-index-not-identity-age"}
        return result(source_status)


def validate_comparison(pair):
    _require(isinstance(pair, dict) and pair.get("method") == POLICY["method"], "Invalid global comparison")
    for direction in ("forward", "reverse"):
        proof = pair.get(direction, {}); seed = proof.get("seedPoints")
        verified, assigned, unknown, points = (proof.get(k) for k in ("verifiedPoints", "assignedPoints", "unknownPoints", "points"))
        _require(seed == POLICY["seedPoints"] and all(type(n) is int and 0 <= n <= seed for n in (verified, assigned, unknown, points))
            and assigned <= verified and points <= assigned and verified+unknown == seed
            and _same(proof.get("assignedFraction"), assigned/seed) and _same(proof.get("supportFraction"), points/seed),
            "Global support denominator omitted failed seed samples")
    lower = min(pair[d]["assignedPoints"]/pair[d]["seedPoints"] for d in ("forward", "reverse"))
    upper = min((pair[d]["assignedPoints"]+pair[d]["unknownPoints"])/pair[d]["seedPoints"] for d in ("forward", "reverse"))
    _require(_same(pair.get("scoreLower"), lower) and _same(pair.get("scoreUpper"), upper) and 0 <= lower <= upper <= 1,
        "Global association support bounds do not reproduce original denominators")


def validate_pair_proof(pair):
    validate_comparison(pair)
    _require(pair.get("supported") is True and pair.get("growthBound") == POLICY["growthBound"], "Missing supported bidirectional global proof")
    estimates = []
    for direction, sign in (("forward", 1.), ("reverse", -1.)):
        proof = pair[direction]; matrix = proof.get("affine")
        _require(proof.get("supported") is True and _affine_shape(matrix)
            and proof["points"] >= max(POLICY["minPoints"], POLICY["minSupport"]*POLICY["seedPoints"]), "Insufficient original-grid robust affine support")
        growth = .5*math.log(float(np.linalg.det(np.asarray(matrix)[:, :2])))
        _require(_same(proof.get("linearLogGrowth"), growth) and _same(proof.get("logAreaGrowth"), 2*growth)
            and _finite(proof.get("maxSupportedCyclePx")) and 0 <= proof["maxSupportedCyclePx"] <= POLICY["maxFlowFbPx"]
            and _finite(proof.get("maxSupportedFitResidualPx")) and 0 <= proof["maxSupportedFitResidualPx"] <= POLICY["ransacThresholdPx"],
            "Invalid measured global growth, cycle or final affine residual proof")
        spread = proof.get("spread")
        _require(isinstance(spread, list) and len(spread) == 2 and all(isinstance(s, dict)
            and isinstance(s.get("span"), list) and len(s["span"]) == 2 and all(_finite(v) and v >= POLICY["minSpan"] for v in s["span"])
            and _finite(s.get("hull")) and s["hull"] >= POLICY["minHull"] for s in spread), "Localized global affine support")
        destination = pair.get("endBox" if direction == "forward" else "startBox")
        _require(isinstance(destination, list) and len(destination) == 4 and all(_finite(v) for v in destination)
            and min(base._size(destination)) > 0, "Invalid global destination rectangle")
        _require(_finite(proof.get("boxLogGrowth")) and abs(proof["boxLogGrowth"]-growth) <= POLICY["maxBoxLogDisagreement"]
            and _finite(proof.get("centerErrorPx")) and 0 <= proof["centerErrorPx"]
            <= max(2., POLICY["maxCenterFraction"]*min(base._size(destination))), "Global fit and detector box disagree")
        estimates.append(sign*growth)
    lower, upper = min(estimates), max(estimates)
    _require(_same(pair.get("linearLogGrowthLowerBound"), lower) and _same(pair.get("linearLogGrowthUpperBound"), upper)
        and _same(pair.get("growthSpan"), upper-lower) and upper-lower <= POLICY["maxEstimatorLogGrowthSpan"], "Global growth envelope omits opposite-direction estimator")


def validate_association_proof(proof):
    _require(isinstance(proof, dict) and proof.get("supported") is True, "Missing global appearance support certificate")
    current, selected = proof.get("currentDetectionIndex"), proof.get("anchorDetectionIndex")
    candidates, competitors = proof.get("eligibleAnchorIndices"), proof.get("eligibleCompetitors")
    _require(type(current) is int and type(selected) is int and 0 <= current < POLICY["maxTracks"]
        and isinstance(candidates, list) and selected in candidates and len(candidates) == len(set(candidates))
        and all(type(i) is int and 0 <= i < POLICY["maxTracks"] for i in candidates)
        and isinstance(competitors, dict) and set(competitors) == {str(i) for i in candidates}
        and proof.get("reciprocalCurrentIndex") == current, "Invalid global reciprocal competitor population")
    _require(all(isinstance(rows, list) and current in rows and len(rows) == len(set(rows))
        and all(type(j) is int and 0 <= j < POLICY["maxTracks"] for j in rows) for rows in competitors.values()), "Invalid global competitor indices")
    score = proof.get("scoreLower")
    _require(_finite(score) and 0 <= score <= 1, "Invalid global lower association score")
    for key, margin in (("runnerUpUpper", "associationMargin"), ("reverseRunnerUpUpper", "reverseAssociationMargin")):
        runner = proof.get(key); gap = proof.get(margin)
        _require(_finite(runner) and -1 <= runner <= 1 and _same(gap, score-runner)
            and gap >= POLICY["associationMargin"], "Unresolved global reciprocal rival upper bound")


def validate_surface(surface, frame, history):
    """Compact numeric/trace gate; the separate runner reconstructs source joins."""
    diagnostics = surface.get("diagnostics", {})
    _require(diagnostics.get("method") == POLICY["method"], "Wrong global measurement method")
    if "A" in frame:
        _require(surface["tracks"] == frame["A"]["tracks"] and surface["epoch"] == frame["A"]["epoch"]
            and diagnostics.get("sourceStatus") == frame["A"]["status"], "Global measurement changed current camera handles")
    fields, comparisons = diagnostics.get("globalFields"), diagnostics.get("comparisons")
    _require(isinstance(fields, list) and len(fields) <= POLICY["maxOriginsPerFrame"]
        and isinstance(comparisons, list) and len(comparisons) <= POLICY["maxComparisonsPerFrame"], "Unbounded global trace")
    calls = 0
    for record in fields:
        _require(type(record.get("modelDirectionCalls")) is int and record["modelDirectionCalls"] == 2,
            "Each global origin needs actual forward and reverse calls")
        calls += record["modelDirectionCalls"]
        _require(record.get("endToken") == frame["token"] and record.get("endMs") == frame["timeMs"]
            and record.get("endSha256") == frame["sourceSha256"], "Unbound current global field")
    _require(diagnostics.get("cost") == {"globalPairs": len(fields), "globalDirectionCalls": calls,
        "candidateComparisons": len(comparisons)}, "Global trace cost does not reproduce")
    for pair in comparisons: validate_comparison(pair)
    for event in surface["events"]:
        proof = diagnostics.get("windowEvidence", {}).get(str(event["trackId"]), {})
        _require(proof.get("confirmed") is True, "Warning lacks current global proof")
        for key in ("fresh", "anchor"):
            validate_pair_proof(proof[key]); validate_association_proof(proof[key]["association"])
        first, fresh = proof["anchor"], proof["fresh"]
        lower = first["linearLogGrowthLowerBound"]
        _require(fresh["linearLogGrowthLowerBound"] >= POLICY["minCurrentLinearGrowth"]
            and lower >= POLICY["minNetLinearGrowth"] and event.get("linearLogGrowth") == lower
            and event.get("linearLogGrowthLowerBound") == lower and _same(event.get("logAreaGrowth"), 2*lower)
            and event.get("growthBound") == POLICY["growthBound"], "Warning ignores conservative two-way growth envelope")
