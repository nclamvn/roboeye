#!/usr/bin/env python3
"""Mac-only A/B: bounded original-pixel detector crops before M3E tracking.

Runtime never loads ground truth. Crop refinement is not enabled in the app.
"""

import argparse
from collections import Counter
from datetime import date
import json
import math
from pathlib import Path
import platform
import tempfile
from time import perf_counter

import cv2
import numpy as np

from assist_scene_motion import parse_detect, sha256
from assist_scene_motion_m3b import detect_samples
from assist_scene_motion_m3c import MAX_SIDE, load_input
from assist_scene_m3e_study import CAPS, DROPPED, legacy_score, output, read_frame, write_new
from assist_scene_roi_redetect import POLICY as ROI_POLICY, RoiRedetector
from assist_scene_scale_approach_m3e import POLICY as TRACK_POLICY, ScaleApproachM3E


HERE=Path(__file__).resolve().parent
LANES=("A","B")
CODE=("assist_scene_roi_redetect.py", "assist_scene_m3f_study.py", "assist_scene_scale_approach_m3e.py",
      "assist_scene_scale_approach.py", "assist_scene_m3e_study.py", "assist_scene_motion_m3b.py")


def stage(clip, root, work):
    frames=[]; samples=[]; shapes=[]
    origin=clip["frames"][0]["timestampUs"]
    for i,f in enumerate(clip["frames"]):
        source=root/f["path"]
        if sha256(source)!=f["sha256"]:
            raise ValueError("Source frame hash mismatch")
        image=read_frame(source,cv2.IMREAD_COLOR)
        oh,ow=image.shape[:2]
        ratio=min(1.,MAX_SIDE/max(oh,ow)); h,w=round(oh*ratio),round(ow*ratio)
        resized=image if (h,w)==(oh,ow) else cv2.resize(image,(w,h),interpolation=cv2.INTER_AREA)
        name=work/f"frame-{i:03d}.jpg"
        if not cv2.imwrite(str(name),resized,[cv2.IMWRITE_JPEG_QUALITY,93]):
            raise RuntimeError("Cannot stage full detector input")
        metadata=dict(f)
        if metadata.get("intrinsics") is not None:
            metadata["intrinsics"]=(np.diag((w/ow,h/oh,1.))@np.asarray(metadata["intrinsics"])).tolist()
        frames.append(metadata); shapes.append((h,w,oh,ow))
        samples.append((i,(f["timestampUs"]-origin)/1000.,name))
    return frames,samples,shapes


def run_clip(clip, root, work, exe, model):
    frames,samples,shapes=stage(clip,root,work)
    detector={}; configs=[]
    full_wall=0.
    for start in range(0,len(samples),50):
        tick=perf_counter()
        config,batch=detect_samples(samples[start:start+50],exe,model)
        full_wall+=(perf_counter()-tick)*1000.
        configs.append(config); detector.update(batch)
    if any(c!=configs[0] for c in configs):
        raise ValueError("Full detector configuration changed")
    lanes={name:ScaleApproachM3E() for name in LANES}
    recover=RoiRedetector(); prior=[]; previous_at=None
    rows=[]
    for i,f in enumerate(frames):
        tick=perf_counter()
        gray=read_frame(samples[i][2],cv2.IMREAD_GRAYSCALE)
        h,w,oh,ow=shapes[i]
        at,obs=detector[i]
        full_boxes=parse_detect(obs,w,h)
        native=read_frame(root/f["path"],cv2.IMREAD_COLOR)
        if gray.shape!=(h,w) or native.shape[:2]!=(oh,ow):
            raise ValueError("Unbound native/source geometry")
        native_gray=cv2.cvtColor(native,cv2.COLOR_BGR2GRAY)
        preprocess=(perf_counter()-tick)*1000.
        injected=i in DROPPED.get(clip["id"],())
        full_input=[] if injected else full_boxes
        tick=perf_counter()
        crops=[] if injected else recover.plan(full_input,prior,(oh,ow),(h,w),
                                                gap_ms=None if previous_at is None else at-previous_at)
        crop_items=[]; crop_hashes=[]; crop_shapes=[]
        for j,crop in enumerate(crops):
            x,y,r,b=crop.rect
            pixels=np.ascontiguousarray(native[y:b,x:r])
            name=work/f"crop-{i:03d}-{j}.jpg"
            if pixels.shape[:2]!=(b-y,r-x) or not cv2.imwrite(str(name),pixels,[cv2.IMWRITE_JPEG_QUALITY,97]):
                raise RuntimeError("Cannot encode original-pixel crop")
            crop_items.append((j,at,name)); crop_hashes.append(sha256(name)); crop_shapes.append(pixels.shape[:2])
        roi_prep_ms=(perf_counter()-tick)*1000.
        crop_wall=0.; crop_detection_ms=0.; parsed=[]
        if crop_items:
            tick=perf_counter()
            config,found=detect_samples(crop_items,exe,model)
            crop_wall=(perf_counter()-tick)*1000.
            if config!=configs[0]:
                raise ValueError("ROI changed detector model or configuration")
            for j,(ch,cw) in enumerate(crop_shapes):
                t,row=found[j]
                if t!=at:
                    raise ValueError("ROI timestamp mismatch")
                crop_detection_ms+=row["detectionMs"]
                parsed.append(parse_detect(row,cw,ch))
        tick=perf_counter()
        candidate,diag=recover.merge(full_input,crops,parsed,(oh,ow),(h,w))
        merge_ms=(perf_counter()-tick)*1000.
        row={"token":f["token"],"timestampUs":f["timestampUs"],"timeMs":at,"index":i,
             "width":w,"height":h,"nativeWidth":ow,"nativeHeight":oh,
             "detectorGapInjected":injected,"detections":[d.record(w,h) for d in full_input],
             "candidateDetections":[d.record(w,h) for d in candidate],
             "roi":{"crops":[{"rect":list(c.rect),"source":c.source,
                               "anchor":c.anchor.record(w,h),"jpegSha256":digest}
                              for c,digest in zip(crops,crop_hashes,strict=True)],
                    "merge":diag,"cropDetectionMs":crop_detection_ms},
             "timingsMs":{"detector":obs["detectionMs"],"sharedPrep":preprocess,
                          "roiPreparation":roi_prep_ms,"roiInferenceWall":crop_wall,"roiMerge":merge_ms}}
        for name,state in lanes.items():
            cv2.setRNGSeed(650500+i)
            tick=perf_counter()
            values=state.update(f,at,gray,full_input if name=="A" else candidate,native_gray=native_gray)
            row[name]=output(values,at)
            row["timingsMs"][name]=(perf_counter()-tick)*1000.
        row["timingsMs"]["candidateExtraToReady"]=roi_prep_ms+crop_wall+merge_ms+row["timingsMs"]["B"]
        rows.append(row)
        # One exact preceding frame only; never feed candidate labels back into
        # proposal planning or turn a chain of crop guesses into permanent IDs.
        prior,previous_at=list(full_input),at
        for _,_,filename in crop_items:
            filename.unlink()
    return {"id":clip["id"],"detectorConfiguration":configs[0],"fullDetectorBatchWallMs":full_wall,"frames":rows}


def replay(args):
    manifest,root=load_input(args.input)
    if manifest["dataset"] not in {"Boreas-real","synthetic-m3c"}:
        raise ValueError("Unexpected source dataset")
    if sum(len(c["frames"]) for c in manifest["clips"])>CAPS["maxFramesTotal"]:
        raise ValueError("Frame budget exceeded")
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("Output must be new")
    cv2.setNumThreads(1)
    clips=[]
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-assist-m3f-{date.today():%Y%m%d}-",dir=args.output.parent) as temp:
        for j,clip in enumerate(manifest["clips"]):
            work=Path(temp)/str(j); work.mkdir()
            print(f"Replay {clip['id']} ({len(clip['frames'])} frames)",flush=True)
            clips.append(run_clip(clip,root,work,args.sceneqa.resolve(),args.yolo.resolve()))
    return {"schemaVersion":1,"dataset":manifest["dataset"],"inputSha256":sha256(args.input),
            "platform":platform.platform(),"opencv":cv2.__version__,
            "policies":{"roi":dict(ROI_POLICY),"tracking":dict(TRACK_POLICY)},
            "lanes":{"A":"M3E original full-image detections","B":"M3E same full detections plus bounded ROI redetection"},
            "sceneqaSha256":sha256(args.sceneqa),"codeSha256":{n:sha256(HERE/n) for n in CODE},
            "yoloModelHashes":{str(p.relative_to(args.yolo)):sha256(p) for p in sorted(args.yolo.rglob("*")) if p.is_file()},
            "clips":clips}


def score(receipt,truth):
    if (receipt.get("schemaVersion")!=1 or truth.get("schemaVersion")!=1
            or receipt["inputSha256"]!=truth["inputSha256"]
            or [c["id"] for c in receipt["clips"]]!=[c["id"] for c in truth["clips"]]):
        raise ValueError("Unbound or incompatible scoring inputs")
    contract=legacy_score()
    totals={n:Counter(contract.empty()) for n in LANES}; rows=[]; frames=[]
    for clip,gold in zip(receipt["clips"],truth["clips"],strict=True):
        targets={f["token"]:f for f in gold["frames"]}
        if (len(targets)!=len(gold["frames"]) or len({f["token"] for f in clip["frames"]})!=len(clip["frames"])
                or not targets.keys()<={f["token"] for f in clip["frames"]}):
            raise ValueError("Duplicate or missing labeled frame")
        stats={n:contract.empty() for n in LANES}; coverage={n:Counter() for n in LANES}
        statuses={n:Counter() for n in LANES}; roi=Counter()
        for f in clip["frames"]:
            ref=targets.get(f["token"])
            if ref and ref["timestampUs"]!=f["timestampUs"]:
                raise ValueError("Wrong exact frame timestamp")
            translated=None if ref is None else [{**t,"motion":{"approaching":"moving","not-approaching":"stationary","unknown":"unknown"}[t["approach"]]} for t in ref["targets"]]
            for n in LANES:
                output(f[n],f["timeMs"])
                contract.score_frame(f,n,translated,stats[n]); statuses[n][f[n]["status"]]+=1
                if gold.get("allSceneNegative"):
                    stats[n]["allSceneFalseNotices"]=stats[n].get("allSceneFalseNotices",0)+len(f[n]["events"])
                detections=f["detections"] if n=="A" else f["candidateDetections"]
                for t in ref["targets"] if ref else ():
                    key=t["approach"]
                    coverage[n][key]+=1
                    overlap=any(contract.family(d["label"])==t["classFamily"] and contract.iou(d["box"],t["box"])>=contract.IOU for d in detections)
                    coverage[n][key+".overlapped"]+=overlap
                if ref:
                    coverage[n]["unmatchedBoxesNotFalsePositiveLabel"]+=sum(not any(contract.family(d["label"])==t["classFamily"] and contract.iou(d["box"],t["box"])>=contract.IOU for t in ref["targets"]) for d in detections)
            crops=f["roi"]["crops"]
            if len(crops)>ROI_POLICY["maxCropsPerFrame"]:
                raise ValueError("Receipt exceeded crop policy")
            roi["cropImages"]+=len(crops); roi["cropDispatches"]+=bool(crops)
            roi.update(f["roi"]["merge"]["reasons"])
            frames.append(f)
        for n in LANES:
            totals[n].update(stats[n])
        rows.append({"id":clip["id"],"lanes":stats,"statuses":statuses,"detectionOverlap":coverage,"roi":roi})
    timing={}
    for n in ("detector","sharedPrep","roiPreparation","roiInferenceWall","roiMerge","A","B","candidateExtraToReady"):
        vals=sorted(f["timingsMs"][n] for f in frames)
        timing[n]={f"p{p}":round(vals[math.ceil(len(vals)*p/100)-1],2) for p in (50,95)}
    return {"schemaVersion":1,"dataset":receipt["dataset"],"inputSha256":receipt["inputSha256"],"review":truth.get("review"),
            "reviewSha256":truth.get("reviewSha256"),"unit":"target-keyframe","frames":len(frames),
            "noMetreChecks":len(frames)*2,"platform":receipt["platform"],"opencv":receipt["opencv"],
            "codeSha256":receipt["codeSha256"],"detectorConfiguration":receipt["clips"][0]["detectorConfiguration"],
            "totals":totals,"clips":rows,"stageMs":timing,
            "limits":"Checkpoint labels are not exhaustive; unmatched detections are not certified false positives. ROI per-frame process launch is included in wall time; full detector uses batches. No end-to-end phone latency measurement."}


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest="mode",required=True)
    for mode,keys in (("replay",("input","sceneqa","yolo","output")),("score",("input","truth","receipt","output"))):
        s=sub.add_parser(mode)
        for k in keys:
            s.add_argument("--"+k,type=Path,required=True)
    args=p.parse_args()
    if args.mode=="replay":
        value=replay(args)
    else:
        rec=json.loads(args.receipt.read_text())
        if rec["inputSha256"]!=sha256(args.input):
            raise ValueError("Input/receipt hash mismatch")
        value=score(rec,json.loads(args.truth.read_text()))
        value.update(receiptSha256=sha256(args.receipt),truthSha256=sha256(args.truth))
        print(json.dumps(value["totals"],indent=2))
    write_new(args.output,value)
