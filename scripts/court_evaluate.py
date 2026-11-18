#!/usr/bin/env python3
"""Score frozen Court session predictions against separately sealed sparse gold.

No inference runs here. Native-pixel matching uses a fixed predeclared 8px gate.
Wrong accepted locations count as BOTH a false positive and a missed true ball.
Unknown/unreviewed frames never become true negatives.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import time

import cv2

RGB_SCHEMA = "roboeye-court-benchmark-rgb-v1"
GOLD_SCHEMA = "roboeye-court-benchmark-gold-v1"
RADIUS_PIXELS = 8.0


def file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    if path.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("JSON exceeds bounded scorer input")
    return json.loads(path.read_text(encoding="utf-8"))


def finite(value) -> bool:
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def safe_id(value) -> bool:
    return isinstance(value, str) and bool(value) and len(value) <= 80 and all(c.isalnum() or c in "-_" for c in value)


def validate_rgb(rgb: dict, directory: Path) -> None:
    if rgb.get("schemaVersion") != RGB_SCHEMA or not isinstance(rgb.get("clips"), list) or not 1 <= len(rgb["clips"]) <= 10:
        raise ValueError("Invalid RGB manifest")
    ids = set()
    for clip in rgb["clips"]:
        if not safe_id(clip.get("id")) or clip["id"] in ids:
            raise ValueError("Invalid or duplicate clip identity")
        ids.add(clip["id"])
        source = (directory / clip["videoFile"]).resolve()
        if not source.is_relative_to(directory.resolve()) or not source.is_file() or file_sha(source) != clip.get("videoSha256"):
            raise ValueError("RGB video source hash/path mismatch")
        if not all(finite(clip.get(k)) and clip[k] > 0 for k in ("fps", "width", "height", "frameCount", "durationSeconds")):
            raise ValueError("RGB dimensions/timing invalid")
        if not isinstance(clip["frameCount"], int) or clip["frameCount"] > 20_000 or abs(clip["frameCount"] / clip["fps"] - clip["durationSeconds"]) > 1e-5:
            raise ValueError("RGB nominal timeline mismatch")
        capture = cv2.VideoCapture(str(source))
        try:
            if not capture.isOpened() or int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)) != clip["width"] or int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) != clip["height"] or int(capture.get(cv2.CAP_PROP_FRAME_COUNT)) != clip["frameCount"] or abs(float(capture.get(cv2.CAP_PROP_FPS)) - clip["fps"]) > 1e-5:
                raise ValueError("RGB metadata does not match the actual source video")
        finally:
            capture.release()


def validate_prediction(session: dict, clip: dict) -> None:
    if session.get("schemaVersion") != "roboeye-court-session-v1" or session.get("decision", {}).get("status") != "insufficient-evidence":
        raise ValueError("Prediction schema/decision unsupported")
    source = session.get("source", {})
    if source.get("sha256") != clip["videoSha256"] or any(source.get(k) != clip[k] for k in ("width", "height", "frameCount")):
        raise ValueError("Prediction source mismatch")
    if any(not finite(source.get(k)) or abs(source[k] - clip[k]) > 1e-5 for k in ("fps", "durationSeconds")):
        raise ValueError("Prediction source timeline mismatch")
    frames = session.get("frames")
    if not isinstance(frames, list) or len(frames) != clip["frameCount"]:
        raise ValueError("Predictions must include every frame")
    for index, frame in enumerate(frames):
        if frame.get("index") != index or not finite(frame.get("timeSeconds")) or abs(frame["timeSeconds"] - index / clip["fps"]) > 1e-5:
            raise ValueError("Prediction frame alignment mismatch")
        status, ball = frame.get("status"), frame.get("ball")
        if status not in ("observed", "ambiguous", "missing"):
            raise ValueError("Prediction observation status invalid")
        if status != "observed":
            if ball is not None:
                raise ValueError("Unobserved prediction cannot retain a ball")
        elif not isinstance(ball, dict) or not all(finite(ball.get(k)) for k in ("x", "y")) or not (0 <= ball["x"] <= clip["width"] and 0 <= ball["y"] <= clip["height"]):
            raise ValueError("Accepted prediction location invalid")


def validate_gold(gold: dict, rgb: dict, rgb_sha: str) -> None:
    if gold.get("schemaVersion") != GOLD_SCHEMA or gold.get("rgbManifestSha256") != rgb_sha:
        raise ValueError("Gold/RGB binding mismatch")
    if gold.get("matching", {}).get("radiusPixels") != RADIUS_PIXELS or gold.get("matching", {}).get("metric") != "native-pixel-center-distance":
        raise ValueError("Scorer gate must remain the predeclared native 8px distance")
    provenance = gold.get("labelProvenance", {})
    if provenance.get("kind") != "assistant-visual-annotation" or provenance.get("independentHumanReview") is not False or provenance.get("sealed") is not True or provenance.get("modelOutputsSeenDuringAnnotation") is not False or provenance.get("derivedFromPublishedLandingPoints") is not False or provenance.get("annotator") in (None, "UNREVIEWED", ""):
        raise ValueError("Gold must be sealed with honest pre-inference label provenance")
    clips = gold.get("clips")
    if not isinstance(clips, list) or [c.get("id") for c in clips] != [c["id"] for c in rgb["clips"]]:
        raise ValueError("Gold clip set/order mismatch")
    for labels_clip, clip in zip(clips, rgb["clips"]):
        selected = [(i * (clip["frameCount"] - 1)) // 11 for i in range(12)]
        if labels_clip.get("sampling", {}).get("selectedIndices") != selected:
            raise ValueError("Gold sampling changed from predeclared twelve uniform frames")
        labels = labels_clip.get("labels")
        if not isinstance(labels, list) or len(labels) != clip["frameCount"]:
            raise ValueError("Every frame requires visible/absent/unknown gold status")
        for index, label in enumerate(labels):
            if label.get("index") != index or label.get("status") not in ("visible", "absent", "unknown") or not isinstance(label.get("reason"), str) or not label["reason"]:
                raise ValueError("Gold label status/index/reason invalid")
            if index not in selected and label["status"] != "unknown":
                raise ValueError("Unselected frames must remain explicitly unknown")
            point = label.get("point")
            if label["status"] == "visible":
                if not isinstance(point, list) or len(point) != 2 or not all(finite(v) for v in point) or not (0 <= point[0] <= clip["width"] and 0 <= point[1] <= clip["height"]):
                    raise ValueError("Visible gold needs an in-image point")
            elif point is not None:
                raise ValueError("Absent/unknown gold cannot have a point")


def empty_counts() -> dict:
    return {key: 0 for key in ("correctVisible", "wrongVisible", "missedVisible", "falseOnAbsent", "correctAbsent", "unknown", "unknownPredicted")}


def metrics(counts: dict) -> dict:
    tp, fp = counts["correctVisible"], counts["wrongVisible"] + counts["falseOnAbsent"]
    fn, tn = counts["missedVisible"] + counts["wrongVisible"], counts["correctAbsent"]
    return {**counts, "TP": tp, "FP": fp, "FN": fn, "TN": tn,
            "precision": tp / (tp + fp) if tp + fp else None,
            "recall": tp / (tp + fn) if tp + fn else None,
            "falseAlarmRateOnAbsentFrames": counts["falseOnAbsent"] / (counts["falseOnAbsent"] + counts["correctAbsent"]) if counts["falseOnAbsent"] + counts["correctAbsent"] else None,
            "scoredFrames": counts["correctVisible"] + counts["wrongVisible"] + counts["missedVisible"] + counts["falseOnAbsent"] + counts["correctAbsent"]}


def score_clip(session: dict, labels: list[dict], radius_pixels: float = RADIUS_PIXELS) -> dict:
    if radius_pixels != RADIUS_PIXELS:
        raise ValueError("No post-hoc scorer threshold changes")
    counts, rows = empty_counts(), []
    for frame, label in zip(session["frames"], labels):
        accepted = frame["status"] == "observed" and frame["ball"] is not None
        distance = None
        if label["status"] == "unknown":
            counts["unknown"] += 1
            counts["unknownPredicted"] += int(accepted)
            continue
        if label["status"] == "absent":
            result = "falseOnAbsent" if accepted else "correctAbsent"
        elif not accepted:
            result = "missedVisible"
        else:
            distance = math.hypot(frame["ball"]["x"] - label["point"][0], frame["ball"]["y"] - label["point"][1])
            result = "correctVisible" if distance <= radius_pixels else "wrongVisible"
        counts[result] += 1
        rows.append({"index": frame["index"], "truth": label["status"], "point": label["point"], "predictionStatus": frame["status"],
                     "prediction": [frame["ball"]["x"], frame["ball"]["y"]] if accepted else None,
                     "distancePixels": distance, "outcome": result})
    return {"counts": metrics(counts), "scoredRows": rows}


def require_gold_sha(gold_path: Path, expected_gold_sha: str) -> str:
    if not isinstance(expected_gold_sha, str) or len(expected_gold_sha) != 64 or any(c not in "0123456789abcdef" for c in expected_gold_sha):
        raise ValueError("Provide the pre-inference sealed gold SHA-256")
    actual = file_sha(gold_path)
    if actual != expected_gold_sha:
        raise ValueError("Gold bytes changed since the pre-inference seal")
    return actual


def evaluate(rgb_path: Path, gold_path: Path, arms: dict[str, Path], output: Path, expected_gold_sha: str) -> dict:
    started = time.perf_counter()
    if len(arms) != 2:
        raise ValueError("Provide exactly two fixed A/B arms")
    rgb = load_json(rgb_path)
    validate_rgb(rgb, rgb_path.parent)
    # Read and fingerprint ALL frozen prediction bytes BEFORE opening gold.
    observations, receipts = {}, {}
    for name, directory in arms.items():
        observations[name], receipts[name] = {}, {}
        for clip in rgb["clips"]:
            path = directory / f"{clip['id']}.json"
            observations[name][clip["id"]] = load_json(path)
            receipts[name][clip["id"]] = {"file": str(path), "sha256": file_sha(path)}
            validate_prediction(observations[name][clip["id"]], clip)
    # A mutable `sealed:true` field is not a digest binding. Caller must retain
    # this exact SHA before inference, not compute an expected value afterwards.
    sealed_gold_sha = require_gold_sha(gold_path, expected_gold_sha)
    gold = load_json(gold_path)
    validate_gold(gold, rgb, file_sha(rgb_path))
    report = {"schemaVersion": "roboeye-court-ab-report-v1", "rgbManifestSha256": file_sha(rgb_path), "goldSha256": sealed_gold_sha,
              "matchingRadiusNativePixels": RADIUS_PIXELS, "predictionFilesReadBeforeGoldOpened": True,
              "scorerSha256": file_sha(Path(__file__)),
              "labelProvenance": gold["labelProvenance"], "predictionReceipts": receipts, "arms": {},
              "limits": ["Sparse assistant visual labels on tennis, not independent human per-frame dataset ground truth.",
                         "Wrong visible accepted locations count as both FP and FN; confusion counts are not a disjoint frame partition.",
                         "Unreviewed/ambiguous gold frames are unknown and excluded, never counted as TN.",
                         "This does not measure bounce/contact, In/Out accuracy, physical metres or pickleball generalization."]}
    visible_gold = sum(label["status"] == "visible" for clip in gold["clips"] for label in clip["labels"])
    absent_gold = sum(label["status"] == "absent" for clip in gold["clips"] for label in clip["labels"])
    selected_count = sum(len(clip["sampling"]["selectedIndices"]) for clip in gold["clips"])
    total_frames = sum(clip["frameCount"] for clip in rgb["clips"])
    report["goldCoverage"] = {"totalVideoFrames": total_frames, "predeclaredSelectedFrames": selected_count,
        "visibleFrames": visible_gold, "absentFrames": absent_gold,
        "selectedUnknownFrames": selected_count - visible_gold - absent_gold,
        "unselectedUnknownFrames": total_frames - selected_count}
    report["preSealCorrectionNote"] = "R1 manual labels retained. Five raw-pixel coordinate corrections were reviewed BEFORE the immutable R2 gold seal and BEFORE inference; no labels or matching thresholds changed after outcomes."
    if absent_gold == 0:
        report["limits"].append("No selected frame has a verified absent label. False-alarm rate on no-ball frames is UNMEASURED, not zero; precision here is conditional on the reviewed visible-frame pool.")
    for name in arms:
        totals, clips = empty_counts(), {}
        for label_clip, clip in zip(gold["clips"], rgb["clips"]):
            session = observations[name][clip["id"]]
            result = score_clip(session, label_clip["labels"])
            for key in totals:
                totals[key] += result["counts"][key]
            result["method"] = session.get("method")
            result["summary"] = session.get("summary")
            clips[clip["id"]] = result
        report["arms"][name] = {"counts": metrics(totals), "clips": clips}
    report["evaluationMs"] = (time.perf_counter() - started) * 1000
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rgb", required=True, type=Path)
    parser.add_argument("--gold", required=True, type=Path)
    parser.add_argument("--expected-gold-sha", required=True, help="Exact gold SHA retained BEFORE predictor runs")
    parser.add_argument("--arm", action="append", required=True, help="A=/path/to/frozen/sessions")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    arms = {}
    for arm in args.arm:
        name, separator, path = arm.partition("=")
        if not separator or not safe_id(name) or name in arms:
            raise ValueError("Use distinct --arm A=/directory and --arm B=/directory")
        arms[name] = Path(path)
    report = evaluate(args.rgb.resolve(), args.gold.resolve(), arms, args.out.resolve(), args.expected_gold_sha)
    print(json.dumps({name: arm["counts"] for name, arm in report["arms"].items()}, indent=2))


if __name__ == "__main__":
    main()
