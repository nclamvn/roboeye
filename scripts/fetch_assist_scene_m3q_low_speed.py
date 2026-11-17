#!/usr/bin/env python3
"""Fetch the separately preregistered third M3Q natural low-speed window.

No mutation of the already sealed city/turn source receipt. No RGB-dependent
selection, retries, model execution or inferred range.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import json
from pathlib import Path
import shutil
from threading import Lock
from time import monotonic
from urllib.request import Request, urlopen

import fetch_assist_scene_m3q_boreas as shared

PLAN_SHA256 = "6653a032243d61a0832cef163aff4acbd0cea17ce4e43e2a8bdbd6559bee256e"
IMAGE_BYTES = 134026516
JOINT_IMAGE_BYTES = 523495815


def fetch(plan_path, out):
    if out.exists() or out.is_symlink(): raise ValueError("Choose a new third source directory")
    if shutil.disk_usage(out.parent).free < 10*1024**3: raise ValueError("Disk floor10GiB")
    raw = plan_path.read_bytes()
    if shared.digest(raw) != PLAN_SHA256: raise ValueError("Preregistered third window changed")
    plan = json.loads(raw); clip = plan["clip"]
    if (plan["study"] != "M3Q-low-speed-additional" or plan["rgbTransfers"] != 0
            or plan["modelCalls"] != 0 or plan["headImageBytes"] != IMAGE_BYTES
            or clip["id"] != "boreas-m3q-low-speed" or len(clip["cameraTimestampsUs"]) != 50
            or len(clip["labelTimestampsUs"]) != 20 or JOINT_IMAGE_BYTES > 700*1024**2):
        raise ValueError("Wrong fixed joint source budget/coverage")
    values = shared.metadata(Path(plan["metadataSource"]))
    if plan["metadata"] != {k:dict(bytes=len(v),sha256=shared.digest(v)) for k,v in values.items()}:
        raise ValueError("Official metadata changed")
    images = plan["imageHeads"]
    if ([r["path"] for r in images] != [f"camera/{s}.png" for s in clip["cameraTimestampsUs"]]
            or sum(r["bytes"] for r in images) != IMAGE_BYTES):
        raise ValueError("Image HEAD coverage/budget differs")
    out.mkdir(); records = []
    for key, body in values.items():
        shared.write_new(out/key, body)
        records.append(dict(path=key,bytes=len(body),sha256=shared.digest(body),reusedMetadata=True))
    shared.write_json(out/"clips.json", dict(schemaVersion=1, clips=[clip]))
    shared.write_json(out/"preregistration.json", plan)
    jobs = images+[dict(path=f"labels_detection/{s}.txt",bytes=None,etag=None) for s in clip["labelTimestampsUs"]]
    state = dict(complete=False,study="m3q-low-speed",source=shared.old.BASE+shared.old.SEQ,
                 license=shared.old.LICENSE,planSha256=PLAN_SHA256,imageBytesReceived=0,
                 metadataLabelBytesReceived=0,requests=0,failedTransfers=0,networkRetries=0,
                 modelCalls=0,headImageBytes=IMAGE_BYTES,jointThreeClipImageBytes=JOINT_IMAGE_BYTES,
                 errors=[])
    lock=Lock(); deadline=monotonic()+180
    def transfer(row):
        key=row["path"]; image=key.endswith(".png"); limit=shared.old.MAX_IMAGE if image else 128*1024
        data=bytearray()
        with lock:state["requests"]+=1
        try:
            if monotonic()>=deadline:raise ValueError("Third source wall budget exceeded")
            with urlopen(Request(shared.old.BASE+shared.old.SEQ+key),timeout=45) as response:
                if response.status!=200 or (row["etag"] is not None and response.headers.get("ETag")!=row["etag"]):
                    raise ValueError("HEAD/GET status or ETag differs")
                while True:
                    if monotonic()>=deadline:raise ValueError("Third source wall budget exceeded")
                    part=response.read(min(256*1024,limit+1-len(data)))
                    if not part:break
                    data.extend(part)
                    with lock:
                        counter="imageBytesReceived" if image else "metadataLabelBytesReceived"
                        state[counter]+=len(part)
                        if state["imageBytesReceived"]>IMAGE_BYTES:raise ValueError("Third image budget exceeded")
                    if len(data)>limit:raise ValueError("Oversized source object")
            if not data or (row["bytes"] is not None and len(data)!=row["bytes"]):
                raise ValueError("Empty/wrong-size source object")
            if image and (not data.startswith(b"\x89PNG\r\n\x1a\n") or not data.endswith(b"\x00\x00\x00\x00IEND\xaeB`\x82")):
                raise ValueError("Incomplete PNG")
            shared.write_new(out/key,data)
            return dict(path=key,bytes=len(data),sha256=shared.digest(data))
        except Exception as error:
            with lock:
                state["failedTransfers"]+=1
                state["errors"].append(dict(path=key,error=type(error).__name__,receivedBytes=len(data)))
            raise
    failure=None; iterator=iter(jobs)
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending={pool.submit(transfer,next(iterator)) for _ in range(4)}
        while pending:
            done,pending=wait(pending,return_when=FIRST_COMPLETED)
            for job in done:
                try:records.append(job.result())
                except Exception as error:failure=error
            if failure is None:
                for _ in done:
                    item=next(iterator,None)
                    if item is not None:pending.add(pool.submit(transfer,item))
            if len(records)%10==0:print("Third source completed",len(records),flush=True)
    state["complete"]=failure is None and len(records)==len(jobs)+len(values)
    state["files"]=sorted(records,key=lambda r:r["path"])
    shared.write_json(out/("slice.json" if state["complete"] else "fetch-incomplete.json"),state)
    print(json.dumps({k:v for k,v in state.items() if k!="files"},indent=2),flush=True)
    if not state["complete"]:raise RuntimeError("Third source incomplete; valid intermediates retained, no retry") from failure
    return state


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--plan",type=Path,required=True);p.add_argument("--output",type=Path,required=True)
    a=p.parse_args();fetch(a.plan,a.output)
