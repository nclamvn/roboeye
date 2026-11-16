"""Offline M3B: causal camera registration. Estimates image warp, not camera pose."""

import math
from time import perf_counter

import cv2
import numpy as np

from assist_scene_motion import Detection, POLICY as SPARSE_POLICY, apply, occupy, registered, warp_box


POLICY = {
    "minRawIntervalMs": 12, "maxRawIntervalMs": 50, "maxSampleIntervalMs": 300,
    "maxStepTranslationDiagonal": .09, "maxStepRotationDeg": 5,
    "minStepScale": .95, "maxStepScale": 1.05,
    "minMaskSafetyDiagonal": .008, "maskSweepDiagonalPerSecond": .18,
    "minDissentingCellPoints": 9, "dissentingCellFraction": .66,
    "minDissentPixelsAt768": 2.6, "maxModelDisagreementDiagonal": .008,
}


def transform_matrix(step):
    out = np.eye(3)
    out[:2] = step
    return out


def _mask(img, boxes, pad):
    h, w = img.shape
    result = np.full(img.shape, 255, np.uint8)
    for box in boxes:
        left, top, right, bottom = box.xyxy
        dx = max(pad, (right - left) * .12)
        dy = max(pad, (bottom - top) * .12)
        x0, y0 = max(0, math.floor(left - dx)), max(0, math.floor(top - dy))
        x1, y1 = min(w, math.ceil(right + dx)), min(h, math.ceil(bottom + dy))
        if x1 > x0 and y1 > y0:
            result[y0:y1, x0:x1] = 0
    return result


def _geometry(matrix, w, h, fast):
    p = POLICY if fast else SPARSE_POLICY
    scale = math.hypot(matrix[0, 0], matrix[1, 0])
    rotation = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
    center = np.array([[w * .5, h * .5]])
    tr = float(np.linalg.norm(apply(matrix, center) - center))
    ok = (p["minStepScale" if fast else "minScale"] <= scale <= p["maxStepScale" if fast else "maxScale"]
          and abs(rotation) <= p["maxStepRotationDeg" if fast else "maxRotationDeg"]
          and tr <= math.hypot(w, h) * p["maxStepTranslationDiagonal" if fast else "maxTranslationDiagonal"])
    return ok, {"scale": scale, "rotationDeg": rotation, "centerTranslationPixels": tr}


def _photometric(a, b, ma, mb, matrix, info):
    h, w = a.shape
    shifted = cv2.warpAffine(a, matrix, (w, h))[::3, ::3]
    allowed = (cv2.warpAffine(ma, matrix, (w, h), flags=cv2.INTER_NEAREST)[::3, ::3] > 0)
    allowed &= mb[::3, ::3] > 0
    info["backgroundOverlap"] = float(np.mean(allowed))
    if info["backgroundOverlap"] < .15:
        return "insufficient-overlap"
    residual = b[::3, ::3][allowed].astype(np.float32) - shifted[allowed]
    residual = np.abs(residual - np.median(residual))
    info["photometricMedianError"] = float(np.median(residual))
    info["photometricBadFraction"] = float(np.mean(residual > 35))
    if info["photometricMedianError"] > 22 or info["photometricBadFraction"] > .33:
        return "cut-or-background-mismatch"
    return None


def _dissent(src, residual, w, h):
    """Flag a regional second translation; don't conflate dominant plane with all depths."""
    gate = max(1.7, POLICY["minDissentPixelsAt768"] * max(w, h) / 768)
    cells = np.minimum((src * (4 / w, 3 / h)).astype(np.int32), (3, 2))
    for col in range(4):
        for row in range(3):
            points = residual[(cells[:, 0] == col) & (cells[:, 1] == row)]
            if len(points) < POLICY["minDissentingCellPoints"]:
                continue
            median = np.median(points, axis=0)
            norm = float(np.linalg.norm(median))
            if norm >= gate and np.mean(points @ (median/norm) >= gate) >= POLICY["dissentingCellFraction"]:
                return [col, row]
    return None


def _pair(prev, current, source_mask, target_mask):
    h, w = prev.shape
    info = {"unmaskedFraction": [float(np.count_nonzero(s) / s.size) for s in (source_mask, target_mask)]}

    def fail(status):
        return None, {"status": status, **info}

    if min(info["unmaskedFraction"]) < .20:
        return fail("insufficient-background")
    start = cv2.goodFeaturesToTrack(prev, maxCorners=420, qualityLevel=.012,
                                    minDistance=max(4, round(max(w, h) * .009)),
                                    mask=source_mask, blockSize=7)
    if start is None or len(start) < SPARSE_POLICY["minInliers"]:
        return fail("low-texture")
    lk = {"winSize": (23, 23), "maxLevel": 3,
          "criteria": (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, .01)}
    end, good, _ = cv2.calcOpticalFlowPyrLK(prev, current, start, None, **lk)
    if end is None or good is None:
        return fail("forward-flow")
    back, rev_good, _ = cv2.calcOpticalFlowPyrLK(current, prev, end, None, **lk)
    if back is None or rev_good is None:
        return fail("backward-flow")
    start, end, back = start[:, 0], end[:, 0], back[:, 0]
    kept = (good[:, 0] == 1) & (rev_good[:, 0] == 1) & np.isfinite(end).all(axis=1)
    kept &= np.linalg.norm(start - back, axis=1) < max(.8, 1.6 * max(w, h) / 768)
    start, end = start[kept], end[kept]
    px = np.rint(end).astype(np.int32)
    inside = (px[:, 0] >= 0) & (px[:, 0] < w) & (px[:, 1] >= 0) & (px[:, 1] < h)
    start, end, px = start[inside], end[inside], px[inside]
    background = target_mask[px[:, 1], px[:, 0]] > 0
    start, end = start[background], end[background]
    info["matchedPoints"] = len(start)
    if len(start) < SPARSE_POLICY["minInliers"]:
        return fail("too-few-consistent-points")
    matrix, fit = cv2.estimateAffinePartial2D(start, end, method=cv2.RANSAC,
                    ransacReprojThreshold=max(1.3, 2.5 * max(w, h) / 768),
                    maxIters=2000, confidence=.995, refineIters=10)
    if matrix is None or fit is None or not np.isfinite(matrix).all():
        return fail("no-background-model")
    inliers = fit.ravel().astype(bool)
    info["inliers"] = int(np.count_nonzero(inliers))
    info["inlierRatio"] = info["inliers"] / len(start)
    if info["inliers"] < SPARSE_POLICY["minInliers"] or info["inlierRatio"] < SPARSE_POLICY["minInlierRatio"]:
        return fail("weak-consensus")
    xa, xb = start[inliers], end[inliers]
    info["gridCells"] = min(occupy(xa, w, h), occupy(xb, w, h))
    info["minAxisSpan"] = float(min(*(np.ptp(xa, axis=0)/(w, h)), *(np.ptp(xb, axis=0)/(w, h))))
    info["hullFraction"] = min(float(cv2.contourArea(cv2.convexHull(x)) / (w*h)) for x in (xa, xb))
    if (info["gridCells"] < SPARSE_POLICY["minOccupiedCells"] or info["minAxisSpan"] < SPARSE_POLICY["minAxisSpan"]
            or info["hullFraction"] < SPARSE_POLICY["minHullFraction"]):
        return fail("localized-consensus")
    residual = end - apply(matrix, start)
    info["medianErrorPixels"] = float(np.median(np.linalg.norm(residual[inliers], axis=1)))
    if info["medianErrorPixels"] > max(.9, SPARSE_POLICY["maxMedianErrorPixelsAt768"] * max(w,h) / 768):
        return fail("high-residual")
    info["dissentingCell"] = _dissent(start, residual, w, h)
    if info["dissentingCell"] is not None:
        return fail("regional-warp-disagreement")
    ok, geometry = _geometry(matrix, w, h, True)
    info.update(geometry)
    if not ok:
        return fail("excessive-transform")
    rejected = _photometric(prev, current, source_mask, target_mask, matrix, info)
    if rejected:
        return fail(rejected)
    return matrix, {"status": "valid", **info}


class BackgroundChain:
    """push every frame; supply actual boxes on detector frames (including []).

    At a detector frame returns previous detector → current affine, only if
    every constituent pair is trusted, masks valid, and endpoint guard agrees.
    For skipped-frame consumers last_step is the last trusted immediate pair.
    A failed pair may never be spanned or interpolated by future evidence.
    """

    def __init__(self):
        self.epoch = 0
        self.last_step = None
        self._prev = self._prev_t = self._prev_mask = None
        self._anchor = self._anchor_t = None
        self._anchor_boxes = ()
        self._pose = np.eye(3)
        self._rejected = []
        self._step_count = 0

    def push(self, gray, at_ms, boxes=None):
        start = perf_counter()
        if not isinstance(gray, np.ndarray) or gray.ndim != 2 or gray.dtype != np.uint8 or min(gray.shape) < 32:
            raise ValueError("Expected 2D uint8 grayscale frame")
        if not math.isfinite(at_ms) or at_ms < 0:
            raise ValueError("Expected finite nonnegative frame timestamp")
        h, w = gray.shape
        diag = math.hypot(w, h)
        mask_pad = diag * POLICY["minMaskSafetyDiagonal"]
        detected = boxes is not None
        actual = tuple(boxes) if detected else ()
        step, q = None, {"status": "first-frame"}
        swept = []
        if self._prev is not None:
            dt = at_ms - self._prev_t
            if not POLICY["minRawIntervalMs"] <= dt <= POLICY["maxRawIntervalMs"]:
                q = {"status": "source-time-discontinuity"}
            elif gray.shape != self._prev.shape:
                q = {"status": "dimensions-changed"}
            elif self._rejected:
                q = {"status": "awaiting-detector-reanchor"}
            elif self._anchor_t is None or at_ms-self._anchor_t > POLICY["maxSampleIntervalMs"]:
                q = {"status": "foreground-mask-stale"}
            else:
                # Causal mask: project previously observed boxes with prior
                # camera motion, and grow a conservative swept exclusion until
                # a detector provides the actual mask (which is unioned).
                elapsed_s = (at_ms-self._anchor_t)/1000
                predicted = self._pose if self.last_step is None else transform_matrix(self.last_step) @ self._pose
                for b in self._anchor_boxes:
                    a, c = warp_box(self._pose[:2], b.xyxy), warp_box(predicted[:2], b.xyxy)
                    swept.append(Detection(b.label, b.score,
                            (min(a[0],c[0]), min(a[1],c[1]), max(a[2],c[2]), max(a[3],c[3]))))
                target_mask = _mask(gray, swept, mask_pad + diag * elapsed_s * POLICY["maskSweepDiagonalPerSecond"])
                if actual:
                    target_mask &= _mask(gray, actual, mask_pad)
                step, q = _pair(self._prev, gray, self._prev_mask, target_mask)
                self._step_count += 1
                if step is not None and not self._rejected:
                    self._pose = transform_matrix(step) @ self._pose
                if len(self._rejected) == 0 and step is not None and not detected:
                    # Keep the estimated pre-fit exclusion too, so a fitted
                    # erroneous warp cannot unmask pixels it used on this step.
                    updated = [Detection(b.label, b.score, warp_box(self._pose[:2], b.xyxy)) for b in self._anchor_boxes]
                    target_mask &= _mask(gray, updated, mask_pad + diag * elapsed_s * POLICY["maskSweepDiagonalPerSecond"])
                if not detected:
                    self._prev_mask = target_mask
            if step is None:
                if not self._rejected:
                    self.epoch += 1
                if len(self._rejected) < 10:
                    self._rejected.append({"timeMs": at_ms, "reason": q["status"]})
        matrix, status, direct_status = None, "intermediate", None
        self.last_step = step
        endpoint_q = {}
        if detected:
            if self._anchor is None:
                status = "first-detector-frame"
            elif self._rejected or not self._step_count:
                status = "interrupted-chain"
            else:
                candidate = self._pose[:2]
                valid, endpoint_q = _geometry(candidate, w, h, False)
                remote, d = registered(self._anchor, gray, self._anchor_boxes, actual)
                direct_status = d["status"]
                test = np.array([(w*x, h*y) for x,y in ((.2,.2), (.8,.2), (.5,.5), (.2,.8), (.8,.8))])
                disagreement = None if remote is None else float(np.max(np.linalg.norm(apply(candidate, test)-apply(remote, test), axis=1)))
                endpoint_q["sparseDisagreementPixels"] = disagreement
                reason = _photometric(self._anchor, gray, _mask(self._anchor, self._anchor_boxes, mask_pad),
                                      _mask(gray, actual, mask_pad), candidate, endpoint_q)
                if not valid or reason:
                    status = reason or "excessive-chained-transform"
                elif disagreement is not None and disagreement > max(3.0, POLICY["maxModelDisagreementDiagonal"] * diag):
                    status = "endpoint-model-disagreement"
                else:
                    status, matrix = "valid", candidate.copy()
                if matrix is None:
                    self.epoch += 1
                    self.last_step = None
            self._anchor, self._anchor_t, self._anchor_boxes = gray.copy(), at_ms, actual
            self._prev_mask = _mask(gray, actual, mask_pad)
        elif self._prev_mask is None or self._prev_mask.shape != gray.shape:
            self._prev_mask = _mask(gray, (), mask_pad)
        report = {"status": status, "path": "high-rate-masked-lk", "epoch": self.epoch,
                  "chainSteps": self._step_count, "rejectedSteps": list(self._rejected), "step": q,
                  "endpoint": endpoint_q, "sparseCrossCheck": direct_status,
                  "elapsedMs": round((perf_counter()-start)*1000, 3)}
        if matrix is not None:
            report["affinePrevToCurrent"] = matrix.tolist()
        if detected:
            self._pose, self._rejected, self._step_count = np.eye(3), [], 0
        self._prev, self._prev_t = gray.copy(), at_ms
        return matrix, report
