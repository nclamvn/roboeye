#!/usr/bin/env python3
"""Local, conservative image-space baseline for RoboEye Court review.

This is NOT an AI referee: colour/motion candidates are not ball identity proof,
an image line is not calibrated ground geometry, and no contact is inferred.
No trained weights, network requests, trajectory gap-filling or distance model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import time

import cv2
import numpy as np


SCHEMA = "roboeye-court-session-v1"
METHOD_VERSION = "1.1.0"
MAX_BYTES = 500 * 1024 * 1024
MAX_SECONDS = 300.0
MAX_FRAMES = 20_000
MAX_PIXELS = 4096 * 2160
MAX_CANDIDATES = 12


class CourtAnalysisError(ValueError):
    """The source cannot be analysed inside the declared M1 budget."""


def source_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _working_image(frame: np.ndarray) -> tuple[np.ndarray, float]:
    height, width = frame.shape[:2]
    scale = min(1.0, 1280.0 / max(height, width))
    if scale < 1:
        frame = cv2.resize(frame, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    return frame, scale


def image_candidates(frame: np.ndarray, previous: np.ndarray | None) -> list[dict]:
    """Return bounded yellow/green components with current-frame motion support.

    Thresholds are fixed baseline heuristics, not a trained/calibrated posterior.
    Static white lights and stationary colour patches have no motion support.
    The previous image is used only to check observed pixel change, not to
    extrapolate a missing ball. Components may still be clothing or other objects.
    """
    if previous is None:
        return []
    image, scale = _working_image(frame)
    previous_image, _ = _working_image(previous)
    if image.shape != previous_image.shape:
        return []
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    coloured = cv2.inRange(hsv, (19, 105, 115), (49, 255, 255))
    difference = cv2.absdiff(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), cv2.cvtColor(previous_image, cv2.COLOR_BGR2GRAY))
    motion = difference >= 20
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(coloured, connectivity=8)
    height, width = image.shape[:2]
    min_area = 2
    max_area = max(64, width * height * 0.00035)
    max_length = max(20, width * 0.045)
    # Tighten spatial evidence, without widening the hue/saturation, motion,
    # acceptance or ambiguity gates. Compressed/striped clothing can break a
    # single large coloured region into many tiny high-scoring components.
    # Closing is used for CONTEXT only: original component pixels and centroid
    # stay unchanged. Reject fragments belonging to a large context group and
    # groups with fewer than six coloured/context pixels. This can also refuse
    # a genuine ball immediately touching similarly coloured clothing: abstain.
    context = cv2.bitwise_or(coloured, cv2.morphologyEx(coloured, cv2.MORPH_CLOSE,
                             cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))))
    _, context_labels, context_stats, _ = cv2.connectedComponentsWithStats(context, connectivity=8)
    candidates = []
    for label in range(1, count):
        x, y, w, h, area = (int(value) for value in stats[label])
        if not min_area <= area <= max_area or max(w, h) > max_length or min(w, h) == 0:
            continue
        if max(w, h) / min(w, h) > 8:
            continue
        component = labels[y:y + h, x:x + w] == label
        local_y, local_x = np.argwhere(component)[0]
        context_id = int(context_labels[y + local_y, x + local_x])
        _, _, context_w, context_h, context_area = (int(value) for value in context_stats[context_id])
        if context_id == 0 or context_area < 6 or context_area > max_area or max(context_w, context_h) > max_length:
            continue
        motion_support = float(np.count_nonzero(motion[y:y + h, x:x + w] & component)) / area
        if motion_support < 0.15:
            continue
        fill = area / (w * h)
        if fill < 0.16:
            continue
        # Retain elongated motion blur as a candidate, but lower its ranking.
        compactness = min(w, h) / max(w, h)
        confidence = min(0.96, 0.32 + 0.40 * motion_support + 0.16 * compactness + 0.10 * fill)
        cx, cy = (float(value) / scale for value in centroids[label])
        candidates.append({
            "x": round(cx, 3), "y": round(cy, 3),
            "radius": round(max(1.0, math.sqrt(area / math.pi)) / scale, 3),
            "confidence": round(confidence, 4),
            "box": [round(value / scale, 3) for value in (x, y, w, h)],
        })
    candidates.sort(key=lambda item: (-item["confidence"], item["y"], item["x"]))
    return candidates[:MAX_CANDIDATES]


def observe_frame(frame: np.ndarray, previous: np.ndarray | None, index: int, fps: float,
                  previous_ball: dict | None = None) -> dict:
    candidates = image_candidates(frame, previous)
    result = {
        "index": index, "timeSeconds": round(index / fps, 6),
        "status": "missing", "ball": None, "candidates": candidates,
        "reason": "Không có ứng viên màu/chuyển động đủ hỗ trợ trong khung này.",
    }
    if previous is None:
        result["reason"] = "Khung đầu chưa có ảnh trước để kiểm chuyển động."
        return result
    if not candidates:
        return result
    ranked = [(candidate["confidence"], candidate) for candidate in candidates]
    if previous_ball is not None:
        # Image association is used only between immediately adjacent observations.
        # No velocity prediction, stale coordinates or bridging missing frames.
        diagonal = math.hypot(frame.shape[1], frame.shape[0])
        radius = max(35.0, diagonal * 0.12)
        ranked = [(score + (0.08 if math.hypot(candidate["x"] - previous_ball["x"], candidate["y"] - previous_ball["y"]) < radius else 0), candidate)
                  for score, candidate in ranked]
        ranked.sort(key=lambda pair: -pair[0])
    best_score, best = ranked[0]
    if best["confidence"] < 0.56:
        result["reason"] = "Ứng viên yếu; chưa đủ hỗ trợ pixel để bám bóng."
        return result
    if len(ranked) > 1 and best_score - ranked[1][0] < 0.12:
        result["status"] = "ambiguous"
        result["reason"] = "Nhiều ứng viên tương tự; không chọn thay người xem."
        return result
    result.update(status="observed", ball=dict(best), reason="Ứng viên màu/chuyển động được chấp nhận; chưa xác thực là bóng hoặc điểm chạm.")
    return result


def suggest_image_lines(frame: np.ndarray) -> list[dict]:
    """Draft image segments only; white net/fixtures can also produce lines."""
    image, scale = _working_image(frame)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    white = cv2.inRange(hsv, (0, 0, 165), (179, 65, 255))
    # Upper background commonly contains roof/signage; this remains a heuristic,
    # not a semantic court ROI. The UI must expose all segments as unconfirmed.
    white[:round(image.shape[0] * 0.20), :] = 0
    edges = cv2.Canny(white, 70, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=35,
                           minLineLength=max(30, round(image.shape[1] * 0.055)), maxLineGap=12)
    if lines is None:
        return []
    segments = []
    # OpenCV 4 returns Nx1x4, OpenCV 5 can return Nx4.
    for entry in np.asarray(lines).reshape(-1, 4):
        x1, y1, x2, y2 = (float(value) for value in entry)
        length = math.hypot(x2 - x1, y2 - y1)
        angle = math.atan2(y2 - y1, x2 - x1)
        if x2 < x1:
            x1, y1, x2, y2 = x2, y2, x1, y1
            angle = math.atan2(y2 - y1, x2 - x1)
        segments.append((length, angle, (x1, y1, x2, y2)))
    segments.sort(reverse=True)
    accepted = []
    for _, angle, coords in segments:
        x1, y1, x2, y2 = coords
        midpoint = np.array(((x1 + x2) / 2, (y1 + y2) / 2))
        duplicate = False
        for _, old_angle, old_coords in accepted:
            ox1, oy1, ox2, oy2 = old_coords
            vector = np.array((ox2 - ox1, oy2 - oy1))
            distance = abs(float(vector[0] * (midpoint[1] - oy1) - vector[1] * (midpoint[0] - ox1))) / max(1, np.linalg.norm(vector))
            if abs(math.sin(angle - old_angle)) < 0.045 and distance < 7:
                duplicate = True
                break
        if not duplicate:
            accepted.append((0, angle, coords))
        if len(accepted) == 14:
            break
    return [{"id": f"draft-{index + 1}", "a": [round(x1 / scale, 3), round(y1 / scale, 3)],
             "b": [round(x2 / scale, 3), round(y2 / scale, 3)],
             "provenance": "image-hough", "confirmed": False}
            for index, (_, _, (x1, y1, x2, y2)) in enumerate(accepted)]


def analyze_video(video: str | Path) -> dict:
    started = time.perf_counter()
    path = Path(video).expanduser().resolve()
    if not path.is_file():
        raise CourtAnalysisError("Video không tồn tại hoặc không phải tệp thường.")
    if path.stat().st_size > MAX_BYTES:
        raise CourtAnalysisError("Video vượt giới hạn 500 MiB của Court M1.")
    fingerprint = source_sha256(path)
    cv2.setNumThreads(1)
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise CourtAnalysisError("OpenCV không mở được video; cần tệp video giải mã được trên Mac.")
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        metadata_frames = float(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if not math.isfinite(fps) or not 1 <= fps <= 480:
            raise CourtAnalysisError("FPS video không hợp lệ; không tự đoán thời gian khung hình.")
        if metadata_frames > MAX_FRAMES or metadata_frames / fps > MAX_SECONDS:
            raise CourtAnalysisError("Video vượt giới hạn 5 phút hoặc 20.000 khung của Court M1.")
        frames = []
        previous = None
        previous_ball = None
        first = None
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if len(frames) >= MAX_FRAMES or len(frames) / fps >= MAX_SECONDS:
                raise CourtAnalysisError("Giải mã vượt giới hạn 5 phút hoặc 20.000 khung.")
            if frame.shape[0] * frame.shape[1] > MAX_PIXELS:
                raise CourtAnalysisError("Kích thước ảnh vượt giới hạn 4096×2160 pixel của Court M1.")
            if previous is not None and frame.shape != previous.shape:
                raise CourtAnalysisError("Kích thước khung thay đổi; không dùng tọa độ cũ cho nguồn khác.")
            if first is None:
                first = frame.copy()
            result = observe_frame(frame, previous, len(frames), fps, previous_ball)
            frames.append(result)
            previous_ball = result["ball"]
            previous = frame
        if first is None:
            raise CourtAnalysisError("Video không có khung hình giải mã được.")
        if metadata_frames > 0 and len(frames) < int(metadata_frames):
            raise CourtAnalysisError(f"Giải mã không đầy đủ: {len(frames)}/{int(metadata_frames)} khung; không phát hành overlay thiếu nguồn.")
        lines = suggest_image_lines(first)
        height, width = first.shape[:2]
        return {
            "schemaVersion": SCHEMA,
            "source": {"name": path.name, "sha256": fingerprint, "width": width, "height": height,
                       "fps": fps, "frameCount": len(frames), "durationSeconds": round(len(frames) / fps, 6)},
            "method": {"id": "court-colour-motion-context-v2", "kind": "classical-cv", "version": METHOD_VERSION,
                       "description": "Baseline OpenCV: thành phần vàng/lục có thay đổi pixel, loại mảnh màu thuộc vùng lớn và nhiễu thiếu hỗ trợ không gian; gợi ý vạch trắng Hough.",
                       "limitations": [
                           "Không phải model AI đã huấn luyện cho pickleball; màu áo/đồ vật khác có thể bị nhận nhầm.",
                           "Bóng bị che, nhòe hoặc thiếu màu có thể bị bỏ sót; không lấp khoảng mất dấu.",
                           "Điểm bám là tâm ứng viên trên ảnh, không phải điểm tiếp xúc mặt sân.",
                           "Vạch Hough là gợi ý chưa xác nhận, có thể là lưới hoặc vật khác; chưa hiệu chuẩn sân.",
                           "Thời gian khung dùng FPS danh định; không phải timestamp phơi sáng cảm biến.",
                           "Ảnh lớn được giảm cạnh dài về tối đa 1280 px khi phân tích; tọa độ trả về theo ảnh gốc.",
                           "Chưa đo độ chính xác trên tập video có nhãn độc lập; không dùng để phân xử In/Out.",
                       ]},
            "frames": frames, "lineSuggestions": lines,
            "summary": {"observedFrames": sum(frame["status"] == "observed" for frame in frames),
                        "ambiguousFrames": sum(frame["status"] == "ambiguous" for frame in frames),
                        "missingFrames": sum(frame["status"] == "missing" for frame in frames),
                        "analysisMs": round((time.perf_counter() - started) * 1000, 3)},
            "decision": {"status": "insufficient-evidence", "reason": "Chưa có bằng chứng tiếp xúc và hiệu chuẩn đủ để kết luận In/Out; chỉ hỗ trợ xem lại."},
        }
    finally:
        capture.release()


def write_session(session: dict, output: str | Path) -> None:
    path = Path(output).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=path.parent, prefix=".court-session-", suffix=".tmp", encoding="utf-8", delete=False) as stream:
            temporary = stream.name
            json.dump(session, stream, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        session = analyze_video(args.video)
        write_session(session, args.output)
    except (CourtAnalysisError, OSError, cv2.error) as error:
        parser.exit(2, f"Court: {error}\n")
    print(json.dumps({"sourceSha256": session["source"]["sha256"], "frames": session["source"]["frameCount"],
                      **session["summary"], "decision": session["decision"]["status"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
