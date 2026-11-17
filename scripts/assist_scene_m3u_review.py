#!/usr/bin/env python3
"""Pre-inference secondary visible-extent review of exact radial-label triples.

Optical extent is not material-point truth or physical approach. This reference
tool neither changes radial labels/scores nor authorizes a runtime warning.
"""
import argparse
from collections import defaultdict,Counter
from hashlib import sha256
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image,ImageDraw

import assist_scene_boreas_review_2d as frozen
import assist_scene_m3q_review as accounting
from assist_scene_boreas_import import project

MAX_POSITIVES=24
MAX_REVIEW_BYTES=24*1024**2
ROLES=('start','mid','current')
POLICY=dict(unit='selected radial-positive target checkpoint',maxPositives=24,
    sourceRule='exact frozen trend start/mid/end; each leg>=300ms, total<=950ms',
    deltaNativePixels='max(3,.03*minimum tight-box side)',
    opticalRule='both leg lower>0 concordant; ANY leg upper<0 contrary to sustained two-leg expansion; else unknown',
    heuristicNotConfidenceInterval=True,changesRadialTruth=False,materialPointTruth=False,modelCalls=0)


def require(value,reason):
    if not value:raise ValueError(reason)


def sha(path):return sha256(path.read_bytes()).hexdigest()


def code_hashes():
    root=Path(__file__).parent
    return {name:sha(root/name)for name in (Path(__file__).name,'assist_scene_boreas_review_2d.py',
        'assist_scene_boreas_import.py','assist_scene_m3q_review.py')}


def rotation_homography(old,new):
    k0,k1=(np.asarray(f['intrinsics'],float)for f in (old,new))
    r0,r1=(np.asarray(f['cameraToWorld'],float)[:3,:3]for f in (old,new))
    return k1@r1.T@r0@np.linalg.inv(k0)


def write_new(path,value):
    with path.open('x')as stream:json.dump(value,stream,indent=2,allow_nan=False);stream.write('\n')


def exact_triple(history,now):
    if not history or history[-1]['labelTimestampUs']!=now:return None
    end=history[-1]
    mid=next((r for r in reversed(history)if now-r['labelTimestampUs']>=300000),None)
    if mid is None:return None
    start=next((r for r in reversed(history)if mid['labelTimestampUs']-r['labelTimestampUs']>=300000),None)
    return None if start is None or now-start['labelTimestampUs']>950000 else [start,mid,end]


def _corners(box,delta):
    x,y,w,h=(box[k]for k in ('x','y','width','height'))
    return np.asarray([[x-delta,y-delta],[x+w+delta,y-delta],
        [x+w+delta,y+h+delta],[x-delta,y+h+delta]],float)


def _area(points):
    return abs(float(np.sum(points[:,0]*np.roll(points[:,1],-1)-points[:,1]*np.roll(points[:,0],-1))))/2


def area_interval(box,homography,shape):
    h,w=shape;v=[box[k]for k in ('x','y','width','height')]
    require(all(type(x)in(int,float)and math.isfinite(x)for x in v)and min(v[2:])>0
        and v[0]>=0 and v[1]>=0 and v[0]+v[2]<=w and v[1]+v[3]<=h,'Invalid native visible box')
    delta=max(3.,.03*min(v[2:]));outer=_corners(box,delta);inner=_corners(box,-delta)
    if min(v[2:])<=2*delta:return dict(status='uncertainty-consumes-visible-box',deltaNativePixels=delta)
    if np.any(outer<0)or np.any(outer[:,0]>w)or np.any(outer[:,1]>h):return dict(status='uncertainty-crosses-image-edge',deltaNativePixels=delta)
    transform=np.asarray(homography,float)
    require(transform.shape==(3,3)and np.isfinite(transform).all()and abs(np.linalg.det(transform))>1e-12,'Invalid rotation homography')
    areas=[]
    for points in (inner,outer):
        p=np.column_stack((points,np.ones(4)))@transform.T
        if np.any(p[:,2]<=1e-6):return dict(status='rotation-crosses-projective-horizon',deltaNativePixels=delta)
        projected=p[:,:2]/p[:,2:]
        areas.append(_area(projected))
    require(0<areas[0]<=areas[1]+1e-8,'Non-conservative projected area nesting')
    return dict(status='bounded-visible-extent-heuristic',lowerAreaPx2=areas[0],upperAreaPx2=areas[1],deltaNativePixels=delta)


def classify_intervals(legs):
    if len(legs)!=2 or any(x.get('status')!='bounded-visible-extent-heuristic'for x in legs):return 'unknown'
    if all(x['lowerLogLinearExtentRatio']>0 for x in legs):return 'concordant'
    if any(x['upperLogLinearExtentRatio']<0 for x in legs):return 'contrary-to-sustained-two-leg-expansion'
    return 'unknown'


def extent_result(triple,decisions):
    result=dict(status='unknown',materialPointTruth=False,changesRadialTruth=False,modelCalls=0)
    if triple is None:return {**result,'reason':'exact-radial-source-exposure-unavailable'}
    if decisions.get('sameIdentity')is not True or decisions.get('stableAspect')is not True:
        return {**result,'reason':'identity-or-aspect-not-established'}
    roles=decisions['roles']
    require(set(roles)==set(ROLES),'All three roles need explicit decisions')
    if any(roles[role]['visibility']!='usable-visible-extent'for role in ROLES):return {**result,'reason':'occluded-clipped-or-unknown-visible-extent'}
    legs=[]
    for index in (0,1):
        old,new=triple[index:index+2]
        homography=rotation_homography(old,new)
        a=area_interval(roles[ROLES[index]]['box'],homography,(old['nativeHeight'],old['nativeWidth']))
        b=area_interval(roles[ROLES[index+1]]['box'],np.eye(3),(new['nativeHeight'],new['nativeWidth']))
        if a['status']!='bounded-visible-extent-heuristic'or b['status']!='bounded-visible-extent-heuristic':
            legs.append(dict(status='unknown',sourceArea=a,currentArea=b));continue
        legs.append(dict(status='bounded-visible-extent-heuristic',sourceArea=a,currentArea=b,
            lowerLogLinearExtentRatio=.5*math.log(b['lowerAreaPx2']/a['upperAreaPx2']),
            upperLogLinearExtentRatio=.5*math.log(b['upperAreaPx2']/a['lowerAreaPx2']),rotationHomography=homography.tolist()))
    return {**result,'status':classify_intervals(legs),'legs':legs,
        'scope':'Visible box extent after pose rotation compensation only; contrary does not mean object moving away'}


def build(source,inputs,candidates,out):
    source=source.resolve(strict=True);inp=json.loads(inputs.read_text());picked=json.loads(candidates.read_text())
    frozen_code=code_hashes();slice_path=source/'slice.json';slice_record=json.loads(slice_path.read_text())
    require(slice_record.get('complete')is True and slice_record.get('study')=='M3U','Incomplete/unbound M3U slice')
    reference_files={}
    for row in slice_record['files']:
        path=(source/row['path']).resolve(strict=True)
        require(path.is_relative_to(source)and not(source/row['path']).is_symlink()and path.is_file()
            and path.stat().st_size==row['bytes']and sha(path)==row['sha256'],'Official source bytes changed')
        if not row['path'].startswith('camera/'):reference_files[row['path']]=row['sha256']
    raw=json.loads((source/'clips.json').read_text())['clips']
    require(picked['inputSha256']==sha(inputs),'Candidate/input hash mismatch')
    a=candidates.parent/'selection-accounting.json';acct=json.loads(a.read_text())
    require(acct['candidatesSha256']==sha(candidates)and acct['inputSha256']==sha(inputs),'Unbound primary review selection')
    targets={(r['token'],g['instance']):(r,index,g)for r in picked['rows']for index,g in enumerate(r['candidates'],1)if g['approach']=='approaching'}
    require(len(targets)==sum(g['approach']=='approaching'for r in picked['rows']for g in r['candidates']),'Duplicate selected positive target')
    resolved={};image_meta={}
    for clip,pictures in zip(raw,inp['clips'],strict=True):
        require(clip['id']==pictures['id'],'Clip order mismatch')
        frames={f['timestampUs']:f for f in pictures['frames']}
        links={t:c for c,t in frozen.matches(clip['cameraTimestampsUs'],clip['labelTimestampsUs']).items()}
        lp=frozen.sensor_poses(source,Path('.'),'lidar',set(clip['labelTimestampsUs']));history=defaultdict(list)
        for stamp in clip['labelTimestampsUs']:
            rgb=links.get(stamp)
            if rgb is None:history.clear();continue
            frame=frames[rgb];path=source/frame['path']
            require(sha(path)==frame['sha256'],'Original source pixels changed')
            if frame['token']not in image_meta:
                with Image.open(path)as image:image_meta[frame['token']]=image.size
            w,h=image_meta[frame['token']];camera=np.asarray(frame['cameraToWorld']);center=camera[:3,3]
            objects,_=frozen.labels_world(source,Path('.'),stamp,lp[stamp])
            for identifier,(_,family,points,position,vertices)in objects.items():
                if family is None or points<5:continue
                items=history[identifier]
                if items and stamp-items[-1]['labelTimestampUs']>280000:items.clear()
                projected=project(vertices,camera,np.asarray(frame['intrinsics']),w,h)
                items.append(dict(labelTimestampUs=stamp,token=frame['token'],timestampUs=rgb,path=frame['path'],sha256=frame['sha256'],
                    nativeWidth=w,nativeHeight=h,intrinsics=frame['intrinsics'],cameraToWorld=frame['cameraToWorld'],
                    worldCenter=position.tolist(),radialCenterReferenceM=float(np.linalg.norm(position-center)),
                    projectedBox=projected,sourceInstance=identifier))
                key=(frame['token'],identifier)
                if key in targets:
                    row,index,gt=targets[key]
                    require(frozen.trend([(x['labelTimestampUs'],x['radialCenterReferenceM'])for x in items],stamp)=='approaching','Frozen radial history disagrees with primary candidate')
                    resolved[key]=dict(key=f"{row['key']}:{index}",reviewKey=row['key'],candidateIndex=index,instance=identifier,
                        currentToken=frame['token'],primaryReference='approaching',triple=exact_triple(items,stamp))
    require(set(resolved)==set(targets),'Missing selected positive radial source history')
    out.mkdir(exist_ok=False);units=[];account=[];rendered_bytes=0
    ordered=sorted(resolved.values(),key=lambda r:(r['currentToken'],r['instance']))
    for index,unit in enumerate(ordered):
        if index>=MAX_POSITIVES:
            account.append(dict(key=unit['key'],reason='fixed24-positive-cap-secondary-unreviewed'));continue
        panels=[]
        for role,frame in (zip(ROLES,unit['triple'],strict=True)if unit['triple']is not None else []):
            with Image.open(source/frame['path'])as raw_image:
                image=raw_image.convert('RGB');b=frame['projectedBox'];w,h=image.size
                if b is None:crop=(0,0,w,h)
                else:
                    x,y,bw,bh=b['x']*w,b['y']*h,b['width']*w,b['height']*h
                    pad=max(24.,.25*max(bw,bh));crop=(max(0,math.floor(x-pad)),max(0,math.floor(y-pad)),min(w,math.ceil(x+bw+pad)),min(h,math.ceil(y+bh+pad)))
                image=image.crop(crop);draw=ImageDraw.Draw(image)
                draw.text((8,8),role+' '+str(frame['timestampUs']),fill='white',stroke_fill='black',stroke_width=2)
                name=f'{index:02d}-{role}.jpg';path=out/name;image.save(path,quality=92)
                rendered_bytes+=path.stat().st_size;require(rendered_bytes<=MAX_REVIEW_BYTES,'Secondary panel byte budget exceeded')
                panels.append(dict(role=role,path=name,sha256=sha(path),nativeCrop=list(crop),size=list(image.size),scale=1.))
        unit_h=[]if unit['triple']is None else[rotation_homography(unit['triple'][i],unit['triple'][i+1]).tolist()for i in (0,1)]
        units.append({**unit,'panels':panels,'rotationHomographies':unit_h,'secondaryStatus':'unreviewed'if unit['triple']is not None else'unknown-missing-exact-source'})
        account.append(dict(key=unit['key'],reason='selected-for-secondary-blind-review'))
    result=dict(schemaVersion=1,study='M3U-secondary-visible-extent',policy=POLICY,inputSha256=sha(inputs),
        candidatesSha256=sha(candidates),primarySelectionAccountingSha256=sha(a),sourceRoot=str(source),
        sourceCodeSha256=frozen_code,sliceManifestSha256=sha(slice_path),referenceFiles=reference_files,
        clipManifestSha256=sha(source/'clips.json'),units=units,accounting=account,selectedPositiveCandidates=len(ordered),
        secondaryReviewUnits=len(units),secondaryUnreviewedByCap=max(0,len(ordered)-MAX_POSITIVES),renderedBytes=rendered_bytes,
        modelOutputsSeen=False,modelCalls=0,
        limits='Pre-inference reference annotation only; no radial relabeling or material-point claim. Native crops retain source pixel scale; world coordinates are offline reference only.')
    require(frozen_code==code_hashes(),'Reference helper changed during proposal build')
    write_new(out/'proposals.json',result)
    print(json.dumps(dict(selectedPositiveCandidates=len(ordered),secondaryReviewUnits=len(units),panels=sum(len(x['panels'])for x in units),renderedBytes=rendered_bytes)))
    return result


def bind(proposals,decisions,output):
    p=json.loads(proposals.read_text());checked=json.loads(decisions.read_text())
    require(p['sourceCodeSha256']==code_hashes()and p['policy']==POLICY,'Secondary reference implementation/policy changed')
    require(checked['proposalsSha256']==sha(proposals)and checked['inputSha256']==p['inputSha256'],'Unbound secondary annotation')
    require(set(checked['units'])=={u['key']for u in p['units']},'Every fixed secondary unit requires explicit annotation')
    rows=[]
    for unit in p['units']:
        for panel in unit['panels']:require(sha(proposals.parent/panel['path'])==panel['sha256'],'Secondary source panel changed')
        d=checked['units'][unit['key']]
        require(type(d['sameIdentity'])is bool and type(d['stableAspect'])is bool,'Explicit identity/aspect decision required')
        require(set(d['roles'])==set(ROLES),'Explicit three-role decisions required')
        for role in ROLES:
            v=d['roles'][role];require(v['visibility']in('usable-visible-extent','occluded','clipped','unknown'),'Invalid visible-extent review status')
            if v['visibility']!='usable-visible-extent':require(isinstance(v.get('reason'),str)and bool(v['reason'].strip()),'Unknown extent requires reason')
        rows.append(dict(key=unit['key'],instance=unit['instance'],decisions=d,result=extent_result(unit['triple'],d)))
    result=dict(schemaVersion=1,study='M3U-secondary-visible-extent',policy=POLICY,proposalsSha256=sha(proposals),
        decisionsSha256=sha(decisions),inputSha256=p['inputSha256'],sourceCodeSha256=sha(Path(__file__)),
        rows=rows,counts=dict(Counter(x['result']['status']for x in rows)),primaryRadialTruthChanged=False,
        modelOutputsSeen=False,modelCalls=0,limits='Extent heuristic not confidence interval, material-point groundtruth or measured traffic warning recall.')
    write_new(output,result);return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='job',required=True)
    a=sub.add_parser('build')
    for name in ('source','input','candidates','output'):a.add_argument('--'+name,type=Path,required=True)
    a=sub.add_parser('bind')
    for name in ('proposals','decisions','output'):a.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args()
    if a.job=='build':build(a.source,a.input,a.candidates,a.output)
    else:bind(a.proposals,a.decisions,a.output)
