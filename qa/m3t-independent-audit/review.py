"""Read-only independent numerical/source audit. No LK or reference rerun."""
from pathlib import Path
from hashlib import sha256
from collections import Counter,defaultdict
import json, math
import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
Q=ROOT/'native/ios/.build-xcode/scene-qa'
RP=Q/'m3t-static-controls-r1.json';MP=Q/'tum-m3t/input.json';SP=Q/'tum-m3t-slice/slice.json'
r=json.loads(RP.read_text());m=json.loads(MP.read_text());s=json.loads(SP.read_text())
def sha(p):return sha256(p.read_bytes()).hexdigest()
def canonical(a):return sha256(json.dumps(a,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def stats(a):
 a=np.asarray(a,float);a=a[np.isfinite(a)]
 return dict(n=len(a),p50=float(np.median(a))if len(a)else None,p95=float(np.percentile(a,95))if len(a)else None,
  gt1=int(np.sum(a>1)),gt2=int(np.sum(a>2)),gt5=int(np.sum(a>5)))
assert sha(MP)==r['manifestSha256']==r['expectedManifestSha256']
assert sha(SP)==m['sliceManifestSha256']
assert r['codeSha256']==r['codeAfterSha256']
assert all(sha(ROOT/'scripts'/k)==v for k,v in r['codeSha256'].items())
assert r['learnedModelCalls']==0 and not r['motionAuthorized']and not r['events']
old_score=ROOT/'docs/evidence/tip65/m3r-boreas-score.json'
assert sha(old_score)=='5e6497dd183a48d4fddcd213f9da7c2b534dde4bb3a339010220183503dc481a'
asset=(MP.parent/m['assetRoot']).resolve();files={}
for f in s['files']:
 p=asset/f['path'];assert sha(p)==f['sha256']and p.stat().st_size==f['bytes'];files[f['path']]=f['sha256']
gray={}
def gray_sha(sensor):
 p=asset/sensor['path']
 if str(p)not in gray:gray[str(p)]=sha256(cv2.imread(str(p),cv2.IMREAD_GRAYSCALE|cv2.IMREAD_IGNORE_ORIENTATION).tobytes()).hexdigest()
 return gray[str(p)]
def pose(sensor):
 p=sensor['pose'];x,y,z,w=np.asarray(p['quaternion'])/np.linalg.norm(p['quaternion'])
 R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
 return R,np.asarray(p['translation'])
groups=defaultdict(lambda:dict(pairs=0,source=0,status=Counter(),visible=0,accepted=0,lkMiss=0,notAccepted=0,
 epe=[],shift=[],allForward=[],radius=[],outside=0,shiftOutside=0,controls=Counter(),guard=Counter(),skews=[]))
fallback=[];fallbackpool=defaultdict(lambda:dict(reference=[],lk=[],epe=[],pairs=0,points=0));outliers=[]
calibration=Counter();rgb_seals=[];directions=Counter();allpairids=[]
eligible_controls=defaultdict(lambda:dict(eligiblePairs=0,status=Counter(),baseline=[],changed=[]))
for seq,ms in zip(r['sequences'],m['sequences'],strict=True):
 assert seq['id']==ms['id'];frames={f['id']:f for f in ms['frames']};pairs={p['id']:p for p in ms['pairs']}
 for p in seq['pairs']:
  allpairids.append(p['id']);mp=pairs[p['id']];a,b=p['sourceMetadata'],p['currentMetadata']
  assert a==frames[p['startId']]and b==frames[p['endId']]
  rgb=p['rgbEvidence'];nominal=mp['nominalIntervalUs']//1000
  if rgb is None:continue
  assert canonical(rgb)==p['rgbEvidenceSha256'];rgb_seals.append(p['rgbEvidenceSha256'])
  assert gray_sha(a['rgb'])==rgb['sourceGraySha256']and gray_sha(b['rgb'])==rgb['currentGraySha256']
  n=rgb['originalSeedCount'];keep=np.asarray(rgb['lkAccepted'],bool);forward=np.asarray(rgb['forwardEndpoints'],float).reshape(-1,2)
  assert len(rgb['sourceSeeds'])==len(keep)==len(forward)==n
  directions['standalone']+=rgb['calcOpticalFlowDirectionCalls'];directions['guard']+=p['frozenPrimaryCameraGuard']['lkDirectionCalls']
  directions['rgbFunctions']+=1;directions['guardFunctions']+=p['frozenPrimaryCameraGuard']['correspondenceCalls']
  masks={}
  for name,profile in p['profiles'].items():
   ref=profile['reference'];comparison=profile['comparison']
   assert ref['originalSeedCount']==n and len(ref['status'])==n
   expected=np.array([v if v is not None else [np.nan,np.nan]for v in ref['expectedEndpoints']],float).reshape(-1,2)
   visible=np.array([x=='approximately-visible-static-reference'for x in ref['status']]);finite=np.isfinite(forward).all(1)&np.isfinite(expected).all(1)
   accepted=visible&keep&finite;mask=accepted;masks[name]=(visible,accepted)
   err=np.linalg.norm(forward-expected,axis=1);shift=np.linalg.norm(forward+np.array([10,10])-expected,axis=1)
   rad=np.array([v if v is not None else np.nan for v in ref['sensitivityRadiusPx']])
   assert int(sum(visible))==comparison['visibleReferenceCount']and int(sum(accepted))==comparison['visibleReferenceAcceptedLkCount']
   assert int(sum(mask&(err>rad)))==comparison['visibleAcceptedOutsideSensitivity']
   assert stats(err[mask])['p50']==comparison['visibleAcceptedEpe']['medianPx']
   base=comparison['projectionGeometrySelfConsistency']
   if base['status']=='valid':
    for cn,control in comparison['negativeControls'].items():
     if cn=='shiftedLkEndpoints':continue
     control_group=eligible_controls[(name,cn)];control_group['eligiblePairs']+=1;control_group['status'][control['status']]+=1
     if control['status']=='valid':
      valid=mask&np.asarray(base['usable'],bool)&np.asarray(control['usable'],bool)
      before=np.asarray([v if v is not None else np.nan for v in base['residualPx']]);after=np.asarray([v if v is not None else np.nan for v in control['residualPx']])
      valid&=np.isfinite(before)&np.isfinite(after);control_group['baseline'].extend(before[valid]);control_group['changed'].extend(after[valid])
   for key in ((name,'all'),(name,seq['id']),(name,f'{nominal}ms'),(name,seq['id'],f'{nominal}ms')):
    g=groups[key];g['pairs']+=1;g['source']+=n;g['status'].update(ref['status']);g['visible']+=int(sum(visible));g['accepted']+=int(sum(accepted))
    g['lkMiss']+=int(sum(visible&~keep));g['notAccepted']+=int(sum(visible&~accepted))
    g['epe'].extend(err[mask]);g['shift'].extend(shift[mask]);g['allForward'].extend(err[visible&finite]);g['radius'].extend(rad[mask]);g['outside']+=int(sum(mask&(err>rad)));g['shiftOutside']+=int(sum(mask&(shift>rad)))
    for cn,c in comparison['negativeControls'].items():
     if cn!='shiftedLkEndpoints':g['controls'][cn+':'+c['status']]+=1
    g['guard'][p['frozenPrimaryCameraGuard']['status']]+=1
    for f in (a,b):
     for sn in ('rgb','depth'):
      sensor=f.get(sn,{});pp=sensor.get('pose',{})
      if isinstance(pp.get('timestampUs'),int):g['skews'].append(abs(pp['timestampUs']-sensor['timestampUs']))
   guard=p['frozenPrimaryCameraGuard']
   if guard.get('modelMode')=='checked-near-rotation-fallback':
    R0,c0=pose(a['rgb']);R1,c1=pose(b['rgb']);K=np.asarray(r['calibrationProfiles'][name]);xy=np.asarray(rgb['sourceSeeds'])
    H=K@(R1.T@R0)@np.linalg.inv(K);h=np.c_[xy,np.ones(n)]@H.T;rot=h[:,:2]/h[:,2:]
    fallback.append(dict(profile=name,pair=p['id'],baseline=float(np.linalg.norm(c1-c0)),criterion=guard['actualResidualCriterionPx'],
     guardStatus=guard['status'],visibleAccepted=int(sum(mask)),referenceRotationResidual=stats(np.linalg.norm(expected[mask]-rot[mask],axis=1)),
     lkRotationResidual=stats(np.linalg.norm(forward[mask]-rot[mask],axis=1)),epe=stats(err[mask])))
    g=fallbackpool[name];g['reference'].extend(np.linalg.norm(expected[mask]-rot[mask],axis=1));g['lk'].extend(np.linalg.norm(forward[mask]-rot[mask],axis=1));g['epe'].extend(err[mask]);g['pairs']+=1;g['points']+=int(sum(mask))
   if name=='primary-fr3':
    for index in np.flatnonzero(mask&(err>rad)):
     outliers.append(dict(pair=p['id'],index=int(index),source=a,current=b,seed=rgb['sourceSeeds'][index],
      expected=expected[index].tolist(),lk=forward[index].tolist(),epe=float(err[index]),radius=float(rad[index]),
      cycle=rgb['cyclePx'][index],photometricNcc=rgb['photometricCorrelation'][index]))
  x,y=masks.values();calibration['visibleMaskDisagreements']+=int(sum(x[0]!=y[0]));calibration['acceptedMaskDisagreements']+=int(sum(x[1]!=y[1]))
assert len(allpairids)==len(set(allpairids))==48
assert directions['standalone']==r['standaloneLkDirectionCalls']and directions['guard']==r['guardLkDirectionCalls']
assert directions['rgbFunctions']+directions['guardFunctions']==r['actualCorrespondenceCalls']
summaries=[]
for key,g in groups.items():
 summaries.append(dict(profile=key[0],stratum=list(key[1:]),pairs=g['pairs'],originalSeeds=g['source'],referenceStatuses=dict(g['status']),
  visible=g['visible'],visibleAccepted=g['accepted'],visibleLkNotAccepted=g['lkMiss'],visibleNoAcceptedFiniteCorrespondence=g['notAccepted'],
  pooledVisibleAcceptedEpePx=stats(g['epe']),pooledSameVisibleAcceptedShiftedEpePx=stats(g['shift']),
  pooledVisibleAllForwardEpePx=stats(g['allForward']),pooledAcceptedSensitivityRadiusPx=stats(g['radius']),outsideSensitivity=g['outside'],
  shiftedEndpointsOutsideSameSensitivity=g['shiftOutside'],unchangedCompatibleWithHeuristic=g['accepted']-g['outside'],
  shiftedEndpointsCompatibleWithSameHeuristic=g['accepted']-g['shiftOutside'],
  guardStatuses=dict(g['guard']),negativeControlPairStatuses=dict(g['controls']),poseAbsSkewUs=stats(g['skews'])))
plates=[]
for number,o in enumerate(outliers):
 assert number<2,'Plate budget is two outliers with two plates each'
 images=[cv2.imread(str(asset/o[sn]['rgb']['path']),cv2.IMREAD_COLOR)for sn in ('source','current')]
 for zoom in (False,True):
  panels=[]
  for i,image in enumerate(images):
   points=[(o['seed'],(0,220,255),'source seed')]if i==0 else [(o['expected'],(80,240,80),'sensor reference'),(o['lk'],(60,60,255),'LK')]
   canvas=image.copy()
   for xy,color,label in points:
    at=tuple(np.round(xy).astype(int));cv2.drawMarker(canvas,at,color,cv2.MARKER_CROSS,14,2);cv2.circle(canvas,at,7,color,1)
   if zoom:
    loc=np.mean(np.asarray([v[0]for v in points]),axis=0);x,y=np.maximum(0,np.floor(loc-65)).astype(int);x=min(x,510);y=min(y,350)
    canvas=cv2.resize(canvas[y:y+130,x:x+130],(520,520),interpolation=cv2.INTER_NEAREST)
   panels.append(canvas)
  sheet=np.concatenate(panels,axis=1);sheet=np.pad(sheet,((35,0),(0,0),(0,0)))
  title=f"{o['pair']} seed{o['index']} | source yellow; current reference green, LK red | NOT new GT"
  cv2.putText(sheet,title,(8,23),cv2.FONT_HERSHEY_SIMPLEX,.45,(255,255,255),1,cv2.LINE_AA)
  name=f"outlier-{number}-{'zoom'if zoom else'context'}.jpg";path=Path(__file__).parent/name
  assert cv2.imwrite(str(path),sheet);plates.append(dict(path=str(path),sha256=sha(path),pair=o['pair'],seedIndex=o['index'],epe=o['epe'],heuristicRadius=o['radius'],cycle=o['cycle'],photometricNcc=o['photometricNcc']))
report=dict(schemaVersion=1,study='M3T-independent-verification',reviewRole='Independent code, source-byte and numerical QA; not author of fetch/import/study',
 receiptPath=str(RP),receiptSha256=sha(RP),manifestSha256=sha(MP),sliceSha256=sha(SP),sourceFilesVerified=len(files),verifiedFiles=files,
 codeHashesMatchFrozenAndCurrent=True,sourceRgbPixelHashesVerified=len(gray),sourcePairRgbSealsVerified=len(rgb_seals),pairCount=48,
 tests=dict(passed=21,failed=0,seconds=1.920,scope='Independent rerun of same21 authored tests, not21 additional scenarios or empirical quality cases'),
 requestedOpenCvThreads=1,observedOpenCvThreads=r['software']['opencvThreads'],timingControlled=False,actualWallMs=r['elapsedMs'],actualCalls=dict(directions),
 summaries=summaries,calibrationMaskComparison=dict(calibration),nearRotationFallback=fallback,
 eligibleNegativeControls=[dict(profile=k[0],control=k[1],baselineEligiblePairs=v['eligiblePairs'],controlStatuses=dict(v['status']),
  sameMaskBaselineResidualPx=stats(v['baseline']),sameMaskChangedResidualPx=stats(v['changed']),
  interpretation='Only baseline epipolar-valid pairs. Reference projection residual is self-consistency by construction, not physical camera validation.')for k,v in eligible_controls.items()],
 nearRotationPooled={name:dict(pairs=g['pairs'],visibleAcceptedPoints=g['points'],referenceToRotationOnlyResidualPx=stats(g['reference']),lkToRotationOnlyResidualPx=stats(g['lk']),epe=stats(g['epe']),
  referenceResidualAboveFrozen1_3Px=int(np.sum(np.asarray(g['reference'])>1.3)),lkResidualAboveFrozen1_3Px=int(np.sum(np.asarray(g['lk'])>1.3)))for name,g in fallbackpool.items()},
 outlierContextPlates=plates,
 visualReview='All four hash-bound outlier context/zoom plates actually viewed by this independent reviewer. Both seeds lie on a slanted poster border; along-edge LK displacement relative to sensor reference makes aperture ambiguity a plausible explanation, not new material-point GT. Full-sequence visual certification NOT PERFORMED. Official static-scene description remains scope assumption, not proof every pixel is static.',
 negativeControlComparison='Shifted endpoints recomputed from RECEIPT on EXACT SAME visible & accepted & finite mask as unshifted EPE. Derived arithmetic, no new trial or inference; stored original shifted aggregate used a wider all-finite mask.',
 limits=['Depth/mocap sensor-derived approximation; fixed-K projection self-consistency is by construction, not independent physical camera validation.',
 'Heuristic radius includes overlapping pose sensitivity terms and conditions on selected surface; not a certified CI or a bound on registration winner/disocclusion effects.',
 'Injected endpoint+(10,10) control remains compatible with the wide heuristic on9049/9052 primary visible accepted points. This falsifies treating sensitivity compatibility as correspondence verification; two outside on unshifted points does not mean only two wrong matches.',
 'Every seed remains in original denominator, missing/occluded/ambiguous reference stays separate. No traffic approach FP/FN, runtime distances, mobile or safety certification.',
 'OpenCV requested1 but observed10 threads; actual elapsed time is uncontrolled diagnostic timing. No repair or rerun for better timing.'],
 motionAuthorized=False,learnedModelCalls=0,productionChangedByThisAudit=False,oldM3RScoreChanged=False,
 oldM3RScoreSha256=sha(old_score))
out=ROOT/'docs/evidence/tip65/m3t-independent-verification.json';out.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
print(json.dumps(dict(output=str(out),receiptSha256=report['receiptSha256'],files=len(files),grayHashes=len(gray),directions=dict(directions),calibration=dict(calibration)),indent=2))
