#!/usr/bin/env python3
"""Bind fixed TUM control pairs; no interpolation, reference score or model.

An unavailable depth association/pose stays on the fixed frame and pair. This
file is offline reference metadata, not a runtime range/warning interface.
"""
import argparse
from bisect import bisect_left
import json
import math
import os
from pathlib import Path, PurePosixPath

import cv2
import numpy as np

import fetch_assist_scene_m3t_tum as source


def parse_poses(body):
    rows=[]
    for line in body.decode().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):continue
        values=line.split();source.require(len(values)==8,"Malformed mocap row")
        at=source.timestamp(values[0]);v=list(map(float,values[1:]))
        source.require(all(math.isfinite(x)for x in v) and abs(sum(x*x for x in v[3:])-1.)<=.001,"Invalid mocap pose/quaternion")
        source.require(not rows or at>rows[-1][0],"Duplicate/unsorted mocap clock")
        rows.append((at,v))
    source.require(len(rows)>0,"Missing mocap rows")
    return rows


def own_pose(rows,sensor_at):
    times=[r[0]for r in rows];i=bisect_left(times,sensor_at)
    candidates=sorted((rows[j]for j in (i-1,i)if 0<=j<len(rows)),key=lambda r:(abs(r[0]-sensor_at),r[0]))
    if not candidates:return dict(status='missing-pose')
    at,v=candidates[0];skew=at-sensor_at
    status=('ambiguous-nearest-pose'if len(candidates)>1 and abs(candidates[1][0]-sensor_at)==abs(skew)
        else 'nearest-pose-exceeds5ms'if abs(skew)>5000 else 'valid')
    return dict(status=status,timestampUs=at,skewUs=skew,translation=v[:3],quaternion=v[3:])


def import_slice(slice_path,output):
    slice_path=slice_path.resolve(strict=True);raw=(slice_path/'slice.json').read_bytes();record=json.loads(raw)
    source.require(record['complete'] is True and record['planSha256']==source.PLAN_SHA256
        and record['sourceCodeSha256']==source.digest(Path(source.__file__).read_bytes()),"Unbound/incomplete source fetch")
    plan=source.validate_plan(record['planRawUtf8'].encode())
    source.require(plan==record['plan'],"Changed original sealed plan content")
    verified={}
    for item in record['files']:
        rel=PurePosixPath(item['path']);source.require(not rel.is_absolute() and '..'not in rel.parts,"Unsafe source record path")
        path=(slice_path/item['path']).resolve(strict=True)
        source.require(path.is_relative_to(slice_path) and not (slice_path/item['path']).is_symlink()
            and path.is_file() and path.stat().st_size==item['bytes'] and source.digest(path.read_bytes())==item['sha256'],"Source file changed")
        source.require(item['path']not in verified,"Duplicate source record")
        verified[item['path']]=item
    sequences=[];pixel_formats={};missing_poses=0
    for planned,observed in zip(plan['sequences'],record['sequences'],strict=True):
        ident=planned['id'];source.require(observed['id']==ident and len(observed['frames'])==27,"Wrong fixed exposure count")
        gt=(slice_path/ident/'groundtruth.txt').read_bytes()
        source.require(source.digest(gt)==planned['groundtruthSha256'],"Official mocap metadata changed")
        poses=parse_poses(gt)
        source.require(len(poses)==planned['poseRows'] and poses[0][0]==planned['firstPoseTimestampUs']
            and poses[-1][0]==planned['lastPoseTimestampUs'],"Wrong fixed mocap clock")
        indexes={}
        for kind in ('rgb','depth'):
            rows=[]
            for line in (slice_path/ident/(kind+'.txt')).read_text().splitlines():
                if line.strip() and not line.lstrip().startswith('#'):
                    at,name=line.split();member='rgbd_dataset_freiburg3_'+ident+'/'+name
                    source.require(PurePosixPath(name).parts[0]==kind
                        and source.timestamp(PurePosixPath(name).stem)==source.timestamp(at),"Wrong sensor index filename clock")
                    rows.append((source.timestamp(at),member))
            source.require(len(rows)==len(set(rows)) and len({a for a,_ in rows})==len(rows),"Duplicate sensor timestamp index")
            indexes[kind]=rows
        frames=[]
        for index,selection in enumerate(observed['frames']):
            expected=planned['windowStartsUs'][index//9]+source.OFFSETS[index%9]
            source.require(selection['nominalTimestampUs']==expected and selection['id']==f'{ident}-{index:02d}',"Selected nominal exposure changed")
            selected_rgb,rgb_status=source.nearest(indexes['rgb'],expected,17500)
            if selected_rgb is not None:
                source.require(selected_rgb==(selection['rgb']['timestampUs'],selection['rgb']['sourceMember']),"RGB selected by something other than fixed metadata rule")
            if rgb_status!='valid':
                source.require(selection['rgb']['status']=='unavailable' and selection['rgb']['reason']==rgb_status
                    and selection['depth'] is None and selection['association']['status']=='rgb-unavailable',"Unavailable nominal RGB status changed")
                rgb=dict(status='unavailable',reason=rgb_status)
                if selected_rgb is not None:
                    rgb.update(timestampUs=selected_rgb[0],pose=own_pose(poses,selected_rgb[0]))
                frames.append(dict(id=selection['id'],nominalTimestampUs=expected,rgb=rgb,
                    depth=dict(status='unavailable',reason='rgb-exposure-unavailable'),association=selection['association']))
                continue
            source.require(selection['rgb']['status']=='available',"Valid RGB source relabelled unavailable")
            selected_depth,depth_status=source.nearest(indexes['depth'],selected_rgb[0],20000)
            reverse,reverse_status=source.nearest(indexes['rgb'],selected_depth[0])if selected_depth else(None,'missing')
            if depth_status=='valid'and(reverse_status!='valid'or reverse!=selected_rgb):depth_status='not-mutual-nearest'
            if selected_depth:
                source.require(selection['depth'] is not None and selected_depth==(selection['depth']['timestampUs'],selection['depth']['sourceMember']),"Nearest depth metadata changed")
                rel=ident+'/'+str(PurePosixPath(selected_depth[1]).relative_to('rgbd_dataset_freiburg3_'+ident))
                if rel not in verified:depth_status='nearest-depth-not-in-bounded-candidates'
            source.require(selection['association']['status']==depth_status,"Unverified RGB/depth mutual-nearest status")
            frame=dict(id=selection['id'],nominalTimestampUs=expected,association=selection['association'])
            for kind in ('rgb','depth'):
                selected=selection[kind]
                if selected is None:
                    frame[kind]=dict(status='unavailable',reason='no-nearest-source-member');continue
                original=PurePosixPath(selected['sourceMember'])
                source.require(original.parts[0]=='rgbd_dataset_freiburg3_'+ident and original.parts[1]==kind
                    and source.timestamp(original.stem)==selected['timestampUs'],"Wrong selected sensor member")
                rel=ident+'/'+str(original.relative_to(original.parts[0]))
                if rel not in verified:
                    source.require(kind=='depth' and frame['association']['status']!='valid',"Selected sensor bytes unavailable")
                    frame[kind]=dict(status='unavailable',reason='nearest-depth-not-buffered',timestampUs=selected['timestampUs'],
                        pose=own_pose(poses,selected['timestampUs']));continue
                image=cv2.imread(str(slice_path/rel),cv2.IMREAD_UNCHANGED)
                shape=(480,640,3)if kind=='rgb'else(480,640)
                dtype=np.uint8 if kind=='rgb'else np.uint16
                source.require(image is not None and image.shape==shape and image.dtype==dtype,"Wrong original sensor image format")
                pixel_formats[kind]=dict(shape=list(image.shape),dtype=str(image.dtype))
                pose=own_pose(poses,selected['timestampUs']);missing_poses+=pose['status']!='valid'
                frame[kind]=dict(status='available',path=rel,sha256=verified[rel]['sha256'],timestampUs=selected['timestampUs'],pose=pose)
            rgb=frame['rgb'];depth=frame['depth']
            source.require(abs(rgb['timestampUs']-expected)<=17500,"Fixed RGB/nominal skew changed")
            if depth.get('timestampUs')is not None:
                source.require(frame['association']['deltaUs']==depth['timestampUs']-rgb['timestampUs'],"Signed RGB/depth skew changed")
            if frame['association']['status']=='valid':
                source.require(depth['status']=='available' and abs(frame['association']['deltaUs'])<=20000,"Invalid depth association")
            frames.append(frame)
        pairs=[]
        for window in range(3):
            for index,(start,end)in enumerate(source.PAIRS):
                a,b=frames[window*9+start],frames[window*9+end]
                ready=all(f['rgb']['status']=='available'for f in (a,b))
                dt=b['rgb']['timestampUs']-a['rgb']['timestampUs']if ready else None
                pairs.append(dict(id=f'{ident}-w{window}-p{index}',startId=a['id'],endId=b['id'],windowIndex=window,
                    nominalIntervalUs=100000 if index%2==0 else 200000,actualRgbIntervalUs=dt,
                    status='rgb-exposure-unavailable'if not ready else 'valid-interval'if 65000<=dt<=300000 else 'outside-frozen-pose-interval'))
        sequences.append(dict(id=ident,referenceStratum=planned['referenceStratum'],frames=frames,pairs=pairs))
    source.require(sum(len(s['pairs'])for s in sequences)==48,"Fixed pair denominator changed")
    result=dict(schemaVersion=1,study=plan['study'],assetRoot=os.path.relpath(slice_path,output.parent),
        intrinsics=plan['calibration']['intrinsics'],imageShape=[480,640],depthScale=5000,
        planSha256=source.PLAN_SHA256,sliceManifestSha256=source.digest(raw),
        codeSha256={Path(__file__).name:source.digest(Path(__file__).read_bytes()),Path(source.__file__).name:source.digest(Path(source.__file__).read_bytes())},
        sourceFileCount=len(verified),pixelFormats=pixel_formats,sequences=sequences,pairs=48,
        poseUnavailableObservations=missing_poses,modelCalls=0,
        license=plan['license'],limits=plan['limits'])
    source.write_json(output,result)
    print(json.dumps(dict(output=str(output),pairs=48,frames=sum(len(s['frames'])for s in sequences),poseUnavailableObservations=missing_poses)))
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--slice',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();import_slice(a.slice,a.output)
