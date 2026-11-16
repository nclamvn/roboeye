"""M3N source-only texture seeds and fixed raw/flow-warped pixel verification.

This module measures pixel agreement, not confidence intervals, identities,
range or object motion. There is no model, search, target-box normalization,
target-conditioned seed selection, or fallback between the two ablations.
"""

from collections import Counter
from hashlib import sha256
import json
import math
from types import MappingProxyType

import cv2
import numpy as np


POLICY = MappingProxyType({
    "selector": "source-cell-max-min-eigenvalue-v1", "gridSide": 8,
    "maxSeeds": 64, "seedInset": .12, "patchSide": 7,
    "minSourceVariance": 16., "cornerQuality": .01,
    "cornerBlockSize": 3, "cornerGradientSize": 3,
    "minCorrelation": .70, "minNormProduct": 49*4.**2,
    "maxCyclePx": 1.3, "minPatchCycleFraction": .70,
    "maxLinearLogGrowth": .40, "maxAnisotropyLog": .20,
    "maxRotationDeg": 15., "maxAffineResidualPx": 1.2,
    "maxWorkingSide": 768,
})
_OFFSETS = np.array([(x, y) for y in range(-3, 4) for x in range(-3, 4)], np.float32)


def _image(image):
    if (not isinstance(image, np.ndarray) or image.dtype != np.uint8
            or image.ndim != 2 or min(image.shape) < 7 or max(image.shape) > POLICY["maxWorkingSide"]):
        raise ValueError("Expected uint8 grayscale working image, sides 7..768")
    return image


def _digest(image):
    return sha256(image.tobytes(order="C")).hexdigest()


def texture_maps(image):
    """Image-only maps, reusable for every source box in the same exposure."""
    image = _image(image)
    values = image.astype(np.float64)
    mean = cv2.boxFilter(values, -1, (7, 7), normalize=True, borderType=cv2.BORDER_REFLECT_101)
    variance = np.maximum(0., cv2.boxFilter(values*values, -1, (7, 7), normalize=True,
                                         borderType=cv2.BORDER_REFLECT_101)-mean*mean)
    corner = cv2.cornerMinEigenVal(image.astype(np.float32)/255., blockSize=3, ksize=3, borderType=cv2.BORDER_REFLECT_101)
    for array in (corner, variance): array.setflags(write=False)
    return {"sourceSha256": _digest(image), "sourceShape": list(image.shape),
            "corner": corner, "variance": variance}


def select_seeds(image, box, maps=None):
    """At most one row-major-tie-broken source corner per fixed interior cell.

    ROI maximum includes every complete-patch candidate in the inset rectangle.
    A cell's maximum is chosen among source-variance/quality-qualified pixels.
    Pixel centers are integers. The complete 7x7 must also lie inside the box.
    """
    image = _image(image)
    rect = np.asarray(getattr(box, "xyxy", box), dtype=float)
    if rect.shape != (4,) or not np.isfinite(rect).all() or np.any(rect[2:] <= rect[:2]):
        raise ValueError("Expected finite, nonempty working-pixel xyxy source box")
    maps = texture_maps(image) if maps is None else maps
    digest = _digest(image)
    if (not isinstance(maps, dict) or maps.get("sourceSha256") != digest
            or maps.get("sourceShape") != list(image.shape)):
        raise ValueError("Texture maps do not belong to this exact source image")
    for key in ("corner", "variance"):
        array = maps.get(key)
        if (not isinstance(array, np.ndarray) or array.shape != image.shape
                or not np.issubdtype(array.dtype, np.floating) or not np.isfinite(array).all()):
            raise ValueError("Invalid source texture map")
    lo = rect[:2]+POLICY["seedInset"]*(rect[2:]-rect[:2])
    hi = rect[2:]-POLICY["seedInset"]*(rect[2:]-rect[:2])
    lower = np.maximum(np.ceil(np.maximum(lo, rect[:2]+3)), 3)
    upper = np.minimum(np.floor(np.minimum(hi, rect[2:]-3)), np.array(image.shape[::-1])-4)
    points, cells, scores, variances = [], [], [], []
    roi_max = 0.; eligible = 0
    if np.all(upper >= lower):
        lower, upper = lower.astype(int), upper.astype(int)
        yy, xx = np.mgrid[lower[1]:upper[1]+1, lower[0]:upper[0]+1]
        values = maps["corner"][yy, xx]
        roi_max = float(values.max())
        usable = ((maps["variance"][yy, xx] >= POLICY["minSourceVariance"])
                  & (values >= POLICY["cornerQuality"]*roi_max) & (values > 0))
        eligible = int(usable.sum())
        col = np.minimum(7, np.floor((xx-lo[0])/(hi[0]-lo[0])*8).astype(int))
        row = np.minimum(7, np.floor((yy-lo[1])/(hi[1]-lo[1])*8).astype(int))
        for ry in range(8):
            for cx in range(8):
                indices = np.flatnonzero(usable & (row == ry) & (col == cx))
                if not len(indices): continue
                # np.argmax's first equal maximum is the deterministic y,x tie.
                chosen = indices[int(np.argmax(values.ravel()[indices]))]
                x, y = int(xx.ravel()[chosen]), int(yy.ravel()[chosen])
                points.append([x, y]); cells.append([ry, cx])
                scores.append(float(maps["corner"][y, x])); variances.append(float(maps["variance"][y, x]))
    return {"sourceOnly": True, "sourceSha256": digest, "sourceShape": list(image.shape), "seedPoints": len(points),
            "sourceBox": rect.tolist(), "points": points, "cells": cells,
            "cornerScores": scores, "sourceVariances": variances,
            "roiMaxCorner": roi_max, "eligiblePixelCount": eligible,
            "selectorPolicy": dict(POLICY)}


def validate_selection(selection):
    """Validate the source inventory certificate, without inventing pixel truth."""
    try:
        if selection["sourceOnly"] is not True or selection["selectorPolicy"] != dict(POLICY): raise ValueError()
        digest = selection["sourceSha256"]
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest): raise ValueError()
        h, w = selection["sourceShape"]
        if any(type(x) is not int or not 7 <= x <= 768 for x in (h, w)): raise ValueError()
        rect = np.asarray(selection["sourceBox"], float)
        if rect.shape != (4,) or not np.isfinite(rect).all() or np.any(rect[2:] <= rect[:2]): raise ValueError()
        points, cells = selection["points"], selection["cells"]
        scores, variances = selection["cornerScores"], selection["sourceVariances"]
        if not 0 <= len(points) <= 64 or not len(points) == len(cells) == len(scores) == len(variances) == selection["seedPoints"]: raise ValueError()
        if cells != sorted(cells) or len({tuple(c) for c in cells}) != len(cells): raise ValueError()
        maximum = selection["roiMaxCorner"]
        if not math.isfinite(maximum) or maximum < 0: raise ValueError()
        if type(selection["eligiblePixelCount"]) is not int or selection["eligiblePixelCount"] < len(points): raise ValueError()
        lo, hi = rect[:2]+.12*(rect[2:]-rect[:2]), rect[2:]-.12*(rect[2:]-rect[:2])
        for point, cell, score, variance in zip(points, cells, scores, variances, strict=True):
            p = np.asarray(point, float)
            if (p.shape != (2,) or not np.isfinite(p).all() or not np.all(p == np.rint(p))
                    or not np.all(p >= np.maximum(lo, rect[:2]+3)) or not np.all(p <= np.minimum(hi, rect[2:]-3))
                    or not np.all(p >= 3) or not np.all(p <= [w-4, h-4])): raise ValueError()
            expected = np.minimum(7, np.floor((p-lo)/(hi-lo)*8).astype(int))[::-1].tolist()
            if cell != expected or any(type(c) is not int or not 0 <= c < 8 for c in cell): raise ValueError()
            if not math.isfinite(score) or not 0 < score <= maximum or score < .01*maximum: raise ValueError()
            if not math.isfinite(variance) or variance < 16: raise ValueError()
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        raise ValueError("Invalid source-only texture selection certificate") from error
    return True


def _sample(field, points):
    # Same OpenCV interpolation and conservative field-coordinate domain as M3M.
    points = np.asarray(points, np.float32).reshape(-1, 2)
    coordinates = np.where(np.isfinite(points), points, -100).astype(np.float32)
    values = cv2.remap(field, coordinates[:, 0].reshape(-1, 1), coordinates[:, 1].reshape(-1, 1),
                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0).reshape(-1, 2)
    bounds = (np.isfinite(points).all(axis=1) & (points[:, 0] >= 1) & (points[:, 1] >= 1)
              & (points[:, 0] < field.shape[1]-2) & (points[:, 1] < field.shape[0]-2))
    return values, bounds & np.isfinite(values).all(axis=1), bounds


def _ncc(first, second):
    first = np.asarray(first, np.float32).reshape(-1).copy()
    second = np.asarray(second, np.float32).reshape(-1).copy()
    first -= first.mean(); second -= second.mean()
    norm = float(np.linalg.norm(first)*np.linalg.norm(second))
    corr = float(np.sum(first*second)/norm) if norm > 0 and math.isfinite(norm) else None
    return norm, corr, bool(norm >= POLICY["minNormProduct"] and corr is not None
                            and corr >= POLICY["minCorrelation"])


def _local_affine(a, b, mapped):
    coefficients = np.linalg.lstsq(np.column_stack((_OFFSETS, np.ones(49))), mapped-b, rcond=None)[0]
    linear = coefficients[:2].T
    matrix = np.column_stack((linear, b+coefficients[2]-linear@a))
    residual = float(np.max(np.linalg.norm(_OFFSETS@linear.T+b+coefficients[2]-mapped, axis=1)))
    determinant = float(np.linalg.det(linear))
    result = {"localAffine": matrix.tolist(), "maxAffineResidualPx": residual,
              "localLinearLogGrowth": None, "localAnisotropyLog": None, "localRotationDeg": None}
    if determinant <= 0 or not np.isfinite(matrix).all(): return result, False
    singular = np.linalg.svd(linear, compute_uv=False)
    growth = .5*math.log(determinant)
    anisotropy = math.log(singular[0]/singular[-1])
    rotation = math.degrees(math.atan2(linear[1, 0], linear[0, 0]))
    result.update(localLinearLogGrowth=growth, localAnisotropyLog=anisotropy, localRotationDeg=rotation)
    valid = (abs(growth) <= POLICY["maxLinearLogGrowth"] and anisotropy <= POLICY["maxAnisotropyLog"]
             and abs(rotation) <= POLICY["maxRotationDeg"] and residual <= POLICY["maxAffineResidualPx"])
    return result, valid


def population(old, new, box, forward, backward, mode="raw", *, maps=None, selection=None):
    """Return all source-selected seeds, endpoint/cycle arrays, mask and proof.

    Warped mode evaluates all49 forward-warped source offsets, at least70%
    reversible offsets, and a bounded positive local affine. No fit adjusts
    intensity, endpoint positions or the NCC samples. Raw mode exactly retains
    frozen getRectSubPix uint8 NCC arithmetic and its conservative patch bounds.
    """
    old, new = _image(old), _image(new)
    if old.shape != new.shape: raise ValueError("Source and destination shapes must match")
    if mode not in ("raw", "warped"): raise ValueError("Mode must be raw or warped")
    for field in (forward, backward):
        if (not isinstance(field, np.ndarray) or field.shape != (*old.shape, 2)
                or field.dtype != np.float32):
            raise ValueError("Expected original-working-coordinate float32 H,W,2 fields")
    selection = select_seeds(old, box, maps) if selection is None else selection
    validate_selection(selection)
    if (selection["sourceSha256"] != _digest(old) or selection["sourceShape"] != list(old.shape)
            or selection["sourceBox"] != list(map(float, getattr(box, "xyxy", box)))):
        raise ValueError("Selection does not belong to this exact source image and box")
    a = np.asarray(selection["points"], np.float32).reshape(-1, 2)
    records = []; good = np.zeros(len(a), bool)
    b = np.full_like(a, np.nan); cycles = np.full(len(a), np.inf)
    if len(a):
        displacement, first, _ = _sample(forward, a); b = a+displacement
        rewind, second, _ = _sample(backward, b)
        cycles = np.linalg.norm(a-(b+rewind), axis=1).astype(float)
        cycles[~np.isfinite(cycles)] = np.inf
        destination_float = new.astype(np.float32) if mode == "warped" else None
        for i, (start, end) in enumerate(zip(a, b, strict=True)):
            record = {"pointIndex": i, "good": False, "reason": "invalid-center-flow",
                      "sourcePoint": start.tolist(),
                      "destinationPoint": end.tolist() if np.isfinite(end).all() else None,
                      "centerCyclePx": float(cycles[i]) if np.isfinite(cycles[i]) else None,
                      "correlation": None, "normProduct": None, "patchValidSamples": 0,
                      "patchCycleCount": None, "patchCycleFraction": None}
            records.append(record)
            if not first[i] or not second[i]: continue
            if cycles[i] > POLICY["maxCyclePx"]: record["reason"] = "center-cycle"; continue
            source = cv2.getRectSubPix(old, (7, 7), tuple(map(float, start)))
            if mode == "raw":
                h, w = old.shape
                if not (np.all(start >= 3) and np.all(start <= [w-4, h-4])
                        and np.all(end >= 3) and np.all(end <= [w-4, h-4])):
                    record["reason"] = "patch-out-of-bounds"; continue
                destination = cv2.getRectSubPix(new, (7, 7), tuple(map(float, end)))
                record["patchValidSamples"] = 49
            else:
                offsets = start+_OFFSETS
                delta, valid, _ = _sample(forward, offsets); mapped = offsets+delta
                reverse, rev_valid, rev_bounds = _sample(backward, mapped)
                h, w = old.shape
                pixel_bounds = ((mapped >= 0).all(axis=1) & (mapped <= [w-1, h-1]).all(axis=1))
                usable = valid & rev_bounds & pixel_bounds
                record["patchValidSamples"] = int(usable.sum())
                if not usable.all(): record["reason"] = "patch-out-of-bounds-or-invalid-flow"; continue
                patch_cycles = np.linalg.norm(offsets-(mapped+reverse), axis=1)
                count = int(np.count_nonzero(rev_valid & np.isfinite(patch_cycles)
                                             & (patch_cycles <= POLICY["maxCyclePx"])))
                record.update(patchCycleCount=count, patchCycleFraction=count/49)
                if count < POLICY["minPatchCycleFraction"]*49:
                    record["reason"] = "patch-cycle"; continue
                shape, shape_ok = _local_affine(start, end, mapped)
                record.update(shape)
                if not shape_ok: record["reason"] = "invalid-local-affine"; continue
                # All49 samples, including cycle failures, enter NCC. No subset fit.
                destination = cv2.remap(destination_float, mapped[:, 0].reshape(7, 7),
                    mapped[:, 1].reshape(7, 7), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            norm, corr, matched = _ncc(source, destination)
            record.update(normProduct=norm, correlation=corr)
            record["reason"] = "verified-patch" if matched else "patch-ncc"
            record["good"] = bool(matched); good[i] = matched
    manifest = sha256(json.dumps(selection, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    proof = {"mode": mode, "status": "measured", "seedPoints": len(a), "verifiedPoints": int(good.sum()),
             "oldWorkingSha256": _digest(old), "newWorkingSha256": _digest(new),
             "selection": selection, "selectionSha256": manifest, "points": records,
             "reasonCounts": dict(Counter(p["reason"] for p in records)),
             "evidence": "measured-working-pixels-not-confidence-interval"}
    return a, b, cycles, good, proof


def validate_population(proof):
    """Numeric proof checks; source/field/exposure joins belong to the caller."""
    try:
        selection = proof["selection"]; validate_selection(selection)
        if proof["oldWorkingSha256"] != selection["sourceSha256"]: raise ValueError()
        for key in ("oldWorkingSha256", "newWorkingSha256"):
            digest = proof[key]
            if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest): raise ValueError()
        manifest = sha256(json.dumps(selection, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        if proof["selectionSha256"] != manifest or proof["status"] != "measured" or proof["mode"] not in ("raw", "warped"): raise ValueError()
        if proof["seedPoints"] != selection["seedPoints"] or len(proof["points"]) != proof["seedPoints"]: raise ValueError()
        if proof["verifiedPoints"] != sum(p["good"] is True for p in proof["points"]): raise ValueError()
        if proof["reasonCounts"] != dict(Counter(p["reason"] for p in proof["points"])): raise ValueError()
        for i, p in enumerate(proof["points"]):
            if p["pointIndex"] != i or type(p["good"]) is not bool: raise ValueError()
            if p["sourcePoint"] != selection["points"][i]: raise ValueError()
            if p["good"]:
                endpoint = np.asarray(p["destinationPoint"], float)
                if endpoint.shape != (2,) or not np.isfinite(endpoint).all(): raise ValueError()
                if (p["reason"] != "verified-patch" or p["patchValidSamples"] != 49
                        or not 0 <= p["centerCyclePx"] <= POLICY["maxCyclePx"]
                        or not POLICY["minCorrelation"] <= p["correlation"] <= 1.000001
                        or not math.isfinite(p["normProduct"]) or p["normProduct"] < POLICY["minNormProduct"]): raise ValueError()
                if proof["mode"] == "warped":
                    matrix = np.asarray(p["localAffine"], float)
                    if matrix.shape != (2, 3) or not np.isfinite(matrix).all(): raise ValueError()
                    determinant = float(np.linalg.det(matrix[:, :2]))
                    if determinant <= 0: raise ValueError()
                    singular = np.linalg.svd(matrix[:, :2], compute_uv=False)
                    growth = .5*math.log(determinant); anisotropy = math.log(singular[0]/singular[-1])
                    rotation = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
                    if (abs(growth) > .40 or anisotropy > .20 or abs(rotation) > 15
                            or abs(growth-p["localLinearLogGrowth"]) > 1e-8
                            or abs(anisotropy-p["localAnisotropyLog"]) > 1e-8
                            or abs(rotation-p["localRotationDeg"]) > 1e-8
                            or not 0 <= p["maxAffineResidualPx"] <= 1.2
                            or type(p["patchCycleCount"]) is not int or not .70*49 <= p["patchCycleCount"] <= 49
                            or abs(p["patchCycleFraction"]-p["patchCycleCount"]/49) > 1e-12): raise ValueError()
            elif p["reason"] == "verified-patch": raise ValueError()
        # Diagnostic receipts must be valid finite JSON, even for failed samples.
        json.dumps(proof, allow_nan=False)
    except (KeyError, TypeError, ValueError, OverflowError, np.linalg.LinAlgError) as error:
        raise ValueError("Invalid measured texture population certificate") from error
    return True
