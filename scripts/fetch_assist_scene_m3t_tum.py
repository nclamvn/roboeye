#!/usr/bin/env python3
"""One-pass bounded TUM static-control slice, selected by filenames, never pixels.

No archive is persisted. The full compressed source is counted, hashed and
drained through gzip CRC, even after tar EOF. No network retry or model call.
"""
import argparse
from decimal import Decimal
import gzip
from hashlib import sha256
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
from time import monotonic
from urllib.request import Request, urlopen

PLAN_SHA256 = "cdf35cbc8c310bc99f5dfb9d2dba3fe5b44064533f01a4ee72b633f7040da02a"
MAX_KEEP = 80*1024**2
MAX_NETWORK = 850*1024**2
OFFSETS = [0,100000,200000,300000,400000,500000,600000,700000,900000]
PAIRS = [[0,1],[1,3],[2,3],[3,5],[4,5],[5,7],[6,7],[7,8]]
PNG = b"\x89PNG\r\n\x1a\n"


def require(value, message):
    if not value: raise ValueError(message)


def digest(body): return sha256(body).hexdigest()


def timestamp(text):
    require(re.fullmatch(r"\d+\.\d{1,6}",text) is not None,"Invalid timestamp")
    return int(Decimal(text)*1000000)


def write_new(path, body):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("xb") as stream: stream.write(body)


def write_json(path, value):
    write_new(path,(json.dumps(value,indent=2,allow_nan=False)+"\n").encode())


def validate_plan(raw):
    require(digest(raw)==PLAN_SHA256,"Pre-RGB plan changed")
    p=json.loads(raw)
    require(p["status"]=="SEALED-BEFORE-RGB" and p["rgbTransfersBeforeSeal"]==0
        and p["selection"]["nodeOffsetsUs"]==OFFSETS and p["selection"]["pairs"]==PAIRS
        and sum(s["archiveBytes"] for s in p["sequences"])==731814825,"Wrong fixed source scope")
    require(p["budget"]["networkBytes"]==MAX_NETWORK
        and p["budget"]["maxSelectedAndCandidateBytes"]==MAX_KEEP
        and p["selection"]["nominalPairsTotal"]==48,"Wrong hard budget/denominator")
    return p


def nearest(rows, query, limit=None):
    ranked=sorted(rows,key=lambda r:(abs(r[0]-query),r[0],r[1]))
    if not ranked:return None,"missing"
    result=ranked[0]
    if len(ranked)>1 and abs(ranked[1][0]-query)==abs(result[0]-query):return result,"ambiguous-nearest"
    if limit is not None and abs(result[0]-query)>limit:return result,"nearest-too-far"
    return result,"valid"


class CountedReader:
    def __init__(self,response,state,deadline):
        self.response,self.state,self.deadline=response,state,deadline
        self.count=0;self.hash=sha256()
    def read(self,size=-1):
        require(monotonic()<=self.deadline,"Fetch wall budget exceeded")
        data=self.response.read(min(256*1024,size) if size>=0 else 256*1024)
        self.count+=len(data);self.state["networkBytesReceived"]+=len(data);self.hash.update(data)
        require(self.state["networkBytesReceived"]<=MAX_NETWORK,"Network budget exceeded")
        return data


def image_stamp(name, root):
    path=PurePosixPath(name)
    require(not path.is_absolute() and ".."not in path.parts,"Unsafe tar path")
    if len(path.parts)!=3 or path.parts[0]!=root or path.parts[1]not in ("rgb","depth"):return None
    require(path.suffix==".png","Unexpected sensor member format")
    return path.parts[1],timestamp(path.stem)


def candidates(rows, stamp, path, targets, kind):
    # At30Hz these filename-only envelopes cover all required nearest files.
    # Full metadata below verifies the chosen nearest member is actually kept.
    limit=17500 if kind=="rgb" else 60000
    maximum=1 if kind=="rgb" else 3
    updated=[list(r) for r in rows]
    for i,target in enumerate(targets):
        if abs(stamp-target)<=limit:
            updated[i]=sorted({*updated[i],(stamp,path)},key=lambda r:(abs(r[0]-target),r[0],r[1]))[:maximum]
    return updated


def stream_sequence(sequence,targets,output,state,deadline,progress):
    root="rgbd_dataset_freiburg3_"+sequence["id"]
    choices={k:[[] for _ in targets] for k in ("rgb","depth")}
    inventory={k:[] for k in choices};kept={};metadata={};seen=set();expanded=0
    progress.update(sequence=sequence["id"],phase="archive-stream",currentCandidateFiles=0)
    try:
        with urlopen(Request(sequence["archiveUrl"],headers={"Accept-Encoding":"identity"}),timeout=30) as response:
            require(response.status==200 and response.headers.get("ETag")==sequence["archiveETag"]
                and int(response.headers.get("Content-Length","-1"))==sequence["archiveBytes"],"Archive HEAD/GET pin changed")
            counted=CountedReader(response,state,deadline)
            with gzip.GzipFile(fileobj=counted,mode="rb") as compressed:
                with tarfile.open(fileobj=compressed,mode="r|") as archive:
                    for member in archive:
                        require(monotonic()<=deadline,"Fetch wall budget exceeded")
                        path=PurePosixPath(member.name)
                        require(not path.is_absolute() and ".."not in path.parts,"Unsafe tar path")
                        name=str(path)
                        require(name not in seen and len(seen)<10000,"Duplicate/oversized tar inventory")
                        seen.add(name)
                        require(member.isdir() or member.isfile(),"Tar links/devices are forbidden")
                        if member.isdir():continue
                        expanded+=member.size;require(expanded<=2*1024**3,"Expanded archive budget exceeded")
                        sensor=image_stamp(name,root)
                        if sensor:
                            kind,stamp=sensor;inventory[kind].append((stamp,name))
                            require(member.size<=1024**2,"Oversized PNG member")
                            updated=candidates(choices[kind],stamp,name,targets,kind)
                            wanted={p for rows in updated for _,p in rows}
                            if name in wanted:
                                require(state["persistedSelectedBytes"]+sum(map(len,kept.values()))+sum(map(len,metadata.values()))+member.size<=MAX_KEEP,"Selected/candidate byte cap exceeded")
                                data=archive.extractfile(member).read(member.size+1)
                                require(len(data)==member.size and data.startswith(PNG)
                                    and data.endswith(b"\x00\x00\x00\x00IEND\xaeB`\x82"),"Incomplete PNG")
                                kept[name]=data
                            choices[kind]=updated
                            needed={p for lists in choices.values()for rows in lists for _,p in rows}
                            kept={k:v for k,v in kept.items()if k in needed}
                            progress["currentCandidateFiles"]=len(kept)
                        elif len(path.parts)==2 and path.parts[0]==root and path.name in ("rgb.txt","depth.txt","groundtruth.txt"):
                            require(member.size<=1024**2,"Oversized source metadata")
                            require(state["persistedSelectedBytes"]+sum(map(len,kept.values()))+sum(map(len,metadata.values()))+member.size<=MAX_KEEP,"Selected/candidate byte cap exceeded")
                            metadata[path.name]=archive.extractfile(member).read(member.size+1)
                # tar end markers do not certify the compressed stream CRC/size.
                while compressed.read(256*1024):
                    require(monotonic()<=deadline,"Fetch wall budget exceeded")
            while counted.read(256*1024):pass
            require(counted.count==sequence["archiveBytes"],"Wrong full archive byte count")
        require(digest(metadata.get("groundtruth.txt",b""))==sequence["groundtruthSha256"],"Archive/external groundtruth differ")
        for kind in ("rgb","depth"):
            require(kind+".txt" in metadata,"Missing sensor timestamp index")
            indexed=[]
            for line in metadata[kind+".txt"].decode().splitlines():
                if line.strip() and not line.lstrip().startswith("#"):
                    stamp,name=line.split();indexed.append((timestamp(stamp),root+"/"+name))
            require(sorted(indexed)==sorted(inventory[kind]),"Tar/index timestamp inventory differs")
        selected=[]
        for i,target in enumerate(targets):
            rgb,status=nearest(inventory["rgb"],target,17500)
            if status!='valid':
                selected.append(dict(id=f"{sequence['id']}-{i:02d}",nominalTimestampUs=target,
                    rgb=dict(status='unavailable',reason=status,**({}if rgb is None else dict(timestampUs=rgb[0],sourceMember=rgb[1]))),
                    depth=None,association=dict(status='rgb-unavailable',deltaUs=None)))
                continue
            require(rgb[1]in kept,"Selected nominal RGB bytes missing from bounded source candidates")
            dep,status=nearest(inventory["depth"],rgb[0],20000)
            reverse,reverse_status=nearest(inventory["rgb"],dep[0]) if dep else (None,"missing")
            if status=="valid" and (reverse_status!="valid" or reverse!=rgb):status="not-mutual-nearest"
            if dep and dep[1]not in kept:
                # Never substitute a more convenient depth merely because it was buffered.
                status="nearest-depth-not-in-bounded-candidates"
            selected.append(dict(id=f"{sequence['id']}-{i:02d}",nominalTimestampUs=target,
                rgb=dict(status='available',timestampUs=rgb[0],sourceMember=rgb[1]),
                depth=None if dep is None else dict(timestampUs=dep[0],sourceMember=dep[1]),
                association=dict(status=status,deltaUs=None if dep is None else dep[0]-rgb[0])))
        required={f[k]["sourceMember"]for f in selected for k in ("rgb","depth")if f[k]is not None
            and f[k].get('status')!='unavailable' and f[k]["sourceMember"]in kept}
        kept={k:v for k,v in kept.items()if k in required}
        files=[]
        for name in sorted(required):
            rel=sequence["id"]+"/"+str(PurePosixPath(name).relative_to(root));data=kept.pop(name)
            write_new(output/rel,data);state["persistedSelectedBytes"]+=len(data)
            files.append(dict(path=rel,bytes=len(data),sha256=digest(data),sourceMember=name))
        for name in ("rgb.txt","depth.txt"):
            data=metadata[name];rel=sequence["id"]+"/"+name;write_new(output/rel,data)
            state["persistedSelectedBytes"]+=len(data)
            files.append(dict(path=rel,bytes=len(data),sha256=digest(data)))
        return dict(id=sequence["id"],frames=selected,archiveBytes=counted.count,archiveSha256=counted.hash.hexdigest(),
            archiveETag=sequence["archiveETag"],tarMembers=len(seen),expandedMemberBytes=expanded,
            sourceRgbCount=len(inventory["rgb"]),sourceDepthCount=len(inventory["depth"]),files=files)
    except Exception:
        # Valid bounded PNG candidates remain recoverable, not silently discarded.
        prefix=[]
        for name,data in sorted(kept.items()):
            rel="partial/"+sequence["id"]+"/"+str(PurePosixPath(name).relative_to(root))
            write_new(output/rel,data);prefix.append(dict(path=rel,bytes=len(data),sha256=digest(data)))
        progress["validCandidateFilesRetained"]=prefix
        raise


def fetch(plan_path,output):
    plan=validate_plan(plan_path.read_bytes());require(not output.exists() and not output.is_symlink(),"New output directory required")
    require(shutil.disk_usage(output.parent).free>=10*1024**3,"Disk floor10GiB")
    output.mkdir();started=monotonic();deadline=started+600
    state=dict(schemaVersion=1,study=plan["study"],complete=False,planSha256=PLAN_SHA256,
        sourceCodeSha256=digest(Path(__file__).read_bytes()),networkBytesReceived=322099,
        preflightMetadataBytesAlreadyReceived=322099,persistedSelectedBytes=0,networkRetries=0,
        learnedModelCalls=0,archivesPersisted=False,sequences=[],files=[])
    progress={}
    try:
        for seq in plan["sequences"]:
            with urlopen(Request(seq["groundtruthUrl"],headers={"Accept-Encoding":"identity"}),timeout=30)as response:
                require(response.status==200 and response.headers.get("ETag")==seq["groundtruthETag"],"Metadata pin changed")
                reader=CountedReader(response,state,deadline);data=b""
                while part:=reader.read(256*1024):
                    data+=part;require(len(data)<=1024**2,"Metadata budget exceeded")
            require(len(data)==seq["groundtruthBytes"] and digest(data)==seq["groundtruthSha256"],"Metadata hash changed")
            rel=seq["id"]+"/groundtruth.txt";write_new(output/rel,data)
            state["persistedSelectedBytes"]+=len(data)
            state["files"].append(dict(path=rel,bytes=len(data),sha256=digest(data)))
            targets=[s+offset for s in seq["windowStartsUs"]for offset in OFFSETS]
            result=stream_sequence(seq,targets,output,state,deadline,progress)
            state["sequences"].append(result);state["files"].extend(result["files"])
            print(json.dumps(dict(sequence=seq["id"],frames=len(result["frames"]),networkBytes=state["networkBytesReceived"])),flush=True)
        require(monotonic()<=deadline,"Fetch wall budget exceeded")
        state.update(complete=True,elapsedSeconds=monotonic()-started,plan=plan,planRawUtf8=plan_path.read_text())
        require(state["sourceCodeSha256"]==digest(Path(__file__).read_bytes()),"Fetcher changed during actual transfer")
        write_json(output/"slice.json",state)
        return state
    except Exception as error:
        state.update(elapsedSeconds=monotonic()-started,progress=progress,errorType=type(error).__name__,error=str(error)[:300])
        write_json(output/"fetch-incomplete.json",state)
        raise


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--plan',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();fetch(a.plan,a.output)
