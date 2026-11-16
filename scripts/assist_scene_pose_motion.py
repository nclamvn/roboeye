"""Bounded Mac replay geometry: calibrated static-correspondence exclusion.

Frame mappings use integer microseconds for RGB/pose in one clock, one shared
world origin, row-major camera-to-world SE(3) with translation in metres, and
the rectified optical basis (+x right, +y down, +z forward). Intrinsics are in
the pixel coordinates scored here, including any actual resize/crop. The
adapter owns provenance, convention conversion, rectification, clock pairing
and clip boundaries; this module cannot authenticate an arbitrary JSON pose.

An epipolar match is not positive evidence of a stationary object (especially
for motion along the line). A violation only excludes a static match under
the pair's calibration/timing assumptions. Require independent static-image
controls plus reliable object-local correspondences before a motion verdict.
"""

from collections.abc import Mapping
from dataclasses import dataclass
import math

import numpy as np


POLICY = {
    "minIntervalUs": 65_000,
    "maxIntervalUs": 300_000,
    "maxSkewUs": 20_000,
    "maxRotationDeg": 25.,
    "zeroTranslationToleranceM": 1e-6,
    "minEpipolarBaselineM": .025,
    "maxTranslationSpeedMps": 45.,
    "minEpipolarSinAngle": .025,
    "maxPointPairs": 256,
    "minFloorPixels": 2.0,
    "floorPixelsAt768": 3.0,
    "maxApproxPixelsAt768": 1.35,
}


@dataclass(frozen=True, slots=True)
class PosePair:
    mode: str
    width: int
    height: int
    floor_px: float
    homography: np.ndarray
    fundamental: np.ndarray | None
    inv_k_prev: np.ndarray
    inv_k_current: np.ndarray
    baseline_prev: np.ndarray
    baseline_current: np.ndarray


def _matrix(raw, shape):
    try:
        candidate = np.asarray(raw)
        if candidate.shape != shape or candidate.dtype.kind not in "iuf":
            return None
        result = candidate.astype(np.float64)
        return result if np.isfinite(result).all() else None
    except (TypeError, ValueError, OverflowError):
        return None


def _intrinsics(raw, w, h):
    if isinstance(raw, Mapping):
        names = ("fx", "fy", "cx", "cy")
        if any(type(raw.get(key)) not in (int, float) for key in names):
            return None
        raw = ((raw["fx"], 0, raw["cx"]), (0, raw["fy"], raw["cy"]), (0, 0, 1))
    k = _matrix(raw, (3, 3))
    if k is None:
        return None
    fx, fy, cx, cy = k[0, 0], k[1, 1], k[0, 2], k[1, 2]
    side = max(w, h)
    if (not (.15*side <= min(fx, fy) <= max(fx, fy) <= 5*side)
            or not .45 <= fx/fy <= 2.25
            or not (0 <= cx < w and 0 <= cy < h)
            or max(abs(k[0, 1]), abs(k[1, 0])) > 1e-6
            or not np.allclose(k[2], [0, 0, 1], atol=1e-8, rtol=0)):
        return None
    return k


def _transform(raw):
    pose = _matrix(raw, (4, 4))
    if pose is None:
        return None
    r, c = pose[:3, :3], pose[:3, 3]
    if (np.max(np.abs(r)) > 1.00001
            or not np.allclose(pose[3], [0, 0, 0, 1], atol=1e-7, rtol=0)
            or not np.allclose(r.T @ r, np.eye(3), atol=1e-5, rtol=0)
            or abs(np.linalg.det(r)-1) > 1e-5
            or np.max(np.abs(c)) > 1e7):
        return None
    return r, c


def _timestamp(value):
    return type(value) is int and 0 <= value < 2**63


def _cross_matrix(x):
    a, b, c = x
    return np.array([[0., -c, b], [c, 0., -a], [-b, a, 0.]])


def pose_pair(previous, current, width, height):
    """Return a verified geometry model, not a claim about any target point."""
    info = {"mode": None, "floorPx": None}

    def reject(reason):
        return None, {"status": reason, **info}

    if (type(width) is not int or type(height) is not int
            or not 32 <= min(width, height) <= max(width, height) <= 4096):
        return reject("invalid-image-size")
    if not isinstance(previous, Mapping) or not isinstance(current, Mapping):
        return reject("missing-frame-pose")
    if "epoch" in previous or "epoch" in current:
        first, last = previous.get("epoch"), current.get("epoch")
        if type(first) is not int or type(last) is not int or first < 0 or last != first:
            return reject("pose-epoch-mismatch")
    t0, t1 = previous.get("timestampUs"), current.get("timestampUs")
    q0, q1 = previous.get("poseTimestampUs"), current.get("poseTimestampUs")
    if q0 is None or q1 is None or previous.get("cameraToWorld") is None or current.get("cameraToWorld") is None:
        return reject("missing-frame-pose")
    if not all(_timestamp(value) for value in (t0, t1, q0, q1)):
        return reject("invalid-pose-clock")
    dt = t1-t0
    info["intervalUs"] = dt
    if not POLICY["minIntervalUs"] <= dt <= POLICY["maxIntervalUs"] or q1 <= q0:
        return reject("pose-interval")
    skew = max(abs(t0-q0), abs(t1-q1))
    info["maxSkewUs"] = skew
    if skew > POLICY["maxSkewUs"] or q0 >= t1 or q1 <= t0:
        return reject("pose-skew")
    k0, k1 = (_intrinsics(f.get("intrinsics"), width, height) for f in (previous, current))
    if k0 is None or k1 is None:
        return reject("invalid-intrinsics")
    if not np.allclose(k0, k1, atol=1e-4, rtol=1e-6):
        return reject("calibration-changed")
    p0, p1 = (_transform(f.get("cameraToWorld")) for f in (previous, current))
    if p0 is None or p1 is None:
        return reject("invalid-camera-transform")
    r0, c0 = p0
    r1, c1 = p1
    r = r1.T @ r0
    t = r1.T @ (c0-c1)
    angle = math.degrees(math.acos(np.clip((np.trace(r)-1)/2, -1., 1.)))
    baseline = float(np.linalg.norm(t))
    info.update(rotationDeg=angle, translationM=baseline)
    if angle > POLICY["maxRotationDeg"]:
        return reject("pose-rotation-too-large")
    if baseline > POLICY["maxTranslationSpeedMps"]*((q1-q0)/1e6):
        return reject("pose-translation-too-large")
    ik0, ik1 = np.linalg.inv(k0), np.linalg.inv(k1)
    h = k1 @ r @ ik0
    if baseline <= POLICY["zeroTranslationToleranceM"]:
        mode, f = "rotation", None
        direction = np.zeros(3)
    elif baseline < POLICY["minEpipolarBaselineM"]:
        return reject("epipolar-baseline-too-small")
    else:
        mode = "epipolar"
        direction = t / baseline
        f = ik1.T @ _cross_matrix(direction) @ r @ ik0
    # This is a sensitivity floor, not a calibrated confidence interval.
    # Observed relative rotation with clock skew increases the reprojection
    # tolerance; unknown pose/rolling shutter/translation timing error still
    # requires independent observed static-image controls in the caller.
    base_floor = max(POLICY["minFloorPixels"], POLICY["floorPixelsAt768"] * max(width, height)/768)
    sync_floor = .0 if skew == 0 else float(max(k0[0, 0], k0[1, 1]) * math.radians(angle) * 2*skew/dt)
    floor = base_floor + sync_floor
    info.update(mode=mode, floorPx=floor)
    return (PosePair(mode, width, height, floor, h, f, ik0, ik1, r.T @ direction, direction),
            {"status": "valid", **info})


def _image_points(raw):
    try:
        values = np.asarray(raw)
        if (values.ndim != 2 or values.shape[1] != 2 or values.shape[0] > POLICY["maxPointPairs"]
                or values.dtype.kind not in "iuf"):
            return None
        return values.astype(np.float64)
    except (TypeError, ValueError, OverflowError):
        return None


def _in_bounds(points, width, height):
    return (np.isfinite(points).all(axis=1) & (points[:, 0] >= 0) & (points[:, 0] <= width-1)
            & (points[:, 1] >= 0) & (points[:, 1] <= height-1))


def _homogeneous(points):
    return np.column_stack((points, np.ones(len(points))))


def point_residuals(pair, p0, p1):
    """Return (residual_px[], usable[]) for matched optical points.

    Invalid shape/type is an empty result; individual invalid or epipole-near
    points are NaN + False. Epipolar residual is the lesser of the two pixel
    point-to-line distances: both views must support a high-error vote.
    """
    a, b = _image_points(p0), _image_points(p1)
    if a is None or b is None or a.shape != b.shape:
        return np.empty(0, dtype=float), np.empty(0, dtype=bool)
    result, usable = np.full(len(a), np.nan), np.zeros(len(a), dtype=bool)
    if not isinstance(pair, PosePair):
        return result, usable
    valid = _in_bounds(a, pair.width, pair.height) & _in_bounds(b, pair.width, pair.height)
    selected = np.flatnonzero(valid)
    x, y = _homogeneous(a[valid]), _homogeneous(b[valid])
    if pair.mode == "rotation":
        warped = x @ pair.homography.T
        forward = warped[:, 2] > 1e-6
        selected, y, warped = selected[forward], y[forward], warped[forward]
        projected = warped[:, :2] / warped[:, 2:3]
        inside = _in_bounds(projected, pair.width, pair.height)
        selected = selected[inside]
        result[selected] = np.linalg.norm(projected[inside] - y[inside, :2], axis=1)
    else:
        f = pair.fundamental
        l1, l0 = x @ f.T, y @ f
        denom1, denom0 = np.linalg.norm(l1[:, :2], axis=1), np.linalg.norm(l0[:, :2], axis=1)
        r0, r1 = x @ pair.inv_k_prev.T, y @ pair.inv_k_current.T
        # Dividing by the ray lengths gives sin(angle(ray, baseline)), robust
        # even when the pixel epipole is at infinity in a lateral translation.
        sin0 = np.linalg.norm(np.cross(r0, pair.baseline_prev), axis=1)/np.linalg.norm(r0, axis=1)
        sin1 = np.linalg.norm(np.cross(r1, pair.baseline_current), axis=1)/np.linalg.norm(r1, axis=1)
        safe = ((denom0 > 1e-9) & (denom1 > 1e-9) & (sin0 >= POLICY["minEpipolarSinAngle"])
                & (sin1 >= POLICY["minEpipolarSinAngle"]))
        selected = selected[safe]
        residual = np.abs(np.sum(y[safe]*l1[safe], axis=1))
        result[selected] = residual / np.maximum(denom0[safe], denom1[safe])
    usable[selected] = np.isfinite(result[selected])
    return result, usable


def pose_warp(previous, current, width, height):
    """Return a global similarity for a genuinely rotation-only pair, or None.

    The tracker expects a 2×3 similarity, not an unrestricted homography. A
    9×9 grid plus an analytic per-cell interpolation bound protects the full
    image against replacing strong projective yaw/pitch by a false affine.
    """
    pair, info = pose_pair(previous, current, width, height)
    if pair is None:
        return None, info
    if pair.mode != "rotation":
        return None, {**info, "status": "translation-needs-epipolar"}
    x, y = np.meshgrid(np.linspace(0., width-1, 9), np.linspace(0., height-1, 9))
    source = np.column_stack((x.ravel(), y.ravel()))
    projected = _homogeneous(source) @ pair.homography.T
    min_d = float(np.min(projected[:, 2]))
    if min_d <= 1e-6:
        return None, {**info, "status": "rotation-outside-projection"}
    target = projected[:, :2] / projected[:, 2:3]
    sx, sy = source.mean(axis=0), target.mean(axis=0)
    a, b = source - sx, target - sy
    den = float(np.sum(a*a))
    k = float(np.sum(a*b))/den
    j = float(np.sum(a[:, 0]*b[:, 1]-a[:, 1]*b[:, 0]))/den
    linear = np.array([[k, -j], [j, k]])
    translation = sy - linear @ sx
    sampled = float(np.max(np.linalg.norm(target - (source @ linear.T + translation), axis=1)))
    # e(x)=((H*x)_xy−d(x)S(x))/d(x). The numerator is quadratic. Bilinear
    # interpolation reproduces constants, x, y and xy exactly; the x²,y²
    # remainder within each grid cell is bounded by h²/4 times its coefficient.
    # Weighted corner errors carry d_i/d(x), whose weights sum to one.
    spacing = np.array([(width-1)/8, (height-1)/8])
    curvature = float(np.sum(np.abs(pair.homography[2, :2]) * np.linalg.norm(linear, axis=0)
                             * spacing**2/4)/min_d)
    bound = sampled + curvature
    limit = max(.9, POLICY["maxApproxPixelsAt768"]*max(width, height)/768)
    info.update(sampledErrorPx=sampled, maxErrorBoundPx=bound, maxApproxPx=limit)
    if bound > limit or not .84 <= math.hypot(k, j) <= 1.19:
        return None, {**info, "status": "projective-warp-not-global-similarity"}
    return np.column_stack((linear, translation)), info
