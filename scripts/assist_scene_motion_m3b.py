#!/usr/bin/env python3
"""Same-box offline ablation: 5 Hz M3 versus a high-rate evidence path."""

import argparse
from datetime import date
import json
from pathlib import Path
import platform
import subprocess
import tempfile
from time import perf_counter

import cv2

from assist_scene_motion import (
    ROOT, MotionState, decode, elapsed, parse_detect, read_manifest, registered, sha256,
)
from assist_scene_registration import BackgroundChain, POLICY as BACKGROUND_POLICY
from assist_scene_camera_guard import CameraScaleGuard, affine_scale, POLICY as SCALE_POLICY
from assist_scene_rgb_output import render_rgb_frame
from assist_scene_track_burst import BurstTracker, POLICY as OBJECT_POLICY


def detect_samples(items, sceneqa, yolo):
    job = subprocess.run([str(sceneqa), str(yolo), *(str(p) for _, _, p in items)],
                         text=True, capture_output=True, check=True, timeout=90)
    result = json.loads(job.stdout)
    indexed = {Path(row["path"]): row for row in result["images"]}
    if (result.get("schemaVersion") != 1 or len(result["images"]) != len(items)
            or set(indexed) != {p for _, _, p in items}):
        raise ValueError("Unexpected detector frame binding")
    return result["configuration"], {i: (t, indexed[p]) for i, t, p in items}


def present(registration_valid, tracker, time_ms, tracks, events):
    result = render_rgb_frame(time_ms=time_ms, epoch=tracker.epoch,
                              registration_valid=registration_valid, tracks=tracks,
                              compensated_events=events)
    ids = {n["trackId"] for n in result["motion"]["trackNotices"]}
    return {"epoch": tracker.epoch, "tracks": tracks,
            "events": [e for e in events if e["trackId"] in ids], "answers": result}


def dense_samples(path, fps, count, sceneqa, yolo, work):
    """Diagnostic only. Read recorded detector frames at source cadence."""
    video = cv2.VideoCapture(str(path))
    queued, detections = [], {}
    try:
        for i in range(count):
            ok, frame = video.read()
            if not ok or max(frame.shape[:2]) > 768:
                raise ValueError("Invalid dense diagnostic source")
            name = work / f"dense-{i:03d}.jpg"
            if not cv2.imwrite(str(name), frame, [cv2.IMWRITE_JPEG_QUALITY, 93]):
                raise RuntimeError("Dense diagnostic JPEG write failed")
            queued.append((i, i/fps*1000, name))
            if len(queued) == 50 or i+1 == count:
                _, reports = detect_samples(queued, sceneqa, yolo)
                detections.update(reports)
                queued.clear()
    finally:
        video.release()
    return detections


def run(clip, sceneqa, yolo, work, dense=False):
    key, path, name, digest, hz = clip
    if hz not in {5, 6} or sha256(path) != digest:
        raise ValueError(f"{key}: expected pinned detector fixture")
    items, source = decode(path, hz, work)
    fps = source["sourceFps"]
    if not 20 <= fps <= 30:
        raise ValueError("M3B requires 20–30 Hz CFR sources")
    detector, samples = detect_samples(items, sceneqa, yolo)
    more = dense_samples(path, fps, source["declaredFrames"], sceneqa, yolo, work) if dense else {}
    baseline, chain, burst = MotionState(), BackgroundChain(), BurstTracker()
    old_gray, old_boxes = None, []
    base_scale, burst_scale = CameraScaleGuard(), CameraScaleGuard()
    result, statuses, raw_t, dense_proposals, dense_pairs = [], {}, [], [], 0
    video = cv2.VideoCapture(str(path))
    try:
        for i in range(source["declaredFrames"]):
            ok, frame = video.read()
            if not ok:
                raise ValueError("Source changed or truncated between passes")
            at = round(1000*i/fps, 3)
            h, w = frame.shape[:2]
            if max(w, h) > 768:
                frame = cv2.resize(frame, (round(w*768/max(w,h)), round(h*768/max(w,h))),
                                   interpolation=cv2.INTER_AREA)
            # Match M3's sampled JPEG pixels exactly on detector frames.
            old_input = cv2.imread(str(items[len(result)][2]), cv2.IMREAD_GRAYSCALE) if i in samples else None
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if i in samples and (old_input is None or old_input.shape != gray.shape):
                raise ValueError("Unexpected sampled frame shape")
            h, w = gray.shape
            boxes = parse_detect(samples[i][1], w, h) if i in samples else None
            high_boxes = parse_detect(more[i][1], w, h) if dense else boxes
            matrix, q = chain.push(gray, at, high_boxes)
            reason = q["step"]["status"]
            statuses[reason] = statuses.get(reason, 0) + 1
            begin = perf_counter()
            bt, be = burst.update(gray, chain.last_step, at, high_boxes)
            raw_t.append(q["elapsedMs"] + elapsed(begin))
            if dense:
                dense_pairs += matrix is not None
                if matrix is not None:
                    dense_proposals.extend(be)
            if i not in samples:
                if not dense and be:
                    raise RuntimeError("Predicted-only frame attempted publication")
                continue
            bm, bq = registered(old_gray, old_input, old_boxes, boxes) if old_gray is not None else (None, {"status":"first-frame"})
            btracks, bcomp, _, _ = baseline.update(boxes, bm, at, w, h, old_gray, old_input)
            bcomp = [{**e, "epoch": baseline.epoch, "timeMs": at} for e in bcomp]
            base_veto = base_scale.update(at, affine_scale(bm))
            burst_veto = burst_scale.update(at, affine_scale(matrix))
            result.append({
                "timeMs": at, "sourceFrame": i, "detectorMs": samples[i][1]["detectionMs"],
                "detectorLabels": [d.label for d in boxes],
                "baseline": {"registration": bq["status"], **present(bm is not None, baseline, at, btracks, bcomp)},
                "candidateRaw": {"registrationStatus": q["status"], **present(not dense and matrix is not None, burst, at, bt, be)},
                "candidate": {"registration": q, "scaleAmbiguity": burst_veto,
                              **present(not dense and matrix is not None and not burst_veto, burst, at, bt, be)},
                "m3Guarded": {"registrationStatus": bq["status"], "scaleAmbiguity": base_veto,
                              **present(bm is not None and not base_veto, baseline, at, btracks, bcomp)},
            })
            old_gray, old_boxes = old_input, boxes
        if video.grab():
            raise ValueError("Source has unexpected trailing frames")
    finally:
        video.release()
    if len(result) != len(items) or sha256(path) != digest:
        raise ValueError("Incomplete replay or input changed")
    return {"id": key, "path": name, "sha256": digest, "source": source, "frames": result,
            "denseDiagnostic": None if not dense else {"detectorFps": fps, "validFramePairs": dense_pairs,
                "detectorLabelsPerFrame": [[t["label"] for t in more[i][1]["tracks"]]
                                           for i in range(source["declaredFrames"])],
                "diagnosticProposals": dense_proposals,
                "publicationDisabled": True},
            "rawRegistrationCounts": statuses, "rawStageMs": raw_t, "detector": detector}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("manifest", "sceneqa", "yolo", "output"):
        parser.add_argument(f"--{arg}", type=Path, required=True)
    parser.add_argument("--case", action="append")
    parser.add_argument("--dense-detector-diagnostic", action="store_true",
                        help="Explicit one-clip replay with detection at source FPS; candidate publication disabled")
    args = parser.parse_args()
    if args.output.exists() or args.output.is_symlink() or not args.output.parent.is_dir():
        raise ValueError("Output must be new and inside an existing directory")
    manifest = args.manifest.resolve(strict=True)
    cases = read_manifest(manifest)
    if args.case:
        if set(args.case) - {c[0] for c in cases}:
            raise ValueError("Unknown clip ID")
        cases = [c for c in cases if c[0] in args.case]
    sceneqa, yolo = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    if args.dense_detector_diagnostic and len(cases) != 1:
        raise ValueError("Dense diagnostic is limited to one named clip")
    cv2.setNumThreads(1)
    clips = []
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3b-{date.today():%Y%m%d}-", dir=args.output.parent) as work:
        for i, clip in enumerate(cases):
            cv2.setRNGSeed(2223)
            sub = Path(work).resolve() / str(i)
            sub.mkdir()
            clips.append(run(clip, sceneqa, yolo, sub, dense=args.dense_detector_diagnostic))
    receipt = {"schemaVersion": 1, "experiment": "TIP-65-M3B-Mac", "platform": platform.platform(),
               "opencv": cv2.__version__, "manifestSha256": sha256(manifest), "sceneqaSha256": sha256(sceneqa),
               "codeSha256": {name: sha256(ROOT / "scripts" / name) for name in (
                   "assist_scene_motion_m3b.py", "assist_scene_motion.py", "assist_scene_evidence.py",
                   "assist_scene_rgb_output.py", "assist_scene_registration.py", "assist_scene_track_burst.py",
                   "assist_scene_camera_guard.py")},
               "backgroundPolicy": BACKGROUND_POLICY, "objectPolicy": OBJECT_POLICY, "scalePolicy": SCALE_POLICY,
               "clips": clips,
               "limits": "Recorded RGB and measured media timestamps, no live use, no metres or world-motion proof."}
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(receipt, file, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        file.write("\n")


if __name__ == "__main__":
    main()
