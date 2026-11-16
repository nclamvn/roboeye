#!/usr/bin/env python3
"""Offline Mac M2B ablation: identical JPEG evidence, with/without advisory boxes."""

import argparse
from dataclasses import dataclass
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
from time import monotonic_ns
from datetime import date


ROOT = Path(__file__).resolve().parent.parent
MODEL_ID = "mlx-community/Qwen3.5-0.8B-4bit"
REVISION = "fd570aaf3873cf796abf524f7cc3f340d9dcf539"
MODEL_FILES = {
    "chat_template.jinja": "273d8e0e683b885071fb17e08d71e5f2a5ddfb5309756181681de4f5a1822d80",
    "config.json": "ba7770da23eae5ebd6827571f086e331956b33f4442a9e876fb4aa10969a6772",
    "model.safetensors": "f5a0d9dd3efa73510542a8023d610ff26be2b4b020d181cfc4bedaa1fcc5dd9e",
    "model.safetensors.index.json": "6e48f2fa5d6f033a6d77bf833abfa9698ca24d1715ecea4c67447bcfaee44650",
    "preprocessor_config.json": "27225450ac9c6529872ee1924fcb0962ff5634834f817040f444118116f4e516",
    "processor_config.json": "14932921ca485d458a04dafd8069fbb0a4505622a48208d19ed247115801385b",
    "tokenizer.json": "87a7830d63fcf43bf241c3c5242e96e62dd3fdc29224ca26fed8ea333db72de4",
    "tokenizer_config.json": "e98f1901ac6f0adff67b1d540bfa0c36ac1a0cf59eb72ed78146ef89aafa1182",
    "video_preprocessor_config.json": "7768af27c1fafa9cc9011c1dc20067e03f8915e03b63504550e11d5066986d13",
    "vocab.json": "ce99b4cb2983d118806ce0a8b777a35b093e2000a503ebde25853284c9dfa003",
}
MAX_SIDE = 768
MAX_TOKENS = 96
MAX_CASES = 32
MAX_FRAMES = 4
JPEG_LIMIT = 16 * 1024 * 1024
RULES = (
    "Trả lời bằng tiếng Việt, tối đa hai câu ngắn. "
    "Chỉ dựa trên hình ảnh đã cung cấp. Trái/phải theo góc nhìn hình ảnh. "
    "Không đoán danh tính, không bịa số mét, không hướng dẫn đi lại. "
    "Nếu thiếu bằng chứng, nói chưa xác định được."
)


@dataclass(frozen=True)
class Frame:
    path: Path
    relative_path: str
    sha256: str
    time_ms: int


@dataclass(frozen=True)
class Case:
    id: str
    question: str
    frames: tuple[Frame, ...]
    asked_at_ms: int
    baseline: str | None


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def elapsed(started):
    return round((monotonic_ns() - started) / 1e6, 3)


def read_json(path, limit=1024 * 1024):
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError(f"Not a bounded JSON file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def asset_path(root, raw):
    if not isinstance(raw, str) or not raw or len(raw) > 255 or "\\" in raw:
        raise ValueError("Invalid asset path")
    name = Path(raw)
    if name.is_absolute() or ".." in name.parts:
        raise ValueError("Expected relative JPEG paths within assetRoot")
    resolved = (root / name).resolve(strict=True)
    if not resolved.is_relative_to(root) or resolved.suffix.lower() not in {".jpg", ".jpeg"}:
        raise ValueError("Asset path escapes assetRoot or is not a JPEG")
    if not resolved.is_file() or not 4 <= resolved.stat().st_size <= JPEG_LIMIT:
        raise ValueError("Not a bounded image file")
    return resolved


def time_ms(value):
    if type(value) is not int or not 0 <= value <= 24 * 60 * 60 * 1000:
        raise ValueError("Expected integer media milliseconds in [0, 24h]")
    return value


def load_cases(manifest_path):
    manifest = read_json(manifest_path)
    if not isinstance(manifest, dict) or type(manifest.get("schemaVersion")) is not int or manifest["schemaVersion"] != 1:
        raise ValueError("Expected manifest schemaVersion 1")
    root_name = manifest.get("assetRoot", ".")
    if not isinstance(root_name, str) or not root_name or Path(root_name).is_absolute():
        raise ValueError("Expected assetRoot relative to the manifest")
    root = (manifest_path.resolve().parent / root_name).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("assetRoot is not a directory")
    rows = manifest.get("cases")
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_CASES:
        raise ValueError(f"Expected 1-{MAX_CASES} benchmark cases")

    keys, checked, parsed = set(), {}, []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Invalid experiment case")
        key, question, items = row.get("id"), row.get("question"), row.get("frames")
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", key) or key in keys:
            raise ValueError("Invalid/duplicate case ID")
        if not isinstance(question, str) or not question.strip() or len(question) > 600 or any(ord(c) < 32 for c in question):
            raise ValueError(f"{key}: question must be a single bounded line")
        if not isinstance(items, list) or not 1 <= len(items) <= MAX_FRAMES:
            raise ValueError(f"{key}: expected 1-{MAX_FRAMES} ordered frames")
        ask = time_ms(row.get("askedAtMs"))
        frames, previous = [], -1
        for item in items:
            if not isinstance(item, dict):
                raise ValueError(f"{key}: invalid frame")
            absolute = asset_path(root, item.get("path"))
            digest, timestamp = item.get("sha256"), time_ms(item.get("timeMs"))
            if not isinstance(digest, str) or not re.fullmatch("[0-9a-f]{64}", digest):
                raise ValueError(f"{key}: invalid fixture SHA-256")
            if absolute not in checked:
                checked[absolute] = sha256(absolute)
            if checked[absolute] != digest:
                raise ValueError(f"{key}: fixture hash mismatch")
            if not previous < timestamp <= ask:
                raise ValueError(f"{key}: non-increasing/future frame timestamp")
            frames.append(Frame(absolute, absolute.relative_to(root).as_posix(), digest, timestamp))
            previous = timestamp
        baseline = row.get("baseline")
        if baseline not in (None, "sceneOverview", "peopleRight") or (baseline is not None and len(frames) != 1):
            raise ValueError(f"{key}: static baseline cannot answer this case shape")
        # Expected answers/clip notes are deliberately NOT carried to prompts.
        parsed.append(Case(key, question.strip(), tuple(frames), ask, baseline))
        keys.add(key)
    return parsed


def prepare(path, dest):
    from PIL import Image, ImageOps

    with Image.open(path, formats=["JPEG"]) as original:
        if original.width < 2 or original.height < 2 or original.width * original.height > 50_000_000:
            raise ValueError("Invalid or over-budget decoded image")
        orientation = original.getexif().get(274, 1)
        if type(orientation) is not int or not 1 <= orientation <= 8:
            raise ValueError(f"Invalid EXIF orientation: {orientation!r}")
        with ImageOps.exif_transpose(original).convert("RGB") as image:
            image.thumbnail((MAX_SIDE, MAX_SIDE), resample=Image.Resampling.LANCZOS)
            image.save(dest, format="JPEG", quality=92, subsampling=0)
            return {"width": image.width, "height": image.height, "sourceOrientation": orientation,
                    "preparedSha256": sha256(dest)}


def observation_text(tracks):
    if not isinstance(tracks, list) or len(tracks) > 12:
        raise ValueError("Invalid SceneQA track list")
    parts = []
    for track in tracks:
        label, score, box = track["label"], track["score"], track["box"]
        if not isinstance(label, str) or not re.fullmatch(r"[a-z0-9][a-z0-9 -]{0,39}", label):
            raise ValueError("Unexpected detector label")
        x, y, w, h = (box[key] for key in ("x", "y", "width", "height"))
        if not all(type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1 for v in (x, y, w, h, score)):
            raise ValueError("Invalid detector confidence/box")
        if not w or not h or x+w > 1.000001 or y+h > 1.000001:
            raise ValueError("Invalid box bounds")
        center = x + w / 2
        side = "phải" if center >= 0.56 else "trái" if center <= 0.44 else "giữa"
        parts.append(f"{label} ({side}, {score:.2f})")
    return "; ".join(parts) if parts else "không có khung đạt ngưỡng"


def prompt_for(case, detector=None):
    frame_count = len(case.frames)
    times = ", ".join(f"{f.time_ms} ms" for f in case.frames)
    if frame_count == 1:
        evidence = "Chỉ có một ảnh tĩnh; không suy ra vật đang di chuyển hay vừa xuất hiện."
    else:
        evidence = ("Các khung theo thứ tự thời gian. Không khẳng định điều xảy ra giữa "
                    "các khung hoặc quy chuyển động cho vật khi góc camera đổi.")
    result = f"{RULES}\n{evidence} Mốc khung từ đầu đến cuối: {times}."
    if detector is not None:
        rows = [f"{f.time_ms} ms: {observation_text(detector[f.path]['tracks'])}" for f in case.frames]
        result += ("\nGợi ý từ detector (có thể bỏ sót/nhầm; không phải đáp án, "
                   "không đo khoảng cách hoặc bám danh tính qua khung):\n" + "\n".join(rows))
    return f"{result}\nCâu hỏi: {case.question}"


def deny_network(event, _):
    if event in ("socket.connect", "socket.connect_ex", "socket.getaddrinfo", "socket.sendto", "socket.sendmsg"):
        raise RuntimeError("M2B prohibits network during inference")


def load_model_identity(model_dir):
    actual = {p.name for p in model_dir.iterdir() if p.is_file() and not p.name.startswith(".")}
    if actual != set(MODEL_FILES):
        raise ValueError(f"Pinned snapshot file set mismatch: {sorted(actual ^ set(MODEL_FILES))}")
    for filename, expected in MODEL_FILES.items():
        if sha256(model_dir / filename) != expected:
            raise ValueError(f"Pinned artifact SHA-256 mismatch: {filename}")
    config = read_json(model_dir / "config.json")
    quant = config.get("quantization", {})
    if config.get("model_type") != "qwen3_5" or quant.get("bits") != 4:
        raise ValueError("Expected Qwen3.5 4-bit snapshot")
    return {"id": MODEL_ID, "revision": REVISION, "weightsSha256": MODEL_FILES["model.safetensors"],
            "artifactSha256": MODEL_FILES, "temperature": 0, "enableThinking": False,
            "maxTokens": MAX_TOKENS, "versions": {name: importlib.metadata.version(name)
            for name in ("mlx", "mlx-vlm", "transformers", "pillow")}}


def model_attempt(case, mode, vision, model, processor, template, stream, detector, order):
    started = monotonic_ns()
    first_ms, last, error, chunks = None, None, None, []
    try:
        task = prompt_for(case, detector if mode == "B" else None)
        prompt = template(processor, model.config, task, num_images=len(vision), enable_thinking=False)
        for chunk in stream(
            model, processor, prompt, image=vision, max_tokens=MAX_TOKENS,
            temperature=0.0, enable_thinking=False, verbose=False,
        ):
            if chunk.text and chunk.text.strip() and first_ms is None:
                first_ms = elapsed(started)
            chunks.append(chunk.text)
            last = chunk
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    tokens = getattr(last, "generation_tokens", None)
    return {"case": case.id, "mode": mode, "order": order, "answer": "".join(chunks), "error": error,
            "firstTextMs": first_ms, "elapsedMs": elapsed(started), "tokens": tokens,
            "reachedTokenLimit": (tokens >= MAX_TOKENS) if tokens is not None else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--case", action="append", help="Run only named cases; report identifies subsets.")
    parser.add_argument("--sceneqa", type=Path, required=True)
    parser.add_argument("--yolo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.is_symlink() or not args.output.parent.is_dir():
        raise ValueError("Output must be new and within an existing directory")
    model_path = args.model.resolve(strict=True)
    detector_cli = args.sceneqa.resolve(strict=True)
    detector_model = args.yolo.resolve(strict=True)
    cases = load_cases(args.manifest)
    if args.case:
        missing = set(args.case) - {c.id for c in cases}
        if missing:
            raise ValueError(f"Unknown case IDs: {sorted(missing)}")
        cases = [c for c in cases if c.id in args.case]
    manifest_sha = sha256(args.manifest)
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                      HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false")
    sys.addaudithook(deny_network)
    from mlx_vlm import load, stream_generate
    from mlx_vlm.prompt_utils import apply_chat_template
    from PIL import Image

    identity = load_model_identity(model_path)
    unique = {f.path: f for case in cases for f in case.frames}
    if len(unique) > 64:
        raise ValueError("Exceeds the 64 distinct JPEG evaluation budget")
    runs = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-scene-qwen-{date.today():%Y%m%d}-", dir=args.output.parent) as work:
        work = Path(work).resolve()
        prepared = {}
        for i, (path, frame) in enumerate(unique.items()):
            if sha256(path) != frame.sha256:
                raise ValueError("Source fixture changed during evaluation")
            filename = work / f"{i:03d}.jpg"
            prepared[path] = (filename, prepare(path, filename))

        detector_started = monotonic_ns()
        process = subprocess.run(
            [str(detector_cli), str(detector_model), *(str(x[0]) for x in prepared.values())],
            capture_output=True, text=True, timeout=150, check=False,
        )
        if process.returncode:
            raise RuntimeError(f"SceneQA failed ({process.returncode}): {process.stderr[-2000:]}")
        detector_wall_ms = elapsed(detector_started)
        detector = json.loads(process.stdout)
        outputs = detector["images"]
        by_dest = {Path(item["path"]): item for item in outputs}
        if detector.get("schemaVersion") != 1 or len(outputs) != len(prepared) or set(by_dest) != {x[0] for x in prepared.values()}:
            raise ValueError("SceneQA output not bound to prepared images")
        by_src = {}
        for source, (name, dimensions) in prepared.items():
            report = by_dest[name]
            if (report["width"], report["height"], report["orientation"]) != (dimensions["width"], dimensions["height"], 1):
                raise ValueError("VLM and SceneQA do not share the same upright pixel coordinates")
            observation_text(report["tracks"])
            by_src[source] = report
            report["path"] = unique[source].relative_path

        started = monotonic_ns()
        model, processor = load(str(model_path), trust_remote_code=False)
        identity["loadMs"] = elapsed(started)
        for i, case in enumerate(cases):
            images = [Image.open(prepared[f.path][0], formats=["JPEG"]) for f in case.frames]
            try:
                for item in images:
                    item.load()
                for mode in (("A", "B") if i % 2 == 0 else ("B", "A")):
                    runs.append(model_attempt(case, mode, images, model, processor, apply_chat_template,
                                              stream_generate, by_src, len(runs) + 1))
            finally:
                for item in images:
                    item.close()
            if case.baseline is not None:
                found = by_src[case.frames[0].path]
                runs.append({"case": case.id, "mode": "C", "answer": found[case.baseline],
                             "detectionMs": found["detectionMs"], "status": "static baseline"})

    record = {
        "schemaVersion": 1, "experiment": "TIP-65-M2B-Mac", "caseSubset": args.case,
        "platform": platform.platform(), "network": "local-only; Python socket guard; no service/API",
        "manifestSha256": manifest_sha, "runnerSha256": sha256(Path(__file__)),
        "detectorCliSha256": sha256(detector_cli),
        "detectorSourceSha256": sha256(ROOT / "native/ios/SceneQA/main.swift"),
        "vlm": identity, "detector": detector, "detectorWallMs": detector_wall_ms,
        "frames": [{"path": frame.relative_path, "sha256": frame.sha256, **prepared[path][1]}
                   for path, frame in unique.items()],
        "cases": [{"id": c.id, "question": c.question, "askedAtMs": c.asked_at_ms,
                   "frames": [{"path": f.relative_path, "timeMs": f.time_ms} for f in c.frames]}
                  for c in cases],
        "runs": runs, "phoneEvidence": None,
        "limits": "Still and ordered JPEGs only; no streaming, camera, LiDAR, voices or physical-phone QA.",
    }
    payload = json.dumps(record, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    with args.output.open("x", encoding="utf-8") as output:
        output.write(payload)
    return int(any(r.get("error") for r in runs))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"M2B: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1)
