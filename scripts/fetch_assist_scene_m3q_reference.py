#!/usr/bin/env python3
"""Bounded official HPatches subset: real planar images and external homographies.

Only original HPatches sequences (references.txt []) are selected. This is not
road motion ground truth, per-object 3D motion, dense flow or occlusion truth.
No network/model action on import; signed redirects never enter the manifest.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
from time import monotonic

import cv2
import numpy as np
from fetch_assist_scene_flow_reference import central_entries, directory, member, response_range

HF_REVISION = "594f211e80b75081ad84a396c93960c8653235f8"
GH_REVISION = "fd79bca4dc755c9f623a5f129f3452fc663ee305"
ARCHIVE = f"https://huggingface.co/datasets/vbalnt/hpatches/resolve/{HF_REVISION}/hpatches-sequences-release.zip"
ARCHIVE_SIZE = 1279545572
ARCHIVE_LFS_SHA256 = "99cf7e1ca167896eb4ca2fe3d903beff6566243a3c0c8e07a13a2596648ad670"
META = f"https://huggingface.co/api/datasets/vbalnt/hpatches/revision/{HF_REVISION}"
CARD = f"https://huggingface.co/datasets/vbalnt/hpatches/raw/{HF_REVISION}/README.md"
GH = f"https://raw.githubusercontent.com/hpatches/hpatches-dataset/{GH_REVISION}/"
SEQUENCES = ("i_londonbridge", "v_abstract")
FILES = ("1.ppm", "2.ppm", "H_1_2")
MAX_NETWORK = 40 * 1024**2


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


class Reader:
    """No retries; exact Content-Range and stable archive ETag, fixed total budget."""
    def __init__(self):
        self.bytes = 0
        self.reserved = 0
        self.calls = []
        self.etags = {}
        self.deadline = monotonic() + 240

    def get(self, url, limit, *, interval=None, total=None):
        archive = interval is not None
        stable = ARCHIVE if archive else url
        require(type(limit) is int and 0 < limit <= 8*1024**2,
                "Oversized individual transfer")
        # Curl applies --max-filesize to redirect bodies as well. Reserve its
        # actual upper bound, then require the final response's exact size.
        cap = max(limit, 20_000)
        require(self.reserved + cap <= MAX_NETWORK, "Network budget exceeded")
        remaining = min(25, int(self.deadline-monotonic()))
        require(remaining > 0, "Fetch wall budget exceeded")
        self.reserved += cap
        command = ["curl", "--proto", "=https", "--proto-redir", "=https",
                   "--fail", "--location", "--silent", "--show-error",
                   "--connect-timeout", "8", "--max-time", str(remaining),
                   "--max-filesize", str(cap), "--dump-header", "/dev/stderr"]
        if archive:
            require(total == ARCHIVE_SIZE and interval[1]-interval[0]+1 == limit,
                    "Wrong archive range contract")
            command += ["--header", f"Range: bytes={interval[0]}-{interval[1]}"]
        command.append(stable)
        result = subprocess.run(command, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=remaining+3)
        self.bytes += len(result.stdout)
        self.calls.append({"url": stable, "range": interval, "reservedBytes": cap,
                           "receivedBytes": len(result.stdout), "exitCode": result.returncode})
        require(result.returncode == 0, f"Bounded request failed exit{result.returncode}; redirects omitted")
        require(0 < len(result.stdout) <= limit, "Wrong final response size")
        if archive:
            etag = response_range(result.stderr, *interval, total, len(result.stdout))
            require(etag is not None, "Archive ETag absent")
            previous = self.etags.setdefault(ARCHIVE, etag)
            require(etag == previous, "Archive changed during range reads")
        return result.stdout


def selected(entries):
    names = []
    for sequence in SEQUENCES:
        for filename in FILES:
            name = f"hpatches-sequences-release/{sequence}/{filename}"
            require(name in entries, "Predeclared reference member absent")
            item = entries[name]
            require(0 < item["size"] < 8*1024**2 and item["compressedSize"] < 8*1024**2,
                    "Member exceeds fixed reference size budget")
            names.append(name)
    return names


def verify_rights(metadata, card, readme, license_text, references):
    require(metadata.get("id") == "vbalnt/hpatches" and metadata.get("sha") == HF_REVISION
            and metadata.get("private") is False and metadata.get("gated") is False
            and metadata.get("cardData", {}).get("license") == "mit", "Wrong dataset rights/revision")
    require("license: mit" in card and "MIT License" in license_text
            and "Copyright (c) 2020 HPatches" in license_text, "Explicit MIT notices absent")
    require("https://huggingface.co/datasets/vbalnt/hpatches/resolve/main/hpatches-sequences-release.zip" in readme,
            "Mirror not linked by official dataset repository")
    require("[] - First introduced in this dataset." in references,
            "Original-source reference convention absent")
    for name in SEQUENCES:
        require(re.search(r"(?m)^"+re.escape(name)+r"\s*-\s*\[\]\s*$", references) is not None,
                "Selected sequence has an inherited external source")


def verify_pair(root, sequence):
    folder = root / "hpatches-sequences-release" / sequence
    images = [cv2.imread(str(folder/name), cv2.IMREAD_COLOR) for name in FILES[:2]]
    require(all(image is not None and image.dtype == np.uint8 for image in images)
            and images[0].shape == images[1].shape and min(images[0].shape[:2]) >= 64,
            "Missing/mismatched real reference images")
    matrix = np.loadtxt(folder/"H_1_2", dtype=np.float64)
    require(matrix.shape == (3, 3) and np.isfinite(matrix).all()
            and abs(np.linalg.det(matrix)) > 1e-10, "Invalid external homography")
    return {"id": sequence, "old": str((folder/"1.ppm").relative_to(root)),
            "new": str((folder/"2.ppm").relative_to(root)),
            "homography": str((folder/"H_1_2").relative_to(root)),
            "shape": list(images[0].shape[:2]), "H_1_2": matrix.tolist(),
            "reference": "External HPatches estimated planar homography; first image to second; original image pixel coordinates",
            "visibility": "Only projected image-bound visibility available; not an occlusion label"}


def fetch(output):
    require(not output.exists() and not output.is_symlink(), "Choose a new reference directory")
    require(shutil.disk_usage(output.parent).free >= 10*1024**3, "Less than10GiB free")
    reader = Reader()
    output.mkdir()
    manifest = {"schemaVersion": 1, "dataset": "HPatches-original-planar-reference",
                "study": "M3Q", "complete": False, "pairs": [], "files": [],
                "selection": "Predeclared first original (references[]) lexical illumination/viewpoint sequences i_londonbridge/v_abstract, frames1->2; no pixel/model selection",
                "license": {"name": "MIT", "datasetCard": CARD, "officialNotice": GH+"LICENSE"},
                "attribution": "HPatches: Vassileios Balntas, Karel Lenc, Andrea Vedaldi, Krystian Mikolajczyk, CVPR2017. Copyright2020 HPatches. Selected original sequences, no endorsement.",
                "sourceSha256": digest(Path(__file__).read_bytes()),
                "archive": {"url": ARCHIVE, "size": ARCHIVE_SIZE, "publishedLfsSha256": ARCHIVE_LFS_SHA256,
                            "fullArchiveDownloadedOrHashed": False},
                "maxNetworkBytes": MAX_NETWORK,
                "limits": "Planar real-image estimated-homography reference only; not dense flow/3D object approach/occlusion truth, metres or phone acceptance."}
    def save(path, data, kind, **extra):
        destination = output/path
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as target:
            target.write(data)
        manifest["files"].append({"path": path, "bytes": len(data), "sha256": digest(data),
                                  "kind": kind, **extra})
    try:
        sources = {"hf-metadata.json": (META, 100000), "dataset-card.md": (CARD, 10000),
                   "official-readme.md": (GH+"README.md", 20000),
                   "LICENSE": (GH+"LICENSE", 10000), "references.txt": (GH+"references.txt", 20000)}
        raw = {}
        for name, (url, limit) in sources.items():
            raw[name] = reader.get(url, limit)
            save(name, raw[name], "primary-rights-source", url=url)
        verify_rights(json.loads(raw["hf-metadata.json"]), *(raw[name].decode() for name in
                      ("dataset-card.md", "official-readme.md", "LICENSE", "references.txt")))
        entries = directory(reader, 0, ARCHIVE_SIZE)
        names = selected(entries)
        manifest["selectedMembersBeforePixels"] = names
        for name in names:
            data = member(reader, 0, ARCHIVE_SIZE, entries[name])
            save(name, data, "original-reference-member", crc32=entries[name]["crc32"])
            print("Verified", name, len(data), flush=True)
        manifest["pairs"] = [verify_pair(output, sequence) for sequence in SEQUENCES]
        manifest["archive"]["etag"] = reader.etags[ARCHIVE]
        manifest["complete"] = True
    finally:
        manifest.update(actualReceivedBytes=reader.bytes, reservedNetworkBytes=reader.reserved,
                        requests=reader.calls, elapsedSeconds=240-(reader.deadline-monotonic()))
        (output/"manifest.json").write_text(json.dumps(manifest, indent=2, allow_nan=False)+"\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    fetch(args.output)
