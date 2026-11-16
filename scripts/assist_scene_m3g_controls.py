#!/usr/bin/env python3
"""Pinned real-photo controls: authored optical expansion, NOT physical ground truth.

No detector outputs or real holdout labels are read. Two runnable manifests share
the same images; the six-clip master is an inventory, not a loader-limit bypass.
"""

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from assist_scene_m3e_controls import local_scale, point_box, rotation
from assist_scene_motion import sha256


SOURCE_SUBPATH = "camera/1598990957178232.png"
SOURCE_SHA = "d01562f2961045492a42770f4476cf13a4dbc1ccd7663c1644366fb0fb623aa9"
SOURCE_TIMESTAMP = 1598990957178232
# Hand-boxed on the 960 x 803 source preview before detector replay.
PREVIEW_SIZE = (960, 803)
BOX = (403., 425., 546., 543.)
ALT_BOX = (128., 419., 178., 447.)
WORKING_SIZE = (1920, 1606)
SCENARIOS = ("static", "zoom", "pan", "shake", "approach-slow", "approach-fast")
FRAME_COUNT = 20
FRAME_US = 90_000


def pixel_box(box, width, height):
    return np.asarray(box, dtype=float) * [width/960, height/803, width/960, height/803]


def geometry(scenario, index, width, height, intrinsics, box):
    """Return image homography and synchronized authored camera rotation."""
    if scenario not in SCENARIOS or not 0 <= index < FRAME_COUNT:
        raise ValueError("Unknown control scenario or frame")
    warp, rot = np.eye(3), np.eye(3)
    if scenario == "zoom":
        # Undisclosed digital zoom: nominal K and pose intentionally unchanged.
        warp[:2] = cv2.getRotationMatrix2D((width/2, height/2), 0., 1.012**index)
    elif scenario in {"pan", "shake"}:
        angles = ((.004*(index-6), 0., 0.) if scenario == "pan" else
                  (.012*math.sin(index*1.7), .009*math.cos(index*2.4), .010*math.sin(index*2.8)))
        rot = rotation(*angles)
        warp = intrinsics @ rot.T @ np.linalg.inv(intrinsics)
    elif scenario.startswith("approach-"):
        scale = (1.009 if scenario == "approach-slow" else 1.035)**index
        center = (box[:2]+box[2:])/2
        warp[:2] = cv2.getRotationMatrix2D(tuple(center), 0., scale)
    return warp, rot


def approach_state(scenario, index):
    if scenario.startswith("approach-"):
        return "approaching" if index*FRAME_US >= 400_000 else "unknown"
    return "not-approaching"


def frame_targets(scenario, index, width, height, warp):
    box, competitor = (pixel_box(b, width, height) for b in (BOX, ALT_BOX))
    return [
        {"instance": "checked-orange-lead", "classFamily": "vehicle",
         "box": point_box(box, height, width, warp), "approach": approach_state(scenario, index)},
        {"instance": "checked-left-static-car", "classFamily": "vehicle",
         "box": point_box(competitor, height, width,
                          np.eye(3) if scenario.startswith("approach-") else warp),
         "approach": "not-approaching"},
    ]


def write_pair(destination, manifest, gold, suffix=""):
    """Every truth group binds its own exact manifest bytes, not the master."""
    inp = destination/f"input{suffix}.json"
    inp.write_text(json.dumps(manifest, indent=2, allow_nan=False)+"\n", encoding="utf-8")
    payload = {**gold, "inputSha256": sha256(inp)}
    (destination/f"truth{suffix}.json").write_text(
        json.dumps(payload, indent=2, allow_nan=False)+"\n", encoding="utf-8")


def write_groups(destination, manifest, gold):
    write_pair(destination, manifest, gold)
    for suffix, start, end in (("-negatives", 0, 4), ("-positives", 4, 6)):
        write_pair(destination, {**manifest, "clips": manifest["clips"][start:end]},
                   {**gold, "clips": gold["clips"][start:end]}, suffix)


def draw_sheet(destination, manifest, gold):
    canvas = Image.new("RGB", (1080, 210*len(SCENARIOS)), "#151515")
    for row, (clip, truth) in enumerate(zip(manifest["clips"], gold["clips"], strict=True)):
        for column, index in enumerate((0, 9, 19)):
            with Image.open(destination/clip["frames"][index]["path"]) as opened:
                image = opened.convert("RGB")
            width, height = image.size
            target = truth["frames"][index]["targets"][0]["box"]
            x, y = round(target["x"]*width), round(target["y"]*height)
            right, bottom = (round((target["x"]+target["width"])*width),
                             round((target["y"]+target["height"])*height))
            ImageDraw.Draw(image).rectangle((x, y, right, bottom), outline="#31ff92", width=3)
            image = image.crop((max(0, x-50), max(0, y-40), min(width, right+50), min(height, bottom+40)))
            image.thumbnail((348, 180), Image.Resampling.LANCZOS)
            cx, cy = column*360, row*210
            canvas.paste(image, (cx, cy+23))
            ImageDraw.Draw(canvas).text((cx+5, cy+5), f"{clip['id']} / {index}", fill="white")
    canvas.save(destination/"review-sheet.jpg", quality=91)


def prepare(source_root, destination):
    source = source_root/SOURCE_SUBPATH
    if sha256(source) != SOURCE_SHA:
        raise ValueError("Study source hash mismatch")
    image = cv2.imread(str(source), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
    if image is None or image.shape[:2] != (2048, 2448):
        raise ValueError("Wrong source geometry")
    width, height = WORKING_SIZE
    image = cv2.resize(image, WORKING_SIZE, interpolation=cv2.INTER_AREA)
    intrinsics = np.asarray([[1240., 0., width/2], [0., 1240., height/2], [0., 0., 1.]])
    box = pixel_box(BOX, width, height)
    evidence = {"sourceSha256": SOURCE_SHA, "sourceSubpath": SOURCE_SUBPATH,
                "kind": "assistant-authored-real-photo-transforms-NOT-physical-GT",
                "poseKind": "authored-camera-rotation", "intrinsicsKind": "synthetic-1240-pixel-K",
                "distanceGroundTruth": "not-supplied", "frameIntervalUs": FRAME_US}
    manifest = {"schemaVersion": 1, "dataset": "synthetic-m3c", "evidence": evidence, "clips": []}
    gold = {"schemaVersion": 1, "review": {
        **evidence, "method": "fixed ROI transformed by authored image homographies before inference",
        "reviewedPreviewSize": list(PREVIEW_SIZE), "reviewedLeadROI": list(BOX),
        "reviewedCompetitorROI": list(ALT_BOX),
        "scope": "synthetic optical expansion controls, not independent physical motion or field validation"}, "clips": []}
    # Validate every target before any output is created. Out-of-view targets
    # fail loudly rather than being silently clipped into false ground truth.
    for scenario in SCENARIOS:
        for index in range(FRAME_COUNT):
            warp, _ = geometry(scenario, index, width, height, intrinsics, box)
            frame_targets(scenario, index, width, height, warp)
    destination.mkdir(exist_ok=False)
    for scenario in SCENARIOS:
        positive = scenario.startswith("approach-")
        clip = {"id": "m3g-control-"+scenario, "frames": []}
        truth = {"id": clip["id"], "allSceneNegative": not positive, "frames": []}
        manifest["clips"].append(clip)
        gold["clips"].append(truth)
        for index in range(FRAME_COUNT):
            warp, rot = geometry(scenario, index, width, height, intrinsics, box)
            view = image
            if positive:
                scale = (1.009 if scenario == "approach-slow" else 1.035)**index
                view, actual_warp = local_scale(image, box, scale)
                if not np.allclose(actual_warp, warp):
                    raise ValueError("Local image and target transforms diverged")
            elif scenario != "static":
                view = cv2.warpPerspective(image, warp, WORKING_SIZE, flags=cv2.INTER_LINEAR,
                                           borderMode=cv2.BORDER_REFLECT_101)
            name = f"{clip['id']}-{index:02d}.jpg"
            path = destination/name
            if not cv2.imwrite(str(path), view, [cv2.IMWRITE_JPEG_QUALITY, 97]):
                raise RuntimeError("Cannot write bounded control")
            timestamp = SOURCE_TIMESTAMP+index*FRAME_US
            pose = np.eye(4)
            pose[:3, :3] = rot
            token = name.removesuffix(".jpg")
            clip["frames"].append({"token": token, "path": name, "timestampUs": timestamp,
                                   "poseTimestampUs": timestamp, "cameraToWorld": pose.tolist(),
                                   "intrinsics": intrinsics.tolist(), "sha256": sha256(path), "isKeyFrame": False})
            truth["frames"].append({"token": token, "timestampUs": timestamp,
                                    "targets": frame_targets(scenario, index, width, height, warp)})
    write_groups(destination, manifest, gold)
    draw_sheet(destination, manifest, gold)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source_root, args.output)
