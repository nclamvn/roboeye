#!/usr/bin/env python3
"""Source-only pixel reference proposals and explicit manual gold binding.

No optical flow, model, pose prediction or automatic patch matching is used.
Annotations are AI-authored/cross-reviewed uncertainty rectangles, not exact
physical groundtruth. Keep every one of the72 fixed slots, including unknown.
"""
import argparse
from collections import Counter
from hashlib import sha256
import json
import math
from pathlib import Path
import shutil
from time import perf_counter

import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageFont

PAIRS=(('boreas-m3u-city',13,14),('boreas-m3u-city',21,22),('boreas-m3u-city',29,30),
       ('boreas-m3u-city',37,38),('boreas-m3u-city',45,46),('boreas-m3u-turn',21,22))
MAX_BYTES=48*1024**2
POLICY=dict(sourceSelector='native source-only GFTT strongest qualifying corner per4x3cell',
    maxCorners=0,qualityLevel=.012,minDistance=4,blockSize=3,useHarrisDetector=False,
    columns=4,rows=3,slotsPerPair=12,pairs=6,slots=72,contextRadius=120,detailRadius=40,
    sourceDetailDisplayScale=3,analysisParity=0,holdoutParity=1,noBackfill=True,
    targetPixelReadBeforeSourceSeal=False,modelCalls=0,flowCalls=0,
    referenceKind='AI-authored independently cross-reviewed inclusive native pixel-center rectangles',
    manualSourceRefinement='same selected material corner only, never another convenient feature in the crop',
    nominalUncertaintyPixels=2,wideUncertaintyAllowed=True,fullCameraCertification=False)


def require(value,reason):
    if not value:raise ValueError(reason)


def digest(path):return sha256(path.read_bytes()).hexdigest()


def write_new(path,value):
    with path.open('x')as stream:json.dump(value,stream,indent=2,allow_nan=False);stream.write('\n')


def bytes_under(path):return sum(p.stat().st_size for p in path.rglob('*')if p.is_file())


def read_rgb(path,expected):
    require(digest(path)==expected,'Source pixel hash mismatch')
    with Image.open(path)as image:
        require(image.size==(2448,2048)and image.mode=='RGB'and image.getexif().get(274,1)==1,'Unexpected native source geometry/EXIF')
        return image.copy()


def choose_source(gray):
    """A source-only detector; no endpoint, target image or pose parameter."""
    require(gray.dtype==np.uint8 and gray.shape==(2048,2448),'Wrong native selector image')
    points=cv2.goodFeaturesToTrack(gray,maxCorners=0,qualityLevel=.012,minDistance=4,
        blockSize=3,useHarrisDetector=False)
    points=np.empty((0,2),np.float32)if points is None else points[:,0]
    require(len(points)<=300000,'Source corner inventory exceeds bound')
    texture=cv2.cornerMinEigenVal(gray,blockSize=3,ksize=3)
    ranked=sorted(((float(texture[round(y),round(x)]),float(x),float(y))for x,y in points),key=lambda p:(-p[0],p[2],p[1]))
    chosen={}
    for score,x,y in ranked:
        cell=(min(3,int(x*4/2448)),min(2,int(y*3/2048)))
        chosen.setdefault(cell,([x,y],score))
    return [dict(cell=[column,row],sourceCandidate=chosen.get((column,row),(None,None))[0],
        sourceTextureScore=chosen.get((column,row),(None,None))[1],
        split='analysis'if(column+row)%2==0 else'holdout')for row in range(3)for column in range(4)],len(points)


def native_rect(candidate,radius):
    x,y=(round(v)for v in candidate)
    return [x-radius,y-radius,x+radius+1,y+radius+1]


def _grid(draw,rect,offset,scale,step):
    x0,y0,x1,y1=rect;ox,oy=offset
    # Thin coordinate grid is presentation only; lossless unmarked crop stays
    # separate and is the authoritative visual material for precise matching.
    for x in range(math.ceil(x0/step)*step,x1,step):
        xx=ox+(x-x0)*scale;draw.line((xx,oy,xx,oy+(y1-y0)*scale-1),fill=(80,100,104))
        draw.text((xx+2,oy+2),str(x),fill=(255,230,140))
    for y in range(math.ceil(y0/step)*step,y1,step):
        yy=oy+(y-y0)*scale;draw.line((ox,yy,ox+(x1-x0)*scale-1,yy),fill=(80,100,104))
        draw.text((ox+2,yy+2),str(y),fill=(255,230,140))


def render_pair(image,pair,phase,out):
    panels=[];sheets=[]
    for group in range(4):
        sheet=Image.new('RGB',(1020,660),(15,23,27));draw=ImageDraw.Draw(sheet)
        draw.text((12,10),f"{pair['id']} {phase.upper()} | native pixel centers; SOURCE center only, not predicted target",fill='white')
        sheet_panels=[]
        for column,slot in enumerate(pair['slots'][group*3:group*3+3]):
            left=column*340+16;candidate=slot['sourceCandidate']
            draw.text((left,38),f"{slot['id']} {slot['split']} cell{slot['cell']}",fill=(160,240,220))
            if candidate is None:
                draw.text((left,82),'EMPTY SOURCE CELL: UNKNOWN',fill=(255,190,110));continue
            context=native_rect(candidate,120);detail=native_rect(candidate,40)
            crop=image.crop(tuple(context));rawpath=out/f"{slot['id']}-{phase}-raw.png";crop.save(rawpath,compress_level=3)
            sheet.paste(crop,(left,74));zoom=image.crop(tuple(detail)).resize((243,243),Image.Resampling.NEAREST);sheet.paste(zoom,(left,366))
            _grid(draw,context,(left,74),1,40);_grid(draw,detail,(left,366),3,10)
            draw.text((left,320),f"context native{context} scale1",fill='white')
            draw.text((left,344),f"detail native{detail} scale3 nearest",fill='white')
            valid=[max(0,context[0]),max(0,context[1]),min(image.width,context[2]),min(image.height,context[3])]
            rec=dict(slotId=slot['id'],phase=phase,rawContextPath=rawpath.name,rawContextSha256=digest(rawpath),
                contextNativeRect=context,validContextNativeRect=valid,detailNativeRect=detail,
                contextDisplayOffset=[left,74],contextDisplayScale=1,detailDisplayOffset=[left,366],detailDisplayScale=3,
                sourceCenterOnly=candidate,noEndpointPrediction=True)
            panels.append(rec);sheet_panels.append(slot['id'])
        path=out/f"{pair['id']}-{phase}-{group}.png";sheet.save(path,compress_level=3)
        sheets.append(dict(path=path.name,sha256=digest(path),slotIds=sheet_panels,size=list(sheet.size)))
        require(bytes_under(out)<=MAX_BYTES,'Reference asset byte budget exceeded')
    return panels,sheets


def source_plan(input_path,out):
    require(not out.exists()and not out.is_symlink(),'New source proposal directory required')
    require(shutil.disk_usage(out.parent).free>=10*1024**3,'Disk floor10GiB')
    code=digest(Path(__file__));inp=json.loads(input_path.read_text());root=(input_path.parent/inp['assetRoot']).resolve(strict=True)
    clips={c['id']:c for c in inp['clips']};out.mkdir();pairs=[];calls=0;started=perf_counter();cv2.setNumThreads(1)
    for index,(clip,start,end)in enumerate(PAIRS):
        a,b=(clips[clip]['frames'][i]for i in(start,end))
        image=read_rgb(root/a['path'],a['sha256'])
        gray=cv2.cvtColor(np.asarray(image),cv2.COLOR_RGB2GRAY);selected,count=choose_source(gray);calls+=1
        pair=dict(id=f'pair{index}',clipId=clip,startIndex=start,endIndex=end,sourceToken=a['token'],targetToken=b['token'],
            sourcePath=a['path'],targetPath=b['path'],sourceSha256=a['sha256'],targetSha256=b['sha256'],
            sourceTimestampUs=a['timestampUs'],targetTimestampUs=b['timestampUs'],nativeWidth=2448,nativeHeight=2048,
            sourceGraySha256=sha256(gray.tobytes()).hexdigest(),sourceGfttPopulation=count,
            slots=[dict(id=f'pair{index}-cell{i:02d}',**slot)for i,slot in enumerate(selected)])
        pair['sourcePanels'],pair['sourceSheets']=render_pair(image,pair,'source',out);pairs.append(pair)
    require(digest(Path(__file__))==code,'Reference implementation changed during source-only selection')
    result=dict(schemaVersion=1,study='M3V-source-only-selection',inputSha256=digest(input_path),sourceRoot=str(root),
        codeSha256=code,policy=POLICY,pairs=pairs,slotCount=72,sourceOnly=True,targetPixelReads=0,
        sourceGfttCalls=calls,modelCalls=0,flowCalls=0,elapsedSeconds=perf_counter()-started,
        nativeRectangleSemantics='inclusive pixel-center annotations; crop rectangles use Python exclusive x1/y1',
        limits='Failure-selected posthoc M3U pairs, not fresh test clips. Source proposals are not gold; no replacement after target view.')
    write_new(out/'source-selection.json',result);require(bytes_under(out)<=MAX_BYTES,'Reference asset byte budget exceeded')
    print(json.dumps(dict(sourceSelection=str(out/'source-selection.json'),sha256=digest(out/'source-selection.json'),slots=72,targetPixelReads=0,sourceGfttCalls=calls,bytes=bytes_under(out))))
    return result


def validate_source(selection_path,expected,input_path):
    require(digest(selection_path)==expected,'Source-only selection seal mismatch')
    p=json.loads(selection_path.read_text())
    require(p['inputSha256']==digest(input_path)and p['codeSha256']==digest(Path(__file__))and p['policy']==POLICY,'Source/input/implementation/policy seal changed')
    require(p['sourceOnly']is True and p['targetPixelReads']==0 and p['slotCount']==72 and len(p['pairs'])==6,'Wrong source-only denominator')
    inp=json.loads(input_path.read_text());clips={c['id']:c for c in inp['clips']}
    for i,pair in enumerate(p['pairs']):
        require(pair['id']==f'pair{i}'and(pair['clipId'],pair['startIndex'],pair['endIndex'])==PAIRS[i]
            and len(pair['slots'])==12,'Fixed source pair changed')
        source,target=(clips[pair['clipId']]['frames'][j]for j in(pair['startIndex'],pair['endIndex']))
        for phase,frame in(('source',source),('target',target)):
            require(all(pair[phase+key]==frame[field]for key,field in(('Token','token'),('Path','path'),('Sha256','sha256'),('TimestampUs','timestampUs'))),'Source/target exposure metadata changed')
        for j,s in enumerate(pair['slots']):
            col,row=j%4,j//4
            require(s['id']==f'pair{i}-cell{j:02d}'and s['cell']==[col,row]
                and s['split']==('analysis'if(col+row)%2==0 else'holdout'),'Source slot/cell/split changed')
        validate_assets(pair,pair['sourcePanels'],pair['sourceSheets'],'source',selection_path.parent)
    return p


def validate_assets(pair,panels,sheets,phase,root):
    expected={s['id']:s for s in pair['slots']if s['sourceCandidate']is not None}
    require(len(panels)==len(expected)and {p['slotId']for p in panels}==set(expected),'Missing/duplicate native crop inventory')
    require(len(sheets)==4 and [s['path']for s in sheets]==[f"{pair['id']}-{phase}-{g}.png"for g in range(4)],'Missing/reordered review sheets')
    for record in panels:
        slot=expected[record['slotId']];j=next(i for i,s in enumerate(pair['slots'])if s['id']==slot['id']);left=(j%3)*340+16
        context=native_rect(slot['sourceCandidate'],120);detail=native_rect(slot['sourceCandidate'],40)
        require(record['phase']==phase and record['rawContextPath']==f"{slot['id']}-{phase}-raw.png"
            and record['contextNativeRect']==context and record['detailNativeRect']==detail
            and record['sourceCenterOnly']==slot['sourceCandidate']and record['noEndpointPrediction']is True
            and record['contextDisplayOffset']==[left,74]and record['detailDisplayOffset']==[left,366]
            and record['contextDisplayScale']==1 and record['detailDisplayScale']==3,'Native crop/coordinate transform changed')
        path=root/record['rawContextPath'];require(digest(path)==record['rawContextSha256'],'Raw native crop changed')
        with Image.open(path)as image:require(image.size==(241,241)and image.mode=='RGB','Raw crop geometry changed')
    for group,record in enumerate(sheets):
        ids=[s['id']for s in pair['slots'][group*3:group*3+3]if s['sourceCandidate']is not None]
        require(record['slotIds']==ids and record['size']==[1020,660],'Review sheet slot geometry changed')
        path=root/record['path'];require(digest(path)==record['sha256'],'Review sheet changed')
        with Image.open(path)as image:require(image.size==(1020,660)and image.mode=='RGB','Review sheet image size changed')


def target_proposals(input_path,selection_path,expected,out):
    p=validate_source(selection_path,expected,input_path)
    require(not out.exists()and not out.is_symlink(),'New target proposal directory required')
    out.mkdir();root=Path(p['sourceRoot']);records=[];target_reads=0
    for pair in p['pairs']:
        image=read_rgb(root/pair['targetPath'],pair['targetSha256']);target_reads+=1
        panels,sheets=render_pair(image,pair,'target',out)
        records.append(dict(id=pair['id'],targetToken=pair['targetToken'],targetSha256=pair['targetSha256'],targetPath=pair['targetPath'],targetPanels=panels,targetSheets=sheets))
        require(bytes_under(out)+bytes_under(selection_path.parent)<=MAX_BYTES,'Combined source/target asset byte budget exceeded')
    result=dict(schemaVersion=1,study='M3V-target-proposals',inputSha256=p['inputSha256'],
        sourceSelectionSha256=expected,sourceSelectionPath=str(selection_path.resolve()),codeSha256=digest(Path(__file__)),
        policy=POLICY,pairs=records,slotCount=72,targetPixelReads=target_reads,modelCalls=0,flowCalls=0,
        limits='All targets centered at frozen SOURCE coordinates; no LK, RAFT or pose endpoint shown. Empty source slots retained unknown.')
    write_new(out/'target-proposals.json',result)
    require(bytes_under(out)+bytes_under(selection_path.parent)<=MAX_BYTES,'Combined source/target asset byte budget exceeded')
    print(json.dumps(dict(targetProposals=str(out/'target-proposals.json'),sha256=digest(out/'target-proposals.json'),targetPixelReads=target_reads,combinedBytes=bytes_under(out)+bytes_under(selection_path.parent))))
    return result


def rectangle(box,pair,context):
    require(set(box)=={'x0','y0','x1','y1'}and all(type(x)in(int,float)and math.isfinite(x)for x in box.values()),'Malformed manual native rectangle')
    x0,y0,x1,y1=(box[k]for k in('x0','y0','x1','y1'))
    require(0<=x0<=x1<pair['nativeWidth']and 0<=y0<=y1<pair['nativeHeight'],'Manual native rectangle out of image')
    require(x1-x0>=4 and y1-y0>=4,'Manual uncertainty smaller than nominal plus/minus2native pixels')
    require(context[0]<=x0<=x1<context[2]and context[1]<=y0<=y1<context[3],'Annotation escaped fixed context')
    return dict(box)


def bind(input_path,selection_path,selection_sha,target_path,target_sha,decisions_path,out):
    p=validate_source(selection_path,selection_sha,input_path)
    require(digest(target_path)==target_sha,'Target proposal seal mismatch');target=json.loads(target_path.read_text())
    require(target['sourceSelectionSha256']==selection_sha and target['inputSha256']==p['inputSha256']
        and target['codeSha256']==digest(Path(__file__))and target['policy']==POLICY
        and target['slotCount']==72 and target['targetPixelReads']==6,'Wrong target provenance')
    require(len(target['pairs'])==6 and [x['id']for x in target['pairs']]==[x['id']for x in p['pairs']],'Missing/reordered target pair inventory')
    for original,current in zip(p['pairs'],target['pairs'],strict=True):
        require(all(current[k]==original[k]for k in('targetToken','targetSha256','targetPath')),'Target source metadata changed')
        validate_assets(original,current['targetPanels'],current['targetSheets'],'target',target_path.parent)
    annotations=json.loads(decisions_path.read_text())
    require(annotations['sourceSelectionSha256']==selection_sha and annotations['targetProposalsSha256']==target_sha
        and annotations['inputSha256']==p['inputSha256'],'Unbound pixel annotation')
    require(set(annotations['slots'])=={s['id']for pair in p['pairs']for s in pair['slots']},'All72 slots need explicit decisions')
    pairs=[];counts=Counter()
    for pair in p['pairs']:
        slots=[]
        for slot in pair['slots']:
            ref=annotations['slots'][slot['id']];status=ref['status'];require(status in('accepted-static-match','unknown'),'Invalid pixel reference status')
            require(isinstance(ref.get('reason'),str)and ref['reason'].strip(),'Every manual reference needs an evidence/reason note')
            if status=='accepted-static-match':
                require(slot['sourceCandidate']is not None and ref.get('staticEvidence')and ref.get('materialIdentity')
                    and ref.get('sameSelectedFeature')is True,'No gold for empty/unstated-selected-static identity slot')
                context=native_rect(slot['sourceCandidate'],120)
                ref=dict(ref,sourceRectangle=rectangle(ref['sourceRectangle'],pair,context),targetRectangle=rectangle(ref['targetRectangle'],pair,context))
            counts[status]+=1;slots.append({**slot,'reference':ref})
        pairs.append({**{k:v for k,v in pair.items()if k not in('sourcePanels','sourceSheets')},'slots':slots})
    result=dict(schemaVersion=1,study='M3V-pixel-reference',inputSha256=p['inputSha256'],sourceSelectionSha256=selection_sha,
        targetProposalsSha256=target_sha,annotationsSha256=digest(decisions_path),codeSha256=digest(Path(__file__)),
        policy=POLICY,pairs=pairs,slotCount=72,counts=dict(counts),modelCalls=0,flowCalls=0,
        annotationProvenance=annotations.get('review',{}),
        limits='AI-authored independently cross-reviewed uncertainty rectangles; not human/exact physical groundtruth or full camera certification. Unknown slots remain denominators; M3U traffic labels/scores unchanged.')
    write_new(out,result);return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='job',required=True)
    a=sub.add_parser('prepare-source');a.add_argument('--input',type=Path,required=True);a.add_argument('--output',type=Path,required=True)
    a=sub.add_parser('prepare-target')
    for key in('input','source-selection','output'):a.add_argument('--'+key,type=Path,required=True)
    a.add_argument('--source-selection-sha256',required=True)
    a=sub.add_parser('bind')
    for key in('input','source-selection','target-proposals','annotations','output'):a.add_argument('--'+key,type=Path,required=True)
    for key in('source-selection-sha256','target-proposals-sha256'):a.add_argument('--'+key,required=True)
    a=parser.parse_args()
    if a.job=='prepare-source':source_plan(a.input,a.output)
    elif a.job=='prepare-target':target_proposals(a.input,a.source_selection,a.source_selection_sha256,a.output)
    else:bind(a.input,a.source_selection,a.source_selection_sha256,a.target_proposals,a.target_proposals_sha256,a.annotations,a.output)
