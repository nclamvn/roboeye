#!/usr/bin/env python3
"""Bounded original-pixel extraction for algorithm-proposed review windows."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys

import cv2
import imageio_ffmpeg


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--video', required=True)
    parser.add_argument('--job', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    scope = (root / '.court-cache/m8').resolve()
    output = Path(args.output).resolve()
    if output == scope or scope not in output.parents:
        raise ValueError('Output must be a dedicated M8 cache child')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Fresh empty output required; never follow existing child entries')
    original = Path(args.video)
    if original.is_symlink() or not original.is_file() or original.stat().st_size > 500 * 1024**2:
        raise ValueError('Invalid original video file')
    job = json.loads(Path(args.job).read_text())
    source, events = job['source'], job['events']
    if digest(original) != source['sha256'] or len(events) > 10:
        raise ValueError('Source hash or event budget mismatch')
    if not (0 < source['durationSeconds'] <= 300 and 0 < source['frameCount'] <= 20000
            and 0 < source['width'] * source['height'] <= 4096 * 2160):
        raise ValueError('Source geometry/duration budget exceeded')
    if os.statvfs(scope).f_bavail * os.statvfs(scope).f_frsize < 10 * 1024**3:
        raise ValueError('Less than10GiB available')
    needed = set()
    for event in events:
        i, window = event['index'], event['clipWindow']
        if not isinstance(i, int) or not 0 <= i < source['frameCount']:
            raise ValueError('Invalid actual anchor')
        a, b = window['startFrame'], window['endFrame']
        if not (isinstance(a, int) and isinstance(b, int) and 0 <= a <= i <= b < source['frameCount']
                and b-a+1 <= math.ceil(3 * source['fps'])):
            raise ValueError('Clip interval exceeds three source seconds')
        needed.update(k for k in range(i-2, i+3) if 0 <= k < source['frameCount'])
    (output / 'stills').mkdir(parents=True, exist_ok=True)
    (output / 'clips').mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(original))
    if not capture.isOpened() or abs(capture.get(cv2.CAP_PROP_FPS)-source['fps']) > 1e-5:
        raise ValueError('Actual source FPS mismatch')
    stills, count, largest_residual = {}, 0, 0.0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if count >= source['frameCount'] or frame.shape[:2] != (source['height'], source['width']):
            raise ValueError('Actual source frame count/geometry mismatch')
        pts = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
        residual = abs(pts-count/source['fps'])
        largest_residual = max(largest_residual, residual)
        if not math.isfinite(pts) or residual > 1e-6:
            raise ValueError('Source is not the declared zero-origin CFR timeline')
        if count in needed:
            relative = f'stills/frame-{count:06}.png'
            path = output / relative
            if not cv2.imwrite(str(path), frame):
                raise ValueError('PNG extraction failed')
            stills[str(count)] = {'path': relative, 'sha256': digest(path), 'bytes': path.stat().st_size,
                                  'contentType': 'image/png', 'sourceFrame': count,
                                  'sourcePtsSeconds': pts, 'width': source['width'], 'height': source['height']}
        count += 1
    capture.release()
    if count != source['frameCount']:
        raise ValueError('Incomplete actual source decode')
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    probe = subprocess.run([ffmpeg, '-hide_banner', '-i', str(original)], capture_output=True, timeout=15)
    if len(probe.stderr) > 128 * 1024:
        raise ValueError('Unexpected media metadata size')
    audio = bool(re.search(rb'Stream #[^\n]*Audio:', probe.stderr))
    clips = {}
    for event in events:
        a, b = event['clipWindow']['startFrame'], event['clipWindow']['endFrame']
        frames = b-a+1
        relative = f'clips/frames-{a:06}-{b:06}.mp4'
        path = output / relative
        start, stop = a/source['fps'], (b+1)/source['fps']
        command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', str(original),
                   '-map', '0:v:0', '-map_metadata', '-1',
                   '-vf', f'trim=start_frame={a}:end_frame={b+1},setpts=PTS-STARTPTS',
                   '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '2',
                   '-pix_fmt', 'yuv420p', '-r', str(source['fps']), '-frames:v', str(frames)]
        if audio:
            command += ['-map', '0:a:0', '-af', f'atrim=start={start:.12f}:end={stop:.12f},asetpts=PTS-{start:.12f}/TB', '-c:a', 'aac', '-b:a', '128k']
        else:
            command += ['-an']
        command += ['-movflags', '+faststart', str(path)]
        result = subprocess.run(command, capture_output=True, timeout=40)
        if result.returncode or not path.is_file() or path.stat().st_size > 32 * 1024**2:
            raise ValueError('Bounded source clip encoding failed')
        decoded = cv2.VideoCapture(str(path))
        actual_count, actual_fps = 0, decoded.get(cv2.CAP_PROP_FPS)
        while True:
            ok, image = decoded.read()
            if not ok:
                break
            if image.shape[:2] != (source['height'], source['width']):
                raise ValueError('Encoded clip geometry mismatch')
            actual_count += 1
        decoded.release()
        if actual_count != frames or abs(actual_fps-source['fps']) > 1e-5:
            raise ValueError('Encoded clip CFR count mismatch')
        clips[event['id']] = {'path': relative, 'sha256': digest(path), 'bytes': path.stat().st_size,
                              'contentType': 'video/mp4', 'sourceStartFrame': a, 'sourceEndFrame': b,
                              'sourceStartTimeSeconds': start, 'sourceEndExclusiveTimeSeconds': stop,
                              'frameCount': frames, 'fps': source['fps'], 'durationSeconds': frames/source['fps'],
                              'width': source['width'], 'height': source['height'],
                              'audio': 'source-trimmed-aac-reencoded' if audio else 'none',
                              'pixels': 'Actual source frames re-encoded H264; no invented/interpolated/model-filled pixels',
                              'audioTiming': 'Trimmed on same original source interval; codec priming/capture AV offset not calibrated'}
    print(json.dumps({'stills': stills, 'clips': clips, 'sourceAudioPresent': audio,
                      'sourceDecodedFrames': count, 'sourceMaximumPtsResidualSeconds': largest_residual,
                      'decoder': 'OpenCV POS_MSEC actual decoded timeline, verified against declared zero-origin CFR',
                      'ffmpegVersion': imageio_ffmpeg.get_ffmpeg_version()}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not leak private source or interpreter paths into public artifacts.
        print(json.dumps({'error': type(error).__name__, 'message': 'Local source evidence export failed; no valid manifest emitted'}), file=sys.stderr)
        raise SystemExit(1)
