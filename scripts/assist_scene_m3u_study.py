#!/usr/bin/env python3
"""M3U camera-only A/B: one detector, resident RAFT, actual duplicated fields.

Two unchanged TexturedGlobalWindowMotion engines consume different camera
authorities. No field cache, tracker, identity-age transfer or oracle input.
"""
import argparse
from collections import Counter
from datetime import date
import json
from pathlib import Path
import platform
import shutil
import tempfile
from time import perf_counter

import cv2
import numpy as np

import assist_scene_m3o_study as baseline
import assist_scene_m3q_study as review
import assist_scene_m3r_study as resources
import assist_scene_m3u_pixel_camera as camera
from assist_scene_motion import parse_detect,sha256
from assist_scene_motion_m3c import load_input
from assist_scene_m3e_study import output,read_frame,legacy_score
from assist_scene_m3f_study import stage
from assist_scene_m3g_study import DETECTOR_CONFIGURATION,bind_input,finite_payload,model_hashes,_percentiles,lane_contract

HERE=Path(__file__).resolve().parent
CODE=tuple(dict.fromkeys((*resources.CODE,"assist_scene_m3s_camera_audit.py","assist_scene_m3u_pixel_camera.py","assist_scene_m3u_study.py")))
LANES=("A","B");MAX_FRAMES=100;MAX_SECONDS=900;MAX_BYTES=192*1024**2
require,canonical=baseline._require,baseline.canonical_hash


def policies():
    from assist_scene_textured_window import POLICY as measurement
    from assist_scene_cohort_loom import POLICY as old_camera
    return json.loads(json.dumps(dict(cameraA=dict(old_camera),cameraB=dict(camera.POLICY),measurement=dict(measurement))))


def lane_view(row,lane):
    """Read-only validator adapter, NOT a recorded ownership/status rewrite."""
    return {**row,"T":row["T_"+lane],"A":row[lane],
        "flowDirectionCalls":{**row["flowDirectionCalls"],"A":row["flowDirectionCalls"][lane]},
        "timingsMs":{**row["timingsMs"],"T":row["timingsMs"]["T_"+lane],"A":row["timingsMs"][lane]}}


def bind_frame_source(row,source,index,origin):
    require(row["index"]==index and row["token"]==source["token"]and row["timestampUs"]==source["timestampUs"]
        and row["timeMs"]==(source["timestampUs"]-origin)/1000. and row["sourceSha256"]==source["sha256"]
        and row["sourcePoseTimestampUs"]==source["poseTimestampUs"]and row.get("sourcePoseEpoch")==source.get("epoch")
        and row["detectorGapInjected"]is False,"source-frame-clock-pose-or-drop-changed")
    k=np.diag((row["width"]/row["nativeWidth"],row["height"]/row["nativeHeight"],1.))@np.asarray(source["intrinsics"])
    require(baseline.audit._same(row["cameraIntrinsics"],k.tolist())
        and baseline.audit._same(row["cameraToWorld"],source["cameraToWorld"]),"source-calibration-or-transform-changed")
    require(row["detections"]==[b.record(row["width"],row["height"])for b in
        parse_detect(row["oldObservation"],row["width"],row["height"])],"actual-detector-boxes-changed")
    return True


def frame_contract(row,history):
    finite_payload(row)
    review.cohort_contract(row["T_A"],row["timeMs"])
    for lane in LANES:
        cam=row["T_"+lane];surface=row[lane]
        for name in ("T_"+lane,lane):
            lane_contract(row[name],row["timeMs"])
            baseline.audit._tracks({**row,"candidateDetections":row["detections"]},name)
            baseline.audit._no_range({k:v for k,v in row[name].items()if k!="answers"})
        require(surface["tracks"]==cam["tracks"]and surface["epoch"]==cam["epoch"]
            and surface["diagnostics"]["sourceStatus"]==cam["status"],"wrong-lane-camera-authority")
        require(cam["status"]=="valid"or not surface["events"],"camera-veto-bypassed")
        require(type(row["flowDirectionCalls"][lane])is int and row["flowDirectionCalls"][lane]in(0,2,4)
            and row["actualCalls"][lane]==dict(raft=row["flowDirectionCalls"][lane]),"actual-direction-counter-mismatch")
        baseline.global_contract(lane_view(row,lane),[lane_view(x,lane)for x in history],"A")
    require(sum(row["flowDirectionCalls"].values())<=8,"combined-direction-budget")
    camera.validate_surface(row["T_B"],row,history)
    return True


def write_new(path,value):
    payload=json.dumps(value,separators=(",",":"),allow_nan=False).encode()
    require(len(payload)<=MAX_BYTES and not path.exists()and not path.is_symlink(),"output-budget-or-overwrite")
    with path.open('xb')as stream:stream.write(payload)


def run_clip(clip,root,work,exe,model,provider,deadline,budget):
    from assist_scene_cohort_loom import CohortWindowLoom
    from assist_scene_textured_window import TexturedGlobalWindowMotion
    started=perf_counter();progress=dict(clipId=clip["id"],frameIndex=None,phase="staging",validatedFrames=[])
    prepared=[];rows=[];origin=clip["frames"][0]["timestampUs"]
    try:
        for index,source in enumerate(clip["frames"]):
            require(perf_counter()<=deadline,"wall-budget")
            tick=perf_counter();folder=work/str(index);folder.mkdir()
            frames,samples,shapes=stage(dict(frames=[source]),root,folder)
            prepared.append((frames[0],samples[0][2],shapes[0],1000*(perf_counter()-tick)))
        staging_ms=1000*(perf_counter()-started)
        samples=[(i,(f["timestampUs"]-origin)/1000.,prepared[i][1])for i,f in enumerate(clip["frames"])]
        progress["phase"]="shared-detector"
        found,batch_ms,batches=baseline.old.previous.previous._detect_batched(samples,exe,model)
        engines=dict(T_A=CohortWindowLoom(),T_B=camera.PixelCameraAuthority(),
            A=TexturedGlobalWindowMotion(provider,mode="warped"),B=TexturedGlobalWindowMotion(provider,mode="warped"))
        validation_ms=0.;clip_bytes=0
        for index,(frame,filename,shape,prep_ms)in enumerate(prepared):
            require(perf_counter()<=deadline,"wall-budget");progress.update(frameIndex=index,phase="source-preparation")
            h,w,nh,nw=shape;at=samples[index][1];tick=perf_counter();gray=read_frame(filename,cv2.IMREAD_GRAYSCALE)
            native=cv2.cvtColor(baseline.old.previous.previous._read_native(root/frame["path"],frame["sha256"]),cv2.COLOR_BGR2GRAY)
            shared_ms=1000*(perf_counter()-tick);found_at,observation=found[index];require(found_at==at,"detector-clock")
            boxes=parse_detect(observation,w,h)
            row=dict(index=index,token=frame["token"],timestampUs=frame["timestampUs"],timeMs=at,sourceSha256=frame["sha256"],
                sourcePoseTimestampUs=frame.get("poseTimestampUs"),sourcePoseEpoch=frame.get("epoch"),
                workingPixelsSha256=sha256_bytes(gray),nativeGraySha256=sha256_bytes(native),width=w,height=h,nativeWidth=nw,nativeHeight=nh,
                cameraIntrinsics=np.asarray(frame["intrinsics"]).tolist(),cameraToWorld=np.asarray(frame["cameraToWorld"]).tolist(),
                detectorGapInjected=False,detections=[b.record(w,h)for b in boxes],oldObservation=observation,
                detectorObservationMs=observation["detectionMs"],flowDirectionCalls={},actualCalls={},
                timingsMs=dict(fullPreparation=prep_ms,sharedPrep=shared_ms))
            bind_frame_source(row,clip["frames"][index],index,origin)
            for lane in LANES:
                key="T_"+lane;cv2.setRNGSeed(650500+index);tick=perf_counter()
                observed=engines[key].update(frame,at,gray,boxes,native_gray=native)if lane=="A"else engines[key].update(frame,at,gray,boxes)
                row[key]=output(observed,at);row["timingsMs"][key]=1000*(perf_counter()-tick)
            camera_seals={key:canonical(row[key])for key in ("T_A","T_B")}
            row["executionOrder"]=list(LANES)
            for lane in LANES:
                progress["phase"]="actual-"+lane+"-measurement"
                cv2.setRNGSeed(650500+index);before=provider.direction_calls;tick=perf_counter()
                row[lane]=output(engines[lane].update(frame,at,gray,boxes,camera_surface=row["T_"+lane]),at)
                row["timingsMs"][lane]=1000*(perf_counter()-tick)
                row["flowDirectionCalls"][lane]=provider.direction_calls-before
                row["actualCalls"][lane]=dict(raft=provider.direction_calls-before)
            require(all(canonical(row[k])==v for k,v in camera_seals.items()),"camera-surface-mutated")
            progress["phase"]="contracts"
            tick=perf_counter();frame_contract(row,rows);validation_ms+=1000*(perf_counter()-tick)
            size=len(json.dumps(row,separators=(",",":"),allow_nan=False).encode())
            require(budget["validatedBytes"]+size<=MAX_BYTES-1024**2,"incremental-receipt-budget-no-pruning")
            budget["validatedBytes"]+=size;clip_bytes+=size;rows.append(row);progress["validatedFrames"]=rows
            if index%10==0:print(json.dumps(dict(clip=clip["id"],frame=index,actualDirections=provider.direction_calls)),flush=True)
        return dict(id=clip["id"],frames=rows,detectorCalls=len(rows),detectorBatches=batches,
            detectorConfiguration=DETECTOR_CONFIGURATION,detectorBatchWallMs=batch_ms,stageWallMs=staging_ms,
            studyWallMs=1000*(perf_counter()-started),receiptValidationAndFrameSerializationMs=validation_ms,
            serializedFrameBytes=clip_bytes,actualFlowDirectionCallsByLane={l:sum(f["flowDirectionCalls"][l]for f in rows)for l in LANES})
    except Exception as error:
        error.m3u_progress=progress;raise


def sha256_bytes(image):
    from hashlib import sha256 as hashed
    return hashed(image.tobytes()).hexdigest()


def replay(args):
    started=perf_counter();deadline=started+MAX_SECONDS;inputs,root=load_input(args.input)
    require(sum(len(c["frames"])for c in inputs["clips"])==100 and args.device=="mps","exact100-frame-MPS-scope")
    require(not args.output.exists()and not args.output.is_symlink(),"new-output-required")
    require(shutil.disk_usage(args.output.parent).free>=10*1024**3,"disk-floor10GiB")
    coverage=json.loads(args.review_coverage.read_text());review.coverage_contract(coverage,sha256(args.input))
    sources={f["path"]:f["sha256"]for c in inputs["clips"]for f in c["frames"]}
    require(all(sha256(root/p)==h for p,h in sources.items()),"changed-source-bytes")
    before={n:sha256(HERE/n)for n in CODE};snapshot=policies();input_hash=sha256(args.input);coverage_hash=sha256(args.review_coverage)
    exe,model=args.sceneqa.resolve(strict=True),args.yolo.resolve(strict=True);exe_hash=sha256(exe);hashes=model_hashes(model)
    from assist_scene_global_field import GlobalRaftSmall
    provider=None;startup=0.;clips=[];budget=dict(validatedBytes=0)
    try:
        cv2.setNumThreads(1);tick=perf_counter();provider=GlobalRaftSmall(args.flow_weights,device="mps");startup=1000*(perf_counter()-tick)
        with tempfile.TemporaryDirectory(prefix=f"codex-tmp-m3u-{date.today():%Y%m%d}-",dir=args.output.parent)as temp:
            for index,clip in enumerate(inputs["clips"]):
                folder=Path(temp)/str(index);folder.mkdir();clips.append(run_clip(clip,root,folder,exe,model,provider,deadline,budget))
        require(perf_counter()<=deadline and before=={n:sha256(HERE/n)for n in CODE}and policies()==snapshot,"source-policy-or-budget-drift")
        require(sha256(args.input)==input_hash and sha256(args.review_coverage)==coverage_hash and sha256(exe)==exe_hash
            and model_hashes(model)==hashes and all(sha256(root/p)==h for p,h in sources.items()),"input-model-source-drift")
        receipt=dict(schemaVersion=1,study="M3U",dataset=inputs["dataset"],developmentOnly=False,inputSha256=input_hash,
            reviewCoverageSha256=coverage_hash,reviewedTruthSha256=coverage["boundTruthSha256"],reviewFormatStudy=coverage["study"],
            codeSha256=before,policies=snapshot,provider=provider.metadata,weightsSha256=sha256(args.flow_weights),
            actualModelDirections=provider.direction_calls,sceneqaSha256=exe_hash,yoloModelHashes=hashes,
            detectorProvenance=dict(kind="actual-local-CoreML-no-cached-observations"),clips=clips,serializedFrameBytes=budget["validatedBytes"],
            opencv=cv2.__version__,opencvThreadsRequested=1,opencvThreadsReported=cv2.getNumThreads(),numpy=np.__version__,
            python=platform.python_version(),platform=platform.platform(),device="mps",modelStartupMs=startup,
            replayWallMs=1000*(perf_counter()-started),maxWallSeconds=MAX_SECONDS,maxReceiptBytes=MAX_BYTES,
            timingScope="Sequential A then B, one resident model but actual duplicate field computation. Shared detector once/frame. Per-lane product includes preparation, detector, own camera and own measurement. Startup/total separate; no phone/realtime/thermal claim.",
            countersScope="No field cache/logical inference counters: every lane direction is an actual resident RAFT direction. Up to8 combined/frame.")
        receipt_contract(receipt);write_new(args.output,receipt)
        print(json.dumps(dict(output=str(args.output),frames=100,actualDirections=provider.direction_calls)))
    except Exception as error:
        write_new(args.output.with_name(args.output.stem+'-incomplete.json'),dict(study="M3U",status="FAILED-INCOMPLETE-NOT-SCORABLE",
            inputSha256=input_hash,reviewCoverageSha256=coverage_hash,codeSha256=before,policies=snapshot,
            actualModelDirections=0 if provider is None else provider.direction_calls,completedValidatedClips=clips,partialClipProgress=getattr(error,'m3u_progress',None),
            errorType=type(error).__name__,error=str(error)[:300],replayWallMs=1000*(perf_counter()-started)))
        raise


def receipt_contract(receipt):
    from assist_scene_global_field import POLICY as field
    finite_payload(receipt)
    require(receipt.get("study")=="M3U"and receipt.get("schemaVersion")==1 and receipt.get("developmentOnly")is False
        and receipt.get("codeSha256")=={n:sha256(HERE/n)for n in CODE}and receipt.get("policies")==policies()
        and receipt.get("device")=="mps"and receipt.get("provider",{}).get("policy")==dict(field)
        and receipt.get("weightsSha256")==field["weightSha256"]and receipt.get("opencv")==cv2.__version__
        and receipt.get("numpy")==np.__version__ and receipt.get("reviewFormatStudy")=="M3Q"
        and receipt.get("detectorProvenance")==dict(kind="actual-local-CoreML-no-cached-observations"),"wrong-M3U-runtime-source-policy")
    require(sum(len(c["frames"])for c in receipt["clips"])==100 and receipt["maxWallSeconds"]==900
        and receipt["maxReceiptBytes"]==MAX_BYTES and 0<=receipt["replayWallMs"]<=900000,"actual-scope-budget")
    total=0
    for clip in receipt["clips"]:
        require(clip["detectorCalls"]==len(clip["frames"])and clip["detectorConfiguration"]==DETECTOR_CONFIGURATION
            and clip["detectorBatches"]==(len(clip["frames"])+49)//50,"detector-count-config")
        for lane in LANES:
            require(all(type(f["flowDirectionCalls"][lane])is int and f["flowDirectionCalls"][lane]in(0,2,4)
                and f["actualCalls"][lane]==dict(raft=f["flowDirectionCalls"][lane])for f in clip["frames"]),"invalid-actual-counter")
            calls=sum(f["flowDirectionCalls"][lane]for f in clip["frames"]);total+=calls
            require(clip["actualFlowDirectionCallsByLane"][lane]==calls,"lane-actual-counter")
    require(receipt["actualModelDirections"]==total and total<=800,"resident-model-counter")


def score(receipt,truth,inputs):
    receipt_contract(receipt);bind_input(receipt,inputs);finite_payload(truth)
    require(truth["inputSha256"]==receipt["inputSha256"]and [c["id"]for c in truth["clips"]]==[c["id"]for c in receipt["clips"]],"unbound-reviewed-truth")
    contract=legacy_score();totals={l:Counter(contract.empty())for l in LANES};clips=[];all_frames=[]
    for clip,gt,input_clip in zip(receipt["clips"],truth["clips"],inputs["clips"],strict=True):
        labels={f["token"]:f for f in gt["frames"]};stats={l:contract.empty()for l in LANES};history=[]
        require(len(labels)==len(gt["frames"])and labels.keys()<={f["token"]for f in clip["frames"]},"foreign-reviewed-frame")
        origin=input_clip["frames"][0]["timestampUs"]
        for index,row in enumerate(clip["frames"]):
            bind_frame_source(row,input_clip["frames"][index],index,origin)
            frame_contract(row,history)
            reviewed=labels.get(row["token"]);targets=None if reviewed is None else [{**t,"motion":
                {"approaching":"moving","not-approaching":"stationary","unknown":"unknown"}[t["approach"]]}for t in reviewed["targets"]]
            for lane in LANES:contract.score_frame(row,lane,targets,stats[lane])
            history.append(row);all_frames.append(row)
        for lane in LANES:totals[lane].update(stats[lane])
        clips.append(dict(id=clip["id"],lanes=stats))
    timing={l:_percentiles([f["detectorObservationMs"]+sum(f["timingsMs"][k]for k in ("fullPreparation","sharedPrep","T_"+l,l))for f in all_frames])for l in LANES}
    return dict(schemaVersion=1,study="M3U",inputSha256=receipt["inputSha256"],frames=len(all_frames),unit="reviewed target-keyframe",
        totals=totals,clips=clips,pairedProductMs=timing,actualModelDirections=receipt["actualModelDirections"],
        detectorVsGT=baseline.detector_gt_metrics(receipt,truth),cameraStatus={l:dict(Counter(f["T_"+l]["status"]for f in all_frames))for l in LANES},
        limits="Radial approach references differ from optical expansion. Unknown/unmatched/unreviewed notices separate; no ranges, safety, phone, realtime or LLM superiority acceptance.")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);jobs=parser.add_subparsers(dest='job',required=True)
    p=jobs.add_parser('replay')
    for key in ('input','review-coverage','sceneqa','yolo','flow-weights','output'):p.add_argument('--'+key,type=Path,required=True)
    p.add_argument('--device',choices=('mps',),required=True)
    p=jobs.add_parser('score')
    for key in ('receipt','truth','input','output'):p.add_argument('--'+key,type=Path,required=True)
    args=parser.parse_args()
    if args.job=='replay':replay(args)
    else:
        receipt=json.loads(args.receipt.read_text());truth=json.loads(args.truth.read_text());inputs,_=load_input(args.input)
        require(sha256(args.truth)==receipt['reviewedTruthSha256']and sha256(args.input)==receipt['inputSha256'],'reviewed-truth-or-input-changed')
        result=score(receipt,truth,inputs);result.update(receiptSha256=sha256(args.receipt),truthSha256=sha256(args.truth));write_new(args.output,result)
