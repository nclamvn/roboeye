#!/usr/bin/env python3
"""Selective read of one pinned public PandaSet ZIP. Never fetch a full archive."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile

URL = ("https://huggingface.co/datasets/georghess/pandaset/resolve/"
       "53f4a13073719592d42a4fbf991e673be2f7cf1e/pandaset.zip")
SIZE = 44_520_528_731
MAX_RANGE = 8*1024**2
LICENSE_RE = re.compile(r"^(?:pandaset/)?(?:\d{3}/)?(?:license|terms)[^/]*\.(txt|md)$", re.I)
STREAM_RE = re.compile(r"^(?:pandaset/)?(\d{3})/(camera/front_camera/(?:intrinsics\.json|poses\.json|timestamps\.json|\d{2}\.jpg)|lidar/timestamps\.json|annotations/cuboids/\d{2}\.pkl\.gz)$")


def fetch(start, size):
    if not 0 < size <= MAX_RANGE or not 0 <= start <= SIZE-size:
        raise ValueError("Range exceeds allowlist or budget")
    stop = start+size-1
    # The query also prevents a proxy from replaying a different cached Range.
    response = subprocess.run(["curl","--proto","=https","--proto-redir","=https",
                               "-fsSL","--retry","2","--retry-all-errors","--max-time","22",
                               # curl also applies its limit to the signed-URL redirect body.
                               "--max-filesize",str(max(size,16*1024)),
                               "--range",f"{start}-{stop}","-D","-","-o","-",
                               URL+f"?slice={start}-{size}&v=2"],
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=80).stdout
    while True:
        header,sep,payload = response.partition(b"\r\n\r\n")
        if not sep or not header.startswith(b"HTTP/"):
            raise ValueError("Unexpected CDN header")
        if payload.startswith(b"HTTP/") and b" 206 " not in header.split(b"\r\n",1)[0]:
            response = payload
            continue
        break
    expected=f"content-range: bytes {start}-{stop}/{SIZE}".encode()
    if b" 206" not in header.split(b"\r\n",1)[0] or expected not in header.lower().split(b"\r\n") or len(payload)!=size:
        raise ValueError("Server did not honor exact byte range")
    return payload


class RemoteZip:
    def __init__(self):
        self.offset = 0
        self.tail_start = SIZE-MAX_RANGE
        self.tail = fetch(self.tail_start,MAX_RANGE)

    def seek(self, offset, origin=0):
        self.offset = (0,self.offset,SIZE)[origin]+offset
        if not 0 <= self.offset <= SIZE:
            raise ValueError("Invalid ZIP offset")
        return self.offset

    def tell(self):
        return self.offset

    def seekable(self):
        return True

    def read(self,n=-1):
        n = min(n if n>=0 else SIZE-self.offset, SIZE-self.offset)
        if not n:
            return b""
        if n>64*1024**2:
            raise ValueError("ZIP central directory exceeds 64 MiB")
        offset = self.offset
        self.offset += n
        return b"".join(
            self.tail[x-self.tail_start:x-self.tail_start+min(MAX_RANGE,offset+n-x)]
            if x>=self.tail_start else fetch(x,min(MAX_RANGE,offset+n-x))
            for x in range(offset,offset+n,MAX_RANGE)
        )


class BufferedMember(RemoteZip):
    def __init__(self, start, data):
        self.offset = start
        self.tail_start = start
        self.tail = data

    def read(self,n=-1):
        if n<0 or self.offset<self.tail_start or self.offset+n>self.tail_start+len(self.tail):
            raise ValueError("Member attempted to read past buffered range")
        return super().read(n)


def member(z, info):
    # Coalesce ZIP header/name + data. Reject exotic headers rather than
    # reading arbitrary offsets. zipfile performs length and CRC verification.
    from threading import RLock
    if (info.flag_bits & 1 or info.is_dir() or not 0 < info.file_size <= 2*1024**2
            or not 0 < info.compress_size <= 2*1024**2):
        raise ValueError("Unexpected archive member size/type")
    span=min(info.compress_size+1024,SIZE-info.header_offset)
    stream=BufferedMember(info.header_offset,fetch(info.header_offset,span))
    # Share parsed, immutable directory entries, never share mutable cursors.
    reader=object.__new__(zipfile.ZipFile)
    reader.mode="r"; reader.pwd=None; reader.fp=stream; reader._writing=False
    reader._lock=RLock(); reader._fpclose=lambda _: None; reader._fileRefCnt=1
    reader.metadata_encoding=None
    with reader.open(info) as file:
        data=file.read(2*1024**2+1)
    reader.fp=None
    if len(data)!=info.file_size:
        raise ValueError("Zip member length mismatch")
    return data


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--license-only",action="store_true")
    parser.add_argument("--terms-accepted",action="store_true",
                        help="Confirm organizational authority and acceptance of PandaSet's attached terms")
    parser.add_argument("--output",type=Path)
    parser.add_argument("--resume",action="store_true",help="Reuse prior members only after checking ZIP CRC and size")
    parser.add_argument("--sequence",action="append",default=[])
    parser.add_argument("--frames",type=int,default=45)
    args=parser.parse_args()
    if not args.license_only and not args.terms_accepted:
        parser.error("Acceptance of PandaSet's attached terms is required before downloading data")
    if not args.license_only and (args.output is None or args.output.is_symlink() or
                                 args.output.exists()!=args.resume or
                                 not 2<=len(set(args.sequence))<=4 or not 20<=args.frames<=55):
        parser.error("New output, 2–4 distinct sequence IDs, 20–55 frames required")
    with zipfile.ZipFile(RemoteZip()) as z:
        directory=z.infolist()
        licenses=[i for i in directory if LICENSE_RE.fullmatch(i.filename)]
        if args.license_only:
            print("Members:",len(directory),"; license files:",len(licenses))
            if not licenses:
                raise ValueError("No attached license")
            print(licenses[0].filename)
            print(member(z,licenses[0]).decode("utf-8"))
            return
        licenses=[i for i in licenses if any(f"/{s}/" in "/"+i.filename for s in args.sequence)]
        if len(licenses)!=len(set(args.sequence)) or any(
                sum(f"/{s}/" in "/"+item.filename for item in licenses)!=1 for s in args.sequence):
            raise ValueError("Expected an attached license for every selected sequence")
        attached=[member(z,item) for item in licenses]
        if len(set(attached))!=1:
            raise ValueError("Selected sequences have different license text")
        terms=attached[0].decode("utf-8")
        if "CC BY 4.0" not in terms or "NonCommercial" in terms or "Non-Commercial" in terms:
            raise ValueError("Attached terms not approved for this slice")
        selected=[]
        for item in directory:
            match=STREAM_RE.fullmatch(item.filename)
            if not match or match[1] not in args.sequence:
                continue
            idx=re.match(r"(\d{2})\.",PurePosixPath(match[2]).name)
            if idx and int(idx[1])>=args.frames:
                continue
            selected.append((item,f"{match[1]}/{match[2]}"))
        if len(selected)!=len(set(args.sequence))*(args.frames*2+4):
            raise ValueError(f"Unexpected member coverage: {len(selected)}")
        args.output.mkdir(exist_ok=args.resume)
        license_file=args.output/"LICENSE.txt"
        if args.resume and (license_file.is_symlink() or license_file.read_bytes()!=attached[0]
                            or (args.output/"slice.json").exists()):
            raise ValueError("Not an incomplete slice with matching terms")
        if not args.resume:
            with license_file.open("xb") as f:
                f.write(attached[0])
        def save(row):
            import zlib
            item,rel=row
            f=args.output/rel
            if f.exists() and args.resume:
                if (f.is_symlink() or not f.resolve().is_relative_to(args.output.resolve()) or
                        f.stat().st_size!=item.file_size):
                    raise ValueError("Invalid resumable member")
                data=f.read_bytes()
                if zlib.crc32(data)!=item.CRC:
                    raise ValueError("CRC mismatch in partial slice")
                return dict(path=rel,bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
            data=member(z,item)
            f.parent.mkdir(parents=True,exist_ok=True)
            if not f.resolve().is_relative_to(args.output.resolve()):
                raise ValueError("Unsafe destination")
            with f.open("xb") as output:
                output.write(data)
            return dict(path=rel,bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
        with ThreadPoolExecutor(max_workers=4) as pool:
            records=list(pool.map(save,selected))
        (args.output/"slice.json").write_text(json.dumps({"source":URL,"archiveBytes":SIZE,
            "licenseSha256":hashlib.sha256(attached[0]).hexdigest(),"files":records},indent=2)+"\n")
        print(f"{len(records)} members, {sum(x['bytes'] for x in records)} bytes")


if __name__=="__main__":
    main()
