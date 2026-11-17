"""Bounded numerical-edge sensitivity audit; no flow, matching or label repair."""
import json
from collections import Counter
from pathlib import Path
import hashlib
import math
import numpy as np

ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/evidence/tip65';Q=ROOT/'native/ios/.build-xcode/scene-qa'
g=json.loads((Q/'m3w-controls-r1/controls.json').read_text());d=json.loads((E/'m3w-factor-evaluation-r1.json').read_text());o=json.loads((E/'m3w-rgb-observations-r1.json').read_text())
rows={p['id']:p for p in d['pairs']};obs={p['id']:p for p in o['pairs']};K=np.array(g['K']);eps=128*np.finfo(float).eps
def touch(points,T,planes):
    T=np.array(T);points=np.array(points).reshape(-1,2);rays=np.c_[points,np.ones(len(points))]@np.linalg.inv(K).T@T[:3,:3].T
    center=T[:3,3];lam=[];xyz=[];valid=[]
    for plane in planes:
        with np.errstate(divide='ignore',invalid='ignore'):z=(plane['z']-center[2])/rays[:,2]
        w=center+z[:,None]*rays;ok=np.isfinite(z)&(z>0)
        if plane['boundsXY']is not None:
            a,b,c,e=plane['boundsXY'];ok&=(w[:,0]>=a)&(w[:,0]<=c)&(w[:,1]>=b)&(w[:,1]<=e)
        lam.append(z);xyz.append(w);valid.append(ok)
    best=np.min(np.where(np.array(valid),np.array(lam),np.inf),axis=0);out=np.zeros(len(points),bool)
    for plane,z,w in zip(planes,lam,xyz,strict=True):
        if plane['boundsXY']is None:continue
        a,b,c,e=plane['boundsXY'];tol=eps*np.maximum(1.,np.max(np.abs(w),axis=1))
        margins=np.array([w[:,0]-a,w[:,1]-b,c-w[:,0],e-w[:,1]]).T
        out|=np.any(abs(margins)<=tol[:,None],axis=1)&np.all(margins>=-tol[:,None],axis=1)&np.isfinite(z)&(z>0)&(z<=best+tol)
    return out
def supports(a,b,p,radius):
    result=np.zeros(len(a),bool)
    for i in range(len(a)):
        for q,key in((a[i],'source'),(b[i],'target')):
            x,y=np.meshgrid(np.arange(math.floor(q[0]-radius),math.ceil(q[0]+radius)+1),np.arange(math.floor(q[1]-radius),math.ceil(q[1]+radius)+1));pts=np.c_[x.ravel(),y.ravel()]
            if np.any(touch(pts,p[key]['cameraToWorld'],p['planes'])):result[i]=True;break
    return result
def counts(points,keep):
    out=Counter()
    for pt,k in zip(points,keep,strict=True):
        if not k:continue
        cls=pt['classification'];out['included']+=1;out[cls]+=1
        if cls=='accepted-right':out['tp']+=1
        if cls=='accepted-wrong':out['fpVisible']+=1;out['fn']+=1
        if cls=='missed-valid':out['fn']+=1
        if pt['status']in('occluded','target-out-of-view','target-behind'):out['knownUnmatchableFP'if pt['lkAccepted']else 'knownUnmatchableTN']+=1
    out['fpTotalKnown']=out['fpVisible']+out['knownUnmatchableFP'];return out
all_rows=[];clear_counts=Counter();interior_counts=Counter();excluded_counts=Counter();per_split={};pairs=[]
for p in g['pairs']:
    row=rows[p['id']];a=np.array(obs[p['id']]['controls']['sourceSeeds']);b=np.array(row['reference']['endpoints'])
    center=touch(a,p['source']['cameraToWorld'],p['planes'])|touch(b,p['target']['cameraToWorld'],p['planes']);s7=supports(a,b,p,3);s21=supports(a,b,p,10)
    interior=np.array(row['patch21SingleMaterial'])&~s21&~center
    pts=row['endpointAccuracy']['points'];clear=counts(pts,~center);inside=counts(pts,interior);excluded=counts(pts,center)
    clear_counts.update(clear);interior_counts.update(inside);excluded_counts.update(excluded)
    slot=per_split.setdefault(p['split'],dict(clear=Counter(),interior21=Counter(),excluded=Counter()));slot['clear'].update(clear);slot['interior21'].update(inside);slot['excluded'].update(excluded)
    for i in np.flatnonzero(center):all_rows.append(dict(pairId=p['id'],seedIndex=int(i),source=a[i].tolist(),recordedPoint=pts[i]))
    pairs.append(dict(pairId=p['id'],centerBoundarySensitive=int(center.sum()),patch7BoundaryTouch=int(s7.sum()),patch21BoundaryTouch=int(s21.sum()),
        centerIndices=np.flatnonzero(center).tolist(),patch7Indices=np.flatnonzero(s7).tolist(),patch21Indices=np.flatnonzero(s21).tolist(),
        primaryOriginalCounts=row['endpointAccuracy']['counts'],centerClearSubset=clear,geometricInterior21Subset=inside,centerAmbiguousExcluded=excluded))
out=dict(schemaVersion=1,study='M3W-numerical-boundary-sensitivity',authority='QA sensitivity strata only; original actual receipts and3072denominator unchanged.',
    rule='128 machine-epsilon scaled coordinate envelope about finite-panel inclusive perimeter, positive ray and no farther than nominal nearest material. Not a new matching/measurement threshold or certified floating interval.',
    actualModelOrFlowCalls=0,originalAuthoredSeeds=3072,pairs=pairs,centerBoundarySensitiveUnits=all_rows,
    centerClearSubset=clear_counts,geometricInterior21Subset=interior_counts,centerAmbiguousExcluded=excluded_counts,perSplit=per_split,
    limits=['Boundary-touching patch does not necessarily change patch verdict; exact alternative-algebra replay showed4centerstatus differences and0patch7/21verdict differences.',
        'Center-clear is numerically screened, not physical exactness or proof of all FP labels. Interior21 remains single-level, not LKpyramid/continuousarea support.',
        'Subsets are descriptive robustness strata with ALL exclusions enumerated; not relabeled trial scores, new heldout trials or selected higher-score data.'])
def plain(x):
    if isinstance(x,dict):return {k:plain(v)for k,v in x.items()}
    if isinstance(x,(list,tuple)):return [plain(v)for v in x]
    if isinstance(x,np.generic):return x.item()
    return x
path=E/'m3w-independent-boundary-sensitivity.json';assert not path.exists();path.write_text(json.dumps(plain(out),indent=2)+'\n')
print(json.dumps(dict(path=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),centers=len(all_rows),patch7=sum(p['patch7BoundaryTouch']for p in pairs),patch21=sum(p['patch21BoundaryTouch']for p in pairs),clear=clear_counts,interior=interior_counts,excluded=excluded_counts),default=dict))
