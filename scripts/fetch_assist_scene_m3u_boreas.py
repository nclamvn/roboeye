#!/usr/bin/env python3
"""Fixed M3U continuations: metadata/HEAD seal first, bounded exact-source fetch.

No old script globals are patched; frozen metadata/serialization helpers are
reused. No outcome-based source selection, learned calls or network retries.
"""
import argparse
import bisect
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import csv
import io
import json
from pathlib import Path
import re
import shutil
from threading import Lock
from time import monotonic
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

import fetch_assist_scene_m3q_boreas as shared

WINDOWS=(("boreas-m3u-city",1598989152031027,1598989152056413,1598989155979205),
         ("boreas-m3u-turn",1598987814079070,1598987814129989,1598987818048959))
IMAGE_BUDGET=600*1024**2
METADATA_BUDGET=5*1024**2
RETAIN_BUDGET=420*1024**2
MAX_SECONDS=600


def require(value,reason):
    if not value:raise ValueError(reason)


def select(camera_bytes):
    rows=list(csv.reader(io.StringIO(camera_bytes.decode('ascii'))))[1:]
    times=[int(r[0])for r in rows if r]
    require(times==sorted(set(times)),"Invalid source camera timeline")
    clips=[]
    for name,start,first,last in WINDOWS:
        stamps=times[bisect.bisect_left(times,start):bisect.bisect_right(times,start+4000000)]
        require(len(stamps)==50 and stamps[0]==first and stamps[-1]==last
            and max(b-a for a,b in zip(stamps,stamps[1:]))<=100000,"Fixed metadata exposure coverage changed")
        clips.append(dict(id=name,cameraTimestampsUs=stamps))
    return clips


def label_listing(first,last):
    prefix=shared.old.SEQ+'labels_detection/'
    url=shared.old.BASE+'?'+urlencode({'list-type':2,'prefix':prefix,
        'start-after':f'{prefix}{first-100000}.txt','max-keys':60})
    with urlopen(Request(url,headers={'Accept-Encoding':'identity'}),timeout=30)as response:
        require(response.status==200,'Unexpected metadata listing response')
        body=response.read(256*1024+1)
    require(len(body)<=256*1024,'Source listing exceeds metadata cap')
    xml=ET.fromstring(body);stamps=[]
    for item in xml.findall('{*}Contents'):
        match=re.fullmatch(re.escape(prefix)+r'(\d{16})\.txt',item.findtext('{*}Key')or'')
        if match and first-60000<=int(match[1])<=last+60000:stamps.append(int(match[1]))
    require(18<=len(stamps)<=25 and stamps==sorted(set(stamps)),"Fixed source lacks18+ official synchronized label exposures")
    return stamps,dict(url=url,bytes=len(body),sha256=shared.digest(body))


def previous_inputs(root):
    fingerprints={};stamps=set()
    for path in sorted(root.glob('*/input.json')):
        payload=json.loads(path.read_text())
        relevant=[f for c in payload.get('clips',[])for f in c.get('frames',[])if f.get('token','').startswith('boreas-')]
        if relevant:
            fingerprints[str(path)]=shared.digest(path.read_bytes());stamps.update(f['timestampUs']for f in relevant)
    return fingerprints,stamps


def plan(source,output):
    require(not output.exists() and not output.is_symlink(),'New plan output required')
    values=shared.metadata(source);clips=select(values[shared.METADATA[0]])
    before,seen=previous_inputs(source.parent)
    stamps=[s for c in clips for s in c['cameraTimestampsUs']]
    require(len(set(stamps))==100 and not(set(stamps)&seen),'M3U overlaps prior source exposures')
    listings=[]
    for clip in clips:
        clip['labelTimestampsUs'],listing=label_listing(clip['cameraTimestampsUs'][0],clip['cameraTimestampsUs'][-1])
        listings.append(listing)
    with ThreadPoolExecutor(max_workers=6)as pool:heads=list(pool.map(shared.head_image,stamps))
    image_bytes=sum(row['bytes']for row in heads);metadata_bytes=sum(len(b)for b in values.values())
    require(image_bytes<=IMAGE_BUDGET and image_bytes+metadata_bytes+METADATA_BUDGET<=RETAIN_BUDGET,'HEAD retained-source budget exceeded')
    result=dict(schemaVersion=1,study='M3U',status='METADATA-HEAD-ONLY-BEFORE-RGB',
        source=shared.old.BASE+shared.old.SEQ,license=shared.old.LICENSE,
        selection='Fixed +6seconds after M3R anchors; source timestamps only, same recording not cross-domain',
        metadataSource=str(source.resolve()),metadata={k:dict(bytes=len(v),sha256=shared.digest(v))for k,v in values.items()},
        clips=clips,imageHeads=heads,headImageBytes=image_bytes,reusedMetadataBytes=metadata_bytes,
        officialLabelListings=listings,planMetadataNetworkBytes=sum(x['bytes']for x in listings),
        priorInputFingerprints=before,priorUniqueExposures=len(seen),priorExposureOverlap=0,
        imageBudgetBytes=IMAGE_BUDGET,metadataBudgetBytes=METADATA_BUDGET,retainedBudgetBytes=RETAIN_BUDGET,
        maxSeconds=MAX_SECONDS,networkRetries=0,rgbTransfers=0,modelCalls=0,
        sourceCodeSha256=shared.digest(Path(__file__).read_bytes()))
    shared.write_json(output,result)
    print(json.dumps(dict(plan=str(output),planSha256=shared.digest(output.read_bytes()),headImageBytes=image_bytes,
        officialLabels=sum(len(c['labelTimestampsUs'])for c in clips),priorOverlap=0)))
    return result


def validate_plan(raw,expected_sha256):
    require(re.fullmatch('[0-9a-f]{64}',expected_sha256 or'')is not None and shared.digest(raw)==expected_sha256,'Pinned pre-RGB plan changed')
    p=json.loads(raw)
    require(p['study']=='M3U' and p['status']=='METADATA-HEAD-ONLY-BEFORE-RGB' and p['rgbTransfers']==0
        and p['imageBudgetBytes']==IMAGE_BUDGET and p['metadataBudgetBytes']==METADATA_BUDGET
        and p['retainedBudgetBytes']==RETAIN_BUDGET and p['maxSeconds']==MAX_SECONDS,'Wrong source scope/budgets')
    require(p['sourceCodeSha256']==shared.digest(Path(__file__).read_bytes()),'Pre-RGB fetch implementation changed')
    values=shared.metadata(Path(p['metadataSource']))
    require(p['metadata']=={k:dict(bytes=len(v),sha256=shared.digest(v))for k,v in values.items()},'Pinned cached metadata changed')
    expected=select(values[shared.METADATA[0]])
    require([(c['id'],c['cameraTimestampsUs'])for c in p['clips']]==[(c['id'],c['cameraTimestampsUs'])for c in expected],'Wrong fixed source windows')
    stamps=[s for c in p['clips']for s in c['cameraTimestampsUs']]
    require([r['path']for r in p['imageHeads']]==[f'camera/{s}.png'for s in stamps]
        and sum(r['bytes']for r in p['imageHeads'])==p['headImageBytes'],'HEAD population/sum changed')
    require(p['headImageBytes']<=IMAGE_BUDGET and p['headImageBytes']+sum(map(len,values.values()))+METADATA_BUDGET<=RETAIN_BUDGET,'Source retained budget changed')
    for name,digest in p['priorInputFingerprints'].items():require(shared.digest(Path(name).read_bytes())==digest,'Prior exposure inventory changed')
    return p,values


def fetch(plan_path,expected_sha256,output):
    require(not output.exists() and not output.is_symlink(),'New slice directory required')
    require(shutil.disk_usage(output.parent).free>=10*1024**3,'Disk floor10GiB')
    p,values=validate_plan(plan_path.read_bytes(),expected_sha256);output.mkdir()
    files=[]
    for name,data in values.items():
        shared.write_new(output/name,data);files.append(dict(path=name,bytes=len(data),sha256=shared.digest(data),reusedMetadata=True))
    shared.write_json(output/'clips.json',dict(schemaVersion=1,clips=p['clips']))
    shared.write_json(output/'preregistration.json',p)
    jobs=p['imageHeads']+[dict(path=f'labels_detection/{s}.txt',bytes=None,etag=None)
        for s in sorted({s for c in p['clips']for s in c['labelTimestampsUs']})]
    state=dict(study='M3U',complete=False,planSha256=expected_sha256,source=p['source'],license=p['license'],
        imageBytesReceived=0,metadataLabelBytesReceived=p['planMetadataNetworkBytes'],
        reusedMetadataBytes=sum(map(len,values.values())),requests=0,failedTransfers=0,networkRetries=0,
        modelCalls=0,errors=[],sourceCodeSha256=shared.digest(Path(__file__).read_bytes()))
    started=monotonic();deadline=started+MAX_SECONDS;lock=Lock()
    def transfer(row):
        key=row['path'];image=key.endswith('.png');limit=shared.old.MAX_IMAGE if image else 128*1024;body=bytearray()
        with lock:state['requests']+=1
        try:
            require(monotonic()<deadline,'Fetch wall budget exceeded before request')
            with urlopen(Request(shared.old.BASE+shared.old.SEQ+key,headers={'Accept-Encoding':'identity'}),timeout=min(45.,max(.1,deadline-monotonic())))as response:
                require(response.status==200 and (row['etag']is None or response.headers.get('ETag')==row['etag']),'Source HEAD/GET differs')
                while True:
                    require(monotonic()<=deadline,'Fetch wall budget exceeded')
                    chunk=response.read(min(256*1024,limit+1-len(body)))
                    if not chunk:break
                    body.extend(chunk)
                    with lock:
                        counter='imageBytesReceived'if image else'metadataLabelBytesReceived';state[counter]+=len(chunk)
                        require(state['imageBytesReceived']<=p['headImageBytes'] and state['metadataLabelBytesReceived']<=METADATA_BUDGET,'Source network budget exceeded')
                        require(state['imageBytesReceived']+state['reusedMetadataBytes']+state['metadataLabelBytesReceived']<=RETAIN_BUDGET,'Source retained budget exceeded')
                    require(len(body)<=limit,'Oversized source object')
            require(body and(row['bytes']is None or len(body)==row['bytes']),'Source byte count differs')
            if image:require(body.startswith(b'\x89PNG\r\n\x1a\n')and body.endswith(b'\x00\x00\x00\x00IEND\xaeB`\x82'),'Incomplete PNG source')
            shared.write_new(output/key,body)
            return dict(path=key,bytes=len(body),sha256=shared.digest(body))
        except Exception as error:
            with lock:
                state['failedTransfers']+=1;state['errors'].append(dict(path=key,receivedBytes=len(body),reason=str(error)[:180]))
            raise
    failure=None;iterator=iter(jobs)
    with ThreadPoolExecutor(max_workers=4)as pool:
        pending={pool.submit(transfer,next(iterator))for _ in range(4)}
        while pending:
            done,pending=wait(pending,return_when=FIRST_COMPLETED)
            for result in done:
                try:files.append(result.result())
                except Exception as error:failure=error
            if failure is None:
                for _ in done:
                    row=next(iterator,None)
                    if row is not None:pending.add(pool.submit(transfer,row))
            if len(files)%20==0:print(json.dumps(dict(completedFiles=len(files),imageBytes=state['imageBytesReceived'])),flush=True)
    state.update(complete=failure is None and len(files)==len(jobs)+len(values),files=sorted(files,key=lambda x:x['path']),elapsedSeconds=monotonic()-started)
    require(state['sourceCodeSha256']==shared.digest(Path(__file__).read_bytes()),'Fetcher changed during actual source run')
    shared.write_json(output/('slice.json'if state['complete']else'fetch-incomplete.json'),state)
    if not state['complete']:raise RuntimeError('Incomplete source; valid prefix retained, no implicit retry')from failure
    print(json.dumps({k:v for k,v in state.items()if k!='files'}),flush=True)
    return state


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='job',required=True)
    a=sub.add_parser('plan');a.add_argument('--metadata-source',type=Path,required=True);a.add_argument('--output',type=Path,required=True)
    a=sub.add_parser('fetch');a.add_argument('--plan',type=Path,required=True);a.add_argument('--plan-sha256',required=True);a.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.job=='plan':plan(args.metadata_source,args.output)
    else:fetch(args.plan,args.plan_sha256,args.output)
