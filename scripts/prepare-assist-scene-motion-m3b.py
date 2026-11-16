#!/usr/bin/env python3
"""Pinned, Mac-only fixtures; predeclared perturbations, not training data."""

import math
import runpy
import subprocess
from pathlib import Path

import cv2
import numpy as np

base = runpy.run_path(str(Path(__file__).with_name("prepare-assist-scene-motion.py")))
ASSETS, W, H, N, FPS = (base[k] for k in ("ASSETS", "W", "H", "N", "FPS"))
DASH = ASSETS / "dashcam-source.ogv"
DASH_SHA = "3b2fb1a37eb797bdbf4884ad7df9f9118d64240a648208b1fa6ef4a927ac8970"


def load():
    for name, expected in base["INPUTS"].items():
        if base["digest"](ASSETS / name) != expected:
            raise ValueError(f"Unverified {name}")
    if base["digest"](DASH) != DASH_SHA:
        raise ValueError("Unverified dashcam clip")
    original = base["decode"]("pedestrian-source.webm", 2)
    static = original[0]
    for i in range(N):
        # Deliberate occlusion on a moving foreground. Leave some visible
        # background; black pixels are not a reliable appearance witness.
        if 30 <= i < 70:
            yield np.pad(original[i, :52], ((0, H-52), (0, 0), (0, 0)), constant_values=23)
        else:
            yield original[i]


def fast_pan(static, i):
    t = i / FPS
    transform = cv2.getRotationMatrix2D((W/2, H/2), 2 * math.sin(2*math.pi*.92*t), 1.22)
    transform[0, 2] += 61 * math.sin(2*math.pi*.90*t)
    transform[1, 2] += 11 * math.sin(2*math.pi*1.23*t)
    return cv2.warpAffine(static, transform, (W, H), flags=cv2.INTER_LINEAR)


def main():
    base["encode"]("pedestrian-cover-m3b.mp4", load())
    static = base["decode"]("pedestrian-source.webm", 2)[0]
    base["encode"]("frozen-fast-pan-m3b.mp4", (fast_pan(static, i) for i in range(N)))
    ffmpeg = base["imageio_ffmpeg"].get_ffmpeg_exe()
    # Crop the time/GPS overlay and the fixed hood out of the feature image.
    path = ASSETS / "dashcam-parallax-m3b.mp4"
    subprocess.run(
        [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", "47", "-i", str(DASH),
         "-t", "4", "-vf", "crop=1160:600:60:24,scale=640:360,fps=25", "-an", "-map_metadata", "-1",
         "-c:v", "libx264", "-crf", "17", "-threads", "1", "-pix_fmt", "yuv420p", str(path)],
        check=True, timeout=90,
    )
    print(path.name, base["digest"](path), flush=True)


if __name__ == "__main__":
    main()
