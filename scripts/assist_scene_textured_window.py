"""M3N source-only texture inventory and raw/flow-warped global verification.

Frozen M3M owns the camera authority, temporal bank, current IDs and warning
schedule. This subclass changes only source sampling and pixel verification;
it never modifies module globals or borrows identity age as measurement age.
"""

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


POLICY = MappingProxyType({**dict(frozen.POLICY), "method": "textured-global-window",
    "modes": ("raw", "warped"), "sourceSelector": dict(texture.POLICY),
    "seedDenominator": "all-original-source-selected-points-before-correspondence",
    "unknownRivals": "geometry-ineligible-or-original-N-below-nine-remain-[0,1]"})
eligible_pair = frozen.eligible_pair
rotation_homography = frozen.rotation_homography
validate_association_proof = frozen.validate_association_proof


def method_for_mode(mode):
    if mode not in POLICY["modes"]: raise ValueError("Choose explicit raw or warped verification")
    return f"textured-global-{mode}-window"


def selection_sha(selection):
    return sha256(json.dumps(selection, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _unknown(selection, mode, reason):
    count = len(selection["points"])
    return {"seedPoints": count, "verifiedPoints": 0, "assignedPoints": 0, "unknownPoints": count,
        "assignedFraction": 0., "points": 0, "supportFraction": 0., "supported": False, "reason": reason}


def _direction(population, old_box, new_box, homography):
    """Frozen M3M direction algorithm, with actual retained indices exposed."""
    a, b, cycles, good = population
    assigned = good & frozen.base._inside(b, new_box.xyxy, .04)
    proof = {"seedPoints": len(a), "verifiedPoints": int(np.count_nonzero(good)),
        "assignedPoints": int(np.count_nonzero(assigned)), "unknownPoints": int(np.count_nonzero(~good)),
        "assignedFraction": float(np.count_nonzero(assigned)/len(a)), "points": 0, "supportFraction": 0.,
        "supported": False, "reason": "insufficient-grid-support", "inlierIndices": [],
        "rotationHomography": np.asarray(homography).tolist()}
    if proof["assignedPoints"] < max(POLICY["minPoints"], POLICY["minSupport"]*len(a)): return proof
    corrected = frozen.base._project(a[assigned], homography)
    matrix, inliers = cv2.estimateAffine2D(corrected, b[assigned], method=cv2.RANSAC,
        ransacReprojThreshold=POLICY["ransacThresholdPx"], maxIters=2000, confidence=.995, refineIters=10)
    if matrix is None or inliers is None or not frozen._affine_shape(matrix):
        proof["reason"] = "invalid-robust-affine"; return proof
    residuals = np.linalg.norm(corrected@matrix[:, :2].T+matrix[:, 2]-b[assigned], axis=1)
    consistent = inliers.ravel().astype(bool) & np.isfinite(residuals) & (residuals <= POLICY["ransacThresholdPx"])
    selected = np.flatnonzero(assigned)[consistent]
    proof.update(points=len(selected), supportFraction=len(selected)/len(a), affine=matrix.tolist(), inlierIndices=selected.tolist())
    if len(selected) < max(POLICY["minPoints"], POLICY["minSupport"]*len(a)):
        proof["reason"] = "insufficient-robust-grid-support"; return proof
    spreads = []
    for points, rect in ((a[selected], old_box.xyxy), (b[selected], new_box.xyxy)):
        spreads.append({"span": (np.ptp(points, axis=0)/frozen.base._size(rect)).tolist(),
            "hull": float(cv2.contourArea(cv2.convexHull(points.astype(np.float32)))/np.prod(frozen.base._size(rect)))})
    proof["spread"] = spreads
    if any(min(s["span"]) < POLICY["minSpan"] or s["hull"] < POLICY["minHull"] for s in spreads):
        proof["reason"] = "localized-grid-support"; return proof
    warped = frozen.base._warp_rect(old_box.xyxy, homography)
    if warped is None: proof["reason"] = "invalid-camera-rectangle"; return proof
    linear = .5*math.log(float(np.linalg.det(matrix[:, :2])))
    box_growth = float(np.mean(np.log(frozen.base._size(new_box.xyxy)/frozen.base._size(warped))))
    center = matrix[:, :2]@frozen.base._center(warped)+matrix[:, 2]
    center_error = float(np.linalg.norm(center-frozen.base._center(new_box.xyxy)))
    proof.update(linearLogGrowth=linear, logAreaGrowth=2*linear, boxLogGrowth=box_growth,
        centerErrorPx=center_error, maxSupportedCyclePx=float(max(cycles[selected])),
        maxSupportedFitResidualPx=float(max(residuals[consistent])))
    if (abs(box_growth-linear) > POLICY["maxBoxLogDisagreement"]
            or center_error > max(2., POLICY["maxCenterFraction"]*min(frozen.base._size(new_box.xyxy)))):
        proof["reason"] = "verified-grid-box-disagreement"; return proof
    proof.update(supported=True, reason="verified-global-grid")
    return proof


def _measure(old, current, i, j, field_id, forward_record, reverse_record, mode):
    started = perf_counter(); before, after = old.boxes[i], current.boxes[j]
    forward, forward_entry = forward_record; reverse, reverse_entry = reverse_record
    proof = {"fieldId": field_id, "method": method_for_mode(mode), "mode": mode, "label": after.label,
        "startToken": old.frame["token"], "endToken": current.frame["token"], "startMs": old.at, "endMs": current.at,
        "startSha256": old.frame["sourceSha256"], "endSha256": current.frame["sourceSha256"], "observationMs": current.at-old.at,
        "startDetectionIndex": i, "endDetectionIndex": j, "startBox": list(before.xyxy), "endBox": list(after.xyxy),
        "supported": False, "reason": "unverifiable-source-selection", "unverifiable": forward is None or reverse is None}
    homography = rotation_homography(old.frame, current.frame)
    fwd = (_unknown(forward_entry["proof"]["selection"], mode, "unverifiable-source-selection") if forward is None
           else _direction(forward[:4], before, after, homography))
    rev = (_unknown(reverse_entry["proof"]["selection"], mode, "unverifiable-source-selection") if reverse is None
           else _direction(reverse[:4], after, before, np.linalg.inv(homography)))
    for direction, entry in ((fwd, forward_entry), (rev, reverse_entry)):
        direction.update(populationId=entry["populationId"], populationSha256=entry["populationSha256"],
                         selectionSha256=entry["selectionSha256"])
    if proof["unverifiable"]: lower, upper = 0., 1.
    else:
        lower = min(p["assignedPoints"]/p["seedPoints"] for p in (fwd, rev))
        upper = min((p["assignedPoints"]+p["unknownPoints"])/p["seedPoints"] for p in (fwd, rev))
    proof.update(forward=fwd, reverse=rev, scoreLower=lower, scoreUpper=upper)
    if fwd["supported"] and rev["supported"]:
        estimates = [fwd["linearLogGrowth"], -rev["linearLogGrowth"]]
        low, high = min(estimates), max(estimates)
        proof.update(linearLogGrowthLowerBound=low, linearLogGrowthUpperBound=high, growthSpan=high-low,
                     growthBound=POLICY["growthBound"])
        if high-low <= POLICY["maxEstimatorLogGrowthSpan"]:
            proof.update(supported=True, reason="bidirectional-textured-global-supported")
        else: proof["reason"] = "bidirectional-estimator-disagreement"
    elif not proof["unverifiable"]:
        proof["reason"] = "forward-"+fwd["reason"] if not fwd["supported"] else "reverse-"+rev["reason"]
    proof["wallMs"] = 1000.*(perf_counter()-started)
    return proof


class TexturedGlobalWindowMotion(frozen.GlobalWindowMotion):
    def __init__(self, flow_provider, mode="raw"):
        method_for_mode(mode)
        super().__init__(flow_provider)
        self.mode = mode
        self._pending = None

    def _prepare(self, frame, gray, boxes):
        if (not isinstance(frame, dict) or not isinstance(gray, np.ndarray) or gray.dtype != np.uint8
                or gray.ndim != 2 or not 32 <= min(gray.shape) <= max(gray.shape) <= POLICY["maxWorkingSide"]): return None
        supplied = frozen.base._boxes(boxes, gray.shape[1], gray.shape[0])
        if supplied is None: return None
        maps = texture.texture_maps(gray)
        selections = [texture.select_seeds(gray, box, maps=maps) for box in supplied]
        for selection in selections: texture.validate_selection(selection)
        return {"sourceToken": frame.get("token"), "sourceMs": None, "sourceSha256": frame.get("sha256"),
            "workingPixelsSha256": sha256(gray.tobytes()).hexdigest(), "selections": selections,
            "selectionSha256s": [selection_sha(selection) for selection in selections]}

    def _origin(self, old, current, diagnostics):
        # Both inventories already exist before the first field call below.
        before_inventory = getattr(old, "source_inventory", None); now_inventory = self._pending
        frozen._require(isinstance(before_inventory, dict) and isinstance(now_inventory, dict), "Missing pre-correspondence source inventories")
        for exposure, inventory in ((old, before_inventory), (current, now_inventory)):
            frozen._require(inventory["sourceToken"] == exposure.frame["token"]
                and inventory["sourceSha256"] == exposure.frame["sourceSha256"]
                and inventory["workingPixelsSha256"] == sha256(exposure.pixels.tobytes()).hexdigest()
                and len(inventory["selections"]) == len(exposure.boxes)
                and inventory["selectionSha256s"] == [selection_sha(s) for s in inventory["selections"]], "Source inventory changed before correspondence")
        # Reuse the frozen full-frame provider and field fingerprint contract;
        # never call the frozen per-object population selector.
        started = perf_counter(); before = self.flow_provider.direction_calls
        fields = self.flow_provider(old.pixels, current.pixels)
        calls = self.flow_provider.direction_calls-before
        frozen._require(calls == 2 and isinstance(fields, (tuple, list)) and len(fields) == 2
            and all(isinstance(field, np.ndarray) and field.dtype == np.float32 and field.shape == (*old.pixels.shape, 2)
                    and np.isfinite(field).all() for field in fields), "Invalid actual full-frame correspondence execution")
        field_id = f"{old.frame['token']}->{current.frame['token']}"
        diagnostics["globalFields"].append({"fieldId": field_id, "mode": self.mode,
            "startToken": old.frame["token"], "endToken": current.frame["token"], "startMs": old.at, "endMs": current.at,
            "startSha256": old.frame["sourceSha256"], "endSha256": current.frame["sourceSha256"],
            "oldWorkingPixelsSha256": before_inventory["workingPixelsSha256"], "newWorkingPixelsSha256": now_inventory["workingPixelsSha256"],
            "oldSelectionSha256s": list(before_inventory["selectionSha256s"]), "newSelectionSha256s": list(now_inventory["selectionSha256s"]),
            "fieldSha256": {name: sha256(np.ascontiguousarray(field).tobytes()).hexdigest() for name, field in zip(("forward", "backward"), fields, strict=True)},
            "fieldShapes": [list(field.shape) for field in fields],
            "providerKind": getattr(self.flow_provider, "metadata", {}).get("kind", "injected-test-provider"),
            "provider": deepcopy(getattr(self.flow_provider, "last_call", {})), "modelDirectionCalls": calls,
            "wallMs": 1000.*(perf_counter()-started)})
        def populations(first, second, inventory, fwd, rev, direction):
            out = []
            for index, (box, selection) in enumerate(zip(first.boxes, inventory["selections"], strict=True)):
                if frozen._small(box, first.pixels.shape) or len(selection["points"]) < POLICY["minPoints"]:
                    result = None
                    proof = {"status": "not-measured", "mode": self.mode, "seedPoints": len(selection["points"]),
                        "selection": deepcopy(selection), "selectionSha256": selection_sha(selection),
                        "reason": "geometry-ineligible-or-insufficient-source-points"}
                else:
                    result = texture.population(first.pixels, second.pixels, box, fwd, rev, mode=self.mode,
                        selection=deepcopy(selection))
                    frozen._require(result[4]["selectionSha256"] == selection_sha(selection)
                        and np.array_equal(result[0], np.asarray(selection["points"], np.float32)), "Population changed its original source inventory")
                    proof = result[4]
                entry = {"populationId": f"{field_id}|{direction}|{index}", "fieldId": field_id,
                    "direction": direction, "detectionIndex": index, "sourceToken": first.frame["token"],
                    "sourceMs": first.at, "sourceSha256": first.frame["sourceSha256"],
                    "selectionSha256": selection_sha(selection), "populationSha256": selection_sha(proof), "proof": proof}
                diagnostics.setdefault("populations", []).append(entry)
                out.append((result, entry))
            return out
        fwd = populations(old, current, before_inventory, *fields, "forward")
        rev = populations(current, old, now_inventory, fields[1], fields[0], "reverse")
        comparisons = []
        for j, new_box in enumerate(current.boxes):
            for i, old_box in enumerate(old.boxes):
                if eligible_pair(old_box, new_box, old.frame, current.frame):
                    comparisons.append(_measure(old, current, i, j, field_id, fwd[i], rev[j], self.mode))
        diagnostics["comparisons"].extend(comparisons)
        return frozen.associate(comparisons, len(current.boxes), len(old.boxes), old, current)

    def update(self, frame, t_ms, gray, boxes, *, native_gray=None, camera_surface=None):
        started = perf_counter()
        # Selection depends only on this source image/box. It is sealed before
        # super.update can call any correspondence provider, fresh or anchor.
        inventory = self._prepare(frame, gray, boxes)
        if inventory is not None: inventory["sourceMs"] = t_ms if frozen._finite(t_ms) else None
        self._pending = inventory
        try:
            result = super().update(frame, t_ms, gray, boxes, native_gray=native_gray, camera_surface=camera_surface)
            if self._latest is not None and inventory is not None and self._latest.frame["token"] == inventory["sourceToken"]:
                self._latest.source_inventory = deepcopy(inventory)
        finally: self._pending = None
        result["diagnostics"].update(method=method_for_mode(self.mode), mode=self.mode,
            sourceSelections=deepcopy(inventory), sourceSelectionBeforeCorrespondence=True,
            wallMs=1000.*(perf_counter()-started))
        result["diagnostics"].setdefault("populations", [])
        for event in result["events"]: event.update(method=method_for_mode(self.mode), mode=self.mode)
        return result


def population_index(populations):
    if isinstance(populations, dict): return populations
    frozen._require(isinstance(populations, list), "Textured proof requires its population catalog")
    lookup = {entry["populationId"]: entry for entry in populations}
    frozen._require(len(lookup) == len(populations), "Duplicated texture population catalog entry")
    return lookup


def resolve_population(pair, direction, populations):
    lookup = population_index(populations); record = pair[direction]
    entry = lookup.get(record.get("populationId"), {}); proof = entry.get("proof", {})
    start = direction == "forward"
    frozen._require(entry.get("fieldId") == pair["fieldId"] and entry.get("direction") == direction
        and entry.get("detectionIndex") == pair["startDetectionIndex" if start else "endDetectionIndex"]
        and entry.get("sourceToken") == pair["startToken" if start else "endToken"]
        and entry.get("sourceMs") == pair["startMs" if start else "endMs"]
        and entry.get("sourceSha256") == pair["startSha256" if start else "endSha256"]
        and entry.get("populationSha256") == record.get("populationSha256") == selection_sha(proof)
        and entry.get("selectionSha256") == record.get("selectionSha256") == proof.get("selectionSha256")
        and frozen._same(proof.get("selection", {}).get("sourceBox"), pair["startBox" if start else "endBox"]),
        "Population reference changed its original source/detection or sealed contents")
    return proof


def retained_geometry(pair, direction, population):
    """Join numeric summaries to the retained original per-seed coordinates."""
    record = pair[direction]; source = pair["startBox" if direction == "forward" else "endBox"]
    destination = pair["endBox" if direction == "forward" else "startBox"]
    a = np.asarray(population["selection"]["points"], np.float32).reshape(-1, 2)
    b = np.asarray([point["destinationPoint"] if point["destinationPoint"] is not None else [np.nan, np.nan]
                    for point in population["points"]], np.float32)
    good = np.asarray([point["good"] for point in population["points"]], bool)
    assigned = good & frozen.base._inside(b, destination, .04)
    indices = record.get("inlierIndices", [])
    frozen._require(isinstance(indices, list) and all(type(i) is int and 0 <= i < len(a) for i in indices)
        and indices == sorted(set(indices)) and len(indices) == record["points"]
        and all(assigned[i] for i in indices) and record["assignedPoints"] == int(assigned.sum()),
        "Assigned or selected textured points do not reproduce retained destinations")
    if not record.get("supported"): return
    homography = np.asarray(record.get("rotationHomography"), dtype=float)
    matrix = np.asarray(record.get("affine"), dtype=float)
    frozen._require(homography.shape == (3, 3) and np.isfinite(homography).all()
        and frozen._affine_shape(matrix) and indices, "Missing retained geometric fit evidence")
    corrected = frozen.base._project(a[indices], homography)
    residuals = np.linalg.norm(corrected@matrix[:, :2].T+matrix[:, 2]-b[indices], axis=1)
    cycles = [population["points"][i]["centerCyclePx"] for i in indices]
    frozen._require(np.isfinite(residuals).all() and max(residuals) <= POLICY["ransacThresholdPx"]
        and all(frozen._finite(v) and 0 <= v <= POLICY["maxFlowFbPx"] for v in cycles)
        and frozen._same(record.get("maxSupportedFitResidualPx"), float(max(residuals)))
        and frozen._same(record.get("maxSupportedCyclePx"), max(cycles)), "Retained points do not support stated final fit or cycle residuals")
    spreads = [{"span": (np.ptp(points, axis=0)/frozen.base._size(box)).tolist(),
        "hull": float(cv2.contourArea(cv2.convexHull(points.astype(np.float32)))/np.prod(frozen.base._size(box)))}
        for points, box in ((a[indices], source), (b[indices], destination))]
    warped = frozen.base._warp_rect(source, homography)
    frozen._require(warped is not None and frozen._same(record.get("spread"), spreads), "Retained coordinates do not reproduce spatial support")
    box_growth = float(np.mean(np.log(frozen.base._size(destination)/frozen.base._size(warped))))
    center = matrix[:, :2]@frozen.base._center(warped)+matrix[:, 2]
    error = float(np.linalg.norm(center-frozen.base._center(destination)))
    frozen._require(frozen._same(record.get("boxLogGrowth"), box_growth)
        and frozen._same(record.get("centerErrorPx"), error), "Retained fit does not reproduce detector agreement")


def validate_comparison(pair, populations=None):
    frozen._require(pair.get("mode") in POLICY["modes"] and pair.get("method") == method_for_mode(pair["mode"]), "Wrong textured mode")
    unknown = pair.get("unverifiable")
    frozen._require(type(unknown) is bool, "Missing unknown-rival measurement status")
    actual_unknown = False
    for direction in ("forward", "reverse"):
        proof = pair[direction]; population = resolve_population(pair, direction, populations); selection = population.get("selection")
        texture.validate_selection(selection)
        count = len(selection["points"])
        frozen._require(proof.get("seedPoints") == count and population.get("seedPoints") == count
            and population.get("mode") == pair["mode"] and population.get("selectionSha256") == selection_sha(selection), "Changed original selected-seed denominator")
        verified, assigned, failed, points = (proof.get(k) for k in ("verifiedPoints", "assignedPoints", "unknownPoints", "points"))
        frozen._require(all(type(n) is int and 0 <= n <= count for n in (verified, assigned, failed, points))
            and assigned <= verified and points <= assigned and verified+failed == count
            and frozen._same(proof.get("assignedFraction"), assigned/count if count else 0.)
            and frozen._same(proof.get("supportFraction"), points/count if count else 0.), "Failed selected seeds were omitted")
        if population.get("status") == "not-measured":
            actual_unknown = True
            frozen._require(population.get("status") == "not-measured" and verified == assigned == points == 0,
                "Unverifiable rival fabricated measured support")
        else:
            frozen._require(count >= POLICY["minPoints"] and population.get("status") == "measured", "Too few original source points")
            texture.validate_population(population)
            frozen._require(population["verifiedPoints"] == verified, "Direction support differs from its fixed point records")
            retained_geometry(pair, direction, population)
    frozen._require(unknown == actual_unknown, "Unknown-rival flag differs from actual source measurement eligibility")
    expected = (0., 1.) if unknown else (min(pair[d]["assignedPoints"]/pair[d]["seedPoints"] for d in ("forward", "reverse")),
        min((pair[d]["assignedPoints"]+pair[d]["unknownPoints"])/pair[d]["seedPoints"] for d in ("forward", "reverse")))
    frozen._require(frozen._same(pair.get("scoreLower"), expected[0]) and frozen._same(pair.get("scoreUpper"), expected[1]), "Wrong unknown-rival or measured support bounds")


def validate_pair_proof(pair, populations=None):
    validate_comparison(pair, populations)
    frozen._require(pair.get("supported") is True and pair.get("unverifiable") is False, "Missing measured textured pair")
    estimates = []
    for direction, sign in (("forward", 1.), ("reverse", -1.)):
        proof = pair[direction]; matrix = proof.get("affine"); count = proof["seedPoints"]
        frozen._require(proof.get("supported") is True and frozen._affine_shape(matrix)
            and proof["points"] >= max(POLICY["minPoints"], POLICY["minSupport"]*count), "Insufficient original-selected-point affine support")
        growth = .5*math.log(float(np.linalg.det(np.asarray(matrix)[:, :2])))
        frozen._require(frozen._same(proof.get("linearLogGrowth"), growth) and frozen._same(proof.get("logAreaGrowth"), 2*growth)
            and frozen._finite(proof.get("maxSupportedCyclePx")) and 0 <= proof["maxSupportedCyclePx"] <= POLICY["maxFlowFbPx"]
            and frozen._finite(proof.get("maxSupportedFitResidualPx")) and 0 <= proof["maxSupportedFitResidualPx"] <= POLICY["ransacThresholdPx"], "Invalid textured affine growth/cycle/residual")
        spread = proof.get("spread")
        frozen._require(isinstance(spread, list) and len(spread) == 2 and all(isinstance(s, dict)
            and isinstance(s.get("span"), list) and len(s["span"]) == 2 and all(frozen._finite(v) and v >= POLICY["minSpan"] for v in s["span"])
            and frozen._finite(s.get("hull")) and s["hull"] >= POLICY["minHull"] for s in spread), "Localized textured support")
        destination = pair["endBox" if direction == "forward" else "startBox"]
        frozen._require(frozen._finite(proof.get("boxLogGrowth")) and abs(proof["boxLogGrowth"]-growth) <= POLICY["maxBoxLogDisagreement"]
            and frozen._finite(proof.get("centerErrorPx")) and 0 <= proof["centerErrorPx"] <= max(2., POLICY["maxCenterFraction"]*min(frozen.base._size(destination))), "Textured affine disagrees with current box")
        estimates.append(sign*growth)
    low, high = min(estimates), max(estimates)
    frozen._require(pair.get("growthBound") == POLICY["growthBound"] and frozen._same(pair.get("linearLogGrowthLowerBound"), low)
        and frozen._same(pair.get("linearLogGrowthUpperBound"), high) and frozen._same(pair.get("growthSpan"), high-low)
        and high-low <= POLICY["maxEstimatorLogGrowthSpan"], "Textured growth envelope omits the reverse estimator")
