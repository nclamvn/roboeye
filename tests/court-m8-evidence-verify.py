#!/usr/bin/env python3
"""Independent original-vs-exported pixel/sequence/audio QA, no model labels."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import cv2
import imageio_ffmpeg
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--video', required=True)
parser.add_argument('--manifest', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
manifest_path = Path(args.manifest).resolve()
manifest = json.loads(manifest_path.read_text())
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert digest(Path(args.video)) == manifest['source']['sha256']
source = manifest['source']
assert manifest['schemaVersion'] == 'roboeye-court-event-evidence-v1'
assert manifest['sessionHashBinding'] == 'inputCachedSessionSha256'

def asset(value):
    path = (manifest_path.parent / value['path']).resolve()
    assert manifest_path.parent in path.parents and not path.is_symlink()
    assert digest(path) == value['sha256'] and path.stat().st_size == value['bytes']
    return path

def audio_present(path):
    probe = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-i', str(path)], capture_output=True, timeout=10)
    return bool(re.search(rb'Stream #[^\n]*Audio:', probe.stderr))

needed = set()
for event in manifest['events']:
    start, end = event['clipWindow']['startFrame'], event['clipWindow']['endFrame']
    needed.update(range(max(0, start-2), min(source['frameCount']-1, end+2)+1))
    needed.update(item['sourceFrame'] for item in event['context'] if item['status'] == 'available')
original = cv2.VideoCapture(args.video)
reference = {}
count = 0
while True:
    ok, bgr = original.read()
    if not ok:
        break
    if count in needed:
        reference[count] = bgr
    count += 1
original.release()
assert count == source['frameCount']
source_audio = audio_present(Path(args.video))
rows = []
for event in manifest['events']:
    assert event['contact'] is None and event['decision'] == 'insufficient-evidence'
    assert event['still']['sourceFrame'] == event['index']
    images = []
    for item in [event['still']] + [item['asset'] for item in event['context'] if item['status'] == 'available']:
        decoded = cv2.imread(str(asset(item)))
        assert decoded.shape == reference[item['sourceFrame']].shape
        different = int(np.count_nonzero(decoded != reference[item['sourceFrame']]))
        assert different == 0
        images.append({'sourceFrame': item['sourceFrame'], 'differentChannels': different})
    clip = event['clip']
    assert clip['sourceStartFrame'] == event['clipWindow']['startFrame'] and clip['sourceEndFrame'] == event['clipWindow']['endFrame']
    expected_count = clip['sourceEndFrame']-clip['sourceStartFrame']+1
    assert clip['frameCount'] == expected_count and abs(clip['durationSeconds']-expected_count/source['fps']) < 1e-9
    movie = asset(clip)
    capture = cv2.VideoCapture(str(movie))
    assert abs(capture.get(cv2.CAP_PROP_FPS)-source['fps']) < 1e-5
    frames, pts_max = [], 0.0
    while True:
        ok, bgr = capture.read()
        if not ok:
            break
        assert bgr.shape[:2] == (source['height'], source['width'])
        pts_max = max(pts_max, abs(capture.get(cv2.CAP_PROP_POS_MSEC)/1000-len(frames)/source['fps']))
        frames.append(bgr)
    capture.release()
    assert len(frames) == expected_count and pts_max < 1e-6
    # Content alignment uses the WHOLE real clip against original frames for
    # every tested integer offset, not only metadata or a file extension.
    offsets = {}
    for delta in [-2, -1, 0, 1, 2]:
        pairs = [(frame, reference.get(clip['sourceStartFrame']+i+delta)) for i, frame in enumerate(frames)]
        differences = [float(np.mean(np.abs(a.astype(np.float32)-b.astype(np.float32)))) for a,b in pairs if b is not None]
        offsets[str(delta)] = float(np.mean(differences))
    best_offset = min(offsets, key=offsets.get)
    assert best_offset == '0', f'Actual encoded content not aligned with declared source start: {offsets}'
    samples = []
    for i in sorted({0, len(frames)//2, len(frames)-1}):
        mse = float(np.mean((frames[i].astype(np.float32)-reference[clip['sourceStartFrame']+i].astype(np.float32))**2))
        psnr = None if mse == 0 else 10*math.log10(255**2/mse)
        assert psnr is None or psnr >= 32, 'Reencoded clip pixels materially differ from declared real source frame'
        samples.append({'clipFrame': i, 'sourceFrame': clip['sourceStartFrame']+i, 'psnrDb': psnr})
    actual_audio = audio_present(movie)
    assert actual_audio == source_audio
    rows.append({'id':event['id'],'kind':event['kind'],'anchorIndex':event['index'],'reviewInterval':event['reviewInterval'],
                 'clipWindow':event['clipWindow'],'stillPixelChecks':images,'clipFrameCount':len(frames),'fps':source['fps'],
                 'durationSeconds':len(frames)/source['fps'],'maximumClipPtsResidualSeconds':pts_max,
                 'wholeClipMeanAbsoluteDifferenceBySourceOffset':offsets,'bestContentAlignmentOffsetFrames':int(best_offset),
                 'sampledSourceFrames':samples,'actualClipAudioPresent':actual_audio})
report={'schemaVersion':'roboeye-court-m8-independent-media-qa-v1','pass':True,'sourceSha256':source['sha256'],
        'manifestSha256':digest(manifest_path),'events':rows,'sourceAudioPresent':source_audio,
        'scope':'Decoded PNG pixels exact; H264 clips are real source reencoding with verified CFR/index sequence, not pixel-identical MP4',
        'contactOrInOutAccuracyMeasured':False,'testSourceSha256':digest(Path(__file__))}
output=Path(args.output); output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
