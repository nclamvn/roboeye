#!/usr/bin/env python3
"""Frozen WASB tennis model adapter for local, offline Court A/B.

This is image-space learned detection, not contact/trajectory completion or a
pickleball-qualified referee. See court-wasb-model.json and court-wasb.LICENSE.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import time
import urllib.request

import cv2
import numpy as np
import torch

from court_analyze import (CourtAnalysisError, MAX_BYTES, MAX_FRAMES, MAX_PIXELS,
                           MAX_SECONDS, SCHEMA, source_sha256, suggest_image_lines,
                           write_session)
from court_wasb_hrnet import HRNet


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = Path(__file__).with_name("court-wasb-model.json")
DEFAULT_WEIGHTS = ROOT / ".court-cache/m2/models/wasb_tennis_best.pth.tar"
MAX_RUN_SECONDS = 300
INPUT_WIDTH, INPUT_HEIGHT = 512, 288


class Attrs(dict):
    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as error:
            raise AttributeError(name) from error


def attrs(value):
    return Attrs({key: attrs(item) for key, item in value.items()}) if isinstance(value, dict) else value


def model_config() -> dict:
    """Exact published wasb.yaml HRNet architecture, no optimisation sweep."""
    stage = lambda branches, channels, blocks: {"NUM_MODULES": 1, "NUM_BRANCHES": branches,
        "BLOCK": "BASIC", "NUM_BLOCKS": blocks, "NUM_CHANNELS": channels, "FUSE_METHOD": "SUM"}
    return attrs({"frames_in": 3, "frames_out": 3, "out_scales": [0], "MODEL": {"EXTRA": {
        "FINAL_CONV_KERNEL": 1, "PRETRAINED_LAYERS": ["*"],
        "STEM": {"INPLANES": 64, "STRIDES": [1, 1]},
        "STAGE1": {"NUM_MODULES": 1, "NUM_BRANCHES": 1, "BLOCK": "BOTTLENECK", "NUM_BLOCKS": [1], "NUM_CHANNELS": [32], "FUSE_METHOD": "SUM"},
        "STAGE2": stage(2, [16, 32], [2, 2]), "STAGE3": stage(3, [16, 32, 64], [2, 2, 2]),
        "STAGE4": stage(4, [16, 32, 64, 128], [2, 2, 2, 2]),
        "DECONV": {"NUM_DECONVS": 0, "KERNEL_SIZE": [], "NUM_BASIC_BLOCKS": 2}}}})


def load_manifest() -> dict:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    config_sha = hashlib.sha256(json.dumps(manifest["config"], sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
    if config_sha != manifest["configSha256"]:
        raise CourtAnalysisError("WASB config SHA không khớp manifest đã đóng băng.")
    if source_sha256(Path(__file__).with_name("court_wasb_hrnet.py")) != manifest["upstreamCodeSha256"]:
        raise CourtAnalysisError("Mã HRNet khác nguồn upstream đã kiểm; dừng thay vì đoán kiến trúc.")
    return manifest


def prepare_assets(weights: Path = DEFAULT_WEIGHTS) -> dict:
    """Explicit CLI staging only; browser requests must never call this."""
    manifest = load_manifest()
    weights = Path(weights).resolve()
    weights.parent.mkdir(parents=True, exist_ok=True)
    if not weights.exists():
        partial = weights.with_name(weights.name + ".partial")
        started = time.monotonic()
        try:
            with urllib.request.urlopen(manifest["sourceUrl"], timeout=30) as response, partial.open("xb") as output:
                size = 0
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    size += len(block)
                    if size > manifest["bytes"] or size > 200 * 1024 * 1024 or time.monotonic() - started > 120:
                        raise CourtAnalysisError("Tải model vượt kích thước/thời hạn đã cho phép.")
                    output.write(block)
            if partial.stat().st_size != manifest["bytes"] or source_sha256(partial) != manifest["sha256"]:
                raise CourtAnalysisError("Model tải về không khớp SHA/kích thước đã pin.")
            os.replace(partial, weights)
        finally:
            partial.unlink(missing_ok=True)
    verify_weights(weights, manifest)
    receipt = {"modelId": manifest["id"], "artifactSha256": manifest["sha256"], "bytes": weights.stat().st_size,
               "sourceUrl": manifest["sourceUrl"], "publicationUrl": manifest["publicationUrl"],
               "license": manifest["license"], "revision": manifest["revision"],
               "configSha256": manifest["configSha256"], "codeSha256": manifest["upstreamCodeSha256"],
               "pinProvenance": manifest["artifactPinProvenance"], "loader": "torch.load(weights_only=True)",
               "inferenceExecuted": False}
    write_session(receipt, weights.with_name("wasb-assets-receipt.json"))
    return receipt


def verify_weights(weights: Path, manifest: dict) -> None:
    if not weights.is_file():
        raise CourtAnalysisError("Chưa có WASB weights; chạy court_ball_model.py --prepare-assets trước.")
    if weights.stat().st_size != manifest["bytes"] or source_sha256(weights) != manifest["sha256"]:
        raise CourtAnalysisError("WASB weights khác SHA/kích thước đã pin; không tải pickle lạ.")


def load_model(weights: Path, device: str = "auto"):
    started = time.perf_counter()
    manifest = load_manifest()
    verify_weights(weights, manifest)
    if device == "auto":
        device = "mps" if torch.backends.mps.is_available() else "cpu"
    if device not in ("cpu", "mps") or (device == "mps" and not torch.backends.mps.is_available()):
        raise CourtAnalysisError("Backend yêu cầu không khả dụng; dùng --device cpu nếu muốn thử CPU.")
    # Never call upstream init_weights/pretrained loader; only this restricted
    # tensor-state reader is permitted. No safe_globals or unsafe fallback.
    checkpoint = torch.load(weights, map_location="cpu", weights_only=True)
    if not isinstance(checkpoint, dict) or set(checkpoint) != {"model_state_dict"}:
        raise CourtAnalysisError("Checkpoint không đúng state-dict contract đã kiểm.")
    state = checkpoint["model_state_dict"]
    if not isinstance(state, dict) or not all(isinstance(key, str) and isinstance(value, torch.Tensor) for key, value in state.items()):
        raise CourtAnalysisError("Checkpoint chứa giá trị ngoài tensor-state contract.")
    model = HRNet(model_config())
    model.load_state_dict(state, strict=True)
    model.eval().to(device)
    if device == "mps":
        torch.mps.synchronize()
    return model, device, manifest, (time.perf_counter() - started) * 1000


def affine_matrices(width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """Published centre=max-dimension affine (not guessed anisotropic resize).

    get_affine_transform(c=[w/2,h/2],s=max(w,h),rot=0,[512,288]).
    For non-16:9 sources this can crop vertical content, as upstream does.
    """
    if width <= 0 or height <= 0:
        raise CourtAnalysisError("Kích thước nguồn không hợp lệ.")
    scale = INPUT_WIDTH / max(width, height)
    forward = np.array([[scale, 0, INPUT_WIDTH / 2 - width / 2 * scale],
                        [0, scale, INPUT_HEIGHT / 2 - height / 2 * scale]], np.float32)
    return forward, cv2.invertAffineTransform(forward)


def preprocess_triplet(frames: list[np.ndarray]) -> tuple[torch.Tensor, np.ndarray]:
    if len(frames) != 3 or any(frame.shape != frames[0].shape for frame in frames):
        raise CourtAnalysisError("Cần đúng ba khung liền kề cùng kích thước, không padding giả.")
    height, width = frames[0].shape[:2]
    forward, inverse = affine_matrices(width, height)
    channels = []
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)[:, None, None]
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)[:, None, None]
    for frame in frames:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = cv2.warpAffine(rgb, forward, (INPUT_WIDTH, INPUT_HEIGHT), flags=cv2.INTER_LINEAR)
        channels.append((image.transpose(2, 0, 1).astype(np.float32) / 255.0 - mean) / std)
    return torch.from_numpy(np.concatenate(channels, axis=0)[None]), inverse


def decode_heatmap(heatmap: np.ndarray, inverse: np.ndarray, width: int, height: int) -> dict:
    if heatmap.shape != (INPUT_HEIGHT, INPUT_WIDTH) or not np.isfinite(heatmap).all():
        raise CourtAnalysisError("Heatmap sai shape hoặc chứa NaN/Inf.")
    labels_count, labels, stats, _ = cv2.connectedComponentsWithStats((heatmap > 0.5).astype(np.uint8), 8)
    ranked = []
    scale = float(inverse[0, 0])
    for label in range(1, labels_count):
        ys, xs = np.where(labels == label)
        values = heatmap[ys, xs]
        mass = float(values.sum())
        xy = np.array([float(np.sum(xs * values) / mass), float(np.sum(ys * values) / mass), 1], np.float32)
        x, y = (float(value) for value in inverse @ xy)
        if not (0 <= x < width and 0 <= y < height):
            continue
        bx, by, bw, bh, area = (int(value) for value in stats[label])
        corners = np.array([[bx, by, 1], [bx + bw, by + bh, 1]], np.float32) @ inverse.T
        left, top = max(0.0, float(corners[0, 0])), max(0.0, float(corners[0, 1]))
        right, bottom = min(float(width), float(corners[1, 0])), min(float(height), float(corners[1, 1]))
        candidate = {"x": round(x, 3), "y": round(y, 3), "radius": round(max(1.0, math.sqrt(area / math.pi) * scale), 3),
                     "confidence": round(float(values.max()), 6),
                     "box": [round(left, 3), round(top, 3), round(right - left, 3), round(bottom - top, 3)]}
        ranked.append((mass, candidate))
    ranked.sort(key=lambda pair: -pair[0])
    candidates = [candidate for _, candidate in ranked[:12]]
    if not candidates:
        return {"status": "missing", "ball": None, "candidates": [], "reason": "Không có vùng heatmap vượt ngưỡng WASB 0,5 trong ảnh nguồn."}
    if len(ranked) > 1 and ranked[0][0] == ranked[1][0]:
        return {"status": "ambiguous", "ball": None, "candidates": candidates, "reason": "Hai vùng heatmap đồng hạng; không tự chọn danh tính bóng."}
    return {"status": "observed", "ball": candidates[0], "candidates": candidates,
            "reason": "Dự đoán WASB tennis theo vùng heatmap mạnh nhất; chưa xác thực bóng pickleball hoặc tiếp xúc sân."}


def analyze_video(video: str | Path, weights: Path = DEFAULT_WEIGHTS, device: str = "auto") -> dict:
    started = time.perf_counter()
    path = Path(video).expanduser().resolve()
    if not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise CourtAnalysisError("Video không tồn tại hoặc vượt giới hạn 500 MiB.")
    fingerprint = source_sha256(path)
    torch.set_num_threads(4)
    cv2.setNumThreads(1)
    capture = cv2.VideoCapture(str(path))
    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        expected = float(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if not capture.isOpened() or not math.isfinite(fps) or not 1 <= fps <= 480:
            raise CourtAnalysisError("Không đọc được nguồn/FPS; không tự đoán timeline.")
        if expected > MAX_FRAMES or expected / fps > MAX_SECONDS:
            raise CourtAnalysisError("Video vượt giới hạn 5 phút/20.000 khung.")
        model, actual_device, manifest, load_ms = load_model(Path(weights), device)
        frames, block = [], []
        first = None
        decoded = calls = 0
        inference_ms = preprocess_ms = postprocess_ms = 0.0
        with torch.inference_mode():
            while True:
                if time.perf_counter() - started > MAX_RUN_SECONDS:
                    raise CourtAnalysisError("Inference vượt 5 phút; không phát hành overlay thiếu nguồn.")
                ok, frame = capture.read()
                if not ok:
                    break
                if decoded >= MAX_FRAMES or decoded / fps >= MAX_SECONDS or frame.shape[0] * frame.shape[1] > MAX_PIXELS:
                    raise CourtAnalysisError("Giải mã vượt ngân sách kích thước/khung/thời lượng.")
                if first is None:
                    first = frame.copy()
                if frame.shape != first.shape:
                    raise CourtAnalysisError("Nguồn thay đổi kích thước; không dùng tọa độ cũ.")
                block.append(frame)
                decoded += 1
                if len(block) < 3:
                    continue
                stage = time.perf_counter()
                tensor, inverse = preprocess_triplet(block)
                tensor = tensor.to(actual_device)
                if actual_device == "mps":
                    torch.mps.synchronize()
                preprocess_ms += (time.perf_counter() - stage) * 1000
                stage = time.perf_counter()
                logits = model(tensor)[0]
                heatmaps = torch.sigmoid(logits).cpu().numpy()[0]
                if actual_device == "mps":
                    torch.mps.synchronize()
                inference_ms += (time.perf_counter() - stage) * 1000
                calls += 1
                if heatmaps.shape != (3, INPUT_HEIGHT, INPUT_WIDTH):
                    raise CourtAnalysisError("Model không trả đúng ba heatmap ứng với ba khung đầu vào.")
                stage = time.perf_counter()
                for channel in range(3):
                    index = decoded - 3 + channel
                    result = decode_heatmap(heatmaps[channel], inverse, first.shape[1], first.shape[0])
                    frames.append({"index": index, "timeSeconds": round(index / fps, 6), **result})
                postprocess_ms += (time.perf_counter() - stage) * 1000
                block.clear()
        if first is None or (expected > 0 and decoded < int(expected)):
            raise CourtAnalysisError("Video trống hoặc giải mã không đầy đủ; dừng thay vì bỏ khung im lặng.")
        for index in range(len(frames), decoded):
            frames.append({"index": index, "timeSeconds": round(index / fps, 6), "status": "missing", "ball": None,
                           "candidates": [], "reason": "Cuối nguồn thiếu bộ ba khung thật; không sao chép/inpaint khung để suy đoán."})
        height, width = first.shape[:2]
        wall_ms = (time.perf_counter() - started) * 1000
        runtime = {"device": actual_device, "torchVersion": torch.__version__, "modelLoadMs": round(load_ms, 3),
                   "modelCalls": calls, "inferenceMs": round(inference_ms, 3), "preprocessMs": round(preprocess_ms, 3),
                   "postprocessMs": round(postprocess_ms, 3), "wallMs": round(wall_ms, 3), "dtype": "float32",
                   "lookAhead": "offline three-frame blocks, at most two source frames", "padding": "none", "gapFilling": "none"}
        return {"schemaVersion": SCHEMA,
            "source": {"name": path.name, "sha256": fingerprint, "width": width, "height": height, "fps": fps,
                       "frameCount": decoded, "durationSeconds": round(decoded / fps, 6)},
            "method": {"id": "court-wasb-tennis-v1", "kind": "learned-ball", "version": "2.0.0",
                "description": "WASB HRNet tennis: ba khung RGB, heatmap riêng từng khung, ngưỡng công bố 0,5; phân tích offline.",
                "model": {"id": manifest["id"], "artifactSha256": manifest["sha256"], "sourceUrl": manifest["sourceUrl"],
                          "license": manifest["license"], "revision": manifest["revision"], "configSha256": manifest["configSha256"],
                          "preprocessId": manifest["preprocessId"]}, "runtime": runtime,
                "limitations": ["Weights huấn luyện tennis, chưa được chứng minh chuyển sang pickleball hoặc camera sân anh.",
                    "Heatmap là dự đoán model, không chứng minh bóng thật, tiếp xúc sân hoặc In/Out.",
                    "Nguồn được warp affine trung tâm 512×288 theo upstream; ảnh khác tỷ lệ có thể bị cắt phần trên/dưới.",
                    "Dùng ba khung có look-ahead offline, không phải cam realtime. Không điền quỹ đạo qua mất dấu.",
                    "Bán kính/box mô tả vùng heatmap, không phải biên vật lý quả bóng hay vùng tiếp xúc sân.",
                    "Vạch Hough vẫn là gợi ý chưa xác nhận; không hiệu chuẩn hay suy ra số mét.",
                    "FPS danh định không phải thời điểm phơi sáng; không có phép đo chuyển động vật lý."]},
            "frames": frames, "lineSuggestions": suggest_image_lines(first),
            "summary": {"observedFrames": sum(frame["status"] == "observed" for frame in frames),
                        "ambiguousFrames": sum(frame["status"] == "ambiguous" for frame in frames),
                        "missingFrames": sum(frame["status"] == "missing" for frame in frames), "analysisMs": round(wall_ms, 3)},
            "decision": {"status": "insufficient-evidence", "reason": "Model chỉ đề xuất vị trí trên ảnh; thiếu chứng cứ tiếp xúc/hiệu chuẩn để kết luận In/Out."}}
    finally:
        capture.release()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video")
    parser.add_argument("--output")
    parser.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS)
    parser.add_argument("--device", choices=["auto", "cpu", "mps"], default="auto")
    parser.add_argument("--prepare-assets", action="store_true")
    args = parser.parse_args()
    try:
        if args.prepare_assets:
            print(json.dumps(prepare_assets(args.weights), ensure_ascii=False))
        if args.video or args.output:
            if not args.video or not args.output:
                raise CourtAnalysisError("--video và --output phải đi cùng nhau.")
            session = analyze_video(args.video, args.weights, args.device)
            write_session(session, args.output)
            print(json.dumps({"method": session["method"]["id"], "sourceSha256": session["source"]["sha256"],
                              **session["summary"], "runtime": session["method"]["runtime"]}, ensure_ascii=False))
        elif not args.prepare_assets:
            parser.error("Chọn --prepare-assets hoặc --video SOURCE --output SESSION.")
    except (CourtAnalysisError, OSError, RuntimeError, ValueError) as error:
        parser.exit(2, f"Court specialist: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
