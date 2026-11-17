#!/usr/bin/env python3
"""M3P component-only color/detail A/B on predeclared real source pairs.

The replay consumes selected source boxes, not visual identity decisions. It
does not associate rivals, emit motion notices, relax guards, or infer metres.
Identity decisions join only in score. Not a held-out warning/runtime study.
"""

import argparse
from collections import Counter
from copy import deepcopy
from datetime import date
from hashlib import sha256 as bytes_sha
import io
import json
from pathlib import Path
import shutil
import tempfile
from time import perf_counter

import cv2
import numpy as np

import assist_scene_m3p_identity as identity
import assist_scene_texture_patches as texture
import assist_scene_textured_window as engine
import assist_scene_global_window as global_window
from assist_scene_motion import Detection, sha256


HERE=Path(__file__).resolve().parent
LANES=("A","B","C")
MAX_PAIRS,MAX_SECONDS,MAX_ARCHIVE_BYTES=24,1800,300*1024**2
CODE=("assist_scene_m3p_pair_study.py","assist_scene_m3p_field.py","assist_scene_m3p_identity.py",
    "assist_scene_global_field.py","assist_scene_learned_region.py","assist_scene_texture_patches.py",
    "assist_scene_textured_window.py","assist_scene_global_window.py","assist_scene_region_motion.py","assist_scene_motion.py")


def require(value,message):
    if not value:raise ValueError(message)


def canonical(value):
    return bytes_sha(json.dumps(value,sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()


def policy_snapshot():
    return json.loads(json.dumps({"texture":dict(texture.POLICY),"geometry":dict(engine.POLICY)}))


def plan(manifest):
    require(manifest.get("study")=="M3P-posthoc-source-identity-review" and manifest.get("schemaVersion")==1,
        "Expected source-bound posthoc identity fixture manifest")
    groups={};units=set()
    for case in manifest["cases"]:
        current=case["current"]
        for source in case["sources"]:
            require(source["timestampUs"]<current["timestampUs"],"Noncausal source pair")
            for option in source["options"]:
                unit_id=option["unitId"]
                require(unit_id not in units,"Duplicated review unit");units.add(unit_id)
                key=(source["token"],current["token"])
                group=groups.setdefault(key,{"pairId":source["token"]+"->"+current["token"],
                    "old":{k:v for k,v in source.items() if k not in ("options","role")},"new":current,"units":[]})
                require(group["old"]=={k:v for k,v in source.items() if k not in ("options","role")} and group["new"]==current,
                    "Same timestamp pair has inconsistent source metadata")
                group["units"].append({"unitId":unit_id,"caseId":case["caseId"],"role":source["role"],
                    "selectedByLanes":option["lanes"],"oldBox":option["workingBox"],"newBox":case["currentDetectorBox"],
                    "oldDetectionIndex":option["detectionIndex"],"newDetectionIndex":case["currentDetectionIndex"],
                    "label":option["label"]})
    require(0<len(groups)<=MAX_PAIRS and len(units)==sum(len(c["units"]) for c in manifest["cases"]),
        "Pair count or complete selected-unit coverage changed")
    return list(groups.values())


def lane_order(index):
    offset=index%3
    return list(LANES[offset:]+LANES[:offset])


def _bound_source(exposure,root):
    path=root/exposure["path"]
    require(path.is_file() and not path.is_symlink() and sha256(path)==exposure["sourceSha256"],"Original source bytes changed")
    image=cv2.imread(str(path),cv2.IMREAD_COLOR|cv2.IMREAD_IGNORE_ORIENTATION)
    require(image is not None and list(image.shape[1::-1])==exposure["nativeSize"],"Native image geometry changed")
    w,h=exposure["workingSize"];nw,nh=exposure["nativeSize"]
    ratio=min(1.,768/max(nw,nh))
    require((w,h)==(round(nw*ratio),round(nh*ratio)),"Working geometry differs from frozen768 resize")
    k=np.asarray(exposure["intrinsics"],float);wk=np.asarray(exposure["workingIntrinsics"],float)
    pose=np.asarray(exposure["cameraToWorld"],float)
    require(k.shape==wk.shape==(3,3) and pose.shape==(4,4) and np.isfinite(pose).all()
        and np.allclose(np.diag((w/nw,h/nh,1.))@k,wk,atol=1e-8,rtol=0),"Camera geometry changed")
    return image


def stage(exposure,root,work):
    native=_bound_source(exposure,root);w,h=exposure["workingSize"]
    pixels=native if native.shape[:2]==(h,w) else cv2.resize(native,(w,h),interpolation=cv2.INTER_AREA)
    path=work/(exposure["token"]+".jpg")
    require(not path.exists(),"Duplicate staging path")
    require(cv2.imwrite(str(path),pixels,[cv2.IMWRITE_JPEG_QUALITY,93]),"JPEG staging failed")
    bgr=cv2.imread(str(path),cv2.IMREAD_COLOR);gray=cv2.imread(str(path),cv2.IMREAD_GRAYSCALE)
    require(bgr is not None and gray is not None and gray.shape==(h,w) and bgr.shape==(h,w,3),"Staged geometry differs")
    return bgr,gray,{"sourceSha256":exposure["sourceSha256"],"jpegSha256":sha256(path),
        "bgrSha256":bytes_sha(bgr.tobytes()).hexdigest(),"graySha256":bytes_sha(gray.tobytes()).hexdigest(),"workingShape":[h,w]}


def homography(old,new):
    a={"intrinsics":old["workingIntrinsics"],"cameraToWorld":old["cameraToWorld"]}
    b={"intrinsics":new["workingIntrinsics"],"cameraToWorld":new["cameraToWorld"]}
    return global_window.rotation_homography(a,b)


def seal(gray,box):
    result=texture.select_seeds(gray,box);texture.validate_selection(result)
    return result


def pair_evidence(old_gray,new_gray,unit,fields,h,old_selection,new_selection):
    """Same frozen directional verifier, no target identity/label decision input."""
    boxes=[Detection(unit["label"],1.,tuple(unit[k])) for k in ("oldBox","newBox")]
    selections=(old_selection,new_selection);shapes=(old_gray.shape,new_gray.shape)
    for box,selection,shape in zip(boxes,selections,shapes,strict=True):
        identity._box(box.xyxy,shape[1],shape[0]);texture.validate_selection(selection)
        require(selection["sourceBox"]==list(box.xyxy),"Selected inventory belongs to a different source box")
    require(old_selection["sourceSha256"]==bytes_sha(old_gray.tobytes()).hexdigest()
        and new_selection["sourceSha256"]==bytes_sha(new_gray.tobytes()).hexdigest(),"Selection changed source pixels")
    result={"supported":False,"reason":"unverifiable-object-geometry","directions":{},"populations":{},
        "oldSelectionSha256":canonical(old_selection),"newSelectionSha256":canonical(new_selection),
        "oldBox":list(boxes[0].xyxy),"newBox":list(boxes[1].xyxy)}
    for index,direction in enumerate(("forward","reverse")):
        first,second=(old_gray,new_gray) if index==0 else (new_gray,old_gray)
        source,target=boxes[index],boxes[1-index];selection=selections[index]
        geometry_bad=global_window._small(source,shapes[index]) or global_window._small(target,shapes[1-index])
        if geometry_bad or selection["seedPoints"]<9:
            n=selection["seedPoints"]
            result["directions"][direction]={"supported":False,"reason":"unverifiable-object-geometry" if geometry_bad else "unverifiable-source-selection",
                "seedPoints":n,"verifiedPoints":0,"assignedPoints":0,"unknownPoints":n,"points":0}
            result["populations"][direction]={"status":"not-measured","selection":deepcopy(selection)}
            continue
        ff,bb=fields if index==0 else fields[::-1]
        population=texture.population(first,second,source.xyxy,ff,bb,mode="warped",selection=deepcopy(selection))
        evidence=engine._direction(population[:4],source,target,h if index==0 else np.linalg.inv(h))
        result["directions"][direction]=evidence;result["populations"][direction]=population[4]
    f,r=(result["directions"][name] for name in ("forward","reverse"))
    if f["supported"] and r["supported"]:
        values=[f["linearLogGrowth"],-r["linearLogGrowth"]];low,high=min(values),max(values)
        result.update(linearLogGrowthLowerBound=low,linearLogGrowthUpperBound=high,growthSpan=high-low)
        if high-low<=engine.POLICY["maxEstimatorLogGrowthSpan"]:result.update(supported=True,reason="bidirectional-pair-supported-not-warning")
        else:result["reason"]="bidirectional-estimator-disagreement"
    else:result["reason"]=("forward-"+f["reason"]) if not f["supported"] else "reverse-"+r["reason"]
    return result


def archive_fields(directory,name,fields,used):
    require(isinstance(fields,(tuple,list)) and len(fields)==2 and all(isinstance(f,np.ndarray)
        and f.ndim==3 and f.shape[-1]==2 and f.dtype==np.float32 and np.isfinite(f).all() for f in fields)
        and fields[0].shape==fields[1].shape,"Invalid actual original-coordinate fields")
    buffer=io.BytesIO();np.savez_compressed(buffer,forward=fields[0],backward=fields[1]);data=buffer.getvalue()
    require(used+len(data)<=MAX_ARCHIVE_BYTES,"Compressed actual fields exceed300MiB budget")
    path=directory/name
    with path.open("xb") as stream:stream.write(data)
    return {"path":str(path.resolve()),"bytes":len(data),"sha256":bytes_sha(data).hexdigest(),
        "fieldSha256":{name:bytes_sha(field.tobytes()).hexdigest() for name,field in zip(("forward","backward"),fields,strict=True)}}


def replay(args):
    from assist_scene_global_field import GlobalRaftSmall
    from assist_scene_m3p_field import ColorGlobalRaftSmall
    started=perf_counter();manifest=identity.read(args.manifest,8*1024**2);groups=plan(manifest)
    manifest_hash=sha256(args.manifest);root=Path(manifest["sourceRoot"]).resolve(strict=True)
    before={n:sha256(HERE/n) for n in CODE};weights_hash=sha256(args.weights)
    require(args.device=="mps" and shutil.disk_usage(args.output.parent).free>=10*1024**3,"Explicit MPS and10GiB disk required")
    directory=args.output.with_name(args.output.stem+"-fields")
    require(not args.output.exists() and not args.output.is_symlink() and not directory.exists(),"Choose new receipt and fields directory")
    gray_hashes={};source_receipt_hash=None
    if args.source_receipt is not None:
        prior=identity.read(args.source_receipt);source_receipt_hash=sha256(args.source_receipt)
        require(source_receipt_hash==manifest["inputBindings"]["receipt"],"Wrong original gray receipt")
        gray_hashes={f["token"]:f["workingPixelsSha256"] for c in prior["clips"] for f in c["frames"]}
    cv2.setNumThreads(1);base=GlobalRaftSmall(args.weights,device="mps")
    providers={"A":base,"B":ColorGlobalRaftSmall.from_provider(base,processed_side=640),
        "C":ColorGlobalRaftSmall.from_provider(base,processed_side=768)}
    startup=1000*(perf_counter()-started);directory.mkdir();rows=[];used=0;progress={"completedPairs":0,"pairIndex":None,"lane":None}
    try:
        with tempfile.TemporaryDirectory(prefix=f"codex-tmp-m3p-pair-{date.today():%Y%m%d}-",dir=args.output.parent) as temp:
            for index,group in enumerate(groups):
                require(perf_counter()-started<=MAX_SECONDS,"Pair-study wall budget exceeded")
                progress.update(pairIndex=index,lane=None);tick=perf_counter();work=Path(temp)/str(index);work.mkdir()
                old_bgr,old_gray,old_meta=stage(group["old"],root,work);new_bgr,new_gray,new_meta=stage(group["new"],root,work)
                require(old_gray.shape==new_gray.shape,"Pair image shapes differ")
                for exposure,meta in ((group["old"],old_meta),(group["new"],new_meta)):
                    if gray_hashes:require(gray_hashes.get(exposure["token"])==meta["graySha256"],"Staged grayscale differs from original M3O inference")
                inventories=[(seal(old_gray,u["oldBox"]),seal(new_gray,u["newBox"])) for u in group["units"]]
                sealed=[(canonical(a),canonical(b)) for a,b in inventories];h=homography(group["old"],group["new"])
                preparation=1000*(perf_counter()-tick);row={"pairId":group["pairId"],"old":group["old"],"new":group["new"],"oldPixels":old_meta,"newPixels":new_meta,
                    "units":group["units"],"laneOrder":lane_order(index),"preparationMs":preparation,"arms":{}}
                for lane in row["laneOrder"]:
                    progress["lane"]=lane;provider=providers[lane];count=provider.direction_calls;tick=perf_counter()
                    fields=provider(old_gray,new_gray) if lane=="A" else provider(old_bgr,new_bgr)
                    require(provider.direction_calls-count==2,"Actual pair direction count differs")
                    field_ms=1000*(perf_counter()-tick);field_record=archive_fields(directory,f"pair-{index:02d}-{lane}.npz",fields,used);used+=field_record["bytes"]
                    tick=perf_counter();evidence=[]
                    for unit,(a,b),hashes in zip(group["units"],inventories,sealed,strict=True):
                        require((canonical(a),canonical(b))==hashes,"Inventory changed after flow")
                        cv2.setRNGSeed(650800+index)
                        evidence.append({"unitId":unit["unitId"],**pair_evidence(old_gray,new_gray,unit,fields,h,a,b)})
                    row["arms"][lane]={"actualDirections":provider.direction_calls-count,"fieldMs":field_ms,
                        "verificationMs":1000*(perf_counter()-tick),"providerCall":deepcopy(provider.last_call),"archive":field_record,"units":evidence}
                    print(f'M3P pair{index+1}/{len(groups)} {lane}: '+str(sum(u["supported"] for u in evidence))+" supported pair proofs",flush=True)
                rows.append(row);progress["completedPairs"]=len(rows)
        require(before=={n:sha256(HERE/n) for n in CODE} and sha256(args.manifest)==manifest_hash and sha256(args.weights)==weights_hash,"Source/config/model drift")
        if args.source_receipt is not None:require(sha256(args.source_receipt)==source_receipt_hash,"Original receipt changed")
        for group in groups:
            for exposure in (group["old"],group["new"]):require(sha256(root/exposure["path"])==exposure["sourceSha256"],"Source image changed after inference")
        actual={lane:providers[lane].direction_calls for lane in LANES}
        require(all(v==2*len(groups) for v in actual.values()),"Actual final counters mismatch")
        return {"schemaVersion":1,"study":"M3P-real-pair-component","manifestSha256":manifest_hash,"originalReceiptSha256":source_receipt_hash,
            "codeSha256":before,"weightsSha256":weights_hash,"providers":{l:providers[l].metadata for l in LANES},"modelStartupMs":startup,
            "actualDirections":actual,"archiveBytes":used,"archiveLimitBytes":MAX_ARCHIVE_BYTES,"maxPairs":MAX_PAIRS,"maxWallSeconds":MAX_SECONDS,
            "replayWallMs":1000*(perf_counter()-started),"selectionBeforeFields":True,"identityDecisionsRead":False,"pairCount":len(groups),"pairs":rows,
            "policies":policy_snapshot(),
            "limits":"OLD M3O selected-pair component study, not unseen video, rival association, object tracking, full warnings, metres or phone acceptance. Pair support is not a collision/approach alert. Counterbalanced three-lane sequence; startup/cold-shape effects remain."}
    except Exception as error:
        failure={"study":"M3P-pair-failed-incomplete","completeStudy":False,"progress":progress,
            "actualDirections":{l:providers[l].direction_calls for l in LANES},"manifestSha256":manifest_hash,"codeSha256":before,
            "error":f"{type(error).__name__}: {error}","retainedArchiveBytes":used,"replayWallMs":1000*(perf_counter()-started)}
        identity.write(args.output.with_name(args.output.name+".failure.json"),failure)
        raise


def receipt_contract(receipt):
    from assist_scene_global_field import POLICY as BASE_POLICY
    require(receipt.get("schemaVersion")==1 and receipt.get("study")=="M3P-real-pair-component"
        and receipt.get("identityDecisionsRead") is False and receipt.get("selectionBeforeFields") is True,
        "Wrong component evidence/identity authority")
    pairs=receipt["pairs"];require(0<len(pairs)<=MAX_PAIRS and receipt["pairCount"]==len(pairs),"Wrong pair count")
    require(receipt["codeSha256"]=={n:sha256(HERE/n) for n in CODE}
        and receipt["weightsSha256"]==BASE_POLICY["weightSha256"]
        and receipt["policies"]==policy_snapshot(),"Source/model/floor drift")
    require(receipt["actualDirections"]=={l:2*len(pairs) for l in LANES},"Actual model direction count mismatch")
    require(receipt["archiveLimitBytes"]==MAX_ARCHIVE_BYTES and receipt["maxPairs"]==MAX_PAIRS
        and receipt["maxWallSeconds"]==MAX_SECONDS and 0<=receipt["replayWallMs"]<=1000*MAX_SECONDS,"Replay budget changed")
    all_units=[u["unitId"] for pair in pairs for u in pair["units"]]
    require(len(all_units)==len(set(all_units)),"Selected unit counted twice across pairs")
    archives=0
    for index,pair in enumerate(pairs):
        require(pair["laneOrder"]==lane_order(index) and set(pair["arms"])==set(LANES),"Unbalanced/missing arm")
        unit_ids=[u["unitId"] for u in pair["units"]];require(len(set(unit_ids))==len(unit_ids),"Duplicate source unit")
        for lane in LANES:
            arm=pair["arms"][lane];call=arm["providerCall"]
            require(arm["actualDirections"]==2 and call.get("modelDirectionCalls")==2 and call.get("status")=="field-supported"
                and call.get("device")=="mps" and call.get("flowUpdatesPerDirection")==12
                and call.get("outputShape")==[*pair["oldPixels"]["workingShape"],2],"Actual provider proof mismatch")
            require(all(type(arm[k]) in (int,float) and np.isfinite(arm[k]) and arm[k]>=0 for k in ("fieldMs","verificationMs")),"Missing actual field/verification cost")
            require([u["unitId"] for u in arm["units"]]==unit_ids,"Missing or reordered selected unit")
            provider=receipt["providers"][lane]
            require(provider.get("weightsSha256")==receipt["weightsSha256"] and provider.get("device")=="mps",
                "Wrong actual pinned model")
            if lane=="A":require(provider.get("kind")=="actual-local-pretrained-torchvision-global" and provider.get("policy")==dict(BASE_POLICY),"Wrong gray baseline")
            else:require(provider.get("kind")=="actual-local-pretrained-torchvision-global-color"
                and provider.get("processedSideLimit")== (640 if lane=="B" else 768)
                and call.get("oldBgrSha256")==pair["oldPixels"]["bgrSha256"]
                and call.get("newBgrSha256")==pair["newPixels"]["bgrSha256"],"Wrong color source pixels/arm")
            archives+=arm["archive"]["bytes"]
    require(archives==receipt["archiveBytes"] and archives<=MAX_ARCHIVE_BYTES,"Retained field budget mismatch")
    return True


def score(receipt,decisions):
    receipt_contract(receipt)
    require(receipt.get("study")=="M3P-real-pair-component" and receipt.get("identityDecisionsRead") is False
        and receipt["manifestSha256"]==decisions.get("manifestSha256"),"Identity decisions are not bound or leaked into replay")
    labels=decisions["units"];expected={u["unitId"] for p in receipt["pairs"] for u in p["units"]}
    require(set(labels)==expected,"Every selected hypothesis requires exactly one identity label")
    totals={l:Counter() for l in LANES};rows=[]
    for p in receipt["pairs"]:
        for lane in LANES:
            arm=p["arms"][lane]
            require(arm["actualDirections"]==2,"Missing actual pair field calls")
            require({u["unitId"] for u in arm["units"]}=={u["unitId"] for u in p["units"]},"Pair unit omitted or duplicated")
            for u in arm["units"]:
                answer=labels[u["unitId"]];kind=answer["identity"]
                require(kind in ("same","different","unknown") and type(u["supported"]) is bool,"Invalid identity/support")
                totals[lane][kind+"Units"]+=1;totals[lane][kind+("Supported" if u["supported"] else "Unsupported")]+=1
                rows.append({"pairId":p["pairId"],"lane":lane,"unitId":u["unitId"],"identity":kind,"supported":u["supported"],"reason":u["reason"]})
    timing={l:{"pairMs":[p["preparationMs"]+p["arms"][l]["fieldMs"]+p["arms"][l]["verificationMs"] for p in receipt["pairs"]],
        "scope":"Source staging/sealing plus actual own arm field and all unit verification; excludes other arms, archive encoding, startup. Paired component latency, not deployed frame/warning latency."} for l in LANES}
    return {"schemaVersion":1,"study":"M3P-real-pair-component-score","manifestSha256":receipt["manifestSha256"],"totals":totals,"units":rows,"pairedComponentTiming":timing,
        "unit":"selected source/current box hypothesis, not independent objects or warning recall",
        "limits":"Same identity does not guarantee measurable projected expansion. Different-identity unsupported is not detector true-negative. Unknown remains separate. No end-to-end approach, metres, real-time or safety claim."}


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest="mode",required=True)
    p=sub.add_parser("replay")
    for name in ("manifest","weights","output"):p.add_argument("--"+name,type=Path,required=True)
    p.add_argument("--source-receipt",type=Path);p.add_argument("--device",choices=("mps",),required=True)
    p=sub.add_parser("score")
    for name in ("receipt","decisions","output"):p.add_argument("--"+name,type=Path,required=True)
    args=parser.parse_args()
    if args.mode=="replay":result=replay(args)
    else:
        result=score(identity.read(args.receipt,64*1024**2),identity.read(args.decisions,2*1024**2))
        result.update(receiptSha256=sha256(args.receipt),decisionsSha256=sha256(args.decisions))
    identity.write(args.output,result)
