#!/usr/bin/env python3
"""New-source still-photo negatives: authored camera transforms, not field video."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from assist_scene_m3g_controls import geometry, FRAME_COUNT, FRAME_US, WORKING_SIZE
from assist_scene_motion import sha256
from assist_scene_motion_m3c import load_input


def prepare(inputs, destination):
    manifest, root = load_input(inputs)
    source = manifest["clips"][0]["frames"][0]
    path = root/source["path"]
    if manifest["dataset"] != "Boreas-real" or sha256(path) != source["sha256"]:
        raise ValueError("Expected hash-bound Boreas source")
    image = cv2.imread(str(path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
    if image is None or image.shape[:2] != (2048, 2448):
        raise ValueError("Wrong still-photo geometry")
    image = cv2.resize(image, WORKING_SIZE, interpolation=cv2.INTER_AREA)
    width, height = WORKING_SIZE
    k = np.asarray([[1240., 0., width/2], [0., 1240., height/2], [0., 0., 1.]])
    runtime = {"schemaVersion": 1, "dataset": "synthetic-m3c", "clips": []}
    gold = {"schemaVersion": 1, "review": {
        "kind": "assistant-authored-single-real-photo-camera-transforms",
        "sourceInputSha256": sha256(inputs), "sourceSha256": source["sha256"],
        "sourceToken": source["token"], "generatorSha256": sha256(Path(__file__)),
        "geometryHelperSha256": sha256(Path(__file__).with_name("assist_scene_m3g_controls.py")),
        "scope": "All scene objects are frozen; only authored camera rotation or unreported digital zoom changes pixels. Not independent field clips or human certification.",
        "intrinsics": "synthetic 1240-pixel K", "distanceGroundTruth": "not supplied"
    }, "clips": []}
    destination.mkdir(exist_ok=False)
    for scenario in ("static", "zoom", "pan", "shake"):
        clip = {"id": "m3h-control-"+scenario, "frames": []}
        truth = {"id": clip["id"], "allSceneNegative": True, "frames": []}
        for i in range(FRAME_COUNT):
            warp, rotation = geometry(scenario, i, width, height, k, np.zeros(4))
            pixels = image if scenario == "static" else cv2.warpPerspective(
                image, warp, WORKING_SIZE, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
            name = f"{clip['id']}-{i:02d}.jpg"
            target = destination/name
            if not cv2.imwrite(str(target), pixels, [cv2.IMWRITE_JPEG_QUALITY, 97]):
                raise RuntimeError("Cannot encode control")
            timestamp = source["timestampUs"]+i*FRAME_US
            pose = np.eye(4); pose[:3, :3] = rotation
            token = name.removesuffix(".jpg")
            clip["frames"].append({"token": token, "path": name, "timestampUs": timestamp,
                                   "poseTimestampUs": timestamp, "cameraToWorld": pose.tolist(),
                                   "intrinsics": k.tolist(), "sha256": sha256(target), "isKeyFrame": False})
            # Exhaustive scene-level negative, not individually boxed objects.
            truth["frames"].append({"token": token, "timestampUs": timestamp, "targets": []})
        runtime["clips"].append(clip); gold["clips"].append(truth)
    output = destination/"input.json"
    output.write_text(json.dumps(runtime, indent=2, allow_nan=False)+"\n")
    gold["inputSha256"] = sha256(output)
    (destination/"truth.json").write_text(json.dumps(gold, indent=2, allow_nan=False)+"\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.input, args.output)
