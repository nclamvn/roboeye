#!/usr/bin/env python3
"""M3Q fixed unseen windows, metadata-size preflight before any RGB transfer.

No model calls or labels enter runtime. The old fetcher remains byte-for-byte
unchanged. This deliberately downloads a slice, not a recording or checkout.
"""
import argparse
import bisect
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
from threading import Lock
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("m3q_old_fetch", HERE/"fetch-assist-scene-boreas-slice.py")
old = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(old)
WINDOWS = (("boreas-m3q-city", 1598989140031027), ("boreas-m3q-turn", 1598987802079070))
IMAGE_BUDGET = 500*1024**2
METADATA = ("applanix/camera_poses.csv", "applanix/lidar_poses.csv", "calib/P_camera.txt")


def digest(data): return hashlib.sha256(data).hexdigest()


def write_new(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream: stream.write(data)


def write_json(path, value): write_new(path, (json.dumps(value, indent=2, allow_nan=False)+"\n").encode())


def metadata(source):
    manifest = json.loads((source/"slice.json").read_text())
    known = {r["path"]: r for r in manifest["files"]}
    values = {}
    for key in METADATA:
        p = source/key
        if p.is_symlink(): raise ValueError("Metadata symlink forbidden")
        body = p.read_bytes()
        if known[key]["sha256"] != digest(body) or known[key]["bytes"] != len(body):
            raise ValueError("Reused official metadata changed")
        values[key] = body
    return values


def select_windows(camera_bytes):
    rows = list(csv.reader(io.StringIO(camera_bytes.decode("ascii"))))[1:]
    times = [int(r[0]) for r in rows if r]
    if times != sorted(set(times)): raise ValueError("Invalid pose timeline")
    clips = []
    for name, start in WINDOWS:
        stamps = times[bisect.bisect_left(times, start):bisect.bisect_right(times, start+4_000_000)]
        if len(stamps) != 50 or max(b-a for a,b in zip(stamps, stamps[1:])) > 100_000:
            raise ValueError("Fixed heldout window lacks complete cadence")
        clips.append(dict(id=name, cameraTimestampsUs=stamps,
                          labelTimestampsUs=old.label_times(stamps[0], stamps[-1])))
    return clips


def head_image(stamp):
    key = f"camera/{stamp}.png"
    with urlopen(Request(old.BASE+old.SEQ+key, method="HEAD"), timeout=20) as response:
        size = int(response.headers["Content-Length"])
        if response.status != 200 or not 0 < size <= old.MAX_IMAGE:
            raise ValueError("Invalid fixed image HEAD size")
        return dict(path=key, bytes=size, etag=response.headers.get("ETag"))


def plan(source, out):
    if out.exists() or out.is_symlink(): raise ValueError("Choose a new preregistration path")
    values = metadata(source)
    clips = select_windows(values[METADATA[0]])
    stamps = [s for c in clips for s in c["cameraTimestampsUs"]]
    if len(stamps) != len(set(stamps)) or len(stamps) != 100: raise ValueError("Duplicate/overbudget frames")
    with ThreadPoolExecutor(max_workers=6) as pool: sizes = list(pool.map(head_image, stamps))
    total = sum(r["bytes"] for r in sizes)
    if total > IMAGE_BUDGET: raise ValueError(f"Image HEAD total {total} exceeds {IMAGE_BUDGET}")
    result = dict(schemaVersion=1, study="M3Q", source=old.BASE+old.SEQ, license=old.LICENSE,
                  selection="Fixed timestamp windows before RGB/model output; same recording, not cross-domain",
                  metadataSource=str(source.resolve()), metadata={k: dict(bytes=len(v), sha256=digest(v)) for k,v in values.items()},
                  imageBudgetBytes=IMAGE_BUDGET, headImageBytes=total, clips=clips, imageHeads=sizes,
                  rgbTransfers=0, modelCalls=0)
    write_json(out, result)
    print(json.dumps(dict(plan=str(out), images=len(sizes), headImageBytes=total, planSha256=digest(out.read_bytes()))))


def fetch(plan_path, out):
    if out.exists() or out.is_symlink(): raise ValueError("Choose a new slice directory")
    if shutil.disk_usage(out.parent).free < 10*1024**3: raise ValueError("Disk floor10GiB")
    registered = json.loads(plan_path.read_text())
    if registered.get("study") != "M3Q" or registered.get("imageBudgetBytes") != IMAGE_BUDGET or registered["rgbTransfers"] != 0:
        raise ValueError("Wrong preregistration contract")
    values = metadata(Path(registered["metadataSource"]))
    if registered["metadata"] != {k: dict(bytes=len(v), sha256=digest(v)) for k,v in values.items()}:
        raise ValueError("Preregistered metadata differs")
    if [(c["id"], c["cameraTimestampsUs"][0]) for c in registered["clips"]] != [
            ("boreas-m3q-city", 1598989140055117), ("boreas-m3q-turn", 1598987802127370)]:
        raise ValueError("Wrong fixed windows")
    images = registered["imageHeads"]
    if sum(r["bytes"] for r in images) != registered["headImageBytes"] or registered["headImageBytes"] > IMAGE_BUDGET:
        raise ValueError("Image HEAD budget differs")
    expected = [f"camera/{s}.png" for c in registered["clips"] for s in c["cameraTimestampsUs"]]
    if [r["path"] for r in images] != expected: raise ValueError("Image set/order differs")
    out.mkdir()
    records = []
    for key, body in values.items():
        write_new(out/key, body)
        records.append(dict(path=key, bytes=len(body), sha256=digest(body), reusedMetadata=True))
    write_json(out/"clips.json", dict(schemaVersion=1, clips=registered["clips"]))
    write_json(out/"preregistration.json", registered)
    jobs = images + [dict(path=f"labels_detection/{s}.txt", bytes=None, etag=None)
                     for s in sorted({s for c in registered["clips"] for s in c["labelTimestampsUs"]})]
    state = dict(imageBytesReceived=0, metadataLabelBytesReceived=0, completedObjects=0, complete=False,
                 requests=0, failedTransfers=0, errors=[], planSha256=digest(plan_path.read_bytes()))
    lock = Lock()
    def transfer(row):
        key = row["path"]; is_image = key.endswith(".png"); limit = old.MAX_IMAGE if is_image else 128*1024
        with lock: state["requests"] += 1
        data = bytearray()
        try:
            with urlopen(Request(old.BASE+old.SEQ+key), timeout=60) as response:
                if response.status != 200: raise ValueError("Unexpected source response")
                if row["etag"] is not None and response.headers.get("ETag") != row["etag"]:
                    raise ValueError("HEAD/GET ETag differs")
                while True:
                    chunk = response.read(min(256*1024, limit+1-len(data)))
                    if not chunk: break
                    data.extend(chunk)
                    with lock:
                        counter = "imageBytesReceived" if is_image else "metadataLabelBytesReceived"
                        state[counter] += len(chunk)
                        if state["imageBytesReceived"] > IMAGE_BUDGET: raise ValueError("Actual image byte budget exceeded")
                    if len(data) > limit: raise ValueError("Oversized object")
            if row["bytes"] is not None and len(data) != row["bytes"]: raise ValueError("HEAD/GET byte count differs")
            if not data: raise ValueError("Empty object")
            if is_image and (not data.startswith(b"\x89PNG\r\n\x1a\n") or not data.endswith(b"\x00\x00\x00\x00IEND\xaeB`\x82")):
                raise ValueError("Incomplete/invalid PNG")
            write_new(out/key, data)
            with lock: state["completedObjects"] += 1
            return dict(path=key, bytes=len(data), sha256=digest(data))
        except Exception as error:
            with lock:
                state["failedTransfers"] += 1
                state["errors"].append(dict(path=key, error=type(error).__name__, message=str(error)[:160], receivedBytes=len(data)))
            raise
    iterator = iter(jobs)
    failure = None
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(transfer, next(iterator)) for _ in range(4)}
        while pending:
            done, pending = wait(pending, return_when=FIRST_COMPLETED)
            for job in done:
                try: records.append(job.result())
                except Exception as error: failure = error
            if failure is None:
                for _ in done:
                    row = next(iterator, None)
                    if row is not None: pending.add(pool.submit(transfer, row))
            if state["completedObjects"] % 10 == 0: print(json.dumps(state), flush=True)
    state["complete"] = failure is None and len(records) == len(jobs)+len(values)
    state["files"] = sorted(records, key=lambda r:r["path"])
    state.update(source=old.BASE+old.SEQ, license=old.LICENSE, study="m3q", modelCalls=0,
                 networkRetries=0, headImageBytes=registered["headImageBytes"])
    write_json(out/("slice.json" if state["complete"] else "fetch-incomplete.json"), state)
    print(json.dumps({k:v for k,v in state.items() if k != "files"}, indent=2), flush=True)
    if not state["complete"]: raise RuntimeError("Slice incomplete; retained valid intermediates, no implicit retry") from failure


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); subs = parser.add_subparsers(dest="job", required=True)
    p = subs.add_parser("plan"); p.add_argument("--metadata-source", type=Path, required=True); p.add_argument("--output", type=Path, required=True)
    p = subs.add_parser("fetch"); p.add_argument("--plan", type=Path, required=True); p.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.job == "plan": plan(args.metadata_source, args.output)
    else: fetch(args.plan, args.output)
