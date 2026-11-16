"""Frame-only native-pixel tiled detector augmentation for Mac research.

This module does not run a model, inspect reference labels, keep temporal state,
create identities, or certify motion/range. The caller must bind all four tile
observations to the same exposure and unchanged detector model/configuration.
"""

from collections import Counter
from dataclasses import dataclass
import math
from types import MappingProxyType

from assist_scene_motion import Detection
from assist_scene_roi_redetect import geometry
from assist_scene_scale_approach import _intersection, _iou


POLICY = MappingProxyType({
    "gridRows": 2, "gridColumns": 2, "tileSideFraction": .60,
    "maxTilesPerFrame": 4, "minimumTileScore": .60,
    "cropEdgeFraction": .035, "cropEdgeMinPx": 4.,
    "overlapIou": .35, "duplicateIou": .55, "containedFraction": .80,
    "maxOutputBoxes": 12, "maxTileBoxes": 12,
    "maxNativeSidePx": 4096, "maxNativePixels": 12_000_000,
    "preserveFullImageBoxes": True, "temporalState": False,
})
LABELS = frozenset({"person", "car", "truck", "bus", "bicycle", "motorcycle", "train"})


@dataclass(frozen=True)
class Tile:
    """Exact integer bounds in the original exposure, in row-major order."""
    index: int
    rect: tuple[int, int, int, int]


def _valid_box(box, width, height):
    return (isinstance(box, Detection) and isinstance(box.label, str)
            and type(box.score) in (int, float) and math.isfinite(box.score) and 0 <= box.score <= 1
            and isinstance(box.xyxy, (tuple, list)) and len(box.xyxy) == 4
            and all(type(v) in (int, float) and math.isfinite(v) for v in box.xyxy)
            and 0 <= box.xyxy[0] < box.xyxy[2] <= width
            and 0 <= box.xyxy[1] < box.xyxy[3] <= height)


def _validate_boxes(boxes, width, height, limit):
    if (not isinstance(boxes, (tuple, list)) or len(boxes) > limit
            or not all(_valid_box(box, width, height) for box in boxes)):
        raise ValueError("Malformed or excessive detector boxes")


def _area(rect):
    return (rect[2]-rect[0])*(rect[3]-rect[1])


def _related(a, b):
    """Include nested rectangles so partial boxes cannot become extra objects."""
    return (_iou(a.xyxy, b.xyxy) >= POLICY["overlapIou"]
            or _intersection(a.xyxy, b.xyxy)/min(_area(a.xyxy), _area(b.xyxy))
            >= POLICY["containedFraction"])


class TiledDetector:
    """Stateless, label-independent four-tile planner and conservative merger."""

    def plan(self, native_shape, working_shape):
        geometry(native_shape, working_shape)
        nh, nw = native_shape
        tw = math.ceil(nw*POLICY["tileSideFraction"])
        th = math.ceil(nh*POLICY["tileSideFraction"])
        return [Tile(i, (x, y, x+tw, y+th))
                for i, (x, y) in enumerate((
                    (0, 0), (nw-tw, 0), (0, nh-th), (nw-tw, nh-th)))]

    def merge(self, current, tiles, tile_detections, native_shape, working_shape):
        sx, sy = geometry(native_shape, working_shape)
        height, width = working_shape
        _validate_boxes(current, width, height, POLICY["maxOutputBoxes"])
        # Only this frozen frame-wide plan is allowed; arbitrary or repeated ROI
        # crops could silently introduce a label-driven recovery strategy.
        if (not isinstance(tiles, (list, tuple))
                or not all(isinstance(tile, Tile) and type(tile.index) is int
                           and isinstance(tile.rect, tuple) and len(tile.rect) == 4
                           and all(type(value) is int for value in tile.rect) for tile in tiles)
                or list(tiles) != self.plan(native_shape, working_shape)
                or not isinstance(tile_detections, (list, tuple)) or len(tile_detections) != len(tiles)):
            raise ValueError("Expected the exact bound four-tile plan")
        reasons = Counter()
        candidates = []
        for tile, detections in zip(tiles, tile_detections, strict=True):
            x, y, right, bottom = tile.rect
            tw, th = right-x, bottom-y
            _validate_boxes(detections, tw, th, POLICY["maxTileBoxes"])
            margin = max(POLICY["cropEdgeMinPx"], min(tw, th)*POLICY["cropEdgeFraction"])
            for local_index, det in enumerate(detections):
                if det.label not in LABELS or det.score < POLICY["minimumTileScore"]:
                    reasons["class-or-score"] += 1
                    continue
                dx, dy, dr, db = det.xyxy
                # Abstain at artificial crop boundaries, not original sensor
                # boundaries; ordinary downstream truncation gates still apply.
                if (x > 0 and dx < margin or y > 0 and dy < margin
                        or right < native_shape[1] and tw-dr < margin
                        or bottom < native_shape[0] and th-db < margin):
                    reasons["artificial-crop-edge"] += 1
                    continue
                mapped = Detection(det.label, det.score,
                                   ((x+dx)/sx, (y+dy)/sy, (x+dr)/sx, (y+db)/sy))
                candidates.append((mapped, tile.index, local_index, det.xyxy))

        # Reject all involved crop-only alternatives when two overlapping
        # observations disagree in class or shape. Never relabel a full box.
        rejected = set()
        for i, (candidate, _, _, _) in enumerate(candidates):
            related_full = [box for box in current if _related(candidate, box)]
            if related_full:
                reasons["full-image-conflict" if any(box.label != candidate.label for box in related_full)
                        else "full-image-duplicate"] += 1
                rejected.add(i)
            for j in range(i):
                other = candidates[j][0]
                if _related(candidate, other) and (candidate.label != other.label
                        or _iou(candidate.xyxy, other.xyxy) < POLICY["duplicateIou"]):
                    rejected.update((i, j))
        reasons["ambiguous-tile-candidates"] = sum(i in rejected and not any(
            _related(item[0], box) for box in current) for i, item in enumerate(candidates))
        output = list(current)
        accepted = []
        ordered = sorted(enumerate(candidates), key=lambda row: (
            -row[1][0].score, row[1][1], row[1][2]))
        for i, (candidate, tile_index, local_index, local_rect) in ordered:
            if i in rejected:
                continue
            if any(_related(candidate, box) for box in output):
                reasons["tile-duplicate"] += 1
                continue
            if len(output) >= POLICY["maxOutputBoxes"]:
                reasons["output-budget"] += 1
                continue
            output_index = len(output)
            output.append(candidate)
            accepted.append({"outputIndex": output_index, "tileIndex": tile_index,
                             "tileDetectionIndex": local_index, "localRect": list(local_rect),
                             "mappedRect": list(candidate.xyxy), "label": candidate.label,
                             "score": candidate.score})
        return output, {"accepted": len(accepted), "fullImageCount": len(current),
                        "candidateCount": len(candidates), "reasons": dict(reasons),
                        "acceptedSources": accepted,
                        "outputSources": ([{"kind": "full-image", "index": i} for i in range(len(current))]
                                          + [{"kind": "native-tile", **item} for item in accepted])}
