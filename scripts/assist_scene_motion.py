#!/usr/bin/env python3
"""Offline MAC experiments only: motion relative to registered background, never world movement."""

import argparse
from collections import deque
from dataclasses import dataclass, field
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import platform
import re
import subprocess
import tempfile
from time import perf_counter

import cv2
import numpy as np

from assist_scene_rgb_output import render_rgb_frame


ROOT = Path(__file__).resolve().parent.parent
MIN_FRAMES = 4
MAX_VIDEO_BYTES = 125 * 1024**2
MAX_SIDE = 768
POLICY = {
    "minInliers": 24, "minInlierRatio": .65, "minOccupiedCells": 5,
    "minAxisSpan": .42, "minHullFraction": .10, "maxMedianErrorPixelsAt768": 1.8,
    "maxRotationDeg": 12, "minScale": .88, "maxScale": 1.12, "maxTranslationDiagonal": .24,
    "minSteps": 3, "minPersistenceMs": 480, "maxHistoryMs": 1050, "maxGapMs": 300,
    "minDisplacementDiagonal": .013, "minDisplacementObjectDiagonal": .10, "minCoherence": .75,
    "localInsetFraction": .18, "localMinPoints": 6, "localMinConsensus": .65,
    "localSpanFraction": .16, "localMinAlongPixelsAt768": 1.8, "localDirectionCosine": .65,
    "localWindowSteps": 3, "localMinAgree": 2, "localMinSummedAgreementFraction": .25,
}


def sha256(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def elapsed(start):
    return round((perf_counter() - start) * 1000, 3)


@dataclass(frozen=True)
class Detection:
    label: str
    score: float
    xyxy: tuple[float, float, float, float]

    def record(self, w, h):
        x1, y1, x2, y2 = self.xyxy
        return {"label": self.label, "score": self.score,
                "box": {"x": x1 / w, "y": y1 / h, "width": (x2 - x1) / w, "height": (y2 - y1) / h}}


def mask_for(shape, detections):
    h, w = shape
    mask = np.full(shape, 255, np.uint8)
    pad = max(2, round(max(shape) * .010))
    for detection in detections:
        a, b, c, d = detection.xyxy
        dx = max(pad, round((c - a) * .12))
        dy = max(pad, round((d - b) * .12))
        mask[max(0, math.floor(b) - dy):min(h, math.ceil(d) + dy),
             max(0, math.floor(a) - dx):min(w, math.ceil(c) + dx)] = 0
    return mask


def apply(matrix, points):
    return points @ matrix[:, :2].T + matrix[:, 2]


def occupy(points, w, h):
    return len({(min(3, int(x * 4 / w)), min(2, int(y * 3 / h))) for x, y in points})


def registered(prev, current, previous_boxes, boxes):
    """Return ((prev→now affine) or None, quality diagnostics)."""
    if prev.shape != current.shape:
        return None, {"status": "dimensions-changed"}
    h, w = current.shape
    diag = math.hypot(w, h)
    q = {}

    def fail(status):
        return None, {"status": status, **q}

    first_mask, last_mask = mask_for(prev.shape, previous_boxes), mask_for(current.shape, boxes)
    q["unmaskedFraction"] = [float(np.count_nonzero(m) / m.size) for m in (first_mask, last_mask)]
    if min(q["unmaskedFraction"]) < .20:
        return fail("insufficient-background")
    initial = cv2.goodFeaturesToTrack(prev, maxCorners=420, qualityLevel=.012,
                                      minDistance=max(4, round(max(w, h) * .009)),
                                      mask=first_mask, blockSize=7)
    if initial is None or len(initial) < POLICY["minInliers"]:
        return fail("low-texture")
    flow_options = {"winSize": (23, 23), "maxLevel": 3,
                    "criteria": (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, .01)}
    end, good, _ = cv2.calcOpticalFlowPyrLK(prev, current, initial, None, **flow_options)
    if end is None or good is None:
        return fail("forward-flow")
    back, reversed_good, _ = cv2.calcOpticalFlowPyrLK(current, prev, end, None, **flow_options)
    if back is None or reversed_good is None:
        return fail("backward-flow")
    source, target, rewind = initial[:, 0], end[:, 0], back[:, 0]
    keep = (good[:, 0] == 1) & (reversed_good[:, 0] == 1) & np.isfinite(target).all(axis=1)
    keep &= np.linalg.norm(source - rewind, axis=1) < max(.8, 1.6 * max(w, h) / 768)
    source, target = source[keep], target[keep]
    xy = np.rint(target).astype(np.int32)
    inside = (xy[:, 0] >= 0) & (xy[:, 1] >= 0) & (xy[:, 0] < w) & (xy[:, 1] < h)
    source, target, xy = source[inside], target[inside], xy[inside]
    clean = last_mask[xy[:, 1], xy[:, 0]] != 0
    source, target = source[clean], target[clean]
    q["matchedPoints"] = len(source)
    if len(source) < POLICY["minInliers"]:
        return fail("too-few-consistent-points")

    matrix, inliers = cv2.estimateAffinePartial2D(
        source, target, method=cv2.RANSAC, ransacReprojThreshold=max(1.3, 2.5 * max(w, h) / 768),
        maxIters=2000, confidence=.995, refineIters=10)
    if matrix is None or inliers is None or not np.isfinite(matrix).all():
        return fail("no-background-model")
    used = inliers.ravel().astype(bool)
    q["inliers"] = int(np.count_nonzero(used))
    q["inlierRatio"] = q["inliers"] / len(source)
    if q["inliers"] < POLICY["minInliers"] or q["inlierRatio"] < POLICY["minInlierRatio"]:
        return fail("weak-consensus")
    source, target = source[used], target[used]
    q["gridCells"] = min(occupy(source, w, h), occupy(target, w, h))
    q["minAxisSpan"] = float(min(*(np.ptp(source, axis=0) / (w, h)), *(np.ptp(target, axis=0) / (w, h))))
    q["hullFraction"] = min(float(cv2.contourArea(cv2.convexHull(points)) / (w * h))
                            for points in (source, target))
    if (q["gridCells"] < POLICY["minOccupiedCells"] or q["minAxisSpan"] < POLICY["minAxisSpan"]
            or q["hullFraction"] < POLICY["minHullFraction"]):
        return fail("localized-consensus")
    q["medianErrorPixels"] = float(np.median(np.linalg.norm(apply(matrix, source) - target, axis=1)))
    if q["medianErrorPixels"] > max(.9, POLICY["maxMedianErrorPixelsAt768"] * max(w, h) / 768):
        return fail("high-residual")
    q["scale"] = math.hypot(matrix[0, 0], matrix[1, 0])
    q["rotationDeg"] = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
    center = np.array([[w / 2, h / 2]])
    q["centerTranslationPixels"] = float(np.linalg.norm(apply(matrix, center) - center))
    if (not POLICY["minScale"] <= q["scale"] <= POLICY["maxScale"]
            or abs(q["rotationDeg"]) > POLICY["maxRotationDeg"]
            or q["centerTranslationPixels"] > diag * POLICY["maxTranslationDiagonal"]):
        return fail("excessive-transform")

    # Photometric cut check complements inlier ratio: a small accidentally
    # aligned repeated pattern cannot explain an otherwise unrelated image.
    aligned = cv2.warpAffine(prev, matrix, (w, h))[::3, ::3].astype(np.float32)
    allowed = (cv2.warpAffine(first_mask, matrix, (w, h), flags=cv2.INTER_NEAREST)[::3, ::3] > 0)
    allowed &= last_mask[::3, ::3] > 0
    q["alignedBackgroundFraction"] = float(np.mean(allowed))
    if q["alignedBackgroundFraction"] < .15:
        return fail("insufficient-overlap")
    residual = current[::3, ::3][allowed].astype(np.float32) - aligned[allowed]
    q["photometricMedianError"] = float(np.median(np.abs(residual - np.median(residual))))
    q["photometricBadFraction"] = float(np.mean(np.abs(residual - np.median(residual)) > 35))
    if q["photometricMedianError"] > 22 or q["photometricBadFraction"] > .33:
        return fail("cut-or-background-mismatch")
    return matrix, {"status": "valid", **q, "affinePrevToCurrent": matrix.tolist()}


def box_center(box):
    a, b, c, d = box
    return np.array([(a + c) / 2, (b + d) / 2])


def box_diag(box):
    a, b, c, d = box
    return math.hypot(c - a, d - b)


def box_iou(a, b):
    area = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    return area / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - area)


def warp_box(matrix, old):
    a, b, c, d = old
    warped = apply(matrix, np.array([[a, b], [a, d], [c, b], [c, d]]))
    return (*np.min(warped, axis=0), *np.max(warped, axis=0))


def local_residual(prev, current, old_box, new_box, matrix, box_flow):
    """Independent RGB-pixel displacement; bbox only selects interior and axis.

    Limit LK to the joint ROI plus a support border. Initial target points are
    seeded from *background* homography, not shifted with detector boxes. A
    detector moving over a static surface cannot vote for its own displacement.
    """
    if prev is None or current is None or prev.shape != current.shape:
        return None
    h, w = current.shape
    floor = max(1.0, POLICY["localMinAlongPixelsAt768"] * max(w, h) / 768)
    norm = float(np.linalg.norm(box_flow))
    if norm < floor:
        return None
    unit = box_flow / norm

    def interior(box):
        left, top, right, bottom = box
        frac = POLICY["localInsetFraction"]
        xx, yy = (right-left) * frac, (bottom-top) * frac
        return left+xx, top+yy, right-xx, bottom-yy

    a, b = interior(old_box), interior(new_box)
    if min(a[2]-a[0], a[3]-a[1], b[2]-b[0], b[3]-b[1]) < 9:
        return None
    pad = 20
    x0, y0 = max(0, math.floor(min(a[0], b[0]))-pad), max(0, math.floor(min(a[1], b[1]))-pad)
    x1, y1 = min(w, math.ceil(max(a[2], b[2]))+pad), min(h, math.ceil(max(a[3], b[3]))+pad)
    before, after = prev[y0:y1, x0:x1], current[y0:y1, x0:x1]
    offset = np.array([x0, y0], np.float32)
    mask = np.zeros(before.shape, np.uint8)
    mask[max(0, math.ceil(a[1])-y0):math.floor(a[3])-y0,
         max(0, math.ceil(a[0])-x0):math.floor(a[2])-x0] = 255
    source = cv2.goodFeaturesToTrack(before, maxCorners=48, qualityLevel=.018, minDistance=3,
                                    mask=mask, blockSize=5)
    min_points = POLICY["localMinPoints"]
    if source is None or len(source) < min_points:
        return None
    background = apply(matrix, source[:, 0] + offset) - offset
    initial = background.astype(np.float32).reshape(-1, 1, 2)
    options = {"winSize": (15, 15), "maxLevel": 2,
               "criteria": (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, .01)}
    target, found, _ = cv2.calcOpticalFlowPyrLK(before, after, source, initial,
                                              flags=cv2.OPTFLOW_USE_INITIAL_FLOW, **options)
    if target is None or found is None:
        return None
    back, refound, _ = cv2.calcOpticalFlowPyrLK(after, before, target, source.copy(),
                                              flags=cv2.OPTFLOW_USE_INITIAL_FLOW, **options)
    if back is None or refound is None:
        return None
    source, target, back = source[:, 0], target[:, 0], back[:, 0]
    targets_full = target + offset
    keep = (found[:, 0] == 1) & (refound[:, 0] == 1) & np.isfinite(target).all(axis=1)
    keep &= np.linalg.norm(back-source, axis=1) < max(.9, 1.6 * max(w, h) / 768)
    keep &= (b[0] <= targets_full[:, 0]) & (targets_full[:, 0] <= b[2])
    keep &= (b[1] <= targets_full[:, 1]) & (targets_full[:, 1] <= b[3])
    if np.count_nonzero(keep) < min_points:
        return None
    flow = (target - background)[keep]
    along = flow @ unit
    # Include stationary valid points in the denominator. A few moving
    # pixels over a stationary interior never become a coherent majority.
    agreement = (along >= floor) & (along >= POLICY["localDirectionCosine"] * np.linalg.norm(flow, axis=1))
    n = int(np.count_nonzero(agreement))
    if n < min_points or n / len(flow) < POLICY["localMinConsensus"]:
        return None
    for coords, bounds in ((source[keep][agreement], a), (target[keep][agreement], b)):
        span = np.ptp(coords, axis=0) / (bounds[2]-bounds[0], bounds[3]-bounds[1])
        if min(span) < POLICY["localSpanFraction"]:
            return None
    return np.median(flow[agreement], axis=0), n


@dataclass
class Track:
    id: int
    box: Detection
    time_ms: float
    steps: deque = field(default_factory=lambda: deque(maxlen=8))
    observations: int = 1


def score_motion(steps, index, box, diagonal, require_local=False):
    if len(steps) < POLICY["minSteps"]:
        return None
    data = np.array([step[index] for step in steps])
    since, upto = steps[0][0], steps[-1][1]
    if upto - since < POLICY["minPersistenceMs"]:
        return None
    vector = np.sum(data, axis=0)
    total = float(np.sum(np.linalg.norm(data, axis=1)))
    distance = float(np.linalg.norm(vector))
    floor = max(diagonal * POLICY["minDisplacementDiagonal"], box_diag(box) * POLICY["minDisplacementObjectDiagonal"])
    if distance < floor or not total or distance / total < POLICY["minCoherence"]:
        return None
    # Do not re-report old motion as if it were still occurring.
    if float(np.dot(np.sum(data[-2:], axis=0), vector / distance)) < floor * .25:
        return None
    direction = ("image-right" if vector[0] > 0 else "image-left") if abs(vector[0]) >= abs(vector[1]) else (
                 "image-down" if vector[1] > 0 else "image-up")
    result = {"direction": direction, "netPixels": distance, "travelPixels": total,
            "coherence": distance / total, "durationMs": round(upto - since, 3),
            "netFrameDiagonalFraction": distance / diagonal}
    if not require_local:
        return result
    unit = vector / distance
    window = list(steps)[-POLICY["localWindowSteps"]:]
    valid = []
    for step in window:
        if step[4] is not None:
            motion, n = step[4]
            along = float(motion @ unit)
            if along >= POLICY["localDirectionCosine"] * float(np.linalg.norm(motion)):
                valid.append((step[1], along, n))
    if (len(valid) < POLICY["localMinAgree"] or valid[-1][0] != upto
            or sum(x[1] for x in valid) < floor * POLICY["localMinSummedAgreementFraction"]):
        return None
    return {**result, "localEvidence": {"agreeingSteps": len(valid), "windowSteps": len(window),
            "minSupportingPoints": min(x[2] for x in valid), "positiveAxisPixels": sum(x[1] for x in valid)}}


class MotionState:
    def __init__(self):
        self.tracks = []
        self.next_id = 1
        self.pose = np.eye(3)
        self.epoch = 0

    def update(self, boxes, matrix, at_ms, width, height, prev=None, current=None):
        diag = math.hypot(width, height)
        if matrix is None or any(not 0 < at_ms - t.time_ms <= POLICY["maxGapMs"] for t in self.tracks):
            self.tracks = []
            self.pose = np.eye(3)
            self.epoch += 1
            matrix = None
        if matrix is not None:
            jump = np.eye(3)
            jump[:2] = matrix
            self.pose = jump @ self.pose
            pose_rotation = self.pose[:2, :2] / math.hypot(self.pose[0, 0], self.pose[1, 0])
            common_axes = pose_rotation.T
        else:
            common_axes = np.eye(2)
        candidates, by_old, by_new = [], {}, {}
        if matrix is not None:
            for i, track in enumerate(self.tracks):
                prediction = warp_box(matrix, track.box.xyxy)
                for j, box in enumerate(boxes):
                    if box.label != track.box.label:
                        continue
                    jump = float(np.linalg.norm(box_center(prediction) - box_center(box.xyxy)))
                    limit = min(diag * .12, max(diag * .025, box_diag(prediction) * .55))
                    ratio = box_diag(box.xyxy) / box_diag(prediction)
                    overlap = box_iou(prediction, box.xyxy)
                    if jump > limit or not .62 <= ratio <= 1.62 or (overlap < .08 and jump > limit * .62):
                        continue
                    cost = jump / limit + .5 * (1 - overlap)
                    candidates.append((cost, i, j))
                    by_old.setdefault(i, []).append(cost)
                    by_new.setdefault(j, []).append(cost)
        new, used = {}, set()
        for cost, i, j in sorted(candidates):
            if i in used or j in new or any(
                sum(abs(other - cost) < .14 for other in choices) != 1 for choices in (by_old[i], by_new[j])
            ):
                continue
            old, box = self.tracks[i], boxes[j]
            old_center, center = box_center(old.box.xyxy), box_center(box.xyxy)
            fr = apply(matrix, old_center.reshape(1, 2))[0]
            local = local_residual(prev, current, old.box.xyxy, box.xyxy, matrix, center-fr)
            local = (common_axes @ local[0], local[1]) if local is not None else None
            old.steps.append((old.time_ms, at_ms, common_axes @ (center - fr), common_axes @ (center - old_center), local))
            while old.steps and at_ms - old.steps[0][0] > POLICY["maxHistoryMs"]:
                old.steps.popleft()
            old.box, old.time_ms = box, at_ms
            old.observations += 1
            new[j] = old
            used.add(i)
        for j, box in enumerate(boxes):
            if j not in new:
                new[j] = Track(self.next_id, box, at_ms)
                self.next_id += 1
        self.tracks = [new[j] for j in range(len(boxes))]
        track_records, compensated, naive, bbox_compensated = [], [], [], []
        for item in self.tracks:
            track_records.append({"id": item.id, "observations": item.observations, **item.box.record(width, height)})
            for index, collection in ((2, compensated), (3, naive)):
                evidence = score_motion(item.steps, index, item.box.xyxy, diag)
                if evidence:
                    if index == 2:
                        bbox_compensated.append({"trackId": item.id, "label": item.box.label, **evidence})
                        evidence = score_motion(item.steps, index, item.box.xyxy, diag, require_local=True)
                    if evidence:
                        collection.append({"trackId": item.id, "label": item.box.label, **evidence})
        return track_records, compensated, naive, bbox_compensated


def read_manifest(path):
    if not path.is_file() or path.stat().st_size > 256 * 1024:
        raise ValueError("Missing or over-budget manifest")
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict) or type(raw.get("schemaVersion")) is not int or raw["schemaVersion"] != 1:
        raise ValueError("Expected schemaVersion=1")
    asset = raw.get("assetRoot", ".")
    if not isinstance(asset, str) or not asset or Path(asset).is_absolute():
        raise ValueError("assetRoot must be relative to manifest")
    folder = (path.resolve().parent / asset).resolve(strict=True)
    clips = raw.get("clips")
    if not folder.is_dir() or not isinstance(clips, list) or not 1 <= len(clips) <= 16:
        raise ValueError("Expected 1–16 clips under assetRoot")
    seen = set()
    results = []
    for row in clips:
        if not isinstance(row, dict):
            raise ValueError("Invalid clip")
        key, name, digest, frequency = row.get("id"), row.get("path"), row.get("sha256"), row.get("sampleFps", 5)
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", key) or key in seen:
            raise ValueError("Invalid/duplicate clip ID")
        if not isinstance(name, str) or not name or len(name) > 300:
            raise ValueError("Invalid clip file")
        path_token = Path(name)
        if path_token.is_absolute() or ".." in path_token.parts or path_token.suffix.lower() != ".mp4":
            raise ValueError("Expected relative MP4 clip")
        video = (folder / path_token).resolve(strict=True)
        if not video.is_relative_to(folder) or not video.is_file() or not 1 <= video.stat().st_size <= MAX_VIDEO_BYTES:
            raise ValueError("Invalid, out-of-root or over-budget clip")
        if type(frequency) is not int or frequency not in (5, 6) or not isinstance(digest, str) or not re.fullmatch("[0-9a-f]{64}", digest):
            raise ValueError("Expected sampleFps=5|6 and pinned SHA-256")
        seen.add(key)
        results.append((key, video, name, digest, frequency))
    return results


def decode(path, sample_hz, work):
    # Local path-only, no camera device or URL input. Sequential decode avoids
    # imprecise seek/GOP behavior and supplies the source frame index.
    capture = cv2.VideoCapture(str(path))
    items = []
    try:
        if not capture.isOpened():
            raise ValueError("Unable to open local MP4")
        source_fps = capture.get(cv2.CAP_PROP_FPS)
        count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        if not (math.isfinite(source_fps) and sample_hz <= source_fps <= 60 and math.isfinite(count)
                and count.is_integer() and 3 <= count / source_fps <= 6):
            raise ValueError("Expected declared 3–6 second clip at sample fps to 60 fps")
        index, next_output = 0, 0
        observed_msec = previous_msec = None
        advancing_msec = False
        while index < int(count):
            ok, image = capture.read()
            if not ok:
                raise ValueError("Decoded fewer frames than the CFR header")
            pts = capture.get(cv2.CAP_PROP_POS_MSEC)
            if observed_msec is None:
                observed_msec = pts
            elif math.isfinite(pts) and math.isfinite(previous_msec) and pts > previous_msec + .1:
                advancing_msec = True
            if advancing_msec and (not math.isfinite(pts) or pts <= previous_msec
                    or abs((pts - observed_msec) - 1000 * index / source_fps) > min(35, 650/source_fps)):
                raise ValueError("Media timestamp discontinuity or declared CFR disagrees with decoder")
            previous_msec = pts
            if index >= math.floor(next_output * source_fps / sample_hz + .5):
                h, w = image.shape[:2]
                if not 2 <= h <= 4096 or not 2 <= w <= 4096 or h * w > 9_000_000:
                    raise ValueError("Decoded frame exceeds budget")
                if max(w, h) > MAX_SIDE:
                    scale = MAX_SIDE / max(w, h)
                    image = cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
                output = work / f"{next_output:03d}.jpg"
                if not cv2.imwrite(str(output), image, [cv2.IMWRITE_JPEG_QUALITY, 93]):
                    raise RuntimeError("Temporary SceneQA JPEG write failed")
                items.append((index, index / source_fps * 1000, output))
                next_output += 1
            index += 1
        if capture.grab():
            raise ValueError("Decoded more frames than the CFR header")
        if not MIN_FRAMES <= len(items) <= 64:
            raise ValueError("Invalid count of sampled JPEGs")
        return items, {"sourceFps": source_fps, "declaredFrames": int(count), "sampleFps": sample_hz,
                       "timestampBasis": "declared-CFR-index+decoder-pts-crosscheck" if advancing_msec else "declared-CFR-index; decoder PTS unavailable",
                       "decoder": capture.getBackendName()}
    finally:
        capture.release()


def parse_detect(report, w, h):
    boxes = report["tracks"]
    if (report["width"], report["height"], report["orientation"]) != (w, h, 1) or not isinstance(boxes, list) or len(boxes) > 12:
        raise ValueError("Mismatched detector frame geometry or budget")
    observed = []
    for box in boxes:
        label, score, bounds = box["label"], box["score"], box["box"]
        if not isinstance(label, str) or not re.fullmatch(r"[a-z0-9][a-z0-9 -]{0,39}", label):
            raise ValueError("Invalid detector label")
        x, y, bw, bh = (bounds[k] for k in ("x", "y", "width", "height"))
        if (not all(type(v) in (float, int) and math.isfinite(v) and 0 <= v <= 1 for v in (x,y,bw,bh,score))
                or bw <= 0 or bh <= 0 or x + bw > 1.000001 or y + bh > 1.000001):
            raise ValueError("Malformed normalized detector box")
        observed.append(Detection(label, score, (x*w, y*h, min(w, (x+bw)*w), min(h, (y+bh)*h))))
    return observed


def run_clip(clip, sceneqa, yolo, work):
    key, path, public_name, digest, frequency = clip
    if sha256(path) != digest:
        raise ValueError(f"Clip hash mismatch: {key}")
    started = perf_counter()
    items, source = decode(path, frequency, work)
    decode_ms = elapsed(started)
    started = perf_counter()
    proc = subprocess.run([str(sceneqa), str(yolo), *(str(p) for _, _, p in items)],
                          capture_output=True, text=True, check=False, timeout=180)
    if proc.returncode:
        raise RuntimeError(f"SceneQA {key}: {proc.stderr[-2000:]}")
    detector_wall_ms = elapsed(started)
    detector = json.loads(proc.stdout)
    images = detector["images"]
    by_path = {Path(report["path"]): report for report in images}
    if detector.get("schemaVersion") != 1 or len(images) != len(items) or set(by_path) != {p for _, _, p in items}:
        raise ValueError("Detector results unexpectedly bound to different input JPEGs")
    tracker, previous, previous_boxes, previous_at = MotionState(), None, [], None
    output = []
    for source_index, at_ms, image_path in items:
        image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise ValueError("Prepared JPEG read failed")
        h, w = image.shape
        report = by_path[image_path]
        boxes = parse_detect(report, w, h)
        started = perf_counter()
        if previous is None:
            matrix, diagnostics = None, {"status": "first-frame"}
        elif at_ms - previous_at > POLICY["maxGapMs"]:
            matrix, diagnostics = None, {"status": "frame-gap"}
        else:
            matrix, diagnostics = registered(previous, image, previous_boxes, boxes)
        registration_ms = elapsed(started)
        started = perf_counter()
        tracks, comp, naive, bbox = tracker.update(boxes, matrix, at_ms, w, h, previous, image)
        association_ms = elapsed(started)
        bound = {"epoch": tracker.epoch, "timeMs": round(at_ms, 3)}
        comp = [{**bound, **row} for row in comp]
        naive = [{**bound, **row} for row in naive]
        output.append({**bound, "sourceFrameIndex": source_index, "width": w, "height": h,
                       "registration": diagnostics, "tracks": tracks,
                       "compensatedEvents": comp, "naiveEvents": naive,
                       "bboxCompensatedEvents": [{**bound, **row} for row in bbox],
                       "answers": render_rgb_frame(time_ms=bound["timeMs"], epoch=tracker.epoch,
                                                   registration_valid=diagnostics["status"] == "valid",
                                                   tracks=tracks, compensated_events=comp),
                       "timing": {"detectorMs": report["detectionMs"], "registrationMs": registration_ms,
                                  "associationMs": association_ms}})
        previous, previous_boxes, previous_at = image, boxes, at_ms
    summary = {
        "sampledFrames": len(output), "registrationAttempts": len(output)-1,
        "registrationValid": sum(row["registration"]["status"] == "valid" for row in output),
        "registrationStatusCounts": {status: sum(row["registration"]["status"] == status for row in output)
                                     for status in sorted({row["registration"]["status"] for row in output})},
        "compensatedEventFrames": sum(bool(row["compensatedEvents"]) for row in output),
        "naiveEventFrames": sum(bool(row["naiveEvents"]) for row in output),
        "bboxCompensatedEventFrames": sum(bool(row["bboxCompensatedEvents"]) for row in output),
        "compensatedEventDetections": sum(len(row["compensatedEvents"]) for row in output),
        "naiveEventDetections": sum(len(row["naiveEvents"]) for row in output),
        "bboxCompensatedEventDetections": sum(len(row["bboxCompensatedEvents"]) for row in output),
    }
    return {"id": key, "path": public_name, "sha256": digest, **source, "summary": summary,
            "detectorConfiguration": detector["configuration"], "detectorModelLoadMs": detector["modelLoadMs"],
            "detectorWallMs": detector_wall_ms, "decodeAndPrepareMs": decode_ms, "frames": output}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--sceneqa", type=Path, required=True)
    parser.add_argument("--yolo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--case", action="append", help="Optional repeatable clip ID filter")
    args = parser.parse_args()
    manifest = args.manifest.resolve(strict=True)
    clips = read_manifest(manifest)
    sceneqa, yolo = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    if args.output.exists() or args.output.is_symlink() or not args.output.parent.is_dir():
        raise ValueError("Expected a new receipt path in an existing directory")
    if args.case:
        if set(args.case) - {c[0] for c in clips}:
            raise ValueError("Unknown clip ID in --case")
        clips = [c for c in clips if c[0] in args.case]
    cv2.setNumThreads(1)
    reports = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-motion-{date.today():%Y%m%d}-", dir=args.output.parent) as work:
        for i, clip in enumerate(clips):
            # RNG is reset per clip so clip order/subset cannot change matches.
            cv2.setRNGSeed(2216)
            sub = Path(work).resolve() / str(i)
            sub.mkdir()
            reports.append(run_clip(clip, sceneqa, yolo, sub))
    receipt = {
        "schemaVersion": 1, "experiment": "TIP-65-M3-Mac",
        "platform": platform.platform(), "cv2": cv2.__version__, "numpy": np.__version__,
        "manifestSha256": sha256(manifest), "runnerSha256": sha256(Path(__file__)),
        "answerCodeSha256": {name: sha256(Path(__file__).with_name(name)) for name in (
            "assist_scene_evidence.py", "assist_scene_rgb_output.py")},
        "detectorCliSha256": sha256(sceneqa),
        "detectorSourceSha256": sha256(ROOT / "native/ios/SceneQA/main.swift"),
        "policy": POLICY, "clips": reports, "caseSubset": args.case,
        "limits": "Offline controlled CFR clips; no phone/real-time/voice/ranging. Events are repeated frame observations of relative motion, not unique world events. Naive and bbox-only are box diagnostics on the same matched IDs and valid background-registration support. Published relative motion additionally requires object-interior flow.",
    }
    with args.output.open("x", encoding="utf-8") as f:
        f.write(json.dumps(receipt, allow_nan=False, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
