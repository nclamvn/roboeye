#!/usr/bin/env python3
"""Bounded public Spring v2 ZIP64 member fetch, never complete archives.

Spring is rendered independent flow ground truth, not real driving footage.
CC BY4.0 is verified from official dataset metadata before any member fetch.
All signed redirects remain in memory only; manifests use stable official URLs.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import subprocess
from time import monotonic
import zlib


API = "https://darus.uni-stuttgart.de/api"
DOI = "doi:10.18419/DARUS-3376"
META = API+"/datasets/:persistentId/?persistentId="+DOI
LICENSE = "http://creativecommons.org/licenses/by/4.0"
MAX_NETWORK = 250*1024**2
MAX_MEMBER = 80*1024**2
MAX_DIRECTORY = 8*1024**2
ARCHIVES = {"train_frame_left.zip": (199097, 13361546687),
    "train_flow_FW_left.zip": (199011, 47214992751),
    "train_flow_BW_left.zip": (199006, 47241115580),
    "train_maps.zip": (242149, 4626778672)}


def require(condition, message):
    if not condition: raise ValueError(message)


def safe_name(name):
    path = PurePosixPath(name)
    require(name and not path.is_absolute() and ".." not in path.parts
        and "\\" not in name and "\x00" not in name and not name.endswith("/"), "Unsafe ZIP member name")
    return name


def response_range(headers, start, end, total, actual):
    blocks = re.findall(rb"HTTP/[^\r\n]+\r?\n(?:(?!HTTP/).)*?(?:\r?\n){2}", headers, re.S)
    require(blocks, "Missing bounded response headers")
    last = blocks[-1]
    require(re.match(rb"HTTP/\S+ 206\b", last) is not None, "Server ignored Range; refusing full archive")
    found = re.search(rb"(?im)^content-range:\s*bytes (\d+)-(\d+)/(\d+)\s*$", last)
    require(found and tuple(map(int, found.groups())) == (start, end, total)
        and actual == end-start+1, "Wrong bounded Content-Range or response size")
    etag = re.search(rb"(?im)^etag:\s*([^\r\n]+)", last)
    return None if etag is None else etag[1].decode("ascii")


class Reader:
    def __init__(self, budget=MAX_NETWORK, deadline=None):
        self.budget=budget; self.bytes=0; self.reserved=0; self.calls=[]; self.etags={};self.redirects={};self.deadline=deadline

    def get(self, url, limit, *, interval=None, total=None):
        if interval is not None and limit>512*1024:
            pieces=[];start,end=interval
            for offset in range(start,end+1,512*1024):
                stop=min(end,offset+512*1024-1)
                pieces.append(self.get(url,stop-offset+1,interval=(offset,stop),total=total))
            return b"".join(pieces)
        # Reserve the entire bounded transfer even on failure. No retry silently
        # adds an unaccounted request; caller may inspect failure and stop.
        require(type(limit) is int and limit > 0 and self.reserved+limit <= self.budget, "Network budget exhausted")
        self.reserved+=limit
        remaining=60 if self.deadline is None else min(60,int(self.deadline-monotonic()))
        require(remaining>0,"Additional fetch wall budget exhausted")
        command=["curl", "--proto", "=https", "--proto-redir", "=https", "--fail", "--location", "--silent", "--show-error",
            "--connect-timeout", "12", "--max-time", str(remaining), "--max-filesize", str(limit), "--dump-header", "/dev/stderr"]
        if interval is not None: command += ["--header", f"Range: bytes={interval[0]}-{interval[1]}"]
        command.append(self.redirects.get(url,url))
        result=subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=remaining+5)
        self.bytes+=len(result.stdout)
        self.calls.append({"url":url,"range":interval,"reservedBytes":limit,"receivedBytes":len(result.stdout),"exitCode":result.returncode})
        require(result.returncode == 0, f"Bounded HTTPS request failed (exit {result.returncode}); signed redirects omitted")
        redirects=re.findall(rb"(?im)^location:\s*(https://s3\.tik\.uni-stuttgart\.de/[^\r\n]+)",result.stderr)
        if redirects:self.redirects[url]=redirects[-1].decode("ascii")
        require(0 < len(result.stdout) <= limit, "Unexpected bounded response size")
        if interval is not None:
            etag=response_range(result.stderr,*interval,total,len(result.stdout))
            prior=self.etags.setdefault(url,etag)
            require(prior==etag, "Archive ETag changed between ranges")
        return result.stdout


def zip_extra(extra):
    result={};p=0
    while p<len(extra):
        require(p+4<=len(extra),"Truncated ZIP extra header")
        kind,n=struct.unpack_from("<HH",extra,p);p+=4
        require(p+n<=len(extra),"Truncated ZIP extra value")
        require(kind not in result,"Duplicate ZIP extra value")
        result[kind]=extra[p:p+n];p+=n
    return result


def central_entries(data):
    p=0;result={}
    while p<len(data):
        require(p+46<=len(data),"Truncated ZIP directory")
        v=struct.unpack_from("<4s6H3I5H2I",data,p)
        require(v[0]==b"PK\x01\x02","Wrong ZIP directory signature")
        flags,method,crc,compressed,size=v[3],v[4],v[7],v[8],v[9]
        nl,el,cl,disk=v[10:14];offset=v[-1];stop=p+46+nl+el+cl
        require(stop<=len(data) and disk==0 and flags&1==0 and method in (0,8),"Unsupported or malformed ZIP entry")
        name=data[p+46:p+46+nl].decode("utf-8" if flags&2048 else "cp437")
        extras=zip_extra(data[p+46+nl:p+46+nl+el]);z=extras.get(1,b"");at=0
        values=[]
        for value in (size,compressed,offset):
            if value==0xffffffff:
                require(at+8<=len(z),"Missing ZIP64 entry size/offset");value=struct.unpack_from("<Q",z,at)[0];at+=8
            values.append(value)
        size,compressed,offset=values
        require(name not in result,"Duplicate ZIP directory member")
        result[name]={"name":name,"flags":flags,"method":method,"crc32":crc,"compressedSize":compressed,"size":size,"offset":offset}
        p=stop
    return result


def directory(reader, archive_id, total):
    url=API+f"/access/datafile/{archive_id}"
    tail=reader.get(url,98,interval=(total-98,total-1),total=total)
    at=tail.rfind(b"PK\x05\x06");require(at>=0,"Missing ZIP end record")
    e=struct.unpack_from("<4s4H2IH",tail,at)
    require(e[1]==e[2]==0 and e[-1]==0,"Multidisk or commented ZIP not accepted")
    count,size,offset=e[4],e[5],e[6]
    if offset==0xffffffff or size==0xffffffff or count==65535:
        locator=tail.rfind(b"PK\x06\x07");require(locator>=0,"Missing ZIP64 locator")
        _,disk,zoff,disks=struct.unpack_from("<4sIQI",tail,locator)
        require(disk==0 and disks==1 and 0<=zoff<total-56,"Invalid ZIP64 end offset")
        z=reader.get(url,56,interval=(zoff,zoff+55),total=total)
        v=struct.unpack("<4sQ2H2I4Q",z)
        require(v[0]==b"PK\x06\x06" and v[4]==v[5]==0 and v[6]==v[7],"Invalid ZIP64 end record")
        count,size,offset=v[7],v[8],v[9]
    require(0<size<=MAX_DIRECTORY and offset+size<total and 0<count<=100000,"Over-budget ZIP directory")
    data=reader.get(url,size,interval=(offset,offset+size-1),total=total)
    result=central_entries(data);require(len(result)==count,"ZIP directory member count differs")
    return result


def member(reader, archive_id,total,entry):
    safe_name(entry["name"])
    size,compressed,offset=(entry[k] for k in ("size","compressedSize","offset"))
    require(0<size<=MAX_MEMBER and 0<compressed<=MAX_MEMBER and offset+30<total,"Over-budget ZIP member")
    url=API+f"/access/datafile/{archive_id}"
    header=reader.get(url,30,interval=(offset,offset+29),total=total)
    h=struct.unpack("<4s5H3I2H",header)
    require(h[0]==b"PK\x03\x04" and h[2]==entry["flags"] and h[3]==entry["method"],"Local ZIP header disagrees")
    nl,el=h[-2:];require(nl<=4096 and el<=65535,"Over-budget local ZIP header")
    raw=reader.get(url,nl+el+compressed,interval=(offset+30,offset+29+nl+el+compressed),total=total)
    name=raw[:nl].decode("utf-8" if entry["flags"]&2048 else "cp437");require(name==entry["name"],"Local ZIP name disagrees")
    payload=raw[nl+el:]
    if entry["method"]==8:
        decoder=zlib.decompressobj(-15);data=decoder.decompress(payload,size+1)
        require(decoder.eof and not decoder.unconsumed_tail and not decoder.unused_data,"Truncated/over-budget compressed member")
    else:data=payload
    require(len(data)==size and zlib.crc32(data)&0xffffffff==entry["crc32"],"ZIP member size/CRC mismatch")
    return data


def verify_metadata(value):
    d=value["data"];v=d["latestVersion"]
    require(value["status"]=="OK" and d["id"]==198926 and v["versionState"]=="RELEASED"
        and v["versionNumber"]==2 and v["versionMinorNumber"]==0 and v["license"]=={"name":"CC BY 4.0","uri":LICENSE,"iconUri":"https://licensebuttons.net/l/by/4.0/88x31.png"},"Dataset identity/version/licence changed")
    files={f["label"]:f for f in v["files"]}
    for name,(id_,size) in ARCHIVES.items():
        f=files[name];require(f["restricted"] is False and f["dataFile"]["id"]==id_ and f["dataFile"]["filesize"]==size,"Archive metadata changed")
    return files


def selection(entries,archive):
    # Names from public archive directory only, independent of pixels/results.
    chosen=[]
    for sequence in ("0001","0002"):
        candidates=[n for n in entries if f"/{sequence}/" in n]
        if archive=="train_frame_left.zip":
            for suffix in ("_0001.png","_0002.png"):
                names=[n for n in candidates if n.endswith(suffix)];require(len(names)==1,"Image naming differs from preregistration");chosen+=names
        elif archive=="train_flow_FW_left.zip":
            names=[n for n in candidates if n.endswith("_0001.flo5")];require(len(names)==1,"Forward naming differs");chosen+=names
        elif archive=="train_flow_BW_left.zip":
            names=[n for n in candidates if n.endswith("_0002.flo5")];require(len(names)==1,"Backward naming differs");chosen+=names
        else:
            names=[n for n in candidates if ("match" in n.lower() and (n.endswith("_0001.png") or n.endswith("_0002.png"))) and "left" in n.lower()]
            require(2<=len(names)<=8,"Match-map naming differs");chosen+=sorted(names)
    return chosen


def fetch(output, *, resume=False):
    require(not output.is_symlink() and output.exists()==resume,"Choose new reference output or explicit one-time resume")
    require(shutil.disk_usage(output.parent).free>=10*1024**3,"Less than10GiB free disk")
    reader=Reader(deadline=monotonic()+300 if resume else None)
    if resume:
        old=output/"manifest.json";manifest=json.loads(old.read_text())
        require(manifest.get("complete") is False and "resume" not in manifest and not (output/"manifest-attempt1.json").exists(),"Only one incomplete attempt may resume")
        meta=(output/"dataset-metadata.json").read_bytes();verify_metadata(json.loads(meta))
        require(hashlib.sha256(meta).hexdigest()==manifest["metadataSha256"],"Stored metadata changed")
        for record in manifest["files"]:
            data=(output/safe_name(record["path"])).read_bytes()
            require(len(data)==record["size"] and hashlib.sha256(data).hexdigest()==record["sha256"] and zlib.crc32(data)&0xffffffff==record["crc32"],"Retained file changed")
        old.rename(output/"manifest-attempt1.json")
        manifest["resume"]={"kind":"one-authorized-infrastructure-repair","change":"512KiB exact ranges, signed GET redirect reused in memory only, additional wall budget300s","priorManifestSha256":hashlib.sha256((output/"manifest-attempt1.json").read_bytes()).hexdigest(),"newSourceSha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
        reader.bytes=manifest["actualReceivedBytes"];reader.reserved=manifest["reservedNetworkBytes"];reader.calls=manifest["requests"]
    else:
        meta=reader.get(META,1024**2);value=json.loads(meta);verify_metadata(value)
        output.mkdir();(output/"dataset-metadata.json").write_bytes(meta)
        manifest={"schemaVersion":1,"dataset":"Spring-v2-independent-rendered-flow-reference","datasetDoi":DOI,"datasetVersion":"2.0",
        "license":{"name":"CC BY4.0","uri":LICENSE,"source":META},"attribution":"Mehl, Lukas; Schmalfuss, Jenny; Jahedi, Azin; Nalivayko, Yaroslava; Bruhn, Andrés (2023), Spring, DaRUS V2, doi:10.18419/DARUS-3376. Spring movie assets by Blender Foundation. Selected subset, no endorsement.",
        "selection":"Sequences0001/0002, left frames0001->0002, forward at0001/backward at0002, matched maps; fixed without viewing pixels/model outcomes.",
        "maxNetworkBytes":MAX_NETWORK,"metadataSha256":hashlib.sha256(meta).hexdigest(),"files":[],"archives":[],"complete":False,
            "sourceSha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),"limits":"Rendered independent benchmark, not real-road scene semantics, motion alerts, metres or phone acceptance."}
    try:
        for archive,(id_,size) in ARCHIVES.items():
            entries=directory(reader,id_,size);names=selection(entries,archive)
            print(archive,"selected",names,flush=True)
            known=next((a for a in manifest["archives"] if a["filename"]==archive),None)
            row={"filename":archive,"dataFileId":id_,"size":size,"url":API+f"/access/datafile/{id_}","etag":reader.etags[API+f"/access/datafile/{id_}"]}
            if known is None:manifest["archives"].append(row)
            else:require(known==row,"Archive metadata/ETag changed on resume")
            for name in names:
                if any(f["archive"]==archive and f["member"]==name for f in manifest["files"]):
                    print("retained-verified",name,flush=True);continue
                data=member(reader,id_,size,entries[name]);path=output/archive.removesuffix(".zip")/safe_name(name);path.parent.mkdir(parents=True,exist_ok=True)
                with path.open("xb") as f:f.write(data)
                manifest["files"].append({"path":str(path.relative_to(output)),"archive":archive,"member":name,"size":len(data),"sha256":hashlib.sha256(data).hexdigest(),"crc32":entries[name]["crc32"]})
                print("verified",name,len(data),flush=True)
        manifest["complete"]=True
    finally:
        manifest["completeReferencePairs"]=[s for s in ("0001","0002") if all(any(f["archive"]==a and f"/{s}/" in f["member"] and f["member"].endswith(end) for f in manifest["files"]) for a,end in (("train_frame_left.zip","_0001.png"),("train_frame_left.zip","_0002.png"),("train_flow_FW_left.zip","_0001.flo5"),("train_flow_BW_left.zip","_0002.flo5")))]
        manifest.update(actualReceivedBytes=reader.bytes,reservedNetworkBytes=reader.reserved,requests=reader.calls)
        (output/"manifest.json").write_text(json.dumps(manifest,indent=2,allow_nan=False)+"\n")
    return manifest


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--output",required=True,type=Path);p.add_argument("--resume",action="store_true");args=p.parse_args()
    fetch(args.output,resume=args.resume)
