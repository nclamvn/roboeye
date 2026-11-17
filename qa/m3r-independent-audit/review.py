"""Independent source-pixel/physical-ID audit. No inference or scoring changes."""
from pathlib import Path
from hashlib import sha256
import json, math, sys
import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
RECEIPT=ROOT/'native/ios/.build-xcode/scene-qa/m3r-boreas-receipt-r1.json'
INPUT=ROOT/'native/ios/.build-xcode/scene-qa/boreas-m3r/input.json'
r=json.loads(RECEIPT.read_text()); inp=json.loads(INPUT.read_text())
asset=(INPUT.parent/inp['assetRoot']).resolve()
source={f['token']:f for c in inp['clips']for f in c['frames']}
rows={f['token']:f for c in r['clips']for f in c['frames']}
clips={c['id']:c for c in r['clips']}
inventory=[]; warnings=[]
for c in r['clips']:
 for f in c['frames']:
  emitted={str(e['trackId'])for e in f['B']['events']}
  for ident,p in f['B']['diagnostics']['windowEvidence'].items():
   for role in ('anchor','fresh'):
    a=p.get(role)
    if a and a['supported']:
     case=dict(clip=c['id'],token=f['token'],identity=ident,role=role,index=f['index'])
     (warnings if ident in emitted else inventory).append(case)
key=lambda a:(a['clip'],a['token'],a['identity'],a['role'])
selected=sorted(inventory,key=key)[:50]
images={}; patches={}; checked_sources={}; results=[]
def read(token):
 if token not in images:
  meta=source[token]; path=asset/meta['path']; data=path.read_bytes()
  assert sha256(data).hexdigest()==meta['sha256']==rows[token]['sourceSha256']
  bgr=cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_COLOR|cv2.IMREAD_IGNORE_ORIENTATION)
  gray=cv2.cvtColor(bgr,cv2.COLOR_BGR2GRAY)
  assert sha256(gray.tobytes()).hexdigest()==rows[token]['nativeGraySha256']
  images[token]=(bgr,gray);checked_sources[token]=meta['sha256']
 return images[token]
def patch(token,index):
 k=(token,index)
 if k not in patches:
  f=rows[token];o=f['B']['diagnostics']['identityObservation']; t=o['tracks'][index]
  bgr,raw=read(token); h,w=f['height'],f['width']; sy,sx=raw.shape[0]/h,raw.shape[1]/w
  assert o['nativeDetail'] is True
  rect=np.asarray(t['xyxy'])*np.asarray([sx,sy,sx,sy]); size=rect[2:]-rect[:2]
  lo=np.maximum(0,np.ceil(rect[:2]+.12*size)).astype(int)
  hi=np.minimum(raw.shape[::-1],np.floor(rect[2:]-.12*size)).astype(int)
  p=cv2.resize(raw[lo[1]:hi[1],lo[0]:hi[0]],(32,32),interpolation=cv2.INTER_AREA).astype(np.float32)
  std=float(np.std(p)); p=cv2.GaussianBlur(p,(3,3),.8);p-=np.mean(p);p/=np.linalg.norm(p)
  a=o['patches'][index]
  assert a['valid'] and std>=3 and abs(std-a['sourceStd'])<1e-8
  assert a['roi']==[*lo.tolist(),*hi.tolist()]
  assert sha256(p.tobytes()).hexdigest()==a['sha256']
  assert np.array_equal(p,np.asarray(a['values'],np.float32).reshape(32,32))
  patches[k]=(p,rect)
 return patches[k]
def canonical(x):return sha256(json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def panel(token,index,title):
 bgr,_=read(token);_,rect=patch(token,index)
 x,y,z,b=rect;padx=max((z-x)*.55,25);pady=max((b-y)*.45,25)
 a=np.maximum([0,0],np.floor([x-padx,y-pady])).astype(int)
 e=np.minimum(bgr.shape[1::-1],np.ceil([z+padx,b+pady])).astype(int)
 crop=bgr[a[1]:e[1],a[0]:e[0]].copy()
 cv2.rectangle(crop,tuple(np.round([x,y]-a).astype(int)),tuple(np.round([z,b]-a).astype(int)),(0,230,255),2)
 target=np.zeros((250,320,3),np.uint8); rh=min(320/crop.shape[1],215/crop.shape[0]);ss=(round(crop.shape[1]*rh),round(crop.shape[0]*rh))
 small=cv2.resize(crop,ss,interpolation=cv2.INTER_AREA);target[35:35+ss[1],:ss[0]]=small
 cv2.putText(target,title,(7,20),cv2.FONT_HERSHEY_SIMPLEX,.46,(255,255,255),1,cv2.LINE_AA)
 return target
for num,c in enumerate(sorted(warnings,key=key)+selected):
 f=rows[c['token']]; part=f['B']['diagnostics']['windowEvidence'][c['identity']][c['role']]
 chain=part['identityChain']; tokens=chain['exposureTokens']; inds=[]
 for token in tokens:
  tracks=rows[token]['B']['diagnostics']['identityObservation']['tracks']
  hits=[i for i,t in enumerate(tracks)if str(t['id'])==c['identity']];assert len(hits)==1;inds.append(hits[0])
 edges=[]
 for k in range(1,len(tokens)):
  t0,t1=tokens[k-1:k+1];i,j=inds[k-1:k+1]
  p0,_=patch(t0,i);p1,_=patch(t1,j);corr=float(np.clip(np.sum(p0*p1),-1,1))
  tr=rows[t1]['B']['diagnostics']['identityTransition'];link=next(a for a in tr['links']if a['currentIndex']==j)
  assert link['supported'] and link['previousIndex']==i and abs(corr-link['correlation'])<1e-8 and corr>=.70
  proof=chain['links'][k-1];assert canonical(tr)==proof['transitionSha256'] and canonical(link)==proof['linkSha256']
  # Independently reconstruct full same-label camera-rotated box competition.
  old=rows[t0]['B']['diagnostics']['identityObservation']; new=rows[t1]['B']['diagnostics']['identityObservation']
  K=np.asarray(new['intrinsics']);H=K@(np.asarray(new['cameraToWorld'])[:3,:3].T@np.asarray(old['cameraToWorld'])[:3,:3])@np.linalg.inv(K)
  matrix=[];eligible=[]
  for oi,a in enumerate(old['tracks']):
   x,y,z,b=a['xyxy']; pts=np.asarray([[x,y,1],[z,y,1],[z,b,1],[x,b,1]]);q=pts@H.T;q=q[:,:2]/q[:,2:];wr=np.r_[q.min(0),q.max(0)]; rr=[]
   for nj,v in enumerate(new['tracks']):
    if a['label']!=v['label']:val=None
    else:
     bb=np.asarray(v['xyxy']);inter=np.maximum(0,np.minimum(wr[2:],bb[2:])-np.maximum(wr[:2],bb[:2]));area=float(np.prod(inter));val=area/(np.prod(wr[2:]-wr[:2])+np.prod(bb[2:]-bb[:2])-area)
    rr.append(val)
    if val is not None and val>=.25:eligible.append((val,oi,nj))
   matrix.append(rr)
  assert all((a is None and b is None)or a is not None and b is not None and abs(a-b)<1e-12 for aa,bb in zip(matrix,tr['geometryMatrix'])for a,b in zip(aa,bb))
  row=sorted([e for e in eligible if e[2]==j],reverse=True);col=sorted([e for e in eligible if e[1]==i],reverse=True)
  assert row[0][1]==i and col[0][2]==j
  assert (len(row)==1 or row[0][0]-row[1][0]>=.12)and(len(col)==1 or col[0][0]-col[1][0]>=.12)
  edges.append(dict(start=t0,end=t1,startIndex=i,endIndex=j,ncc=corr,sourcePixelsVerified=True,fullGeometryMatrixVerified=True))
 ps=part['measurementPair'];pair=next(p for p in f['A']['diagnostics']['comparisons']if all(p[k]==ps[k]for k in ('fieldId','startToken','endToken','startDetectionIndex','endDetectionIndex')))
 assert canonical(pair)==ps['pairSha256'] and pair['supported']
 name=f"{num:02d}-{c['clip']}-{c['index']:02d}-id{c['identity']}-{c['role']}.jpg"
 panels=[panel(t,i,f"frame {rows[t]['index']} id {c['identity']} det {i}")for t,i in zip(tokens,inds)]
 cols=min(5,len(panels));height=math.ceil(len(panels)/cols)*250
 sheet=np.zeros((height,cols*320,3),np.uint8)
 for k,p in enumerate(panels):sheet[(k//cols)*250:(k//cols+1)*250,(k%cols)*320:(k%cols+1)*320]=p
 assert cv2.imwrite(str(OUT/name),sheet)
 results.append(dict(**c,warning= c in warnings,sourceIndices=inds,edges=edges,sheet=name,sheetSha256=sha256((OUT/name).read_bytes()).hexdigest(),measurementPairSha256=canonical(pair),physicalIdentityReview='PENDING'))
report=dict(study='M3R',receiptSha256=sha256(RECEIPT.read_bytes()).hexdigest(),inputSha256=sha256(INPUT.read_bytes()).hexdigest(),warningsRoles=len(warnings),nonwarningEligibleRoles=len(inventory),nonwarningReviewedRoles=len(selected),nonwarningUnreviewedRoles=len(inventory)-len(selected),selectionRule='First50 lexical (clipId,frameToken,identityId as string,role), supported fresh/anchor measurement association roles excluding emitted warning identities',inventory=sorted(inventory,key=key),checkedSources=checked_sources,checkedPatches=len(patches),cases=results,limits='Independent source PNG/nativeGray hashes, exact32patch values/NCC and full camera-rotated same-label matrix reconstructed. Physical-ID visual review pending; no physical motion inferred from stills; no models, no scoring/GT/source changes.')
(OUT/'numeric-and-contact-sheet-audit.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items()if k not in ('inventory','cases','checkedSources')},indent=2))
