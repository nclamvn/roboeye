#!/usr/bin/env python3
"""Prepare a bounded real-video, RGB-only Court benchmark before inference.

TenniST's published labels are landing coordinates, NOT ball pixel positions.
This tool does not convert those labels into fabricated per-frame ground truth.
The separate gold template starts entirely unknown and must be visually reviewed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.request
from datetime import datetime, timezone

import cv2
import numpy as np

RGB_SCHEMA = "roboeye-court-benchmark-rgb-v1"
GOLD_SCHEMA = "roboeye-court-benchmark-gold-v1"
DATASET_URL = "https://data.mendeley.com/datasets/75m8vz7jr2/2"
DATASET_API = "https://data.mendeley.com/public-api/datasets/75m8vz7jr2/snapshot/2"
ATTRIBUTION = "Lai, Kalin Guanlun; Huang, Hsu-Chun; Lin, Shang-Yi; Lin, Wei-Ting; Lin, Kawuu Weicheng (2024), Tennis Shot Side-View and Top-View Data Set for Player Analysis in Tennis, Mendeley Data, V2, doi:10.17632/75m8vz7jr2.2."
FILES = (
    {"id": "tennist-01", "name": "OCT01.mp4", "fileId": "402dde2c-76f6-4cfd-8700-dd960923faf8", "bytes": 3823824,
     "sha256": "82337e2c228455da4e431c8dd07672c3452018ab781603d9e0fe5d1b8c8e403b", "view": "outdoor top-view cross-court"},
    {"id": "tennist-02", "name": "OST01.mp4", "fileId": "76012c73-6ec3-44b9-bcd2-01e74b27296e", "bytes": 3835890,
     "sha256": "5654c81889eb979495112d52cb50cb064934d35c250196cbb4b7a3f80919f42d", "view": "outdoor top-view straight"},
    {"id": "tennist-03", "name": "ICS01.mp4", "fileId": "656a30e3-84f2-4287-8603-ff553a799810", "bytes": 5051247,
     "sha256": "109c2a048f61d85f707255413efac3728cbff228e783bef825bac1c0d41799ff", "view": "indoor side-view cross-court"},
)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def download(url: str, path: Path, max_bytes: int, expected_sha: str | None = None) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "RoboEye-Court-RnD/0.1"})
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(path.name + ".pending")
    count = 0
    try:
        with urllib.request.urlopen(request, timeout=30) as response, pending.open("wb") as output:
            declared = response.headers.get("Content-Length")
            if declared and int(declared) > max_bytes:
                raise ValueError("Declared download exceeds the fixed byte budget")
            for chunk in iter(lambda: response.read(64 * 1024), b""):
                count += len(chunk)
                if count > max_bytes:
                    raise ValueError("Download exceeds the fixed byte budget")
                output.write(chunk)
        actual_sha = digest(pending)
        if expected_sha and actual_sha != expected_sha:
            raise ValueError("Source SHA-256 does not match publisher metadata")
        pending.replace(path)
        return {"url": url, "bytes": count, "sha256": actual_sha}
    finally:
        pending.unlink(missing_ok=True)


def sample_indices(frame_count: int, count: int = 12) -> list[int]:
    if frame_count < count:
        raise ValueError("Clip has fewer than twelve frames")
    # Deterministic image-independent selection. Never consult any predictor.
    return [(i * (frame_count - 1)) // (count - 1) for i in range(count)]


def apply_visual_annotations(template_path: Path, annotations_path: Path, output_path: Path) -> dict:
    """Deterministically combine MANUAL labels, retaining all unknown entries.

    This does not seal or approve the labels. Contractor cross-check comes next.
    """
    template = json.loads(template_path.read_text(encoding="utf-8"))
    annotations = json.loads(annotations_path.read_text(encoding="utf-8"))
    if annotations.get("schemaVersion") == "roboeye-court-visual-corrections-v1":
        corrections = annotations
        base = (annotations_path.parent / corrections["baseFile"]).resolve()
        if not base.is_relative_to(annotations_path.parent.resolve()) or digest(base) != corrections["baseSha256"]:
            raise ValueError("Original manual annotations changed before correction")
        annotations = json.loads(base.read_text(encoding="utf-8"))
        if corrections.get("modelOutputsSeenDuringCorrection") is not False:
            raise ValueError("Pre-seal correction must not consult model outcomes")
        for correction in corrections["corrections"]:
            clip = next(c for c in annotations["clips"] if c["id"] == correction["clip"])
            label = next(label for label in clip["labels"] if label["index"] == correction["index"])
            if label["point"] != correction["before"]:
                raise ValueError("Pre-seal correction does not match the original point")
            label["point"] = correction["after"]
            label["reason"] += "; pre-seal manual ROI measurement refinement, see retained correction log"
        annotations["method"] += " Five pre-seal coordinate refinements use grayscale-contrast weighted moments ONLY inside visually hand-selected ball ROIs, not automatic component detection."
        annotations["preSealCorrectionLogSha256"] = digest(annotations_path)
    if template.get("schemaVersion") != GOLD_SCHEMA or annotations.get("schemaVersion") != "roboeye-court-visual-annotations-v1":
        raise ValueError("Unsupported annotation/template schema")
    if annotations.get("modelOutputsSeenDuringAnnotation") is not False or annotations.get("independentHumanReview") is not False:
        raise ValueError("Manual assistant provenance must remain honest")
    if [c.get("id") for c in template["clips"]] != [c.get("id") for c in annotations["clips"]]:
        raise ValueError("Annotation clip set/order mismatch")
    for gold_clip, manual in zip(template["clips"], annotations["clips"]):
        if [label.get("index") for label in manual["labels"]] != gold_clip["sampling"]["selectedIndices"]:
            raise ValueError("Manual annotations must cover precisely the predeclared uniform samples")
        for label in manual["labels"]:
            if label.get("status") not in ("visible", "absent", "unknown"):
                raise ValueError("Invalid manual status")
            gold_clip["labels"][label["index"]].update(label)
    template["labelProvenance"].update({"annotator": annotations["annotator"], "manualAnnotationsSha256": digest(annotations_path),
        "pixelDefinition": annotations["pixelDefinition"], "method": annotations["method"], "sealed": False,
        "independentHumanReview": False, "modelOutputsSeenDuringAnnotation": False})
    if "preSealCorrectionLogSha256" in annotations:
        template["labelProvenance"]["preSealCorrectionLogSha256"] = annotations["preSealCorrectionLogSha256"]
    write_json(output_path, template)
    return template


def prepare(output: Path, allow_download: bool = False) -> dict:
    started = time.perf_counter()
    output.mkdir(parents=True, exist_ok=True)
    rgb_path, gold_path = output / "rgb-manifest.json", output / "gold-template.json"
    if rgb_path.exists() or gold_path.exists():
        raise ValueError("Existing benchmark is immutable; use a new explicitly named output directory")
    downloaded_bytes = 0
    rights_path = output / "rights" / "mendeley-snapshot-v2.json"
    if not rights_path.exists():
        if not allow_download:
            raise ValueError("License receipt is missing; use --download-tennist for the fixed approved sources")
        receipt = download(DATASET_API, rights_path, 256 * 1024)
        downloaded_bytes += receipt["bytes"]
    metadata = json.loads(rights_path.read_text(encoding="utf-8"))
    license_record = metadata.get("licence", metadata.get("license", {}))
    if "creativecommons.org/licenses/by/4.0" not in json.dumps(license_record):
        raise ValueError("Publisher dataset receipt does not declare CC BY 4.0")
    if metadata.get("version") != 2 or metadata.get("id") != "75m8vz7jr2":
        raise ValueError("Wrong publisher dataset snapshot")
    downloads, clips, gold_clips = [], [], []
    cv2.setNumThreads(1)
    for item in FILES:
        source = output / "videos" / item["name"]
        url = f"https://data.mendeley.com/public-files/datasets/75m8vz7jr2/files/{item['fileId']}/file_downloaded"
        if not source.exists():
            if not allow_download:
                raise ValueError(f"Source not staged: {item['name']}")
            received = download(url, source, item["bytes"], item["sha256"])
            downloaded_bytes += received["bytes"]
        if source.stat().st_size != item["bytes"] or digest(source) != item["sha256"]:
            raise ValueError("Staged source mismatch")
        if downloaded_bytes > 20 * 1024 * 1024:
            raise ValueError("Total download budget exceeded")
        downloads.append({**item, "url": url, "localFile": str(source.relative_to(output))})
        capture = cv2.VideoCapture(str(source))
        try:
            if not capture.isOpened():
                raise ValueError("Could not decode the real video")
            width, height = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps, declared_frames = float(capture.get(cv2.CAP_PROP_FPS)), int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
            if not 0 < fps <= 300 or not 12 <= declared_frames <= 20_000 or width * height > 4096 * 2160:
                raise ValueError("Video exceeds decode budget")
            if declared_frames / fps > 300:
                raise ValueError("Video exceeds duration budget")
            selected = sample_indices(declared_frames)
            image_records, labels = [], []
            sheet = np.full((3 * 244, 4 * 384, 3), 244, np.uint8)
            index = 0
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if index >= 20_000 or frame.shape[:2] != (height, width):
                    raise ValueError("Decoded video violates frame budget/shape")
                label = {"index": index, "status": "unknown", "point": None, "reason": "Not visually annotated; excluded from accuracy denominator"}
                if index in selected:
                    relative = f"annotation-images/{item['id']}/frame-{index:05d}.png"
                    image_path = output / relative
                    image_path.parent.mkdir(parents=True, exist_ok=True)
                    if not cv2.imwrite(str(image_path), frame):
                        raise ValueError("Could not save source annotation frame")
                    label["annotationImage"] = {"file": relative, "sha256": digest(image_path)}
                    image_records.append(label["annotationImage"])
                    k = selected.index(index)
                    scale = min(384 / width, 216 / height)
                    preview = cv2.resize(frame, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
                    x = (k % 4) * 384 + (384 - preview.shape[1]) // 2
                    y = (k // 4) * 244
                    sheet[y:y + preview.shape[0], x:x + preview.shape[1]] = preview
                    cv2.putText(sheet, f"{item['id']} / frame {index}", ((k % 4) * 384 + 8, y + 236), cv2.FONT_HERSHEY_SIMPLEX, .52, (30, 30, 30), 1, cv2.LINE_AA)
                labels.append(label)
                index += 1
            if index != declared_frames:
                raise ValueError("Frame count differs from publisher source decode; no silent truncation")
        finally:
            capture.release()
        clip = {"id": item["id"], "videoFile": str(source.relative_to(output)), "videoSha256": item["sha256"],
                "width": width, "height": height, "fps": fps, "frameCount": index, "durationSeconds": index / fps,
                "timestampBasis": "container-nominal-fps", "sourceDataset": "TenniST-v2", "sport": "tennis"}
        clips.append(clip)
        gold_clips.append({"id": item["id"], "sampling": {"strategy": "uniform-twelve-before-inference", "selectedIndices": selected}, "labels": labels})
        cv2.imwrite(str(output / f"{item['id']}-contact.jpg"), sheet)
    license_info = {"id": "CC-BY-4.0", "url": "https://creativecommons.org/licenses/by/4.0/", "sourceUrl": DATASET_URL,
                    "attribution": ATTRIBUTION, "receiptFile": "rights/mendeley-snapshot-v2.json", "receiptSha256": digest(rights_path),
                    "limits": "Tennis, not pickleball. Dataset landing coordinates are not per-frame ball pixels. Further permission may be needed for identified third-party material."}
    rgb = {"schemaVersion": RGB_SCHEMA, "datasetId": "roboeye-court-tennist-m2-r1", "license": license_info,
           "clips": clips, "noGoldRead": "This manifest contains RGB source metadata only; no label file or outcomes are supplied to inference."}
    write_json(rgb_path, rgb)
    gold = {"schemaVersion": GOLD_SCHEMA, "rgbManifestSha256": digest(rgb_path),
            "matching": {"metric": "native-pixel-center-distance", "radiusPixels": 8},
            "labelProvenance": {"kind": "assistant-visual-annotation", "annotator": "UNREVIEWED", "sealed": False,
                                "independentHumanReview": False, "derivedFromPublishedLandingPoints": False,
                                "modelOutputsSeenDuringAnnotation": False}, "clips": gold_clips}
    write_json(gold_path, gold)
    summary = {"downloadedBytes": downloaded_bytes, "sources": downloads, "license": license_info,
               "rgbManifestSha256": digest(rgb_path), "goldTemplateSha256": digest(gold_path),
               "preparedMs": (time.perf_counter() - started) * 1000,
               "clips": [{**c, "annotationIndices": g["sampling"]["selectedIndices"]} for c, g in zip(clips, gold_clips)]}
    write_json(output / "preparation-receipt.json", summary)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--download-tennist", action="store_true")
    parser.add_argument("--apply-visual", type=Path, help="Combine manual annotations with --template; never seals gold")
    parser.add_argument("--template", type=Path)
    parser.add_argument("--seal-reviewed-gold", type=Path, help="Seal a Contractor-cross-checked draft; does not run inference")
    parser.add_argument("--reviewer", help="Actual reviewer identity and scope, not a simulated review")
    args = parser.parse_args()
    if args.seal_reviewed_gold:
        if not args.reviewer:
            parser.error("--seal-reviewed-gold requires the actual --reviewer")
        if args.out.exists():
            raise ValueError("Refusing to overwrite an existing gold seal")
        gold = json.loads(args.seal_reviewed_gold.read_text(encoding="utf-8"))
        if gold.get("schemaVersion") != GOLD_SCHEMA or gold.get("labelProvenance", {}).get("sealed") is not False:
            raise ValueError("Only an unsealed supported draft can be sealed")
        gold["labelProvenance"].update({"sealed": True, "sealedAtUtc": datetime.now(timezone.utc).isoformat(),
            "sealedBeforeInference": True, "contractorCrosscheck": {"kind": "assistant-visual-crosscheck", "reviewerAndScope": args.reviewer},
            "draftSha256": digest(args.seal_reviewed_gold)})
        write_json(args.out.resolve(), gold)
        print(json.dumps({"sealedGold": str(args.out), "sha256": digest(args.out.resolve())}))
        return
    if args.apply_visual:
        if not args.template:
            parser.error("--apply-visual requires --template")
        apply_visual_annotations(args.template.resolve(), args.apply_visual.resolve(), args.out.resolve())
        print(json.dumps({"goldDraft": str(args.out), "sha256": digest(args.out.resolve()), "sealed": False}))
        return
    result = prepare(args.out.resolve(), args.download_tennist)
    print(json.dumps({"downloadedBytes": result["downloadedBytes"], "clips": result["clips"], "preparedMs": result["preparedMs"]}, indent=2))


if __name__ == "__main__":
    main()
