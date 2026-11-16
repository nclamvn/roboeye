"""M3E offline ablation: native ROI texture and one-gap identity continuity.

Inputs use the M3D coordinate/clock contract. The caller must establish that
native_gray is the *same* source exposure before frame resizing, not another
camera, an artificial upscale, or a differently cropped image. Native pixels
are only used for object evidence, never to bypass the M3D camera guard.
"""

from collections import Counter, deque
from dataclasses import dataclass
import math
from types import MappingProxyType

import cv2
import numpy as np

import assist_scene_scale_approach as base
from assist_scene_motion import Detection


POLICY = MappingProxyType({
    **base.POLICY,
    "detailMinWorkingSidePx": 12., "detailMinNativeSidePx": 24.,
    "detailMinSourceRatio": 1.15, "detailMaxSourceSidePx": 4096,
    "detailMaxSourcePixels": 4096*2160, "detailMaxTileSidePx": 192,
    "detailTilePaddingPx": 16, "detailMinSeedDistancePx": 3.,
    "relinkMaxGapMs": 205., "relinkMinIoU": .50,
    "relinkMinDetectionScore": .45, "relinkMaxSleepingTracks": 4,
    "relinkMaxScaleChangeLog": .15, "relinkMaxCenterShiftFraction": .32,
})


@dataclass(frozen=True, slots=True)
class _Track:
    box: Detection
    id: int
    votes: deque
    verified: bool = False


@dataclass(frozen=True, slots=True)
class _Sleeping:
    box: Detection  # tracked pixel region in the one frame lacking a detection
    id: int
    last_detection_ms: float


def _native_transform(native, shape):
    if (not isinstance(native, np.ndarray) or native.ndim != 2 or native.dtype != np.uint8
            or max(native.shape) > POLICY["detailMaxSourceSidePx"]
            or native.size > POLICY["detailMaxSourcePixels"] or not min(native.shape)):
        return None
    h, w = shape
    nh, nw = native.shape
    s = max(h, w)/max(nh, nw)
    if (min(nh/h, nw/w) < POLICY["detailMinSourceRatio"]
            or abs(nh*s-h) > .51 or abs(nw*s-w) > .51):
        return None
    return np.array([[nw/w, 0., 0.], [0., nh/h, 0.], [0., 0., 1.]])


def _edge_or_small(rect, shape, native):
    h, w = shape
    x, y, r, b = rect
    m = POLICY["edgeMarginPx"]
    if min(x, y, w-r, h-b) < m:
        return True
    side = min(r-x, b-y)
    if side >= POLICY["minBoxSidePx"]:
        return False
    if native is None or side < POLICY["detailMinWorkingSidePx"]:
        return True
    return min((r-x)*native[0, 0], (b-y)*native[1, 1]) < POLICY["detailMinNativeSidePx"]


def _eligible(boxes, shape, native):
    result = {}
    for i, box in enumerate(boxes):
        if _edge_or_small(box.xyxy, shape, native):
            result[i] = "small-or-truncated"
        elif any(i != j and base._intersection(box.xyxy, other.xyxy)/float(np.prod(base._size(box.xyxy)))
                 > POLICY["maxOccludedFraction"] for j, other in enumerate(boxes)):
            result[i] = "overlap-occlusion-ambiguous"
    return result


def _projected_tile(old_native, new_native, transform, a, b, homography):
    """Both crops share an origin; LK observes actual source pixels, no resampling."""
    a, b = base._warp_rect(a, transform), base._warp_rect(b, transform)
    pad = POLICY["detailTilePaddingPx"]
    lo = np.maximum(0, np.floor(np.minimum(a[:2], b[:2])).astype(int)-pad)
    hi = np.minimum(old_native.shape[::-1], np.ceil(np.maximum(a[2:], b[2:])).astype(int)+pad)
    if np.any(hi-lo > POLICY["detailMaxTileSidePx"]) or np.any(hi-lo < 16):
        return None
    x, y = lo
    x1, y1 = hi
    scale = np.array([[1., 0., -x], [0., 1., -y], [0., 0., 1.]]) @ transform
    offset = np.tile(lo, 2)
    return (np.ascontiguousarray(old_native[y:y1, x:x1]),
            np.ascontiguousarray(new_native[y:y1, x:x1]), a-offset, b-offset,
            scale @ homography @ np.linalg.inv(scale), np.linalg.inv(scale))


def _object_pixels(old, new, a, b, homography, *, confirm_identity=False, native_ratio=None):
    """Fit inside pixels, counting failed or occluded seeds in the denominator."""
    projected = base._warp_rect(a, homography)
    if projected is None or min(base._size(projected)) <= 0:
        return None, "invalid-object-projection"
    inset = POLICY["objectInset"]
    left, top = np.ceil(a[:2]+inset*base._size(a)).astype(int)
    right, bottom = np.floor(a[2:]-inset*base._size(a)).astype(int)
    mask = np.zeros(old.shape, np.uint8)
    if not (0 <= left < right <= old.shape[1] and 0 <= top < bottom <= old.shape[0]):
        return None, "invalid-object-projection"
    mask[top:bottom, left:right] = 255
    win = min(21, max(11, int(min(base._size(a))*.53)//2*2+1))
    lk = {**base.LK, "winSize": (win, win), "maxLevel": 2} if native_ratio else base.LK
    seeds = cv2.goodFeaturesToTrack(old, maxCorners=POLICY["maxObjectPoints"], qualityLevel=.012,
                                   minDistance=POLICY["detailMinSeedDistancePx"] if native_ratio else 4, mask=mask)
    if seeds is None or len(seeds) < POLICY["minObjectPoints"]:
        return None, "insufficient-object-flow"
    end, forward, _ = cv2.calcOpticalFlowPyrLK(old, new, seeds, None, **lk)
    if end is None or forward is None:
        return None, "insufficient-object-flow"
    keep = ((forward.ravel() == 1) & np.isfinite(end[:, 0]).all(axis=1)
            & base._inside(end[:, 0], b, inset*.65 if not confirm_identity else .04))
    if np.count_nonzero(keep) < POLICY["minObjectSupport"]*len(seeds):
        return None, "insufficient-object-flow"
    seeds_valid, end = seeds[keep], end[keep]
    back, backward, _ = cv2.calcOpticalFlowPyrLK(new, old, end, None, **lk)
    if back is None or backward is None:
        return None, "insufficient-object-flow"
    old_p, new_p = seeds_valid[:, 0], end[:, 0]
    good = ((backward.ravel() == 1) & (np.linalg.norm(old_p-back[:, 0], axis=1) <= 1.3)
            & base._matching_patches(old, new, old_p, new_p))
    if np.count_nonzero(good) < POLICY["minObjectSupport"]*len(seeds):
        return None, "insufficient-object-flow"
    a_pts, b_pts = old_p[good], new_p[good]
    corrected = base._project(a_pts, homography)
    if not np.isfinite(corrected).all():
        return None, "invalid-object-projection"
    tolerance = min(1.35, max(.9, .6*native_ratio)) if native_ratio else max(.75, 1.4*max(old.shape)/768)
    fit, inliers = base._similarity(corrected, b_pts, tolerance)
    count = int(np.count_nonzero(inliers)) if inliers is not None else 0
    if count < POLICY["minObjectPoints"] or count < POLICY["minObjectSupport"]*len(seeds):
        return None, "incoherent-object-flow"
    for points, rect in ((a_pts[inliers], a), (b_pts[inliers], b)):
        span = np.min(np.ptp(points, axis=0)/base._size(rect))
        hull = cv2.contourArea(cv2.convexHull(points.astype(np.float32)))/float(np.prod(base._size(rect)))
        if span < POLICY["minObjectSpan"] or hull < POLICY["minObjectHull"]:
            return None, "localized-object-flow"
    scale = math.hypot(*fit[:, 0])
    angle = abs(math.degrees(math.atan2(fit[1, 0], fit[0, 0])))
    if scale <= 0 or angle > POLICY["maxLocalRotationDeg"]:
        return None, "object-shape-change"
    center = fit[:, :2] @ base._center(projected)+fit[:, 2]
    center_error = float(np.linalg.norm(center-base._center(b)))
    point_log = math.log(scale)
    axis = np.log(base._size(b)/base._size(projected))
    box_log = float(np.mean(axis))
    if confirm_identity:
        if (abs(point_log) > POLICY["relinkMaxScaleChangeLog"]
                or abs(axis[0]-axis[1]) > POLICY["maxBoxShapeLogChange"]
                or abs(box_log-point_log) > POLICY["maxBoxPointLogDifference"]*1.5
                or center_error > max(2., POLICY["relinkMaxCenterShiftFraction"]*min(base._size(b)))):
            return None, "relink-object-disagreement"
        half = base._size(projected)*scale/2
        return np.r_[center-half, center+half], "identity-supported"
    if center_error > max(2., POLICY["maxCenterErrorFraction"]*min(base._size(b))):
        return None, "object-flow-box-disagreement"
    if (abs(axis[0]-axis[1]) > POLICY["maxBoxShapeLogChange"]
            or abs(box_log-point_log) > POLICY["maxBoxPointLogDifference"]):
        return None, "object-scale-disagreement"
    if not (POLICY["minPointStepLog"] <= point_log <= POLICY["maxStepLog"]
            and min(axis) >= POLICY["minBoxAxisStepLog"] and max(axis) <= POLICY["maxStepLog"]):
        return None, "no-current-expansion"
    return (float(axis[0]), float(axis[1]), point_log, count), "expansion-supported"


def _same_native_transform(old_native, new_native, shape):
    if old_native is None or new_native is None or old_native.shape != new_native.shape:
        return None
    return _native_transform(new_native, shape)


def _collides(rect, boxes, *, skip=None):
    area = float(np.prod(base._size(rect)))
    return any(i != skip and (base._intersection(rect, b.xyxy)/area > POLICY["maxOccludedFraction"]
                              or (b.label == boxes[skip].label and base._iou(rect, b.xyxy) >= POLICY["associationIou"]
                                  if skip is not None else False)) for i, b in enumerate(boxes))


def _cast_rect(box):
    return tuple(float(value) for value in box)


class ScaleApproachM3E(base.ScaleApproach):
    """Ablatable offline candidate; only current continuous expansion can emit."""

    def __init__(self, *, detail=True, relink=True):
        super().__init__()
        self.detail, self.relink = detail, relink
        self._previous_native = None
        self._sleeping = []

    def _reset(self):
        super()._reset()
        self._previous_native = None
        self._sleeping.clear()

    @staticmethod
    def _record_evidence(old, new, a, b, warped, homography, native, diagnostics, *, identity=False):
        old_raw, new_raw, transform = native
        if min(*base._size(a), *base._size(b)) < POLICY["minBoxSidePx"]:
            if transform is None:
                return None, "missing-native-detail"
            diagnostics["detailAttempts"] += 1
            tile = _projected_tile(old_raw, new_raw, transform, a, b, homography)
            if tile is None:
                return None, "native-tile-budget"
            p, q, ar, br, hom, inverse = tile
            evidence, reason = _object_pixels(p, q, ar, br, hom, confirm_identity=identity,
                                              native_ratio=min(transform[0, 0], transform[1, 1]))
            if evidence is not None:
                if identity:
                    evidence = base._warp_rect(evidence, inverse)
                else:
                    diagnostics["detailEvidencePairs"] += 1
            return evidence, reason
        if identity:
            return _object_pixels(old, new, np.asarray(a), np.asarray(b), homography, confirm_identity=True)
        return base._local_evidence(old, new, a, b, warped, homography)

    def _resume(self, boxes, blocked, links, old_boxes, warped, old_image, gray, at,
                homography, native, diagnostics):
        rows = [(s, base._warp_rect(s.box.xyxy, homography)) for s in self._sleeping
                if 0 < at-s.last_detection_ms <= POLICY["relinkMaxGapMs"]]
        edges = [(i, j) for i, (s, rect) in enumerate(rows)
                 if rect is not None and not _edge_or_small(rect, gray.shape, native[2])
                 for j, box in enumerate(boxes) if box.label == s.box.label
                 and base._iou(rect, box.xyxy) >= POLICY["associationIou"]]
        sources, targets = Counter(i for i, _ in edges), Counter(j for _, j in edges)
        result = {}
        for i, j in edges:
            s, rect = rows[i]
            box = boxes[j]
            if (sources[i] != 1 or targets[j] != 1 or j in blocked or j in links
                    or box.score < POLICY["relinkMinDetectionScore"]
                    or base._iou(rect, box.xyxy) < POLICY["relinkMinIoU"]
                    or _collides(rect, boxes, skip=j)
                    or any(r is not None and old.label == box.label
                           and base._iou(r, box.xyxy) >= POLICY["associationIou"]
                           for old, r in zip(old_boxes, warped))):
                continue
            diagnostics["relinkAttempts"] += 1
            proof, _ = self._record_evidence(old_image, gray, s.box.xyxy, box.xyxy, rect,
                                             homography, native, diagnostics, identity=True)
            if proof is not None and base._iou(proof, box.xyxy) >= POLICY["relinkMinIoU"]:
                result[j] = s.id
                diagnostics["relinkedTracks"] += 1
        return result

    def _keep_missing(self, boxes, edges, prior, warped, old_blocked, old_image, gray, old_at,
                      homography, native, diagnostics):
        used = {i for i, _ in edges}
        eligible = [(i, p, warped[i]) for i, p in enumerate(prior) if p.verified and i not in used
                    and i not in old_blocked and p.box.score >= POLICY["relinkMinDetectionScore"]
                    and warped[i] is not None and not _edge_or_small(warped[i], gray.shape, native[2])
                    and not _collides(warped[i], boxes)]
        if len(eligible) > POLICY["relinkMaxSleepingTracks"]:
            return []
        sleeping = []
        for i, p, rect in eligible:
            if any(k != i and q is not None and base._iou(rect, q) >= POLICY["associationIou"]
                   for k, q in enumerate(warped)):
                continue
            proof, _ = self._record_evidence(old_image, gray, p.box.xyxy, rect, rect,
                                             homography, native, diagnostics, identity=True)
            if proof is None or _edge_or_small(proof, gray.shape, native[2]) or _collides(proof, boxes):
                continue
            sleeping.append(_Sleeping(Detection(p.box.label, p.box.score, _cast_rect(proof)), p.id, old_at))
        return sleeping

    def update(self, frame, t_ms, gray, boxes, *, native_gray=None):
        # Exact old behavior is retained when neither experiment is enabled.
        if not self.detail and not self.relink:
            return super().update(frame, t_ms, gray, boxes)

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
        frame, status = base._frame_view(frame, w, h)
        boxes = base._boxes(boxes, w, h)
        if frame is None or boxes is None:
            self._reset()
            return result(status if frame is None else "invalid-detections")

        transform = _native_transform(native_gray, gray.shape) if self.detail else None
        native_gray = native_gray if transform is not None else None
        blocked = _eligible(boxes, gray.shape, transform)
        diagnostics = {"trackReasons": {}, "detailAttempts": 0, "detailEvidencePairs": 0,
                       "relinkAttempts": 0, "relinkedTracks": 0}
        events, tracks, active, resting = [], [], [], []
        links, resumed = {}, {}
        status = "first-frame"
        if self._previous is not None:
            old_frame, old_at, old_image, prior = self._previous
            old_boxes = [item.box for item in prior]
            homography = None
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
                pair, q = base.pose_pair(old_frame, frame, w, h)
                diagnostics["pose"] = q
                status = q["status"]
                if pair is not None:
                    homography = pair.homography
                elif status == "epipolar-baseline-too-small" and q["translationM"] < POLICY["maxNearRotationBaselineM"]:
                    k = frame["intrinsics"]
                    r = frame["cameraToWorld"][:3, :3].T @ old_frame["cameraToWorld"][:3, :3]
                    homography = k @ r @ np.linalg.inv(k)
                    q["control"] = "near-static-rotation"
                    status = "valid"
                if homography is not None:
                    valid, bg = base._background(pair, homography, old_image, gray, old_boxes, boxes)
                    diagnostics["background"] = bg
                    ambiguous = self._update_common_scale(t_ms, bg)
                    if ambiguous or not valid:
                        homography = None
                        status = "scale-ambiguous" if ambiguous else "insufficient-background-agreement"
            if homography is None:
                self._reset()
            else:
                native = (self._previous_native, native_gray,
                          _same_native_transform(self._previous_native, native_gray, gray.shape))
                old_blocked = _eligible(old_boxes, gray.shape, native[2])
                warped = [base._warp_rect(box.xyxy, homography) for box in old_boxes]
                edges = [(i, j) for i, (r, b) in enumerate(zip(warped, old_boxes)) if r is not None
                         for j, box in enumerate(boxes) if box.label == b.label
                         and base._iou(r, box.xyxy) >= POLICY["associationIou"]]
                a, b = Counter(i for i, _ in edges), Counter(j for _, j in edges)
                for i, j in edges:
                    if a[i] != 1 or b[j] != 1:
                        blocked[j] = "association-ambiguous"
                    elif i in old_blocked or _edge_or_small(warped[i], gray.shape, native[2]):
                        blocked.setdefault(j, "previous-object-not-reliable")
                    elif j not in blocked:
                        links[j] = i
                if self.relink:
                    resumed = self._resume(boxes, blocked, links, old_boxes, warped, old_image, gray, t_ms,
                                           homography, native, diagnostics)
                    resting = self._keep_missing(boxes, edges, prior, warped, old_blocked, old_image, gray,
                                                 old_at, homography, native, diagnostics)

        for j, box in enumerate(boxes):
            history = deque(maxlen=12)
            id_, verified = resumed.get(j), False
            reason = "relinked-identity-only" if id_ is not None else blocked.get(j, "new-or-unmatched-object")
            index = links.get(j)
            if index is not None:
                old = prior[index]
                evidence, reason = self._record_evidence(old_image, gray, old.box.xyxy, box.xyxy, warped[index],
                                                         homography, native, diagnostics)
                if evidence is not None or reason == "no-current-expansion":
                    id_, verified = old.id, True
                if evidence is not None:
                    history = deque(old.votes, maxlen=12)
                    history.append((old_at, *evidence))
                    while history and t_ms-history[0][0] > POLICY["maxWindowMs"]:
                        history.popleft()
                    if len(history) >= POLICY["minPairs"] and t_ms-history[0][0] >= POLICY["minWindowMs"]:
                        _, widths, heights, point_logs, _ = zip(*history)
                        nw, nh, nl = sum(widths), sum(heights), sum(point_logs)
                        box_supported = all(net >= POLICY["minNetLogGrowth"] and
                                            net >= POLICY["minBoxGrowthCoherence"]*sum(map(abs, values))
                                            for net, values in ((nw, widths), (nh, heights)))
                        if box_supported and nl >= POLICY["minNetLogGrowth"] and abs(nl-(nw+nh)/2) <= POLICY["maxBoxPointLogDifference"]:
                            events.append({"kind": "relative-optical-approach", "trackId": id_, "label": box.label,
                                           "epoch": self.epoch, "timeMs": t_ms, "pairCount": len(history),
                                           "observationMs": t_ms-history[0][0], "boxLogGrowth": (nw+nh)/2,
                                           "pointLogGrowth": nl, "lastPoints": history[-1][-1]})
            if id_ is None:
                id_ = self._next_id
                self._next_id += 1
            active.append(_Track(box, id_, history, verified))
            tracks.append({"id": id_, **box.record(w, h)})
            diagnostics["trackReasons"][str(id_)] = reason

        self._previous = frame, t_ms, gray.copy(), active
        self._previous_native = native_gray.copy() if native_gray is not None else None
        self._sleeping = resting
        return result(status, diagnostics, tracks, events)
