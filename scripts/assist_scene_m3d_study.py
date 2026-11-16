#!/usr/bin/env python3
"""Mac study: shared RGB inference; motion and relative approach scored separately."""

import argparse
from collections import Counter, deque
from datetime import date
from importlib.util import module_from_spec, spec_from_file_location
import json
import math
from pathlib import Path
import platform
import tempfile

import cv2

from assist_scene_motion import sha256
from assist_scene_motion_m3c import load_input, run_clip


def iou(a,b):
    w=max(0,min(a[2],b[2])-max(a[0],b[0])); h=max(0,min(a[3],b[3])-max(a[1],b[1]))
    return w*h/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-w*h)


class BoxBaseline:
    """Small detector-only comparator, not an eligible output for the app."""

    def __init__(self):
        self.active=[]
        self.prev=None
        self.epoch=0
        self.next_id=0

    def update(self, frame, at, gray, boxes):
        if self.prev is not None and not 0<at-self.prev<=230:
            self.active=[]
            self.epoch+=1
        self.prev=at
        h,w=gray.shape
        links=[(i,j) for i,(b,_,_) in enumerate(self.active) for j,c in enumerate(boxes)
               if c.label==b.label and iou(b.xyxy,c.xyxy)>=.45]
        old,new=Counter(i for i,_ in links),Counter(j for _,j in links)
        match={j:i for i,j in links if old[i]==new[j]==1}
        active=[]; events=[]; tracks=[]
        for j,b in enumerate(boxes):
            x,y,r,s=b.xyxy
            if min(x,y,w-r,h-s)<4:
                continue
            if j in match:
                _,id_,history=self.active[match[j]]
            else:
                id_,history=self.next_id,deque(maxlen=10)
                self.next_id+=1
            history.append((at,r-x,s-y))
            active.append((b,id_,history))
            tracks.append({'id':id_,**b.record(w,h)})
            refs=[k for k in history if 280<=at-k[0]<=650]
            if refs:
                _,a,c=refs[0]
                if min((r-x)/a,(s-y)/c)>=1.065:
                    events.append(dict(trackId=id_,label=b.label,epoch=self.epoch,timeMs=at,kind='relative-optical-approach'))
        self.active=active
        return dict(tracks=tracks,events=events,status='valid',diagnostics={},epoch=self.epoch)


def replay(args):
    from assist_scene_pose_accumulation import PoseAccumulation, POLICY as C_POLICY
    from assist_scene_scale_approach import ScaleApproach, POLICY as D_POLICY
    inp,root=load_input(args.input)
    cv2.setNumThreads(1)
    clips=[]
    def branches():
        return dict(C=PoseAccumulation(),D=ScaleApproach(),S=BoxBaseline())
    if args.output.exists() or args.output.is_symlink():
        raise ValueError('Output must be new')
    with tempfile.TemporaryDirectory(prefix=f'codex-tmp-assist-m3d-{date.today():%Y%m%d}-',dir=args.output.parent) as wd:
        for j,c in enumerate(inp['clips']):
            cv2.setRNGSeed(65231)
            sub=Path(wd).resolve()/str(j)
            sub.mkdir()
            clips.append(run_clip(c,root,sub,args.sceneqa.resolve(),args.yolo.resolve(),branches))
    return dict(schemaVersion=1,inputSha256=sha256(args.input),dataset=inp['dataset'],clips=clips,
                platform=platform.platform(),opencv=cv2.__version__,policies={'C':dict(C_POLICY),'D':dict(D_POLICY)},
                sceneqaSha256=sha256(args.sceneqa),branchesSha256={n:sha256(Path(__file__).with_name(n)) for n in
                ('assist_scene_pose_accumulation.py','assist_scene_scale_approach.py','assist_scene_motion_m3c.py',Path(__file__).name)})


def score(receipt,gt):
    if receipt.get('schemaVersion')!=1 or gt.get('schemaVersion')!=1:
        raise ValueError('Unsupported study schema')
    if receipt['inputSha256']!=gt['inputSha256']:
        raise ValueError('Truth/input mismatch')
    if [c['id'] for c in receipt['clips']]!=[c['id'] for c in gt['clips']]:
        raise ValueError('Clip identity/order mismatch')
    spec=spec_from_file_location('m3c_scorer',Path(__file__).with_name('score-assist-scene-motion-m3c.py'))
    old=module_from_spec(spec); spec.loader.exec_module(old)
    totals={n:Counter(old.empty()) for n in 'ABCDS'}
    rows=[]
    for c,g in zip(receipt['clips'],gt['clips'],strict=True):
        labels={f['token']:f for f in g['frames']}
        if len(labels)!=len(g['frames']) or len({x['token'] for x in c['frames']})!=len(c['frames']):
            raise ValueError('Duplicate frame')
        if not labels.keys()<={x['token'] for x in c['frames']}:
            raise ValueError('Missing reviewed frame')
        bins={n:old.empty() for n in 'ABCDS'}
        statuses={n:Counter() for n in 'ABCDS'}
        detector_ceiling=Counter()
        for f in c['frames']:
            match=labels.get(f['token'])
            if match and match['timestampUs']!=f['timestampUs']:
                raise ValueError('Reviewed time mismatch')
            if match:
                for target in match['targets']:
                    overlap=any(old.family(d['label'])==target['classFamily'] and old.iou(d['box'],target['box'])>=old.IOU
                                for d in f.get('detections',()))
                    for kind in ('motion','approach'):
                        key=f'{kind}.{target[kind]}'
                        detector_ceiling[key]+=1
                        detector_ceiling[key+'.with_overlap']+=overlap
            for name in bins:
                statuses[name][f[name]['status']]+=1
                if name in 'DS' and any(e.get('kind')!='relative-optical-approach' for e in f[name]['events']):
                    raise ValueError('Approach branch emitted an unrelated claim')
                targets=match['targets'] if match else None
                if targets is not None and name in 'DS':
                    targets=[{**t,'motion':{'approaching':'moving','not-approaching':'stationary',
                                            'unknown':'unknown'}[t['approach']]} for t in targets]
                old.score_frame(f,name,targets,bins[name])
        for name,b in bins.items():
            totals[name].update(b)
        rows.append(dict(id=c['id'],lanes=bins,statuses=statuses,boxOverlapDiagnostic=detector_ceiling))
    if any(totals[n]['tp']+totals[n]['fn']==0 or totals[n]['fp']+totals[n]['tn']==0 for n in totals):
        raise ValueError('Both known positive and negative examples required for each scored claim')
    tm={}
    for k in ('detector','A','B','C','D','S'):
        v=sorted(f['timingsMs'][k] for c in receipt['clips'] for f in c['frames'])
        tm[k]=dict(p50=round(v[math.ceil(len(v)*.5)-1],2),p95=round(v[math.ceil(len(v)*.95)-1],2))
    return dict(schemaVersion=1,inputSha256=receipt['inputSha256'],reviewSha256=gt['reviewSha256'],
                review=gt.get('review',{}),
                unit='reviewed target-keyframe',truthKind={'ABC':'object motion relative to world','DS':'relative approach'},
                totals=totals,clips=rows,stageMs=tm)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='job',required=True)
    c=sub.add_parser('replay')
    for n in ('input','sceneqa','yolo','output'):
        c.add_argument('--'+n,type=Path,required=True)
    c=sub.add_parser('score')
    for n in ('input','truth','receipt','output'):
        c.add_argument('--'+n,type=Path,required=True)
    a=p.parse_args()
    if a.job=='replay':
        value=replay(a)
    else:
        rec=json.loads(a.receipt.read_text())
        if sha256(a.input)!=rec['inputSha256']:
            raise ValueError('Receipt/input mismatch')
        value=score(rec,json.loads(a.truth.read_text()))
        value.update(receiptSha256=sha256(a.receipt),truthSha256=sha256(a.truth))
    with a.output.open('x',encoding='utf-8') as f:
        json.dump(value,f,indent=2 if a.job=='score' else None,allow_nan=False)
        f.write('\n')
    if a.job=='score':
        print(json.dumps(value['totals'],indent=2))
