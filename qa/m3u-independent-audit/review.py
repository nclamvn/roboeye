"""Independent frozen-score/pixel/proof recount, never another model run."""
from pathlib import Path
from hashlib import sha256
from collections import Counter
from importlib.util import spec_from_file_location,module_from_spec
import json,math,sys
import cv2
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts'))
import assist_scene_m3u_study as study
Q=ROOT/'native/ios/.build-xcode/scene-qa'
RP=Q/'m3u-boreas-receipt-r1.json';IP=Q/'boreas-m3u/input.json';TP=Q/'boreas-m3u/truth-reviewed.json';SP=Q/'boreas-m3u-slice/slice.json'
SEC=ROOT/'docs/evidence/tip65/m3u-secondary-visible-extent.json'
def sha(p):return sha256(p.read_bytes()).hexdigest()
def canonical(a):return sha256(json.dumps(a,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
r,i,t,s,secondary=[json.loads(p.read_text())for p in (RP,IP,TP,SP,SEC)]
assert r['inputSha256']==sha(IP)==t['inputSha256']and r['reviewedTruthSha256']==sha(TP)
assert r['reviewCoverageSha256']==sha(IP.parent/'truth-reviewed-coverage.json')
assert r['codeSha256']=={k:sha(ROOT/'scripts'/k)for k in r['codeSha256']}
oldpath=ROOT/'docs/evidence/tip65/m3r-boreas-score.json'
assert sha(oldpath)=='5e6497dd183a48d4fddcd213f9da7c2b534dde4bb3a339010220183503dc481a'
old=json.loads(oldpath.read_text());assert all(sha(ROOT/'scripts'/k)==v for k,v in old['codeSha256'].items())
asset=(IP.parent/i['assetRoot']).resolve();files={}
for f in s['files']:
 assert sha(asset/f['path'])==f['sha256'];files[f['path']]=f['sha256']
spec=spec_from_file_location('independent_frozen_legacy_score',ROOT/'scripts/score-assist-scene-motion-m3c.py');legacy=module_from_spec(spec);spec.loader.exec_module(legacy)
stats={l:legacy.empty()for l in ('A','B')};clips=[];positives=[];camera=Counter();modes=Counter();directions=Counter();first_veto={l:Counter()for l in ('A','B')}
controls_checked=0;photo_checks=0;raw_checks=0;working_checks=0;concordant=[];allrows=[]
union_diag=dict(pairs=0,rejected=0,rejectedUnionMeetsFloors=0,rejectedUnionStillFails=0,originalN=[],lkFractions=[],photoBackgroundFractions=[])
concordant_keys={z['key']for z in secondary['rows']if z['result']['status']=='concordant'}
candidates=json.loads((Q/'boreas-m3u-review/candidates.json').read_text());bykey={z['key']:z for z in candidates['rows']}
concordant_target={(bykey[key.split(':')[0]]['token'],bykey[key.split(':')[0]]['candidates'][int(key.split(':')[1])-1]['instance'])for key in concordant_keys}
def mask(row):
 h,w=row['height'],row['width'];out=np.full((h,w),255,np.uint8);pad=max(2,round(max(h,w)*.010))
 for d in row['detections']:
  b=d['box'];x,y,z,v=b['x']*w,b['y']*h,(b['x']+b['width'])*w,(b['y']+b['height'])*h
  dx=max(pad,round((z-x)*.12));dy=max(pad,round((v-y)*.12))
  out[max(0,math.floor(y)-dy):min(h,math.ceil(v)+dy),max(0,math.floor(x)-dx):min(w,math.ceil(z)+dx)]=0
 return out
for clip,src,gt in zip(r['clips'],i['clips'],t['clips'],strict=True):
 assert clip['id']==src['id']==gt['id'];labels={x['token']:x for x in gt['frames']};hist=[];prior_gray=None;prior_row=None;local={l:legacy.empty()for l in ('A','B')}
 for index,(row,source)in enumerate(zip(clip['frames'],src['frames'],strict=True)):
  study.bind_frame_source(row,source,index,src['frames'][0]['timestampUs']);study.frame_contract(row,hist)
  bgr=cv2.imread(str(asset/source['path']),cv2.IMREAD_COLOR|cv2.IMREAD_IGNORE_ORIENTATION)
  ng=cv2.cvtColor(bgr,cv2.COLOR_BGR2GRAY);assert sha256(ng.tobytes()).hexdigest()==row['nativeGraySha256'];raw_checks+=1
  prepared=cv2.resize(bgr,(row['width'],row['height']),interpolation=cv2.INTER_AREA)
  ok,jpeg=cv2.imencode('.jpg',prepared,[cv2.IMWRITE_JPEG_QUALITY,93]);assert ok
  gray=cv2.imdecode(jpeg,cv2.IMREAD_GRAYSCALE);assert sha256(gray.tobytes()).hexdigest()==row['workingPixelsSha256'];working_checks+=1
  controls=row['T_B']['diagnostics'].get('controls')
  if controls is not None:
   a=np.asarray(controls['sourceSeeds'],float);b=np.asarray(controls['endpoints'],float);keep=np.asarray(controls['lkAccepted'],bool);photo=np.zeros(len(a),bool);bg=np.zeros(len(a),bool)
   current_mask=mask(row);assert sha256(current_mask.tobytes()).hexdigest()==controls['currentMaskSha256']
   assert sha256(mask(prior_row).tobytes()).hexdigest()==controls['sourceMaskSha256']
   for k in np.flatnonzero(keep):
    x,y=b[k].astype(int);bg[k]=current_mask[y,x]!=0
    h,w=gray.shape
    if not(all(3<=p[0]<=w-4 and 3<=p[1]<=h-4 for p in (a[k],b[k]))):continue
    pa=cv2.getRectSubPix(prior_gray,(7,7),tuple(map(float,a[k]))).astype(np.float32);pb=cv2.getRectSubPix(gray,(7,7),tuple(map(float,b[k]))).astype(np.float32)
    pa-=pa.mean();pb-=pb.mean();norm=float(np.linalg.norm(pa)*np.linalg.norm(pb));photo[k]=norm>=49*4**2 and float(np.sum(pa*pb))>=norm*.70;photo_checks+=1
   assert photo.tolist()==controls['photometric']and bg.tolist()==controls['outsideCurrentForeground'];controls_checked+=1
   if clip['id']=='boreas-m3u-city':
    ev=row['T_B']['diagnostics']['evidence'];union=np.asarray(ev['rotationAgreement'],bool)|np.asarray(ev['epipolarParallaxAgreement'],bool)
    pts=b[union];cells=len({(int(x*4/row['width']),int(y*3/row['height']))for x,y in pts})
    span=float(np.min(np.ptp(pts,axis=0)/[row['width'],row['height']])) if len(pts) else 0.
    qualifies=int(sum(union))>=24 and sum(union)/len(a)>=.70 and cells>=5 and span>=.40
    union_diag['pairs']+=1;union_diag['originalN'].append(len(a));union_diag['lkFractions'].append(float(np.mean(keep)))
    union_diag['photoBackgroundFractions'].append(float(np.mean(keep&photo&bg)))
    if row['T_B']['status']!='valid':
     union_diag['rejected']+=1;union_diag['rejectedUnionMeetsFloors']+=int(qualifies);union_diag['rejectedUnionStillFails']+=int(not qualifies)
  ref=labels.get(row['token']);targets=None if ref is None else [{**z,'motion':{'approaching':'moving','not-approaching':'stationary','unknown':'unknown'}[z['approach']]}for z in ref['targets']]
  for lane in ('A','B'):
   legacy.score_frame(row,lane,targets,local[lane]);cam=row['T_'+lane];camera[(clip['id'],lane,cam['status'])]+=1
   ev=cam['diagnostics'].get('evidence');modes[(clip['id'],lane,None if ev is None else ev['selectedMode'])]+=1
   directions[lane]+=row['flowDirectionCalls'][lane];assert row['actualCalls'][lane]==dict(raft=row['flowDirectionCalls'][lane])
   assert row[lane]['answers']['distance']['metres']is None
  if targets:
   for target in ref['targets']:
    if target['approach']!='approaching':continue
    prev=src['frames'][index-1];baseline=float(np.linalg.norm(np.asarray(source['cameraToWorld'])[:3,3]-np.asarray(prev['cameraToWorld'])[:3,3]))
    entry=dict(clipId=clip['id'],frameIndex=index,token=row['token'],instance=target['instance'],baselineM=baseline,
      immediatePoseOpportunity='old-baseline-too-small'if 1e-6<baseline<.025 else 'large-baseline'if baseline>=.025 else'zero-translation',lanes={})
    for lane in ('A','B'):
     ranked=sorted([(legacy.iou(d['box'],target['box']),j)for j,d in enumerate(row[lane]['tracks'])if legacy.family(d['label'])==target['classFamily']],reverse=True)
     match=ranked[0][1]if ranked and ranked[0][0]>=.35 and(len(ranked)==1 or ranked[0][0]-ranked[1][0]>=.08)else None
     track=None if match is None else row[lane]['tracks'][match]
     proof={}if track is None else row[lane]['diagnostics'].get('windowEvidence',{}).get(str(track['id']),{})
     reason=('current-detector-or-handle-criterion-failure'if track is None else
      'camera-veto:'+row['T_'+lane]['status']if row['T_'+lane]['status']!='valid'else
      proof.get('reason',row[lane]['diagnostics'].get('trackReasons',{}).get(str(track['id']),'no-window-proof')))
     entry['lanes'][lane]=dict(cameraStatus=row['T_'+lane]['status'],measurementStatus=row[lane]['status'],matched=track is not None,firstVeto=reason)
     first_veto[lane][reason]+=1
    positives.append(entry)
    if(row['token'],target['instance'])in concordant_target:concordant.append(entry)
  hist.append(row);prior_gray=gray;prior_row=row;allrows.append(row)
  if index%20==0:print(clip['id'],index,flush=True)
 for lane in ('A','B'):
  for k,v in local[lane].items():stats[lane][k]+=v
 clips.append(dict(id=clip['id'],lanes=local))
assert len(allrows)==100 and sum(directions.values())==r['actualModelDirections']==402
assert len(positives)==13 and len(concordant)==1
report=dict(schemaVersion=1,study='M3U-independent-verification',reviewRole='Independent source/code/geometry/score reviewer; not author of camera/study/data/review helper',
 receiptSha256=sha(RP),inputSha256=sha(IP),truthSha256=sha(TP),secondarySha256=sha(SEC),sourceFileCount=len(files),sourceFileHashes=files,
 actualCodeHashCount=len(r['codeSha256']),allActualCodeHashesCurrent=True,oldM3RCodeHashCount=len(old['codeSha256']),allOldM3RCodeHashesUnchanged=True,oldM3RScoreSha256=sha(oldpath),
 actualFrames=100,nativeGrayPixelHashesVerified=raw_checks,workingJpegGrayPixelHashesVerified=working_checks,
 candidateControlExposuresVerified=controls_checked,originalPixelPhotometricChecks=photo_checks,candidatePhotometryAndForegroundMasksReproduced=True,
 proofContractsValidated=100,validationScope='Frozen per-lane point/population/rival/source/clock/cost contracts plus candidate supplied-pose geometry, scale-veto and own epoch/status. Actual LK/RAFT/ML detection NOT repeated.',
 scoreMethod='Direct frozen legacy score_frame, not new M3U.score; radial labels mapped unchanged; .35IoU/.08margin; unreviewed/unknown separate.',
 totals=stats,clips=clips,cameraStatus=[dict(clip=k[0],lane=k[1],status=k[2],frames=v)for k,v in camera.items()],
 candidateModes=[dict(clip=k[0],lane=k[1],mode=k[2],frames=v)for k,v in modes.items()],
 actualRaftDirections=dict(directions),actualRaftDirectionsTotal=sum(directions.values()),firstPositiveVeto={k:dict(v)for k,v in first_veto.items()},
 posthocCityUnionDiagnostic=dict(pairs=union_diag['pairs'],rejected=union_diag['rejected'],rejectedUnionMeetsUnchangedFloors=union_diag['rejectedUnionMeetsFloors'],rejectedUnionStillFails=union_diag['rejectedUnionStillFails'],
  originalSeedCounts=sorted(set(union_diag['originalN'])),medianLkFraction=float(np.median(union_diag['lkFractions'])),medianPhotometricBackgroundFraction=float(np.median(union_diag['photoBackgroundFractions'])),
  authority='Posthoc arithmetic only, NOT an approved new camera method, acceptance, warning or TP. No rerun/source/threshold change.'),
 positiveOpportunityStrata=dict(Counter(v['immediatePoseOpportunity']for v in positives)),positiveCheckpoints=positives,oneConcordantCheckpoint=concordant,
 runtime=dict(actualWallMs=r['replayWallMs'],requestedOpenCvThreads=r['opencvThreadsRequested'],reportedOpenCvThreads=r['opencvThreadsReported'],timingControlled=False),
 scopedTestRerun=dict(passed=26,failed=0,seconds=.791,scope='Same26 authored M3U scenarios independently rerun, not26 additional empirical cases'),
 blindReview=dict(primarySheetsViewed=10,all51CandidatesAccounted=True,nativeAmbiguityCropsViewed=4,secondaryAssignedUnits=[7,8,9,10,11,12,13],secondaryAssignedPanelsViewed=21,
 secondaryDecisionPath='docs/evidence/tip65/m3u-secondary-reviewer-decisions.json',secondaryDecisionSha256=sha(ROOT/'docs/evidence/tip65/m3u-secondary-reviewer-decisions.json'),modelOutputsSeenDuringAnnotation=False),
 limits=['All13 primary positives may be outside the small-baseline opportunity stratum; do not generalize absence of recall gain to all pixel-impact geometry.',
 'Camera availability on negative-only stopped clip is not positive recall evidence. Primary radial targets differ from optical expansion; single concordant checkpoint separately traced, not substitute benchmark.',
 'B camera is stricter and conditional on static-background/calibration/pose assumptions, with no metadata covariance certification.',
 'Frozen numeric verification emitted a nonfatal NumPy RuntimeWarning: invalid value encountered in det; all100 contracts passed. No source/receipt was repaired to suppress it.',
 'No model rerun, threshold/label/source edits, object metres, iPhone, runtime deployment or safety certification.'],
 disposition='NOT READY to promote candidate or claim user-outcome improvement if recall remains unchanged; preserve regressions and abstentions honestly.')
out=ROOT/'docs/evidence/tip65/m3u-independent-verification.json';out.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
print(json.dumps(dict(output=str(out),totals=stats,opportunities=report['positiveOpportunityStrata'],veto=report['firstPositiveVeto'],concordant=concordant,directions=dict(directions),controls=controls_checked,photometricChecks=photo_checks),indent=2))
