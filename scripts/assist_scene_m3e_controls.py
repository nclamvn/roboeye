#!/usr/bin/env python3
"""Real-image controlled clips. Motion, poses and labels are authored, not field evidence."""

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from assist_scene_motion import sha256


SOURCE_SHA = "3e45e456ce59de59bc748a7f5cc5bb93cbf97d8ecd8e70a60ef2a1a2d73945e5"
SOURCE_SUBPATH = "camera/1598987772122917.png"
# Hand-boxed on the source preview (1200 x 1004), before running YOLO.
BOX = (596., 506., 626., 533.)
ALT_BOX = (695., 514., 757., 550.)
SCENARIOS = ("static", "zoom", "pan", "shake", "approach-gap")
FRAME_COUNT = 16


def pixel_box(source, width, height):
    return np.asarray(source, dtype=float) * [width/1200, height/1004, width/1200, height/1004]


def point_box(box, h, w, matrix):
    x, y, r, b = box
    pair = cv2.perspectiveTransform(np.float64([[(x,y), (x,b), (r,y), (r,b)]]), matrix)[0]
    (x,y), (r,b) = pair.min(axis=0), pair.max(axis=0)
    if not 0 <= x < r <= w or not 0 <= y < b <= h:
        raise ValueError("Control lost its labeled target")
    return {"x": x/w, "y": y/h, "width": (r-x)/w, "height": (b-y)/h}


def rotation(yaw, pitch, roll):
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cr, sr = math.cos(roll), math.sin(roll)
    return np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]]) @ np.array([[1,0,0],[0,cp,-sp],[0,sp,cp]]) @ np.array([[cr,-sr,0],[sr,cr,0],[0,0,1]])


def local_scale(img, box, scale):
    h, w = img.shape[:2]
    center = (box[:2]+box[2:])/2
    width, height = box[2:]-box[:2]
    matrix = np.vstack((cv2.getRotationMatrix2D(tuple(center), 0, scale), [0.,0.,1.]))
    if scale == 1.:
        return img, matrix
    yy, xx = np.ogrid[:h, :w]
    # A fixed local envelope moves only a textured patch around the checked
    # car. The rest of the scene, including camera, stays unchanged.
    ratio = np.maximum(abs(yy-center[1])/height, abs(xx-center[0])/width)
    alpha = np.clip((1.25-ratio)/.35, 0, 1).astype(np.float32)[:, :, None]
    grown = cv2.warpPerspective(img, matrix, (w,h), flags=cv2.INTER_LINEAR)
    return np.rint(alpha*grown+(1-alpha)*img).astype(np.uint8), matrix


def draw_sheet(root, manifest, gold):
    canvas = Image.new("RGB", (1260, 3*400), "#151515")
    for r, (runtime, truth) in enumerate(zip(manifest["clips"], gold["clips"], strict=True)):
        for j, i in enumerate((0, 6, 15)):
            # Small crops for visibility; no prediction/measurements are read.
            image = Image.open(root / runtime["frames"][i]["path"]).convert("RGB")
            target = truth["frames"][i]["targets"][0]["box"]
            w,h = image.size
            x,y,rgt,btm = (round(target["x"]*w), round(target["y"]*h),
                           round((target["x"]+target["width"])*w), round((target["y"]+target["height"])*h))
            rect = ImageDraw.Draw(image)
            rect.rectangle((x,y,rgt,btm), outline="#31ff92", width=2)
            im = image.crop((max(0,x-70), max(0,y-55), min(w,rgt+70), min(h,btm+55)))
            im.thumbnail((405, 182), Image.Resampling.LANCZOS)
            cx,cy=420*j, 210*r
            canvas.paste(im,(cx,cy+20))
            ImageDraw.Draw(canvas).text((cx+8,cy+4), f"{truth['id']} / {i}", fill="white")
    canvas.crop((0,0,1260,210*len(SCENARIOS))).save(root/"review-sheet.jpg", quality=91)


def prepare(source_root, destination):
    source = source_root / SOURCE_SUBPATH
    if sha256(source) != SOURCE_SHA:
        raise ValueError("Study source hash mismatch")
    img = cv2.imread(str(source), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
    if img is None or img.shape[:2] != (2048, 2448):
        raise ValueError("Wrong source geometry")
    w,h = 1920,1606
    img = cv2.resize(img, (w,h), interpolation=cv2.INTER_AREA)
    k = np.asarray([[1240.,0.,w/2],[0.,1240.,h/2],[0.,0.,1.]])
    box, competitor = [pixel_box(b, w, h) for b in (BOX,ALT_BOX)]
    manifest = {"schemaVersion": 1, "dataset": "synthetic-m3c", "clips": []}
    gold = {"schemaVersion": 1, "review": {
        "method": "authored transformations of pinned Boreas RGB; ROI manually checked before replay",
        "sourceSha256": SOURCE_SHA, "scope": "not independently recorded or human certified"}, "clips": []}
    destination.mkdir(exist_ok=False)
    for scenario in SCENARIOS:
        clip = {"id": "m3e-"+scenario, "frames": []}
        positive = scenario == "approach-gap"
        truth = {"id": clip["id"], "frames": [], "allSceneNegative": not positive}
        manifest["clips"].append(clip)
        gold["clips"].append(truth)
        for i in range(FRAME_COUNT):
            rot = np.eye(3)
            view, warp = img, np.eye(3)
            if scenario == "zoom":
                warp[:2] = cv2.getRotationMatrix2D((w/2,h/2), 0., 1.032**i)
                # Deliberately undisclosed digital zoom; K stays nominal.
            elif scenario in {"pan","shake"}:
                angles = ((.012*(i-4), 0., 0.) if scenario == "pan" else
                          (.016*math.sin(i*1.70), .011*math.cos(i*2.4), .014*math.sin(i*2.8)))
                rot = rotation(*angles)
                warp = k @ rot.T @ np.linalg.inv(k)
            if scenario in {"zoom","pan","shake"}:
                view = cv2.warpPerspective(img, warp, (w,h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
            if positive:
                view, warp = local_scale(img, box, 1.041**i)
            name = f"{clip['id']}-{i:02d}.jpg"
            path = destination/name
            if not cv2.imwrite(str(path), view, [cv2.IMWRITE_JPEG_QUALITY, 97]):
                raise RuntimeError("Cannot write bounded control")
            timestamp = 1598987772122917 + i*90_000
            pose = np.eye(4)
            pose[:3,:3] = rot
            clip["frames"].append({"token": name.removesuffix(".jpg"), "path": name, "timestampUs": timestamp,
                                   "poseTimestampUs": timestamp, "cameraToWorld": pose.tolist(), "intrinsics": k.tolist(),
                                   "sha256": sha256(path), "isKeyFrame": False})
            targets = [{"instance": "checked-small-car", "classFamily": "vehicle", "box": point_box(box,h,w,warp),
                        "approach": "approaching" if positive and i>=3 else ("unknown" if positive else "not-approaching")},
                       {"instance": "checked-right-car", "classFamily": "vehicle",
                        "box": point_box(competitor,h,w,np.eye(3) if positive else warp), "approach": "not-approaching"}]
            truth["frames"].append({"token": clip["frames"][-1]["token"], "timestampUs": timestamp, "targets": targets})
    inp = destination/"input.json"
    inp.write_text(json.dumps(manifest, indent=2, allow_nan=False)+"\n")
    gold["inputSha256"] = sha256(inp)
    (destination/"truth.json").write_text(json.dumps(gold, indent=2, allow_nan=False)+"\n")
    draw_sheet(destination, manifest, gold)


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args=parser.parse_args()
    prepare(args.source_root, args.output)
