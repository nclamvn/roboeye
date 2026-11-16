#!/usr/bin/env python3
"""Convert hash-bound PandaSet cuboids only; no unrestricted pickle loading."""

import argparse
import gzip
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path
import pickle
import re

import numpy as np
import pandas as pd


ALLOW = {
    "pandas": {"DataFrame", "Index", "RangeIndex"},
    "pandas.core.frame": {"DataFrame"},
    "pandas.core.internals.managers": {"BlockManager"},
    "pandas.core.internals.blocks": {"new_block"},
    "pandas._libs.internals": {"_unpickle_block"},
    "pandas.core.indexes.base": {"Index", "_new_Index"},
    "pandas.core.indexes.range": {"RangeIndex"},
    "pandas.core.indexes.numeric": {"Int64Index"},
    "numpy": {"ndarray", "dtype"},
    "numpy.core.multiarray": {"_reconstruct", "scalar"},
    "numpy._core.multiarray": {"_reconstruct", "scalar"},
    "numpy.core.numeric": {"_frombuffer"},
    "numpy._core.numeric": {"_frombuffer"},
    "builtins": {"slice"},
}
FIELDS = {"uuid","label","yaw","stationary","position.x","position.y","position.z",
          "dimensions.x","dimensions.y","dimensions.z","cuboids.sensor_id","cuboids.sibling_id",
          "attributes.object_motion"}
MAX_PICKLE = 2 * 1024**2
MEMBER = re.compile(r"(\d{3})/annotations/cuboids/(\d{2})\.pkl\.gz")


class CuboidReader(pickle.Unpickler):
    def find_class(self, module, name):
        if name not in ALLOW.get(module,set()):
            raise pickle.UnpicklingError(f"Rejected pickle global {module}.{name}")
        if (module, name) == ("pandas.core.indexes.numeric", "Int64Index"):
            return pd.Index
        return super().find_class(module,name)

    def persistent_load(self, pid):
        raise pickle.UnpicklingError("External pickle references forbidden")


def plain(payload):
    if len(payload)>MAX_PICKLE:
        raise ValueError("Compressed cuboid exceeds budget")
    with gzip.GzipFile(fileobj=BytesIO(payload)) as stream:
        data=stream.read(MAX_PICKLE+1)
    if len(data)>MAX_PICKLE:
        raise ValueError("Decoded cuboid exceeds budget")
    obj=CuboidReader(BytesIO(data)).load()
    if type(obj) is not pd.DataFrame or len(obj)>1500 or len(obj.columns)>64 or not obj.columns.is_unique:
        raise ValueError("Not a bounded PandaSet cuboid table")
    output=[]
    for row in obj[[x for x in obj.columns if x in FIELDS]].to_dict("records"):
        result={}
        for k,v in row.items():
            if isinstance(v,np.generic):
                v=v.item()
            if v is pd.NA or (type(v) is float and math.isnan(v)):
                v=None
            if type(v) not in (str,int,float,bool,type(None)) or (type(v) is float and not math.isfinite(v)):
                raise ValueError("Expected finite scalar cuboid columns")
            result[k]=v
        output.append(result)
    return output


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("root",type=Path)
    args=p.parse_args()
    root=args.root.resolve(strict=True)
    manifest=json.loads((root/"slice.json").read_text())
    selected={}
    for row in manifest["files"]:
        paths=MEMBER.fullmatch(row["path"])
        if paths:
            if row["path"] in selected:
                raise ValueError("Duplicate archive label path")
            selected[row["path"]]=(paths[1],paths[2],row["sha256"],row["bytes"])
    if not 20<=len(selected)<=220:
        raise ValueError("Unexpected set of selected cuboids")
    for source,(seq,index,sha,expected_size) in selected.items():
        path=(root/source).resolve(strict=True)
        if not path.is_relative_to(root) or path.stat().st_size!=expected_size or expected_size>MAX_PICKLE:
            raise ValueError("Unverified source path or size")
        content=path.read_bytes()
        if hashlib.sha256(content).hexdigest()!=sha:
            raise ValueError("Unverified source digest")
        rows=plain(content)
        out=root/seq/"annotations/cuboids_safe"
        out.mkdir(exist_ok=True)
        target=out/f"{index}.json"
        text=json.dumps(rows,separators=(",",":"),ensure_ascii=False,allow_nan=False)+"\n"
        if target.is_file() and not target.is_symlink() and target.read_text()==text:
            continue
        with target.open("x") as file:
            file.write(text)
    print(f"Converted {len(selected)} hash-verified cuboid tables")


if __name__=="__main__":
    main()
