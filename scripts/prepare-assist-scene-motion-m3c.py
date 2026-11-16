#!/usr/bin/env python3
"""Synthetic camera/target geometry with real-photo textures, never nuScenes."""

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

SHA = "a0c1239cd6785b197b556363920665e0850688fde79c21fb290df81f79f0e0be"
WIDTH, HEIGHT, FOCAL = 768, 432, 540
K = [[FOCAL,0,WIDTH/2],[0,FOCAL,HEIGHT/2],[0,0,1]]


def digest(p):
    with p.open("rb") as f:
        return hashlib.file_digest(f,"sha256").hexdigest()


def build(source, output):
    if digest(source)!=SHA:
        raise ValueError("Expected the pinned M2B Shibuya image")
    original = cv2.imread(str(source))
    if original.shape[:2]!=(HEIGHT,WIDTH):
        raise ValueError("Unexpected image shape")
    # Bus and planar background are separate layers. Render lateral camera
    # translation as Z-dependent horizontal shifts (constant orientation).
    texture = cv2.resize(original[:196,30:738], (WIDTH,HEIGHT))
    bus = cv2.resize(original[231:322,577:667], (158,159), interpolation=cv2.INTER_CUBIC)
    output.mkdir(exist_ok=False)
    inputs={"schemaVersion":1,"dataset":"synthetic-m3c","assetRoot":".","clips":[]}
    truth={"schemaVersion":1,"clips":[]}
    for mode in ("stationary-parallax","cross-epipolar","along-epipolar","pose-dropout"):
        frames, judges = [], []
        case=output/mode
        case.mkdir()
        for i in range(23):
            camera_x = i*.065
            background_z, bus_z = 12.,6.
            xx = round(465-FOCAL*camera_x/bus_z + (6*i if mode=="along-epipolar" else 0))
            yy = 104 + (6*i if mode in ("cross-epipolar","pose-dropout") else 0)
            a=np.float32([[1,0,-FOCAL*camera_x/background_z],[0,1,0]])
            canvas=cv2.warpAffine(texture,a,(WIDTH,HEIGHT),borderMode=cv2.BORDER_REFLECT_101)
            canvas[yy:yy+bus.shape[0],xx:xx+bus.shape[1]]=bus
            name=case/f"{i:02}.jpg"
            cv2.imwrite(str(name),canvas,[cv2.IMWRITE_JPEG_QUALITY,96])
            pose=np.eye(4);pose[0,3]=camera_x
            time=1_000_000+100_000*i
            token=f"{mode}-{i:02}"
            key=i>=5 and i%2==1
            frames.append({"token":token,"path":name.relative_to(output).as_posix(),"timestampUs":time,
                           "poseTimestampUs":None if mode=="pose-dropout" else time,
                           "cameraToWorld":None if mode=="pose-dropout" else pose.tolist(),
                           "intrinsics":K,"sha256":digest(name),"isKeyFrame":key})
            if key:
                judges.append({"token":token,"timestampUs":time,"targets":[{"instance":"synthetic-bus",
                    "classFamily":"vehicle","box":{"x":xx/WIDTH,"y":yy/HEIGHT,"width":158/WIDTH,"height":159/HEIGHT},
                    "motion":"stationary" if mode=="stationary-parallax" else "moving"}]})
        inputs["clips"].append({"id":mode,"frames":frames})
        truth["clips"].append({"id":mode,"frames":judges})
    with (output/"input.json").open("x") as f:
        json.dump(inputs,f,indent=2)
    truth["inputSha256"] = digest(output/"input.json")
    with (output/"truth.json").open("x") as f:
        json.dump(truth,f,indent=2)


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("source",type=Path)
    p.add_argument("output",type=Path)
    a=p.parse_args()
    build(a.source,a.output)
