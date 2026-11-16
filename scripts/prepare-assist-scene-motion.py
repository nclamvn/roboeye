#!/usr/bin/env python3
"""Create pinned public-media motion fixtures, never used on the runtime path."""

import hashlib
import math
from pathlib import Path
import subprocess
import sys

import cv2
import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "native/ios/.build-xcode/scene-qa/motion-cases"
INPUTS = {
    "pedestrian-source.webm": "bfadaa62cccb42db875d50bb842aa0964fbf72040432e4097c1df59e043e0c26",
    "bus-source.webm": "945446dc7d39316f71eabb3cb8f6429e78c7b67a0fccade5ca416e692d14d9b2",
}
FPS = 25
W, H = 640, 360
N = 100


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def decode(name, start):
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    job = subprocess.run(
        [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-ss", str(start),
         "-i", str(ASSETS / name), "-an", "-vf", f"scale={W}:{H},fps={FPS}",
         "-frames:v", str(N), "-c:v", "rawvideo", "-threads", "1", "-pix_fmt", "bgr24",
         "-f", "rawvideo", "pipe:1"],
        stdout=subprocess.PIPE, check=True, timeout=30,
    )
    return np.frombuffer(job.stdout, dtype=np.uint8).reshape(N, H, W, 3)


def moved(img, i, *, shake_only=False):
    t = i / FPS
    dx = 12 * math.sin(2 * math.pi * 2.40 * t)
    dy = 8 * math.sin(2 * math.pi * 3.15 * t)
    roll = 0.75 * math.sin(2 * math.pi * 1.25 * t)
    if not shake_only:
        dx += 55 * (t/4 - 0.5)
        dy += 12 * t/4
        roll += 2 * (t/4 - 0.5)
    mat = cv2.getRotationMatrix2D((W/2, H/2), roll, 1.10)
    mat[:, 2] += (dx, dy)
    return cv2.warpAffine(img, mat, (W, H), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(18, 18, 18))


def steady_pan(img, i):
    # Separate mechanism control: coherent shift can survive temporal
    # filtering even when oscillating shake cancels out in the same window.
    mat = cv2.getRotationMatrix2D((W/2, H/2), 0, 1.16)
    mat[0, 2] += 96 * (i / (N - 1) - .5)
    return cv2.warpAffine(img, mat, (W, H), flags=cv2.INTER_LINEAR)


def encode(name, frames):
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    payload = b"".join(frame.tobytes() for frame in frames)
    if len(payload) != W * H * 3 * N:
        raise ValueError("Fixture frame count/shape mismatch")
    subprocess.run(
        [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo",
         "-pixel_format", "bgr24", "-video_size", f"{W}x{H}", "-framerate", str(FPS),
         "-i", "pipe:0", "-an", "-map_metadata", "-1", "-c:v", "libx264", "-crf", "17",
         "-threads", "1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(ASSETS / name)],
        input=payload, check=True, timeout=45,
    )
    print(name, digest(ASSETS / name), flush=True)


def main():
    if len(sys.argv) != 1:
        raise SystemExit("Usage: prepare-assist-scene-motion.py")
    for name, expected in INPUTS.items():
        if digest(ASSETS / name) != expected:
            raise ValueError(f"unverified source: {name}")
    pedestrians = decode("pedestrian-source.webm", 2)
    bus = decode("bus-source.webm", 0)
    still = pedestrians[0]
    # End-to-end controls with real detector texture. Warp applies equally
    # to foreground and background; stationary subjects remain stationary.
    encode("pedestrians-fixed.mp4", pedestrians)
    encode("pedestrians-sim-pan.mp4", (moved(frame, i) for i, frame in enumerate(pedestrians)))
    encode("frozen-sim-pan.mp4", (moved(still, i) for i in range(N)))
    encode("frozen-sim-shake.mp4", (moved(still, i, shake_only=True) for i in range(N)))
    encode("frozen-steady-pan.mp4", (steady_pan(still, i) for i in range(N)))
    encode("frozen-untextured.mp4", (np.full_like(still, 32 + i % 3) for i in range(N)))
    encode("cut-interleave.mp4", (still if i // 10 % 2 == 0 else bus[35] for i in range(N)))
    encode("bus-real-pan.mp4", bus)


if __name__ == "__main__":
    main()
