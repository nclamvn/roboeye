#!/usr/bin/env python3
"""Fetch only the pre-approved M3R three-window Boreas slice.

Reuses frozen metadata/serialization helpers, never mutates their globals or
receipts. The metadata-only 150-HEAD proposal is pinned before any RGB transfer.
No retries, model calls, range inference, full sequence or new environment.
"""
import argparse
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import json
from pathlib import Path
import shutil
from threading import Lock
from time import monotonic
from urllib.request import Request, urlopen

import fetch_assist_scene_m3q_boreas as shared

PLAN_SHA256 = "0d1eccfcbd2887809b2841df12eca13fbbb4a004aed6031ba167bd028b96fa86"
IMAGE_BYTES = 510474526
IMAGE_BUDGET = 700 * 1024**2
CLIP_ENDPOINTS = (
    ("boreas-m3r-city", 1598989146060288, 1598989149977468, 19),
    ("boreas-m3r-turn", 1598987808132459, 1598987812049741, 20),
    ("boreas-m3r-low-speed", 1598991324076195, 1598991327995639, 20),
)


def validate_plan(raw):
    if shared.digest(raw) != PLAN_SHA256:
        raise ValueError("Pre-RGB approved M3R proposal changed")
    plan = json.loads(raw)
    if (plan.get("study") != "M3R" or plan.get("status") != "PROPOSED-HEAD-ONLY"
            or plan.get("rgbTransfers") != 0 or plan.get("modelCalls") != 0
            or plan.get("headImageBytes") != IMAGE_BYTES
            or plan.get("imageBudgetBytes") != IMAGE_BUDGET):
        raise ValueError("Wrong fixed M3R scope/byte budget")
    endpoints = [(c["id"], c["cameraTimestampsUs"][0], c["cameraTimestampsUs"][-1],
                  len(c["labelTimestampsUs"])) for c in plan["clips"]]
    if endpoints != list(CLIP_ENDPOINTS) or any(len(c["cameraTimestampsUs"]) != 50 for c in plan["clips"]):
        raise ValueError("Wrong fixed three50-frame windows")
    timestamps = [s for c in plan["clips"] for s in c["cameraTimestampsUs"]]
    if len(set(timestamps)) != 150:
        raise ValueError("Duplicate/over-budget exposures")
    heads = plan["imageHeads"]
    if ([r["path"] for r in heads] != [f"camera/{s}.png" for s in timestamps]
            or sum(r["bytes"] for r in heads) != IMAGE_BYTES
            or any(not 0 < r["bytes"] <= shared.old.MAX_IMAGE for r in heads)):
        raise ValueError("HEAD image coverage/byte budget differs")
    values = shared.metadata(Path(plan["metadataSource"]))
    if plan["metadata"] != {k: dict(bytes=len(v), sha256=shared.digest(v)) for k, v in values.items()}:
        raise ValueError("Pinned reused official metadata changed")
    return plan, values


def valid_png(data):
    return (data.startswith(b"\x89PNG\r\n\x1a\n")
            and data.endswith(b"\x00\x00\x00\x00IEND\xaeB`\x82"))


def fetch(plan_path, output):
    if output.exists() or output.is_symlink():
        raise ValueError("Choose a new source directory")
    if shutil.disk_usage(output.parent).free < 10*1024**3:
        raise ValueError("Disk floor10GiB")
    plan, values = validate_plan(plan_path.read_bytes())
    output.mkdir()
    records = []
    for key, body in values.items():
        shared.write_new(output/key, body)
        records.append(dict(path=key, bytes=len(body), sha256=shared.digest(body), reusedMetadata=True))
    shared.write_json(output/"clips.json", dict(schemaVersion=1, clips=plan["clips"]))
    shared.write_json(output/"preregistration.json", plan)
    jobs = plan["imageHeads"] + [dict(path=f"labels_detection/{s}.txt", bytes=None, etag=None)
        for s in sorted({s for c in plan["clips"] for s in c["labelTimestampsUs"]})]
    state = dict(complete=False, study="m3r", source=shared.old.BASE+shared.old.SEQ,
        license=shared.old.LICENSE, planSha256=PLAN_SHA256, imageBytesReceived=0,
        metadataLabelBytesReceived=0, requests=0, failedTransfers=0, networkRetries=0,
        modelCalls=0, headImageBytes=IMAGE_BYTES, maxImageBytes=IMAGE_BUDGET,
        errors=[], sourceCodeSha256=shared.digest(Path(__file__).read_bytes()))
    lock = Lock()
    started = monotonic()
    deadline = started+300

    def transfer(row):
        key = row["path"]
        image = key.endswith(".png")
        limit = shared.old.MAX_IMAGE if image else 128*1024
        data = bytearray()
        with lock:
            state["requests"] += 1
        try:
            if monotonic() >= deadline:
                raise ValueError("M3R source wall budget exceeded")
            with urlopen(Request(shared.old.BASE+shared.old.SEQ+key), timeout=45) as response:
                if response.status != 200 or (row["etag"] is not None
                        and response.headers.get("ETag") != row["etag"]):
                    raise ValueError("HEAD/GET status or ETag differs")
                while True:
                    if monotonic() >= deadline:
                        raise ValueError("M3R source wall budget exceeded")
                    part = response.read(min(256*1024, limit+1-len(data)))
                    if not part:
                        break
                    data.extend(part)
                    with lock:
                        name = "imageBytesReceived" if image else "metadataLabelBytesReceived"
                        state[name] += len(part)
                        if state["imageBytesReceived"] > IMAGE_BYTES:
                            raise ValueError("Fixed image transfer budget exceeded")
                    if len(data) > limit:
                        raise ValueError("Oversized source object")
            if not data or (row["bytes"] is not None and len(data) != row["bytes"]):
                raise ValueError("Empty/wrong-size source object")
            if image and not valid_png(data):
                raise ValueError("Incomplete PNG source")
            shared.write_new(output/key, data)
            return dict(path=key, bytes=len(data), sha256=shared.digest(data))
        except Exception as error:
            with lock:
                state["failedTransfers"] += 1
                state["errors"].append(dict(path=key, error=type(error).__name__,
                                             receivedBytes=len(data), message=str(error)[:160]))
            raise

    failure = None
    iterator = iter(jobs)
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(transfer, next(iterator)) for _ in range(4)}
        while pending:
            done, pending = wait(pending, return_when=FIRST_COMPLETED)
            for job in done:
                try:
                    records.append(job.result())
                except Exception as error:
                    failure = error
            if failure is None:
                for _ in done:
                    row = next(iterator, None)
                    if row is not None:
                        pending.add(pool.submit(transfer, row))
            if len(records) % 20 == 0:
                print("M3R source completed", len(records)-len(values), flush=True)
    state["complete"] = failure is None and len(records) == len(jobs)+len(values)
    state["files"] = sorted(records, key=lambda r:r["path"])
    state["elapsedSeconds"] = monotonic()-started
    shared.write_json(output/("slice.json" if state["complete"] else "fetch-incomplete.json"), state)
    print(json.dumps({k:v for k,v in state.items() if k != "files"}, indent=2), flush=True)
    if not state["complete"]:
        raise RuntimeError("Incomplete source: valid intermediates retained, no implicit retry") from failure
    return state


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    fetch(args.plan, args.output)
