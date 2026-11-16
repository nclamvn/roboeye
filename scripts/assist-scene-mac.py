#!/usr/bin/env python3
"""Local Mac VLM ablation; no model downloads, recording, or product output."""

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
from time import monotonic_ns


ROOT = Path(__file__).resolve().parent.parent
PILOT = ROOT / "tests/fixtures/assist-scene-mac-pilot.json"
MODEL_ID = "mlx-community/SmolVLM2-500M-Video-Instruct-mlx"
REVISION = "fa57db46815177fbdfd65cc85a2b3416a8332268"
WEIGHTS_SHA = "a9839c8f79ecc93e54a00dc73cc0e68ba477debcd065d50c1c289fbb1075f981"
MAX_TOKENS = 96
RULES = (
    "Trả lời câu hỏi bằng tiếng Việt, tối đa hai câu ngắn, dựa trên ảnh. "
    "Trái/phải theo góc nhìn ảnh. Chỉ nói điều nhìn thấy rõ; không đoán "
    "danh tính, không bịa số mét, không suy ra chuyển động từ ảnh tĩnh, "
    "không chỉ đường. Khi thiếu bằng chứng, nói chưa xác định được."
)


def deny_network(event, _):
    if event in ("socket.connect", "socket.getaddrinfo", "socket.sendto"):
        raise RuntimeError("M2 prohibits network during inference")


def sha256(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def elapsed(start):
    return round((monotonic_ns() - start) / 1e6, 3)


def observation_text(tracks):
    parts = []
    for track in tracks[:12]:
        box = track["box"]
        x, width, score = box["x"], box["width"], track["score"]
        if not all(math.isfinite(v) for v in (x, width, score)):
            raise ValueError("Nonfinite detector output")
        center = x + width / 2
        side = "phải" if center >= 0.56 else "trái" if center <= 0.44 else "giữa"
        parts.append(f'{track["label"]} ({side}, {score:.2f})')
    return "; ".join(parts) if parts else "không có box đạt ngưỡng"


def prompt_for(question, tracks=None):
    # Detector context is advisory. The rest of the instruction is identical.
    if tracks is None:
        return f"{RULES}\nCâu hỏi: {question}"
    context = observation_text(tracks)
    return (
        f"{RULES}\nQuan sát bổ sung từ bộ phát hiện vật thể (có thể sai hoặc "
        f"bỏ sót; không phải số đo hay đáp án): {context}.\nCâu hỏi: {question}"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vlm", type=Path, required=True)
    parser.add_argument("--detector-cli", type=Path, required=True)
    parser.add_argument("--compiled-detector", type=Path, required=True)
    parser.add_argument("--fixture-dir", type=Path, required=True)
    args = parser.parse_args()
    pilot = json.loads(PILOT.read_text())
    manifest = json.loads((ROOT / pilot["fixtureManifest"]).read_text())
    assets = {entry["id"]: entry for entry in manifest["qaFixtures"]}
    cases = pilot["cases"]
    fixture_ids = list(dict.fromkeys(c["fixture"] for c in cases))
    paths = {key: (args.fixture_dir / assets[key]["file"]).resolve(strict=True) for key in fixture_ids}
    for key, path in paths.items():
        entry = assets[key]
        if path.stat().st_size != entry["bytes"] or sha256(path) != entry["sha256"]:
            raise ValueError(f"Unverified fixture {key}")
    weights = args.vlm / "model.safetensors"
    if weights.stat().st_size != 1_015_023_993 or sha256(weights) != WEIGHTS_SHA:
        raise ValueError("SmolVLM2 weights do not match pinned artifact")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                      HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false")
    sys.addaudithook(deny_network)
    from mlx_vlm import load, stream_generate
    from mlx_vlm.prompt_utils import apply_chat_template
    from PIL import Image, ImageOps

    detector_run = subprocess.run(
        [str(args.detector_cli.resolve(strict=True)), str(args.compiled_detector.resolve(strict=True)),
         *(str(paths[k]) for k in fixture_ids)], check=True, text=True, capture_output=True, timeout=90,
    )
    detector = json.loads(detector_run.stdout)
    by_path = {Path(result["path"]).resolve(): result for result in detector["images"]}
    if set(by_path) != set(paths.values()) or len(detector["images"]) != len(paths):
        raise ValueError("Unexpected detector image binding")
    start = monotonic_ns()
    model, processor = load(str(args.vlm.resolve(strict=True)), trust_remote_code=False)
    model_load_ms = elapsed(start)
    runs = []
    for i, case in enumerate(cases):
        path = paths[case["fixture"]]
        observation = by_path[path]
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
        # Same upright pixels for A and B. Interleave to avoid giving one
        # mode an exclusive cold-start penalty in this very small run.
        for mode in ("A", "B") if i % 2 == 0 else ("B", "A"):
            task = prompt_for(case["question"], observation["tracks"] if mode == "B" else None)
            started = monotonic_ns()
            first_ms = None
            result = None
            chunks = []
            error = None
            try:
                prompt = apply_chat_template(processor, model.config, task, num_images=1)
                for result in stream_generate(
                    model, processor, prompt, image=[image], max_tokens=MAX_TOKENS,
                    temperature=0.0, verbose=False,
                ):
                    if result.text and first_ms is None:
                        first_ms = elapsed(started)
                    chunks.append(result.text)
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
            runs.append({
                "case": case["id"], "mode": mode, "order": len(runs) + 1,
                "answer": "".join(chunks).strip(), "error": error, "firstTextMs": first_ms,
                "elapsedMs": elapsed(started), "tokens": getattr(result, "generation_tokens", None),
            })
        field = case["baseline"]
        runs.append({
            "case": case["id"], "mode": "C",
            "answer": observation[field] if field else None,
            "status": "computed" if field else "not supported by this static baseline",
            "detectionMs": observation["detectionMs"],
        })
    for item in detector["images"]:
        item["path"] = Path(item["path"]).name
    receipt = {
        "schemaVersion": 1, "platform": platform.platform(), "split": pilot["split"],
        "pilotSha256": sha256(PILOT), "runnerSha256": sha256(Path(__file__).resolve()),
        "detectorSourceSha256": sha256(ROOT / "native/ios/SceneQA/main.swift"),
        "vlm": {"id": MODEL_ID, "revision": REVISION, "weightsSha256": WEIGHTS_SHA,
                "modelLoadMs": model_load_ms, "maxTokens": MAX_TOKENS, "temperature": 0,
                "configSha256": sha256(args.vlm / "config.json"),
                "versions": {p: importlib.metadata.version(p)
                             for p in ("mlx", "mlx-vlm", "transformers", "pillow")}},
        "fixtures": [assets[k] for k in fixture_ids], "detector": detector,
        "detectorSourceWeightSha256": manifest["model"]["sha256"],
        "cases": cases, "runs": runs, "phoneEvidence": None,
        "note": "Sample questions are not independent. No speech, no camera, no LiDAR, no video.",
    }
    print(json.dumps(receipt, ensure_ascii=False, allow_nan=False, indent=2))
    return int(any(r.get("error") for r in runs))


if __name__ == "__main__":
    raise SystemExit(main())
