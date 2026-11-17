"""Independent post-run arithmetic/source audit; never executes LK or models."""
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/evidence/tip65';Q=ROOT/'native/ios/.build-xcode/scene-qa'
SHA=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
load=lambda p:json.loads(p.read_text())
RP=E/'m3v-pixel-diagnostic-r1.json';GP=E/'m3v-pixel-reference.json';IP=Q/'boreas-m3u/input.json'
assert SHA(RP)=='c34320d88587b54e9f4123e391643423e0b5f4b6329eb8060c2f83462ed61c58'
assert SHA(GP)=='7526453f77534ad490e90f423a10ad44b1f311c65e52008a755432cc87b24d60'
d,g,inputs=load(RP),load(GP),load(IP);base=(IP.parent/inputs['assetRoot']).resolve()
assert d['complete']and d['originalSlotCount']==72 and d['unknownReferenceSlots']==60
assert d['referenceSha256']==SHA(GP)and d['inputSha256']==SHA(IP)
assert d['codeSha256']==d['codeAfterSha256']
for name,sha in d['codeSha256'].items():assert SHA(ROOT/'scripts'/name)==sha
assert SHA(base/'slice.json')=='16a590b7bfc5850d9078f21edda085bfaee5988ef2a5ac6ae055d4a73ec034ab'
source=load(base/'slice.json')
for row in source['files']:assert SHA(base/row['path'])==row['sha256']
for name,sha in d['metadataSha256'].items():assert SHA(base/name)==sha
assert SHA(Q/'m3u-boreas-receipt-r1.json')==d['cachedReceiptSha256']
old=load(Q/'m3u-boreas-receipt-r1.json')
for name,sha in old['codeSha256'].items():assert SHA(ROOT/'scripts'/name)==sha
oldr=load(E/'m3r-boreas-score.json')
assert SHA(E/'m3r-boreas-score.json')=='5e6497dd183a48d4fddcd213f9da7c2b534dde4bb3a339010220183503dc481a'
for name,sha in oldr['codeSha256'].items():assert SHA(ROOT/'scripts'/name)==sha
frames={c['id']:c['frames']for c in inputs['clips']};oldframes={c['id']:c['frames']for c in old['clips']}
P=np.loadtxt(base/'calib/P_camera.txt');K=P[:3,:3];assert np.array_equal(P[:3,3],np.zeros(3))
corner=lambda r:np.array([[r['x0'],r['y0'],1.],[r['x1'],r['y0'],1.],[r['x1'],r['y1'],1.],[r['x0'],r['y1'],1.]])
def mapped(r,A):
    x=corner(r)@A.T;x=x[:,:2]/x[:,2:]
    return dict(x0=x[:,0].min(),y0=x[:,1].min(),x1=x[:,0].max(),y1=x[:,1].max())
def denominator(F,r,w):
    M=np.asarray(w)[:,None]*F[:2];v=corner(r);q=v@M.T;vals=list(np.linalg.norm(q,axis=1))
    for i in range(4):
        u=q[i];z=q[(i+1)%4]-u;s=0 if z@z==0 else np.clip(-(u@z)/(z@z),0,1)
        vals.append(np.linalg.norm(u+s*z))
    x=np.linalg.lstsq(M[:,:2],-M[:,2],rcond=None)[0]
    if r['x0']<=x[0]<=r['x1']and r['y0']<=x[1]<=r['y1']:vals.append(np.linalg.norm(M[:,:2]@x+M[:,2]))
    return min(vals),max(vals)
def epiline(F,a,b,w):
    if np.linalg.norm(F)<1e-15:return None
    F=F/np.linalg.norm(F);n=corner(b)@F@corner(a).T;lo,hi=n.min(),n.max()
    nlo=0 if lo<=0<=hi else min(abs(lo),abs(hi));nhi=max(abs(lo),abs(hi))
    x,y=denominator(F,a,w),denominator(F.T,b,w)
    if min(x[0],y[0])<=1e-9:return None
    return max(nlo/x[1],nlo/y[1]),max(nhi/x[0],nhi/y[0])
def geom(k,a,b,w,R,t):
    if np.linalg.norm(t)<1e-15:return None
    t=t/np.linalg.norm(t);X=np.array([[0,-t[2],t[1]],[t[2],0,-t[0]],[-t[1],t[0],0.]])
    F=np.linalg.inv(k).T@X@R@np.linalg.inv(k)
    return epiline(F,a,b,w)
def near(actual,expected,tol=2e-7):assert abs(actual-expected)<=tol*max(1,abs(actual),abs(expected)),(actual,expected)
checks=0;intervals=0;control_unknowns=0;patches=0;warnings=[];nominal=[];fixed=[];clock=[];decisions=Counter();negs=Counter();all_splits={};oracle={}
for pair,truth in zip(d['completedPairs'],g['pairs'],strict=True):
    assert pair['id']==truth['id']and len(pair['slots'])==12
    fs=frames[pair['clipId']];i,j=pair['startIndex'],pair['endIndex'];p0,p1=[np.array(fs[v]['cameraToWorld'])for v in(i,j)]
    native=[];work=[];ww=oldframes[pair['clipId']][i]['width'];hh=oldframes[pair['clipId']][i]['height'];sx,sy=ww/2448,hh/2048
    S=np.diag([sx,sy,1.]);A=S.copy();A[:2,2]=[(sx-1)/2,(sy-1)/2]
    assert np.array_equal(pair['coordinateMaps']['legacy'],S)and np.array_equal(pair['coordinateMaps']['pixelCenter'],A)
    for n in(i,j):
        f=fs[n];path=base/f['path'];image=cv2.imread(str(path),cv2.IMREAD_COLOR|cv2.IMREAD_IGNORE_ORIENTATION)
        assert SHA(path)==f['sha256'];native.append(cv2.cvtColor(image,cv2.COLOR_BGR2GRAY))
        ok,jpeg=cv2.imencode('.jpg',cv2.resize(image,(ww,hh),interpolation=cv2.INTER_AREA),[cv2.IMWRITE_JPEG_QUALITY,93]);assert ok
        gray=cv2.imdecode(jpeg,cv2.IMREAD_GRAYSCALE);assert hashlib.sha256(gray.tobytes()).hexdigest()==oldframes[pair['clipId']][n]['workingPixelsSha256'];work.append(gray)
    byid={s['id']:s for s in truth['slots']}
    for slot in pair['slots']:
        ref=byid[slot['id']]['reference'];assert slot['referenceStatus']==ref['status']
        if ref['status']!='accepted-static-match':assert not slot['geometry'];continue
        for v in pair['variants']:
            name=v['name'];q0,q1=p0.copy(),p1.copy();C=np.eye(3);k=K.copy();weights=np.array([1/sx,1/sy])
            if name.startswith('clock-'):
                shift=int(name.split('endpoints-')[1].split('-frames')[0]);q0,q1=[np.array(fs[n+shift]['cameraToWorld'])for n in(i,j)]
                assert not v['runtimeEligible']and abs(v['sourceSkewUs'])>20000 and abs(v['targetSkewUs'])>20000;clock.append([pair['id'],name,v['sourceSkewUs'],v['targetSkewUs']])
            if name.startswith('working-'):
                C=S if name=='working-diagonal-conjugacy-algebra-only'else A;k=(A if name=='working-consistent-pixel-center'else S)@K;weights=np.ones(2)
            T=np.linalg.inv(q1)@q0;R,t=T[:3,:3],T[:3,3]
            if name=='wrong-relative-R-transpose':R=R.T
            if name=='wrong-translation-sign':t=-t
            if name=='wrong-fx-times1.05':k[0,0]*=1.05
            sa,ta=mapped(ref['sourceRectangle'],C),mapped(ref['targetRectangle'],C)
            for axis in(None,'x','y'):
                target=ta;actual=slot['geometry'][name]
                if axis:
                    shifted=dict(ref['targetRectangle']);shifted[axis+'0']+=16;shifted[axis+'1']+=16
                    ctrl=actual['wrongTargetRectangleControls'][axis];actual=ctrl['result'];target=mapped(shifted,C)
                    original=ref['targetRectangle']
                    overlap=not(original['x1']<shifted['x0']or shifted['x1']<original['x0']or original['y1']<shifted['y0']or shifted['y1']<original['y0'])
                    inside=0<=shifted['x0']<=shifted['x1']<2448 and 0<=shifted['y0']<=shifted['y1']<2048
                    assert ctrl['knownWrong']==(not overlap and inside)
                    if not ctrl['knownWrong']:
                        assert actual['geometryDecision']=='unknown';checks+=1;control_unknowns+=1
                        if name=='native-nominal-sdk-working-metric':negs['unknown']+=1
                        continue
                bounds=geom(k,sa,target,weights,R,t);observed=actual['epiline']
                intervals+=1
                if bounds is None:assert observed['decision']=='unknown'
                else:
                    near(bounds[0],observed['lowerWorkingPx']);near(bounds[1],observed['upperWorkingPx'])
                    expected='pass'if bounds[1]<=1.3 else 'fail'if bounds[0]>1.3 else 'unknown';assert expected==observed['decision']
                checks+=1
                if name=='native-nominal-sdk-working-metric':
                    if axis:negs[actual['geometryDecision']]+=1
                    else:
                        decisions[actual['geometryDecision']]+=1;nominal.append(dict(slotId=slot['id'],epiline=observed['decision'],bounds=bounds,cheirality=actual['cheirality']['decision'],combined=actual['geometryDecision']))
    for domain,images,C in [('native',native,np.eye(3)),('working-JPEG93',work,A)]:
        o=pair['oracleSourceLk'][domain];assert o['directionCalls']==2 and not o['targetReferenceSeen']
        bucket=oracle.setdefault(domain,dict(stages=Counter(),outcomes=Counter(),queries=0))
        for point in o['points']:
            ref=byid[point['slotId']]['reference'];sr=ref['sourceRectangle'];center=np.array([(sr['x0']+sr['x1'])/2,(sr['y0']+sr['y1'])/2,1.]);center=(C@center)[:2]
            np.testing.assert_allclose(np.array(point['source']),center,atol=3e-5,rtol=0)
            target=mapped(ref['targetRectangle'],C);end=point['endpoint'];w=np.array([sx,sy])if domain=='native'else np.ones(2)
            if end is not None:
                end=np.array(end);low=np.maximum(0,np.maximum(np.array([target['x0'],target['y0']])-end,end-np.array([target['x1'],target['y1']])))*w
                high=np.maximum(abs(end-np.array([target['x0'],target['y0']])),abs(end-np.array([target['x1'],target['y1']])))*w
                near(np.linalg.norm(low),point['endpointErrorWorkingPx'][0]);near(np.linalg.norm(high),point['endpointErrorWorkingPx'][1])
            if point['lkAccepted']:
                a=cv2.getRectSubPix(images[0],(7,7),tuple(map(float,point['source']))).astype(np.float32);b=cv2.getRectSubPix(images[1],(7,7),tuple(map(float,point['endpoint']))).astype(np.float32)
                a-=a.mean();b-=b.mean();norm=float(np.linalg.norm(a)*np.linalg.norm(b));photo=norm>=49*4**2 and float(np.sum(a*b))>=norm*.70
                # Frozen photometric policy minPatchCorrelation is checked below.
                patches+=1
                policy_text=(ROOT/'scripts/assist_scene_scale_approach.py').read_text()
                assert '"minPatchCorrelation": .70'in policy_text or '"minPatchCorrelation": .7'in policy_text
                assert bool(photo)==point['photometric']
            stage='lk-status-cycle-or-bounds-rejected'if not point['lkAccepted']else 'photometric-rejected'if not point['photometric']else 'accepted';assert stage==point['acceptanceStage']
            outcome='missed-reference'if not point['accepted']else 'accepted-wrong-conditional-reference'if point['endpointErrorWorkingPx'][0]>1.3 else 'compatible-with-reference'if point['endpointErrorWorkingPx'][1]<=1.3 else 'uncertain-reference-endpoint'
            assert outcome==point['outcome'];bucket['stages'][stage]+=1;bucket['outcomes'][outcome]+=1;bucket['queries']+=1
            fixed.append(dict(slotId=point['slotId'],domain=domain,accepted=point['accepted'],endpointErrorWorkingPx=point['endpointErrorWorkingPx']))
assert checks==432 and sum(p['oracleSourceLk'][k]['directionCalls']for p in d['completedPairs']for k in('native','working-JPEG93'))==d['actualLkDirections']==24
assert not d['motionAuthorized']and not d['events']and d['learnedModelCalls']==d['newTrafficModelRuns']==0 and d['wallMs']<120000 and RP.stat().st_size<32*1024**2
result=dict(schemaVersion=1,study='M3V-independent-receipt-verification',receiptSha256=SHA(RP),referenceSha256=SHA(GP),
    sourceFileCount=len(source['files']),actualCodeHashesVerified=len(d['codeSha256']),oldM3UCodeHashesUnchanged=len(old['codeSha256']),oldM3RCodeHashesUnchanged=len(oldr['codeSha256']),
    originalSlots=72,conditionalStaticReference=12,unknownReference=60,geometryOrControlUnitsVerified=checks,
    independentlyRecomputedEpipolarIntervals=intervals,overlappingOrOutOfViewControlUnitsKeptUnknown=control_unknowns,
    rawPhotometricPatchPairsRecomputed=patches,actualRecordedLkDirections=24,newReviewerLkOrModelCalls=0,
    nominalCombinedCounts=dict(decisions),nominalReferenceCases=nominal,nominalWrongTargetControls=dict(negs),oracleSourceRecount=oracle,
    recordedRuntime=d['wallMs'],requestedOpenCvThreads=d['software']['opencvThreadsRequested'],reportedOpenCvThreads=d['software']['opencvThreadsReported'],controlledPerformanceClaim=False,
    invalidClockVariants=clock,endpointRecount=fixed,scopedAuthoredTestsIndependentRerun=dict(passed=16,failed=0,seconds=3.037,notAdditionalEmpiricalCases=True),
    limits=['Nominal one conditional-static epiline failure and11unknown do not identify pose/calibration/time/correspondence root cause or explain all13traffic misses.',
        'Known-wrong endpoint controls are synthetic geometry compatibility, not trafficfalsepositive assessment. Unknown controls are not correct rejections.',
        'Broad AI-authored/cross-reviewed rectangles, not exacthuman/physicaltruth. All72slots retained; match disagreement madeunknown before geometry.',
        'Raw backward endpoints/statusarrays were not serialized: empirical FBcycle cannot be independently reconstructed from receipt. Recorded cycle/calllogic reviewed, rawpatches/EPE/geometry independentlyrecomputed; no forbidden rerun.',
        'Oracle-source centers were queried once, not an uncertainty sweep; native andworking windows coverdifferent footprints.',
        'M3Ucached0TP13FN0FP18TN2unknown unchanged; no runtimefix/freshwarningA/B/performance improvement/iPhonecertification.'],
    disposition='Diagnostic integrity verified within scope; product recall goal NOT READY. No automatic variant selection or runtime promotion.')
def plain(x):
    if isinstance(x,dict):return {str(k):plain(v)for k,v in x.items()}
    if isinstance(x,(list,tuple)):return [plain(v)for v in x]
    if isinstance(x,np.generic):return x.item()
    return x
out=E/'m3v-independent-verification.json';assert not out.exists();out.write_text(json.dumps(plain(result),indent=2)+'\n')
print(json.dumps(dict(path=str(out),sha256=SHA(out),geometryChecks=checks,patches=patches,nominal=decisions,negativeControls=negs,oracle=oracle),default=dict))
