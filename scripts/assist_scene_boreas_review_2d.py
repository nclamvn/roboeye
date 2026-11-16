#!/usr/bin/env python3
"""Prepare blind-to-model 2D review tiles and bind explicitly reviewed regions."""

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from assist_scene_boreas_import import sensor_poses, labels_world, matches


def trend(history, now):
    """Offline reference for increasing proximity, never an inference input."""
    end=history[-1]
    mid=next((r for r in reversed(history) if now-r[0]>=300_000),None)
    if not mid:
        return 'unknown'
    start=next((r for r in reversed(history) if mid[0]-r[0]>=300_000),None)
    if not start or now-start[0]>950_000:
        return 'unknown'
    # Metric coordinates belong to the reference only. Do not serialize them.
    r0,r1,r2=[r[1] for r in (start,mid,end)]
    if r0-r1>=max(.22,r0*.018) and r1-r2>=max(.22,r1*.018):
        return 'approaching'
    if (r2-r0>=max(.35,r0*.025) and r1>=r0-.12 and r2>=r1-.12
            or max(abs(r0-r1),abs(r1-r2),abs(r0-r2))<=max(.18,.012*r0)):
        return 'not-approaching'
    return 'unknown'


def build(source,inputs,truth,out,clip_manifest=None):
    source=source.resolve(strict=True)
    raw=json.loads((clip_manifest or source/'clips.json').read_text())['clips']
    inp=json.loads(inputs.read_text())
    ref=json.loads(truth.read_text())
    ih=hashlib.sha256(inputs.read_bytes()).hexdigest()
    if (ref['inputSha256']!=ih or [c['id'] for c in raw]!=[c['id'] for c in inp['clips']]
            or [c['id'] for c in raw]!=[c['id'] for c in ref['clips']]):
        raise ValueError('Source/input mismatch')
    out.mkdir(exist_ok=False)
    review=[]
    for clip, pictures, labels in zip(raw,inp['clips'],ref['clips'],strict=True):
        lts=clip['labelTimestampsUs']
        cts=clip['cameraTimestampsUs']
        pairs={t:c for c,t in matches(cts,lts).items()}
        frames={g['timestampUs']:g for g in labels['frames']}
        image_steps={f['timestampUs']:f for f in pictures['frames']}
        if set(frames)!=set(pairs.values()) or list(image_steps)!=cts:
            raise ValueError('Review input does not match unique paired timestamps')
        lp=sensor_poses(source,Path('.'),'lidar',set(lts))
        history=defaultdict(list)
        ts_rows=[]
        for j,stamp in enumerate(lts):
            t=pairs.get(stamp)
            if t is None:
                history.clear()
                continue
            g,f=frames[t],image_steps[t]
            if f['token']!=g['token']:
                raise ValueError('Wrong paired review frame')
            c=np.asarray(f['cameraToWorld'])[:3,3]
            objects,_=labels_world(source,Path('.'),stamp,lp[stamp])
            for id_,(_,family,n,pos,_) in objects.items():
                if not family or n<5:
                    continue
                items=history[id_]
                if items and stamp-items[-1][0]>280_000:
                    items.clear()
                items.append((stamp,float(np.linalg.norm(pos-c))))
            ts_rows.append((j,f,[{**gt,'approach':trend(history[gt['instance']],stamp)}
                                 for gt in g['targets']]))
        picks=[]
        # Fixed five checkpoints; choose a small number of visible-size candidates
        # per metric/class stratum, independent of model predictions.
        for j,f,targets in ts_rows:
            if j not in {5,8,11,14,17}:
                continue
            keys=set()
            candidates=[]
            for gt in sorted(targets,key=lambda g:-(g['box']['width']*g['box']['height'])):
                b=gt['box']
                key=(gt['motion'],gt['approach'],gt['classFamily'])
                if (key in keys or min(b['width'],b['height'])<.019 or
                        gt['motion']==gt['approach']=='unknown'):
                    continue
                keys.add(key)
                candidates.append(gt)
            picks.append((j,f,candidates[:9]))
        for j,f,candidates in picks:
            im=Image.open(source/f['path']).convert('RGB')
            im.thumbnail((960,810))
            draw=ImageDraw.Draw(im)
            for n,gt in enumerate(candidates,1):
                b=gt['box']; w,h=im.size
                x0,y0,x1,y1=[round(v) for v in (b['x']*w,b['y']*h,(b['x']+b['width'])*w,(b['y']+b['height'])*h)]
                draw.rectangle((x0,y0,x1,y1),outline='#ffff47',width=2)
                draw.text((x0,max(2,y0-13)),str(n),fill='white',stroke_fill='black',stroke_width=2)
            draw.text((12,10),f'{clip["id"]} checkpoint {j}   {im.width}x{im.height}',fill='white',stroke_fill='black',stroke_width=2)
            key=f'{clip["id"]}-{j:02d}'
            tile=out/f'{key}.jpg'
            im.save(tile,quality=89)
            review.append(dict(key=key,clip=clip['id'],token=f['token'],timestampUs=f['timestampUs'],
                               size=list(im.size), tileSha256=hashlib.sha256(tile.read_bytes()).hexdigest(),
                               candidates=candidates))
    (out/'candidates.json').write_text(json.dumps(dict(schemaVersion=1,inputSha256=ih,rows=review),indent=2)+'\n')


def bind(candidates,checked,output):
    gold=json.loads(candidates.read_text()); review=json.loads(checked.read_text())
    if (review['inputSha256']!=gold['inputSha256'] or review['candidatesSha256']!=hashlib.sha256(candidates.read_bytes()).hexdigest()):
        raise ValueError('Review does not bind this candidate revision')
    clipmap={}
    if set(review['frames'])!={r['key'] for r in gold['rows']}:
        raise ValueError('Every review frame needs an explicit decision')
    for r in gold['rows']:
        if r.get('tileSha256') and hashlib.sha256((candidates.parent/f"{r['key']}.jpg").read_bytes()).hexdigest()!=r['tileSha256']:
            raise ValueError('Review image changed')
        adjusted=review['frames'][r['key']]
        targets=[]
        w,h=r['size']
        if set(adjusted)!={str(i) for i in range(1,len(r['candidates'])+1)}:
            raise ValueError('Every candidate needs a box or explicit omission')
        for n, box in adjusted.items():
            if box is None:
                continue
            x,y,x2,y2=box
            if not (0 <= x < x2 <= w and 0 <= y < y2 <= h and min(x2-x,y2-y)>=10):
                raise ValueError('Bad 2D review correction')
            targets.append({**r['candidates'][int(n)-1], 'box':dict(x=x/w,y=y/h,width=(x2-x)/w,height=(y2-y)/h)})
        clipmap.setdefault(r['clip'],[]).append({k:r[k] for k in ('token','timestampUs')}|{'targets':targets})
    with output.open('x') as f:
        json.dump(dict(schemaVersion=1,inputSha256=gold['inputSha256'],review=review['review'],
                   reviewSha256=hashlib.sha256(checked.read_bytes()).hexdigest(),
                   clips=[dict(id=k,frames=v) for k,v in clipmap.items()]),f,indent=2)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='job',required=True)
    c=sub.add_parser('build')
    for k in ('source','inputs','truth','out'):
        c.add_argument(k,type=Path)
    c.add_argument('--clip-manifest',type=Path)
    c=sub.add_parser('bind')
    for k in ('candidates','checked','output'):
        c.add_argument(k,type=Path)
    a=p.parse_args()
    if a.job=='build':
        build(a.source,a.inputs,a.truth,a.out,a.clip_manifest)
    else:
        bind(a.candidates,a.checked,a.output)
