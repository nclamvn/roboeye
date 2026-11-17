"""Reference-only M3S observability diagnosis; NEVER a runtime approach detector.

Official indexed cuboid vertices are annotation proxies, including hidden faces,
not guaranteed material features or visible texture correspondences. No metres, labels or warnings are produced
for users. Old M3R scores are unchanged. No models, downloads or interpolation.
"""
import argparse
from collections import Counter
from hashlib import sha256
import json
import math
from pathlib import Path
from time import perf_counter

import numpy as np

from assist_scene_boreas_import import labels_world, matches, sensor_poses
from assist_scene_global_window import POLICY as FROZEN

MAX_SECONDS = 300
MAX_BYTES = 5*1024**2
POLICY = {
    "study": "M3S-reference-observability", "targets": "all12 frozen M3R positive misses",
    "synchronization": "existing mutual-unique-nearest60ms; no interpolation",
    "counterfactualWhen": "actual anchor absent only",
    "counterfactualMinMs": 320., "counterfactualMaxMs": 800.,
    "counterfactualPreferredMs": 600., "minimumLabelLidarPoints": 5,
    "geometry": "same indexed8 official cuboid annotation vertices; varying dimensions/yaw may change material location; includes hidden/empty box geometry",
    "affine": "unweighted all-vertex least squares, no RANSAC, no point-support claim",
    "angular": "RMS angular radius of normalized material-vertex rays around their mean bearing",
    "frozenGrowthMagnitude": FROZEN["minNetLinearGrowth"],
    "changesRuntime": False, "changesScoresOrGT": False, "modelCalls": 0,
}


def require(value, reason):
    if not value: raise ValueError(reason)


def fingerprint(path):
    return sha256(path.read_bytes()).hexdigest()


def _xyz(points, camera):
    return (np.asarray(points,float)-camera[:3,3])@camera[:3,:3]


def _project(xyz, k):
    h=xyz@k.T
    return h[:,:2]/h[:,2:]


def _affine(a,b):
    aug=np.column_stack((a,np.ones(len(a))))
    coef,_,rank,_=np.linalg.lstsq(aug,b,rcond=None)
    m=coef[:2,:].T;det=float(np.linalg.det(m))
    residual=np.linalg.norm(aug@coef-b,axis=1)
    if rank<3 or det<=0:return {"status":"degenerate-affine"}
    sv=np.linalg.svd(m,compute_uv=False)
    return {"status":"geometric-proxy-only", "matrix":coef.T.tolist(),
        "linearLogGrowth":.5*math.log(det), "maxResidualPx":float(max(residual)),
        "rmsResidualPx":float(np.sqrt(np.mean(residual**2))),
        "anisotropyLog":float(math.log(sv[0]/sv[1]))}


def _angular(xyz):
    rays=xyz/np.linalg.norm(xyz,axis=1)[:,None]
    center=np.mean(rays,axis=0);center/=np.linalg.norm(center)
    angles=np.arccos(np.clip(rays@center,-1.,1.))
    return float(np.sqrt(np.mean(angles**2)))


def geometry_proxy(old_points,new_points,old_center,new_center,old_camera,new_camera,k,shape):
    """Two distinct outputs: radial ratio vs optical proxy; neither is a verdict."""
    old_camera,new_camera,k=map(lambda v:np.asarray(v,float),(old_camera,new_camera,k))
    p0,p1=map(lambda v:np.asarray(v,float),(old_points,new_points))
    require(p0.shape==p1.shape and p0.ndim==2 and p0.shape[1]==3 and len(p0)>=4
        and np.isfinite(p0).all()and np.isfinite(p1).all(),"Invalid material-vertex geometry")
    # Express both exposure rays in current orientation, retaining their OWN
    # camera origins. This removes camera rotation, never camera translation.
    q0=(p0-old_camera[:3,3])@new_camera[:3,:3]
    q1=_xyz(p1,new_camera)
    c0=(np.asarray(old_center)-old_camera[:3,3])@new_camera[:3,:3]
    c1=_xyz(np.asarray(new_center)[None,:],new_camera)[0]
    r0,r1=map(float,(np.linalg.norm(c0),np.linalg.norm(c1)))
    require(min(r0,r1)>0,"Zero center range")
    result={"status":"geometric-proxy-only", "radialCenterLogRatio":math.log(r0/r1),
        "vertexCount":len(p0), "visibleMaterialCorrespondenceTruth":False,
        "minimumCommonOpticalZPositive":bool(np.min(q0[:,2])>0 and np.min(q1[:,2])>0)}
    if not result["minimumCommonOpticalZPositive"]:
        return {**result,"status":"nonpositive-proxy-depth-optical-unavailable"}
    a,b=_project(q0,k),_project(q1,k)
    h,w=shape
    result.update(axialCenterLogRatio=None if min(c0[2],c1[2])<=0 else math.log(c0[2]/c1[2]),
        angularRmsLogRatio=math.log(_angular(q1)/_angular(q0)),
        projectedVerticesClipped=bool(any(np.any((x[:,0]<0)|(x[:,0]>=w)|(x[:,1]<0)|(x[:,1]>=h))for x in (a,b))),
        forward=_affine(a,b), reverse=_affine(b,a))
    f,r=result['forward'],result['reverse']
    if f['status']==r['status']=='geometric-proxy-only':
        low,high=sorted((f['linearLogGrowth'],-r['linearLogGrowth']))
        result.update(proxyLinearLogGrowthLower=low,proxyLinearLogGrowthUpper=high,
            proxyEstimatorSpan=high-low,
            proxyExceedsFrozenGrowthMagnitude=bool(low>=POLICY['frozenGrowthMagnitude']))
    return result


def counterfactual_source(frames,current,available):
    eligible=[f for f in frames if f['token']in available and
        320_000<=current['timestampUs']-f['timestampUs']<=800_000]
    return min(eligible,key=lambda f:(abs(current['timestampUs']-f['timestampUs']-600_000),f['token']))if eligible else None


def audit(receipt_path,input_path,diagnosis_path,slice_path,progress=None):
    tick=perf_counter(); slice_path=slice_path.resolve(strict=True)
    progress={}if progress is None else progress
    dependency_names=(Path(__file__).name,'assist_scene_boreas_import.py','assist_scene_global_window.py',
        'assist_scene_region_motion.py','assist_scene_scale_approach.py','assist_scene_pose_motion.py')
    dependencies={n:fingerprint(Path(__file__).parent/n)for n in dependency_names}
    policy_seal=json.dumps(POLICY,sort_keys=True)
    progress.update(phase='reference-preflight',completedCases=[],codeSha256=dependencies,modelCalls=0)
    receipt=json.loads(receipt_path.read_text());inputs=json.loads(input_path.read_text())
    diagnosis=json.loads(diagnosis_path.read_text());manifest=json.loads((slice_path/'clips.json').read_text())
    inventory=json.loads((slice_path/'slice.json').read_text())
    truth_path=input_path.parent/'truth-reviewed.json';truth=json.loads(truth_path.read_text())
    require(diagnosis['receiptSha256']==fingerprint(receipt_path)and diagnosis['inputSha256']==fingerprint(input_path)
        and receipt['inputSha256']==fingerprint(input_path),"Unbound M3R sources")
    require(diagnosis['truthSha256']==receipt['reviewedTruthSha256']==fingerprint(truth_path),"Changed reviewed M3R truth")
    cases=diagnosis['cases'];expected={(f['token'],t['instance'])for c in truth['clips']for f in c['frames']for t in f['targets']if t['approach']=='approaching'}
    require(len(cases)==len(expected)==12 and len({(c['token'],c['target']['instance'])for c in cases})==12
        and {(c['token'],c['target']['instance'])for c in cases}==expected
        and all(c['target']['approach']=='approaching'for c in cases),"Must enumerate exact unique12 frozen positive misses")
    verified={}
    for item in inventory['files']:
        if item['path'].startswith('camera/'):continue
        p=(slice_path/item['path']).resolve(strict=True)
        require(p.is_relative_to(slice_path.resolve())and p.is_file()and fingerprint(p)==item['sha256'],"Changed official reference metadata/labels")
        verified[item['path']]=item['sha256']
    label_cache={};annotation_cache={};bindings={};clipframes={}
    for raw,clip in zip(manifest['clips'],inputs['clips'],strict=True):
        require(raw['id']==clip['id'],"Reference clip IDs differ")
        mapping=matches(raw['cameraTimestampsUs'],raw['labelTimestampsUs'])
        poses=sensor_poses(slice_path,Path('.'),'lidar',set(raw['labelTimestampsUs']))
        for stamp in raw['labelTimestampsUs']:
            require(f'labels_detection/{stamp}.txt'in verified,"Missing official label fingerprint")
            if stamp not in label_cache:
                label_cache[stamp]=labels_world(slice_path,Path('.'),stamp,poses[stamp])[0]
                annotation_cache[stamp]={}
                for line in (slice_path/f'labels_detection/{stamp}.txt').read_text().splitlines():
                    cols=line.split()
                    if cols:annotation_cache[stamp][cols[0]]=(np.asarray([float(v)for v in cols[2:5]]),float(cols[8]))
        clipframes[clip['id']]=clip['frames']
        for f in clip['frames']:
            if f['timestampUs']in mapping:bindings[f['token']]=(mapping[f['timestampUs']],f)
    bytoken={f['token']:f for c in inputs['clips']for f in c['frames']}
    actual={f['token']:f for c in receipt['clips']for f in c['frames']}
    require(len(bytoken)==len(actual)==150,"Wrong original exposure inventory")
    for token,frame in actual.items():
        src=bytoken[token]
        expected=np.diag((frame['width']/frame['nativeWidth'],frame['height']/frame['nativeHeight'],1.))@np.asarray(src['intrinsics'])
        require(src['timestampUs']==frame['timestampUs']and src['sha256']==frame['sourceSha256']
            and np.array_equal(np.asarray(src['cameraToWorld']),np.asarray(frame['cameraToWorld']))
            and np.allclose(expected,frame['cameraIntrinsics'],atol=1e-10,rtol=1e-10),"Camera exposure/center differs from bound original input")
    def pair(start,end,identifier,kind):
        out={"kind":kind,"sourceToken":None if start is None else start['token'],"currentToken":end['token'],
            "measuredCorrespondence":False,"warningPass":False}
        if start is None:return {**out,"status":"no-executed-source"if kind.startswith('actual')else'no-synchronized-counterfactual-source'}
        if any(f['token']not in bindings for f in (start,end)):
            return {**out,"status":"no-direct-synchronized-label-endpoint"}
        oldstamp,_=bindings[start['token']];newstamp,_=bindings[end['token']]
        oa,ob=label_cache[oldstamp].get(identifier),label_cache[newstamp].get(identifier)
        if oa is None or ob is None or min(oa[2],ob[2])<5:return {**out,"status":"missing-or-low-support-official-object"}
        frame=actual[end['token']];k=np.asarray(frame['cameraIntrinsics'])
        result=geometry_proxy(oa[4],ob[4],oa[3],ob[3],np.asarray(start['cameraToWorld']),np.asarray(end['cameraToWorld']),k,(frame['height'],frame['width']))
        dims0,yaw0=annotation_cache[oldstamp][identifier];dims1,yaw1=annotation_cache[newstamp][identifier]
        dimension_log=np.log(dims1/dims0)
        axis0=oa[4][4]-oa[4][0];axis1=ob[4][4]-ob[4][0]
        axis_angle=math.acos(float(np.clip(axis0@axis1/(np.linalg.norm(axis0)*np.linalg.norm(axis1)),-1,1)))
        return {**out,"status":"reference-geometric-proxy-not-image-proof","elapsedMs":(end['timestampUs']-start['timestampUs'])/1000,
            "oldLabelTimestampUs":oldstamp,"newLabelTimestampUs":newstamp,
            "oldAbsSkewUs":abs(oldstamp-start['timestampUs']),"newAbsSkewUs":abs(newstamp-end['timestampUs']),
            "annotationDimensionLogRatios":dimension_log.tolist(),"annotationDimensionsChanged":bool(np.max(np.abs(dimension_log))>1e-8),
            "rawLidarAnnotationYawChangeRad":math.atan2(math.sin(yaw1-yaw0),math.cos(yaw1-yaw0)),
            "worldCuboidXAxisAngleChangeRad":axis_angle,"worldCuboidAxisChanged":bool(axis_angle>1e-8),
            "annotationCornersAreNotGuaranteedMaterialPoints":True,"geometry":result}
    results=[];progress['completedCases']=results
    for c in cases:
        progress.update(phase='target-reference-geometry',targetToken=c['token'],targetInstance=c['target']['instance'])
        require(perf_counter()-tick<MAX_SECONDS,"Reference CPU budget exceeded")
        end=bytoken[c['token']];f=actual[c['token']];ident=c['target']['instance'];snap=f['A']['diagnostics']['snapshotSelection']
        roles={role:pair(bytoken[snap[role]['token']]if snap.get(role)else None,end,ident,'actual-'+role)for role in ('fresh','anchor')}
        alternative=None
        if snap.get('anchor')is None:
            available={t for t,(stamp,_)in bindings.items()if ident in label_cache[stamp]and label_cache[stamp][ident][2]>=5}
            alternative=pair(counterfactual_source(clipframes[c['clipId']],end,available),end,ident,'counterfactual-reference-only-nearest600ms')
        results.append(dict(clipId=c['clipId'],frameIndex=c['frameIndex'],token=c['token'],instance=ident,
            frozenReferenceApproach='approaching',frozenScore='FN-unchanged',firstVeto=c['firstVeto'],
            cameraStatus=f['T']['status'],actual=roles,counterfactual=alternative))
    require(dependencies=={n:fingerprint(Path(__file__).parent/n)for n in dependency_names}
        and policy_seal==json.dumps(POLICY,sort_keys=True),'Reference source/policy changed during audit')
    progress['phase']='complete'
    return dict(schemaVersion=1,study='M3S-reference-observability',policy=POLICY,
        receiptSha256=fingerprint(receipt_path),inputSha256=fingerprint(input_path),diagnosisSha256=fingerprint(diagnosis_path),
        sliceInventorySha256=fingerprint(slice_path/'slice.json'),verifiedReferenceFiles=verified,
        codeSha256=dependencies,truthSha256=fingerprint(truth_path),numpyVersion=np.__version__,targets=len(results),results=results,
        actualPairStatuses=dict(Counter(p['status']for a in results for p in a['actual'].values())),
        counterfactualStatuses=dict(Counter(a['counterfactual']['status']for a in results if a['counterfactual']is not None)),
        modelCalls=0,cpuWallMs=1000*(perf_counter()-tick),maxCpuSeconds=MAX_SECONDS,maxOutputBytes=MAX_BYTES,
        limits='Posthoc reference diagnosis, not fresh quality evidence. No object-pose interpolation. Indexed official cuboid vertices can change physical location as annotation dimensions/yaw vary; include hidden faces/empty geometry; are not image texture, actual visible correspondences, segmentation or9-point support. Different aspect, clipping and synchronization skew can affect proxies. Camera centers are from each exact bound image exposure, but object labels can have up to60ms skew; no mover interpolation silently repairs it. No runtime, original scores or truth changed; no radial target relabeling, range output, detection or warning promotion.')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('receipt','input','diagnosis','slice','output'):p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();require(not a.output.exists()and not a.output.is_symlink(),'New output only')
    progress={}
    try:result=audit(a.receipt,a.input,a.diagnosis,a.slice,progress)
    except Exception as error:
        partial={"study":"M3S-reference-observability","status":"FAILED-INCOMPLETE-NOT-SCORABLE",
            "progress":progress,"completedCaseCount":len(progress.get('completedCases',[])),
            "failurePhase":progress.get('phase','initialization'),"sourceCodeSha256":fingerprint(Path(__file__)),
            "errorType":type(error).__name__,"error":str(error)[:300],"modelCalls":0}
        raw=json.dumps(partial,indent=2,allow_nan=False).encode();require(len(raw)<MAX_BYTES,'Incomplete receipt budget exceeded')
        with a.output.with_name(a.output.stem+'-incomplete.json').open('xb')as stream:stream.write(raw)
        raise
    raw=json.dumps(result,indent=2,allow_nan=False).encode();require(len(raw)<MAX_BYTES,'Receipt budget exceeded')
    with a.output.open('xb')as stream:stream.write(raw)
    print(json.dumps({k:result[k]for k in ('targets','actualPairStatuses','counterfactualStatuses','cpuWallMs','modelCalls')}))
