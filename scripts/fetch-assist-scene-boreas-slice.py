#!/usr/bin/env python3
"""Fetch three 4-second Boreas object-detection windows, never a full sequence."""

import argparse
import bisect
from concurrent.futures import ThreadPoolExecutor
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess
from urllib.parse import urlencode
import xml.etree.ElementTree as ET


BASE = "https://boreas.s3.us-west-2.amazonaws.com/"
SEQ = "boreas-objects-v1/"
LICENSE = "https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md"
# Fixed public obj_train anchors, chosen without looking at boxes or predictions.
ANCHORS = (1598986289111738, 1598987327084848, 1598987513026635, 1598987772079070,
           1598988939059928, 1598989109031027, 1598989277032742, 1598989516069069,
           1598989897075981, 1598989992068558, 1598990189106857, 1598990950088125,
           1598991312015344, 1598991443097712, 1598992245041538)
DURATION_US = 4_000_000
MAX_IMAGE = 8 * 1024**2
# Distinct public obj_train anchors, none overlap the M3C replay intervals.
M3D = (("boreas-m3d-traffic",1598986289111738),
       ("boreas-m3d-urban",1598989277032742),
       ("boreas-m3d-crossing",1598989992068558))
# M3E: unseen anchors, picked using camera cadence/speed/turn only.
# Two natural clips and a separate frozen real-image stress suite.
M3E = (("boreas-m3e-turn",1598987772079070),
       ("boreas-m3e-stop",1598991312015344))
# M3F: preregistered holdout, selected by cadence and speed only, not RGB.
M3F = (("boreas-m3f-city",1598987513026635),
       ("boreas-m3f-stop",1598990950088125))
# M3G: new source intervals, chosen solely from cadence/speed metadata.
M3G = (("boreas-m3g-traffic",1598987327084848),
       ("boreas-m3g-low-speed",1598990956088125))
# M3H: disjoint from M3C-G; fixed from camera cadence/speed before RGB review.
M3H = (("boreas-m3h-urban",1598989109031027),
       ("boreas-m3h-traffic",1598991443097712))
# M3I: unseen original anchors, selected from cadence/speed metadata only.
M3I = (("boreas-m3i-urban",1598988939059928),
       ("boreas-m3i-following",1598989897075981))
# M3J: new four-second intervals fixed from pose/cadence metadata, not RGB.
M3J = (("boreas-m3j-urban",1598988945059928),
       ("boreas-m3j-following",1598989903075981))
# M3K: new intervals selected on pose/cadence only before RGB/model results.
M3K = (("boreas-m3k-urban",1598989115031027),
       ("boreas-m3k-traffic",1598991449097712))
# M3L: cadence/speed metadata only, disjoint from all earlier source windows.
M3L = (("boreas-m3l-city",1598987519026635),
       ("boreas-m3l-turn",1598987778079070))
# M3M: new four-second intervals preregistered from timestamp/cadence only.
# Same recording/domain as earlier windows, not a cross-domain benchmark.
M3M = (("boreas-m3m-city",1598987525026635),
       ("boreas-m3m-turn",1598987784079070))
# M3N: fixed metadata-only windows before RGB or model outputs.
# The attempted city continuation 1598987531026635 has only22 exposures;
# choose this complete50-exposure interval instead, not based on RGB/labels.
M3N = (("boreas-m3n-city",1598989121031027),
       ("boreas-m3n-turn",1598987790079070))
# M3O: metadata-only replacement before RGB/inference. City1598989127031027
# and1598989133031027 lack required label-timestamp coverage; retain the gate.
M3O = (("boreas-m3o-traffic",1598991455097712),
       ("boreas-m3o-turn",1598987796079070))


def get(url, size):
    body = subprocess.run(["curl", "--proto", "=https", "-fsS", "--retry", "1", "--connect-timeout", "8",
                           "--max-time", "100", "--max-filesize", str(size), url],
                          stdout=subprocess.PIPE, check=True, timeout=215).stdout
    if not 0 < len(body) <= size:
        raise ValueError("Unexpected or oversized object")
    return body


def pose_rows(body):
    _, *rows = csv.reader(io.StringIO(body.decode("ascii")))
    def forward(r):
        roll, pitch = map(float,r[7:9])
        return (-math.sin(pitch), math.sin(roll)*math.cos(pitch), math.cos(roll)*math.cos(pitch))
    result = [(int(r[0]), math.hypot(float(r[4]), float(r[5])), forward(r)) for r in rows if r]
    if len(result) < 100 or any(x[0] >= y[0] for x, y in zip(result, result[1:])):
        raise ValueError("Invalid camera pose timeline")
    return result


def select(cameras):
    times = [r[0] for r in cameras]
    candidates = []
    # Rank by actual change of optical axis, not camera Euler yaw.
    for start in ANCHORS:
        frames = cameras[bisect.bisect_left(times, start):bisect.bisect_right(times, start+DURATION_US)]
        if not 40 <= len(frames) <= 53:
            continue
        turns = [math.acos(max(-1.,min(1.,sum(a*b for a,b in zip(x[2],y[2])))))
                 for x,y in zip(frames, frames[1:])]
        speed = sum(x[1] for x in frames)/len(frames)
        candidates.append((start, frames, speed, sum(turns)))
    if len(candidates) < 3:
        raise ValueError("Not enough pose windows")
    turn = max(candidates,key=lambda x:x[3])
    slow = min((x for x in candidates if x!=turn),key=lambda x:x[2])
    fast = max((x for x in candidates if x not in (turn, slow)),key=lambda x:x[2])
    return zip(("boreas-heading-change", "boreas-low-speed", "boreas-high-speed"), (turn,slow,fast))


def label_times(start,stop):
    prefix=SEQ+"labels_detection/"
    xml=ET.fromstring(get(BASE+"?"+urlencode({"list-type":2,"prefix":prefix,
             "start-after":f"{prefix}{start-100_000}.txt","max-keys":60}),256*1024))
    values=[]
    for contents in xml.findall("{*}Contents"):
        key=contents.findtext("{*}Key")
        m=re.fullmatch(re.escape(prefix)+r"(\d{16})\.txt",key or "")
        if m and start-60_000<=int(m[1])<=stop+60_000:
            values.append(int(m[1]))
    if not 14<=len(values)<=25 or values!=sorted(set(values)):
        raise ValueError("Unexpected 3D label file coverage")
    return values


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output",required=True,type=Path)
    p.add_argument("--study",choices=("m3c","m3d","m3e","m3f","m3g","m3h","m3i","m3j","m3k","m3l","m3m","m3n","m3o"),default="m3c")
    p.add_argument("--resume",action="store_true",help="Resume an incomplete slice on the same Mac")
    a=p.parse_args()
    if a.output.is_symlink() or a.output.exists()!=a.resume or (a.output/"slice.json").exists():
        p.error("Choose a new output or an incomplete slice with --resume")
    a.output.mkdir(exist_ok=a.resume)
    meta={key:get(BASE+SEQ+key,32*1024**2) for key in
          ("applanix/camera_poses.csv","applanix/lidar_poses.csv","calib/P_camera.txt")}
    clips=[]
    jobs=[]
    cameras=pose_rows(meta["applanix/camera_poses.csv"])
    def fixed_windows(anchors):
        times=[r[0] for r in cameras]
        for name,start in anchors:
            frames=cameras[bisect.bisect_left(times,start):bisect.bisect_right(times,start+DURATION_US)]
            # The first M3I source is 25 Hz. Fixed even-index subsampling
            # gives ~80 ms exposure intervals supported by all frozen lanes;
            # this is declared before RGB review, not outcome-based selection.
            if a.study in {"m3i", "m3j"} and len(frames)==100:
                frames=frames[::2]
            if not 40<=len(frames)<=53:
                raise ValueError("Unexpected held-out camera coverage")
            yield name,(start,frames,sum(r[1] for r in frames)/len(frames),0.)
    windows=select(cameras) if a.study=="m3c" else fixed_windows({"m3d":M3D,"m3e":M3E,"m3f":M3F,"m3g":M3G,"m3h":M3H,"m3i":M3I,"m3j":M3J,"m3k":M3K,"m3l":M3L,"m3m":M3M,"m3n":M3N,"m3o":M3O}[a.study])
    for name,(start,frames,speed,turn) in windows:
        label = label_times(frames[0][0],frames[-1][0])
        stamps = [r[0] for r in frames]
        clips.append(dict(id=name,cameraTimestampsUs=stamps,labelTimestampsUs=label))
        print(name, start, len(stamps), len(label), round(speed,2),round(turn,3),flush=True)
        jobs.extend((f"camera/{ts}.png",MAX_IMAGE) for ts in stamps)
        jobs.extend((f"labels_detection/{ts}.txt",128*1024) for ts in label)
    if len({j[0] for j in jobs})!=len(jobs) or len(jobs)>235:
        raise ValueError("Duplicate or over-budget slice")
    target=a.output/"clips.json"
    clip_text=json.dumps({"schemaVersion":1,"clips":clips},indent=2)+"\n"
    def save(path,data):
        f=a.output/path
        f.parent.mkdir(parents=True,exist_ok=True)
        if a.resume and f.is_file() and not f.is_symlink() and f.read_bytes()==data:
            return {"path":path,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()}
        with f.open("xb") as out:
            out.write(data)
        return {"path":path,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()}
    def download(job):
        path,limit=job
        dest=a.output/path
        if a.resume and dest.is_file() and not dest.is_symlink() and 0<dest.stat().st_size<=limit:
            data=dest.read_bytes()
        else:
            data=get(BASE+SEQ+path,limit)
        if path.endswith(".png") and not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Unexpected camera format")
        if path.endswith(".png") and not data.endswith(b"\x00\x00\x00\x00IEND\xaeB`\x82"):
            raise ValueError("Incomplete PNG")
        return save(path,data)
    records=[save(path,data) for path,data in meta.items()]
    if target.exists():
        if target.is_symlink() or target.read_text()!=clip_text:
            raise ValueError("Existing clip selection differs")
    else:
        with target.open("x",encoding="utf-8") as f:
            f.write(clip_text)
    with ThreadPoolExecutor(max_workers=10) as pool:
        records.extend(pool.map(download,jobs))
    (a.output/"slice.json").write_text(json.dumps({"source":BASE+SEQ,"license":LICENSE,"study":a.study,
            "files":records},indent=2)+"\n")
    print(f"{len(records)} source files, {sum(r['bytes'] for r in records)} bytes")


if __name__=="__main__":
    main()
