"""M3D offline candidate: corroborated relative optical approach, not motion.

One calibrated RGB stream, detector rectangles and synchronized camera pose
only. Apparent expansion cannot establish object self-motion, metres, time to
contact, clearance, or safety. Background controls test continuity and veto an
unexplained common image scale; calibration provenance still belongs to the
caller. These preregistered sensitivity floors are not calibrated probabilities.
"""

from collections import Counter, deque
from collections.abc import Mapping
import math
import re
from types import MappingProxyType

import cv2
import numpy as np

from assist_scene_motion import Detection, mask_for
from assist_scene_motion_m3c import LK, correspondences
from assist_scene_pose_motion import _intrinsics, _transform, point_residuals, pose_pair


POLICY = MappingProxyType({
    "maxImageSide": 768, "maxTracks": 12, "maxBackgroundPoints": 256,
    "minBackgroundPoints": 24, "minBackgroundSupport": .70,
    "minBackgroundCells": 5, "minBackgroundSpan": .40,
    "minPatchCorrelation": .70, "maxNearRotationBaselineM": .025,
    "maxNearRotationControlPx": 1.30, "maxImageClockErrorMs": 1.,
    "commonScaleMinSupport": .80, "commonScaleStepLog": .016,
    "commonScaleWindowLog": .035, "commonScaleHorizonMs": 640.,
    "minBoxSidePx": 24., "edgeMarginPx": 4., "maxOccludedFraction": .22,
    "associationIou": .30, "objectInset": .17, "maxObjectPoints": 52,
    "minObjectPoints": 9, "minObjectSupport": .75, "minObjectSpan": .28,
    "minObjectHull": .045, "maxLocalRotationDeg": 10.,
    "maxBoxShapeLogChange": .065, "maxBoxPointLogDifference": .050,
    "maxCenterErrorFraction": .15, "minPointStepLog": .006,
    "maxStepLog": .16, "minBoxAxisStepLog": -.012,
    "minPairs": 3, "minWindowMs": 220., "maxWindowMs": 900.,
    "minNetLogGrowth": .075, "minBoxGrowthCoherence": .80,
})


def _valid_timestamp(value):
    return type(value) is int and 0 <= value < 2**63


def _frame_view(frame, width, height):
    """Retain only the validated source geometry; borrow no mappings/arrays."""
    if not isinstance(frame, Mapping) or not _valid_timestamp(frame.get("timestampUs")):
        return None, "invalid-frame-clock"
    if not _valid_timestamp(frame.get("poseTimestampUs")) or frame.get("cameraToWorld") is None:
        return None, "missing-frame-pose"
    k = _intrinsics(frame.get("intrinsics"), width, height)
    pose = _transform(frame.get("cameraToWorld"))
    if k is None or pose is None:
        return None, "invalid-intrinsics" if k is None else "invalid-camera-transform"
    r, c = pose
    rigid = np.eye(4)
    rigid[:3, :3], rigid[:3, 3] = r, c
    output = {"timestampUs": frame["timestampUs"], "poseTimestampUs": frame["poseTimestampUs"],
              "intrinsics": k, "cameraToWorld": rigid}
    if "epoch" in frame:
        if type(frame["epoch"]) is not int or frame["epoch"] < 0:
            return None, "pose-epoch-mismatch"
        output["epoch"] = frame["epoch"]
    if "token" in frame:
        if not isinstance(frame["token"], str) or not 1 <= len(frame["token"]) <= 160:
            return None, "invalid-frame-token"
        output["token"] = frame["token"]
    return output, "valid"


def _boxes(rows, w, h):
    if not isinstance(rows, (list, tuple)) or len(rows) > POLICY["maxTracks"]:
        return None
    clean = []
    for row in rows:
        if (not isinstance(row, Detection) or not isinstance(row.label, str)
                or not re.fullmatch(r"[a-z0-9][a-z0-9 -]{0,39}", row.label)
                or type(row.score) not in (int, float) or not 0 <= row.score <= 1):
            return None
        rect = row.xyxy
        if (not isinstance(rect, (tuple, list)) or len(rect) != 4
                or not all(type(v) in (int, float) and math.isfinite(v) for v in rect)):
            return None
        x0, y0, x1, y1 = rect
        if not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h):
            return None
        clean.append(Detection(row.label, row.score, tuple(rect)))
    return clean


def _project(points, homography):
    result = np.column_stack((points, np.ones(len(points)))) @ homography.T
    with np.errstate(divide="ignore", invalid="ignore"):
        output = result[:, :2] / result[:, 2:]
    output[result[:, 2] <= 1e-6] = np.nan
    return output


def _warp_rect(rect, homography):
    x, y, u, v = rect
    points = _project(np.array([(x, y), (x, v), (u, y), (u, v)]), homography)
    if not np.isfinite(points).all():
        return None
    return np.r_[points.min(axis=0), points.max(axis=0)]


def _size(rect):
    return np.asarray(rect[2:]) - np.asarray(rect[:2])


def _center(rect):
    return (np.asarray(rect[:2]) + np.asarray(rect[2:])) / 2


def _intersection(a, b):
    return float(np.prod(np.maximum(0, np.minimum(a[2:], b[2:]) - np.maximum(a[:2], b[:2]))))


def _iou(a, b):
    intersection = _intersection(a, b)
    return intersection / (float(np.prod(_size(a)) + np.prod(_size(b))) - intersection)


def _too_close_to_edge(rect, w, h):
    x, y, u, v = rect
    m = POLICY["edgeMarginPx"]
    return x < m or y < m or u > w-m or v > h-m or min(u-x, v-y) < POLICY["minBoxSidePx"]


def _eligible(boxes, w, h):
    reasons = {}
    for i, box in enumerate(boxes):
        if _too_close_to_edge(box.xyxy, w, h):
            reasons[i] = "small-or-truncated"
        elif any(i != j and _intersection(box.xyxy, other.xyxy) / float(np.prod(_size(box.xyxy)))
                 > POLICY["maxOccludedFraction"] for j, other in enumerate(boxes)):
            reasons[i] = "overlap-occlusion-ambiguous"
    return reasons


def _inside(points, rect, inset):
    lo, hi = np.asarray(rect[:2]), np.asarray(rect[2:])
    border = inset * (hi - lo)
    return ((lo + border <= points) & (points <= hi - border)).all(axis=1)


def _matching_patches(old, new, a, b):
    """Independent photometric veto of reversible but unrelated LK matches."""
    supported = np.zeros(len(a), dtype=bool)
    h, w = old.shape
    interior = _inside(a, (3, 3, w-4, h-4), 0) & _inside(b, (3, 3, w-4, h-4), 0)
    for i in np.flatnonzero(interior):
        p, q = a[i], b[i]
        pa = cv2.getRectSubPix(old, (7, 7), tuple(map(float, p))).astype(np.float32)
        pb = cv2.getRectSubPix(new, (7, 7), tuple(map(float, q))).astype(np.float32)
        pa -= pa.mean(); pb -= pb.mean()
        norm = float(np.linalg.norm(pa) * np.linalg.norm(pb))
        supported[i] = norm >= 49*4**2 and float(np.sum(pa*pb)) >= norm*POLICY["minPatchCorrelation"]
    return supported


def _similarity(a, b, threshold):
    matrix, mask = cv2.estimateAffinePartial2D(a, b, method=cv2.RANSAC, ransacReprojThreshold=threshold,
                                                maxIters=250, confidence=.99, refineIters=6)
    if matrix is None or mask is None or not np.isfinite(matrix).all():
        return None, None
    return matrix, mask.ravel().astype(bool)


def _spread(points, w, h):
    cells = len({(int(x*4/w), int(y*3/h)) for x, y in points})
    span = float(np.min(np.ptp(points, axis=0)/[w, h])) if len(points) else 0.
    return cells, span


def _background(pair, homography, old, new, previous_boxes, boxes):
    h, w = new.shape
    a, b = correspondences(old, new, mask_for(old.shape, previous_boxes), POLICY["maxBackgroundPoints"])
    current_mask = mask_for(new.shape, boxes)
    xx, yy = b.astype(int).T
    plausible = (current_mask[yy, xx] != 0) & _matching_patches(old, new, a, b)
    a, b = a[plausible], b[plausible]
    derotated = _project(a, homography)
    finite = np.isfinite(derotated).all(axis=1)
    a, b, derotated = a[finite], b[finite], derotated[finite]
    q = {"points": len(a), "support": 0., "occupiedCells": 0, "commonLogScale": None}
    if len(a) < POLICY["minBackgroundPoints"]:
        return False, q
    if pair is None or pair.mode == "rotation":
        # Also used for the independently checked <2.5 cm near-static limit.
        # No artificial zero-translation pose is fed into the pose validator.
        agreement = np.linalg.norm(b-derotated, axis=1) <= POLICY["maxNearRotationControlPx"]
    else:
        residual, usable = point_residuals(pair, a, b)
        agreement = usable & (residual <= min(1.8, .65*pair.floor_px))
    cells, span = _spread(b[agreement], w, h)
    q.update(support=float(np.mean(agreement)), occupiedCells=cells, axisSpan=span)
    # A tight whole-image similarity after de-rotation is evidence of a common
    # scale ambiguity, not a claim it really was optical zoom. A forward-moving
    # camera with varying static depths generally has mutually different scales.
    transform, inliers = _similarity(derotated, b, .8)
    if transform is not None and np.mean(inliers) >= POLICY["commonScaleMinSupport"]:
        n_cells, common_span = _spread(b[inliers], w, h)
        scale = math.hypot(*transform[:, 0])
        if (n_cells >= POLICY["minBackgroundCells"] and common_span >= POLICY["minBackgroundSpan"]
                and np.count_nonzero(inliers) >= POLICY["minBackgroundPoints"] and scale > 0):
            q["commonLogScale"] = math.log(scale)
    ok = (np.count_nonzero(agreement) >= POLICY["minBackgroundPoints"]
          and q["support"] >= POLICY["minBackgroundSupport"]
          and cells >= POLICY["minBackgroundCells"] and span >= POLICY["minBackgroundSpan"])
    return ok, q


def _local_evidence(old, new, old_box, new_box, warped, homography):
    h, w = old.shape
    mask = np.zeros(old.shape, np.uint8)
    x, y, u, v = old_box
    inset = POLICY["objectInset"]
    lx, rx = math.ceil(x+(u-x)*inset), math.floor(u-(u-x)*inset)
    ly, ry = math.ceil(y+(v-y)*inset), math.floor(v-(v-y)*inset)
    mask[ly:ry, lx:rx] = 255
    # Count every original ROI seed in the denominator. The shared background
    # helper only returns surviving LK pairs, so using len(survivors) here could
    # silently drop all occluded points and call a small remnant unanimous.
    seeds = cv2.goodFeaturesToTrack(old, maxCorners=POLICY["maxObjectPoints"], qualityLevel=.012,
                                   minDistance=4, mask=mask)
    if seeds is None or len(seeds) < POLICY["minObjectPoints"]:
        return None, "insufficient-object-flow"
    end, forward, _ = cv2.calcOpticalFlowPyrLK(old, new, seeds, None, **LK)
    if end is None or forward is None:
        return None, "insufficient-object-flow"
    keep = (forward.ravel() == 1) & np.isfinite(end[:, 0]).all(axis=1)
    keep &= _inside(end[:, 0], new_box, inset*.65)
    if np.count_nonzero(keep)/len(seeds) < POLICY["minObjectSupport"]:
        return None, "insufficient-object-flow"
    seeds_kept, end = seeds[keep], end[keep]
    back, backward, _ = cv2.calcOpticalFlowPyrLK(new, old, end, None, **LK)
    if back is None or backward is None:
        return None, "insufficient-object-flow"
    a, b = seeds_kept[:, 0], end[:, 0]
    visible = (backward.ravel() == 1) & (np.linalg.norm(a-back[:, 0], axis=1) <= 1.3)
    visible &= _matching_patches(old, new, a, b)
    if np.count_nonzero(visible)/len(seeds) < POLICY["minObjectSupport"]:
        return None, "insufficient-object-flow"
    a, b = a[visible], b[visible]
    corrected = _project(a, homography)
    if not np.isfinite(corrected).all():
        return None, "invalid-object-projection"
    fit, inliers = _similarity(corrected, b, max(.75, 1.4*max(h, w)/768))
    if (fit is None or np.count_nonzero(inliers) < POLICY["minObjectPoints"]
            or np.count_nonzero(inliers)/len(seeds) < POLICY["minObjectSupport"]):
        return None, "incoherent-object-flow"
    for points, rect in ((a[inliers], old_box), (b[inliers], new_box)):
        span = np.min(np.ptp(points, axis=0)/_size(rect))
        hull = cv2.contourArea(cv2.convexHull(points.astype(np.float32))) / float(np.prod(_size(rect)))
        if span < POLICY["minObjectSpan"] or hull < POLICY["minObjectHull"]:
            return None, "localized-object-flow"
    k = math.hypot(*fit[:, 0])
    angle = abs(math.degrees(math.atan2(fit[1, 0], fit[0, 0])))
    if k <= 0 or angle > POLICY["maxLocalRotationDeg"]:
        return None, "object-shape-change"
    if np.linalg.norm(fit[:, :2] @ _center(warped)+fit[:, 2]-_center(new_box)) > max(2., POLICY["maxCenterErrorFraction"]*min(_size(new_box))):
        return None, "object-flow-box-disagreement"
    axis = np.log(_size(new_box) / _size(warped))
    box_log, point_log = float(np.mean(axis)), math.log(k)
    if (abs(axis[0]-axis[1]) > POLICY["maxBoxShapeLogChange"]
            or abs(box_log-point_log) > POLICY["maxBoxPointLogDifference"]):
        return None, "object-scale-disagreement"
    if not (POLICY["minPointStepLog"] <= point_log <= POLICY["maxStepLog"]
            and min(axis) >= POLICY["minBoxAxisStepLog"] and max(axis) <= POLICY["maxStepLog"]):
        return None, "no-current-expansion"
    return (float(axis[0]), float(axis[1]), point_log, int(np.count_nonzero(inliers))), "expansion-supported"


class ScaleApproach:
    """Causal clip replay. Retains at most one bounded RGB grayscale frame."""

    def __init__(self):
        self.epoch = 0
        self._next_id = 1
        self._previous = None
        self._common = deque(maxlen=8)

    def _reset(self):
        self.epoch += 1
        self._previous = None
        self._common.clear()

    def _update_common_scale(self, at, q):
        value = q.get("commonLogScale")
        if value is None:
            self._common.clear()
            return False
        self._common.append((at, value))
        while self._common and at-self._common[0][0] > POLICY["commonScaleHorizonMs"]:
            self._common.popleft()
        net = abs(sum(v for _, v in self._common))
        total = sum(abs(v) for _, v in self._common)
        return (abs(value) >= POLICY["commonScaleStepLog"] or
                (net >= POLICY["commonScaleWindowLog"] and net >= .8*total))

    def update(self, frame, t_ms, gray, boxes):
        def result(status, diagnostics=None, tracks=None, events=None):
            return {"tracks": tracks or [], "events": events or [], "status": status,
                    "diagnostics": diagnostics or {}, "epoch": self.epoch}

        if (not isinstance(gray, np.ndarray) or gray.ndim != 2 or gray.dtype != np.uint8
                or not 32 <= min(gray.shape) <= max(gray.shape) <= POLICY["maxImageSide"]):
            self._reset()
            return result("invalid-image")
        if type(t_ms) not in (int, float) or not math.isfinite(t_ms) or t_ms < 0:
            self._reset()
            return result("invalid-stream-clock")
        h, w = gray.shape
        frame, status = _frame_view(frame, w, h)
        boxes = _boxes(boxes, w, h)
        if frame is None or boxes is None:
            self._reset()
            return result(status if frame is None else "invalid-detections")

        events, tracks, active, diagnostics = [], [], [], {"trackReasons": {}}
        blocked = _eligible(boxes, w, h)
        prior, warped, links = [], [], {}
        homography = None
        status = "first-frame"
        if self._previous is not None:
            old_frame, old_at, old_image, prior = self._previous
            old_boxes = [item[0] for item in prior]
            if gray.shape != old_image.shape:
                status = "image-geometry-changed"
            elif "token" in frame and frame["token"] == old_frame.get("token"):
                self._reset()
                return result("duplicate-frame")
            elif (t_ms <= old_at or abs((t_ms-old_at)-(frame["timestampUs"]-old_frame["timestampUs"])/1000)
                  > POLICY["maxImageClockErrorMs"]):
                self._reset()
                return result("stream-clock-mismatch")
            else:
                pair, q = pose_pair(old_frame, frame, w, h)
                diagnostics["pose"] = q
                status = q["status"]
                if pair is not None:
                    homography = pair.homography
                elif status == "epipolar-baseline-too-small" and q["translationM"] < POLICY["maxNearRotationBaselineM"]:
                    # pose_pair already validated calibration, timing and SE(3).
                    # Accept this limit only with independently observed, tight
                    # rotation-compatible background; do not assert zero motion.
                    k = frame["intrinsics"]
                    r = frame["cameraToWorld"][:3, :3].T @ old_frame["cameraToWorld"][:3, :3]
                    homography = k @ r @ np.linalg.inv(k)
                    q["control"] = "near-static-rotation"
                    status = "valid"
                if homography is not None:
                    valid, bg = _background(pair, homography, old_image, gray, old_boxes, boxes)
                    diagnostics["background"] = bg
                    ambiguous = self._update_common_scale(t_ms, bg)
                    if ambiguous or not valid:
                        homography = None
                        status = "scale-ambiguous" if ambiguous else "insufficient-background-agreement"
            if homography is None:
                self._reset()
            else:
                old_blocked = _eligible(old_boxes, w, h)
                warped = [_warp_rect(box.xyxy, homography) for box in old_boxes]
                edges = [(i, j) for i, (q, box0) in enumerate(zip(warped, old_boxes)) if q is not None
                         for j, box in enumerate(boxes) if box.label == box0.label
                         and _iou(q, box.xyxy) >= POLICY["associationIou"]]
                a, b = Counter(i for i, _ in edges), Counter(j for _, j in edges)
                for i, j in edges:
                    if a[i] != 1 or b[j] != 1:
                        blocked[j] = "association-ambiguous"
                    elif i in old_blocked or _too_close_to_edge(warped[i], w, h):
                        blocked.setdefault(j, "previous-object-not-reliable")
                    elif j not in blocked:
                        links[j] = i
        for j, box in enumerate(boxes):
            at, history = t_ms, deque(maxlen=12)
            index = links.get(j)
            reason = blocked.get(j, "new-or-unmatched-object")
            id_ = None
            if index is not None:
                old_box, old_id, old_history = prior[index]
                evidence, reason = _local_evidence(old_image, gray, old_box.xyxy, box.xyxy,
                                                    warped[index], homography)
                if evidence is not None or reason == "no-current-expansion":
                    id_ = old_id
                # Lost/ambiguous data never carries votes into a new track.
                if evidence is not None:
                    history = deque(old_history, maxlen=12)
                    history.append((old_at, *evidence))
                    while history and at-history[0][0] > POLICY["maxWindowMs"]:
                        history.popleft()
                    if len(history) >= POLICY["minPairs"] and at-history[0][0] >= POLICY["minWindowMs"]:
                        _, widths, heights, point_logs, _ = zip(*history)
                        nw, nh, nl = sum(widths), sum(heights), sum(point_logs)
                        box_supported = all(net >= POLICY["minNetLogGrowth"] and
                                            net >= POLICY["minBoxGrowthCoherence"]*sum(map(abs, values))
                                            for net, values in ((nw, widths), (nh, heights)))
                        if box_supported and nl >= POLICY["minNetLogGrowth"] and abs(nl-(nw+nh)/2) <= POLICY["maxBoxPointLogDifference"]:
                            events.append({"kind": "relative-optical-approach", "trackId": id_, "label": box.label,
                                           "epoch": self.epoch, "timeMs": at, "pairCount": len(history),
                                           "observationMs": at-history[0][0], "boxLogGrowth": (nw+nh)/2,
                                           "pointLogGrowth": nl, "lastPoints": history[-1][-1]})
            if id_ is None:
                id_ = self._next_id
                self._next_id += 1
            active.append((box, id_, history))
            tracks.append({"id": id_, **box.record(w, h)})
            diagnostics["trackReasons"][str(id_)] = reason
        self._previous = frame, t_ms, gray.copy(), active
        return result(status, diagnostics, tracks, events)
