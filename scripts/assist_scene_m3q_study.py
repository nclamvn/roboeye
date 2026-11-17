#!/usr/bin/env python3
"""M3Q fresh-road A/B, actual serial RAFT and independent descriptor verifier.

Replay opens runtime inputs and a BOX-FREE completed-review coverage seal only.
Ground-truth boxes/approach labels are opened exclusively by score. The exact
frozen A baseline is M3O A: source-texture plus flow-warped pixel verification.
"""
import argparse
from collections import Counter
from copy import deepcopy
from datetime import date
from hashlib import sha256 as bytes_sha
import json
from pathlib import Path
import platform
import shutil
import tempfile
from time import perf_counter

import cv2
import numpy as np

import assist_scene_m3o_study as baseline
import assist_scene_m3q_correspondence as candidate
import audit_assist_scene_m3k as audit
from assist_scene_motion import parse_detect, sha256
from assist_scene_motion_m3c import load_input
from assist_scene_m3e_study import output, read_frame, legacy_score
from assist_scene_m3f_study import stage
from assist_scene_m3g_study import model_hashes, DETECTOR_CONFIGURATION, finite_payload, lane_contract, bind_input, _percentiles
from assist_scene_m3h_study import cohort_contract

HERE=Path(__file__).resolve().parent
LANES=("A","B"); SURFACES=("T",*LANES,"S")
CODE=tuple(dict.fromkeys((*baseline.CODE,"assist_scene_m3q_correspondence.py","assist_scene_m3q_study.py")))
MAX_FRAMES,MAX_SECONDS,MAX_BYTES=150,1800,256*1024**2
require=baseline._require
canonical=baseline.canonical_hash


def policies():
    from assist_scene_textured_window import POLICY as A
    keys=("minPoints","minSupport","minCorrelation","maxFlowFbPx","maxAnisotropyLog","maxRotationDeg",
          "maxLinearLogGrowth","maxBoxLogDisagreement","minNetLinearGrowth","minCurrentLinearGrowth",
          "maxEstimatorLogGrowthSpan","associationMargin","minSpan","minHull","ransacThresholdPx",
          "minRepresentedWorkingSidePx","maxGapMs","minWindowMs","maxWindowMs")
    require(all(A[k]==candidate.POLICY[k] for k in keys),"M3Q weakens frozen geometry/temporal floors")
    return json.loads(json.dumps(dict(A=dict(A),B=dict(candidate.POLICY))))


def write_new(path,value):
    data=json.dumps(value,separators=(",",":"),allow_nan=False).encode()
    require(len(data)<=MAX_BYTES and not path.exists() and not path.is_symlink(),"Output exists or exceeds receipt budget")
    with path.open("xb") as stream:stream.write(data)


def coverage_contract(value,input_hash):
    require(value.get("schemaVersion")==1 and value.get("study")=="M3Q" and value.get("inputSha256")==input_hash
        and value.get("completeSelectedCandidateReview") is True and value.get("notExhaustiveSceneTruth") is True
        and value.get("modelOutputsSeen") is False,"Incomplete/unbound selected-candidate review")
    counts=[value.get(k) for k in ("reviewedCandidateUnits","correctedBoxUnits","unscorableCandidateUnits")]
    require(all(type(n) is int and n>=0 for n in counts) and counts[0]>0 and counts[0]==counts[1]+counts[2]
        and counts[1]>0,"Review coverage silently loses candidate units")
    for key in ("candidatesSha256","selectionAccountingSha256","checkedSha256","boundTruthSha256"):
        require(baseline._digest(value.get(key)),"Coverage lacks source-binding hashes")
    require(set(value)<={"schemaVersion","study","inputSha256","candidatesSha256","selectionAccountingSha256",
        "checkedSha256","boundTruthSha256","reviewedCandidateUnits","correctedBoxUnits","unscorableCandidateUnits",
        "omissions","scope","completeSelectedCandidateReview","notExhaustiveSceneTruth","modelOutputsSeen"},
        "Coverage gate must not carry runtime GT boxes or metric coordinates")


def surface_contract(frame):
    for lane in SURFACES:
        lane_contract(frame[lane],frame["timeMs"])
        audit._tracks({**frame,"candidateDetections":frame["detections"]},lane)
        audit._no_range({k:v for k,v in frame[lane].items() if k!="answers"})
        if lane in LANES:
            require(frame[lane]["tracks"]==frame["T"]["tracks"] and frame[lane]["epoch"]==frame["T"]["epoch"]
                and frame[lane]["diagnostics"]["sourceStatus"]==frame["T"]["status"],"Candidate changed current IDs/camera authority")
            require(frame["T"]["status"]=="valid" or not frame[lane]["events"],"Camera veto bypassed")
    cohort_contract(frame["T"],frame["timeMs"])


def _inventory(inv,frame):
    require(isinstance(inv,dict) and inv.get("sourceOnly") is True
        and inv.get("sourceToken")==frame["token"] and inv.get("sourceMs")==frame["timeMs"]
        and inv.get("originalSourceSha256")==frame["sourceSha256"]
        and inv.get("sourceSha256")==frame["workingPixelsSha256"] and inv.get("sourceShape")==[frame["height"],frame["width"]]
        and inv.get("catalogSha256")==canonical(inv.get("keypoints")) and baseline._digest(inv.get("descriptorsSha256"))
        and len(inv.get("keypoints",[]))<=candidate.POLICY["maxFeatures"]
        and len(inv.get("selections",[]))==len(frame["detections"])
        and inv.get("selectionSha256s")==[canonical(s) for s in inv["selections"]],"Wrong sealed RootSIFT source inventory")
    for i,s in enumerate(inv["selections"]):
        require(s.get("sourceOnly") is True and s.get("sourceSha256")==frame["workingPixelsSha256"]
            and s.get("sourceShape")==[frame["height"],frame["width"]] and s.get("selectorPolicy")==dict(candidate.POLICY)
            and audit._same(s.get("sourceBox"),baseline.old._box_pixels(frame,i))
            and 0<=s.get("seedPoints",-1)<=64 and s["seedPoints"]==len(s.get("indices",[]))==len(s.get("points",[]))
            and len(set(s["indices"]))==len(s["indices"])
            and s["points"]==[inv["keypoints"][j]["point"] for j in s["indices"]],"Source-only descriptor selection changed")


def _population(proof,exposure,target,selection):
    require(proof.get("status")=="measured" and proof.get("mode")=="rootsift-independent-strict-flow"
        and proof.get("selection")==selection and proof.get("selectionSha256")==canonical(selection)
        and proof.get("oldWorkingSha256")==exposure["workingPixelsSha256"]
        and proof.get("newWorkingSha256")==target["workingPixelsSha256"]
        and proof.get("seedPoints")==selection["seedPoints"],"Population is not bound to original selected pixels")
    points=proof.get("points",[])
    require(len(points)==selection["seedPoints"] and [r.get("pointIndex") for r in points]==list(range(len(points)))
        and [r.get("sourcePoint") for r in points]==selection["points"]
        and all(type(r.get("good")) is bool for r in points)
        and proof.get("verifiedPoints")==sum(r["good"] for r in points),"Original selected denominator was pruned")
    for record in points:
        if not record["good"]:continue
        pair=record.get("descriptorMatch",{})
        require(all(pair.get(d,{}).get("unique") is True and 0<=pair[d].get("descriptorDistance",-1)
            <.70*pair[d].get("secondDescriptorDistance",-1) for d in ("forward","reverse"))
            and baseline._number(record.get("sourcePatchVariance")) and record["sourcePatchVariance"]>=16.
            and record.get("patchValidSamples")==49 and record.get("patchCycleCount",-1)>=.70*49
            and baseline._number(record.get("centerCyclePx")) and 0<=record["centerCyclePx"]<=1.3
            and baseline._number(record.get("flowEndpointAgreementPx")) and 0<=record["flowEndpointAgreementPx"]<=1.3
            and baseline._number(record.get("correlation")) and record["correlation"]>=.70
            and baseline._number(record.get("normProduct")) and record["normProduct"]>=49*4**2
            and abs(record.get("linearLogGrowth",999))<=.40 and abs(record.get("rotationDeg",999))<=15.,
            "Supported independent pixel violates unchanged NCC/cycle/shape or new descriptor floor")
        require(candidate.footprint_inside(record["sourcePoint"],record["sourceDescriptorRadiusPx"],selection["sourceBox"]),
                "Object proof borrowed background descriptor support")


def candidate_contract(frame,history):
    surface=frame["B"]; diag=surface["diagnostics"]; fields=diag["globalFields"]; comparisons=diag["comparisons"]
    require(diag.get("method")==candidate.POLICY["method"] and diag.get("sourceSelectionBeforeCorrespondence") is True,
            "Wrong independent verifier")
    _inventory(diag["sourceSelections"],frame)
    fresh,anchor=baseline.old.selected_origins(baseline._view(frame,"B"),[baseline._view(f,"B") for f in history],candidate.POLICY)
    origins=[] if fresh is None else [fresh]+([] if anchor is None else [anchor])
    require([f["startToken"] for f in fields]==[o["token"] for o in origins]
        and frame["flowDirectionCalls"]["B"]==2*len(fields)
        and diag["cost"]==dict(globalPairs=len(fields),globalDirectionCalls=2*len(fields),candidateComparisons=len(comparisons)),
        "Candidate source/execution schedule differs")
    populations={p["populationId"]:p for p in diag.get("populations",[])}
    require(len(populations)==len(diag.get("populations",[])),"Duplicate population ID")
    needed_pop=set();by_field={}
    for field,origin in zip(fields,origins,strict=True):
        actual=next(row for row in history if row["token"]==origin["token"])
        fid=actual["token"]+"->"+frame["token"]
        require(field["fieldId"]==fid and field["startSha256"]==actual["sourceSha256"]
            and field["endSha256"]==frame["sourceSha256"] and field["endToken"]==frame["token"]
            and field["startMs"]==actual["timeMs"] and field["endMs"]==frame["timeMs"]
            and field["oldWorkingPixelsSha256"]==actual["workingPixelsSha256"]
            and field["newWorkingPixelsSha256"]==frame["workingPixelsSha256"],"Wrong actual correspondence source")
        baseline.provider_contract(field,frame,"A")
        match=field["descriptorMatching"]
        require(match["policy"]==dict(candidate.POLICY) and match["pairCount"]==len(match["pairs"])
            and match["oldCatalogSha256"]==actual["B"]["diagnostics"]["sourceSelections"]["catalogSha256"]
            and match["newCatalogSha256"]==diag["sourceSelections"]["catalogSha256"],"Wrong global descriptor pair catalog")
        for direction,exposure,target in (("forward",actual,frame),("reverse",frame,actual)):
            inventory=exposure["B"]["diagnostics"]["sourceSelections"]
            for index,selection in enumerate(inventory["selections"]):
                pid=f"{fid}|{direction}|{index}";needed_pop.add(pid);entry=populations.get(pid,{})
                require(entry.get("fieldId")==fid and entry.get("direction")==direction and entry.get("detectionIndex")==index
                    and entry.get("sourceToken")==exposure["token"] and entry.get("sourceSha256")==exposure["sourceSha256"]
                    and entry.get("selectionSha256")==canonical(selection) and entry.get("populationSha256")==canonical(entry.get("proof")),
                    "Wrong population provenance")
                _population(entry["proof"],exposure,target,selection)
        rows=baseline.old._eligible_matrix(actual,frame,candidate.POLICY)
        raw=[p for p in comparisons if p["fieldId"]==fid];pairs={(p["endDetectionIndex"],p["startDetectionIndex"]):p for p in raw}
        require(len(pairs)==len(raw) and set(pairs)=={(j,i) for j,choices in enumerate(rows) for i in choices},"Unverifiable rival was dropped")
        for (j,i),pair in pairs.items():
            baseline._bounds(pair)
            require(pair["method"]==candidate.POLICY["method"] and pair["startToken"]==actual["token"]
                and pair["endToken"]==frame["token"] and pair["startMs"]==actual["timeMs"] and pair["endMs"]==frame["timeMs"]
                and audit._same(pair["startBox"],baseline.old._box_pixels(actual,i))
                and audit._same(pair["endBox"],baseline.old._box_pixels(frame,j)),"Wrong pair source/box")
            bad_geometry=False
            for rectangle,exposure in ((pair["startBox"],actual),(pair["endBox"],frame)):
                x,y,r,b=rectangle
                bad_geometry |= min(x,y,exposure["width"]-r,exposure["height"]-b)<4 or min(r-x,b-y)<18
            n_small=min(pair[d]["seedPoints"] for d in ("forward","reverse"))<9
            require(pair.get("unverifiable") is bool(bad_geometry or n_small),"Wrong geometry/source-selection uncertainty flag")
            for direction,source,target,index,source_box,target_box in (("forward",actual,frame,i,pair["startBox"],pair["endBox"]),
                    ("reverse",frame,actual,j,pair["endBox"],pair["startBox"])):
                value=pair[direction];entry=populations[value["populationId"]];pop=deepcopy(entry["proof"])
                require(value["populationSha256"]==entry["populationSha256"] and value["selectionSha256"]==entry["selectionSha256"],"Pair references wrong source population")
                if pair["unverifiable"]:
                    require(not pair["supported"] and not value["supported"]
                        and value["verifiedPoints"]==value["assignedPoints"]==value["points"]==0
                        and value["unknownPoints"]==value["seedPoints"],"Geometry-ineligible rival did not remain entirely unknown")
                    continue
                excluded=value.get("targetDescriptorSupportUnknownIndices",[])
                require(excluded==sorted(set(excluded)) and all(type(n) is int and 0<=n<len(pop["points"]) for n in excluded),"Malformed target support unknowns")
                for n in excluded:
                    record=pop["points"][n]
                    require(record["good"] and not candidate.footprint_inside(record["destinationPoint"],record["destinationDescriptorRadiusPx"],target_box),
                        "Target support pruning lacks evidence")
                    record["good"]=False
                if value["seedPoints"]:
                    baseline.direction_contract(value,pop,source,target,source_box,target_box,candidate.POLICY)
                else:require(value["points"]==value["assignedPoints"]==value["verifiedPoints"]==0,"Zero-source fabricated support")
            if pair["supported"]:
                require(not pair["unverifiable"] and pair["growthSpan"]<=.005 and all(pair[d]["supported"] for d in ("forward","reverse")),"Unsupported bidirectional pair")
        by_field[fid]=(actual,rows,pairs)
    require(set(populations)==needed_pop and all(p["fieldId"] in by_field for p in comparisons),"Foreign/omitted population/comparison")
    for event in surface["events"]:
        proof=diag["windowEvidence"].get(str(event["trackId"]),{})
        require(proof.get("confirmed") is True and fresh is not None and anchor is not None,"No three-source warning evidence")
        for name,origin in (("fresh",fresh),("anchor",anchor)):
            pair=proof[name];actual,rows,pairs=by_field[pair["fieldId"]];j,i=pair["endDetectionIndex"],pair["startDetectionIndex"]
            require(actual["token"]==origin["token"] and pair["supported"]
                and audit._same({k:v for k,v in pair.items() if k!="association"},pairs[j,i]),"Warning not supported by executed comparison")
            lower=baseline._bounds(pair)[0]
            require(lower-max((pairs[j,k]["scoreUpper"] for k in rows[j] if k!=i),default=-1.)>=.08
                and lower-max((p["scoreUpper"] for (other,k),p in pairs.items() if k==i and other!=j),default=-1.)>=.08,
                "Warning loses reciprocal uniqueness against unknown rival")
            require(frame["T"]["tracks"][j]["id"]==event["trackId"],"Wrong current camera handle")
        first,recent=proof["anchor"],proof["fresh"]
        require(len({first["startMs"],recent["startMs"],frame["timeMs"]})==3
            and recent["linearLogGrowthLowerBound"]>=candidate.POLICY["minCurrentLinearGrowth"]
            and first["linearLogGrowthLowerBound"]>=candidate.POLICY["minNetLinearGrowth"]
            and event["linearLogGrowth"]==first["linearLogGrowthLowerBound"]
            and audit._same(event["logAreaGrowth"],2*event["linearLogGrowth"]),"Warning ignores unchanged temporal expansion floor")


def frame_contract(frame,history):
    surface_contract(frame)
    baseline.global_contract(frame,history,"A")
    candidate_contract(frame,history)
    require([f["startToken"] for f in frame["A"]["diagnostics"]["globalFields"]]
        ==[f["startToken"] for f in frame["B"]["diagnostics"]["globalFields"]],"A/B source schedules differ")


def run_clip(clip,root,work,exe,model,provider,deadline,receipt_budget=None):
    budget={"validatedBytes":0} if receipt_budget is None else receipt_budget
    progress=dict(clipId=clip["id"],frameIndex=None,phase="staging",validatedFrames=[])
    try:return _run_clip(clip,root,work,exe,model,provider,deadline,budget,progress)
    except Exception as error:
        error.m3q_progress=progress
        raise


def _run_clip(clip,root,work,exe,model,provider,deadline,budget,progress):
    from assist_scene_textured_window import TexturedGlobalWindowMotion
    from assist_scene_cohort_loom import CohortWindowLoom
    from assist_scene_m3d_study import BoxBaseline
    started=perf_counter();origin=clip["frames"][0]["timestampUs"];prepared=[];rows=[]
    for i,source in enumerate(clip["frames"]):
        baseline.old._deadline(deadline);tick=perf_counter();folder=work/str(i);folder.mkdir()
        frames,samples,shapes=stage(dict(frames=[source]),root,folder)
        prepared.append((frames[0],samples[0][2],shapes[0],1000*(perf_counter()-tick)))
    staging=1000*(perf_counter()-started)
    samples=[(i,(f["timestampUs"]-origin)/1000.,prepared[i][1]) for i,f in enumerate(clip["frames"])]
    progress["phase"]="detector"
    found,batch_ms,batches=baseline.old.previous.previous._detect_batched(samples,exe,model)
    engines=dict(T=CohortWindowLoom(),S=BoxBaseline(),A=TexturedGlobalWindowMotion(provider,mode="warped"),B=candidate.RootSiftGlobalWindowMotion(provider))
    validation_ms=0.;clip_bytes=0
    for i,(frame,filename,shape,prep_ms) in enumerate(prepared):
        progress.update(frameIndex=i,phase="frame-preparation")
        baseline.old._deadline(deadline);h,w,nh,nw=shape;at=samples[i][1]
        tick=perf_counter();gray=read_frame(filename,cv2.IMREAD_GRAYSCALE);working_ms=1000*(perf_counter()-tick)
        tick=perf_counter();native=cv2.cvtColor(baseline.old.previous.previous._read_native(root/frame["path"],frame["sha256"]),cv2.COLOR_BGR2GRAY);native_ms=1000*(perf_counter()-tick)
        found_at,observation=found[i];require(found_at==at,"Wrong detector exposure clock");boxes=parse_detect(observation,w,h)
        row=dict(index=i,token=frame["token"],timestampUs=frame["timestampUs"],timeMs=at,sourceSha256=frame["sha256"],
            sourcePoseTimestampUs=frame.get("poseTimestampUs"),sourcePoseEpoch=frame.get("epoch"),
            workingPixelsSha256=bytes_sha(gray.tobytes()).hexdigest(),width=w,height=h,nativeWidth=nw,nativeHeight=nh,
            cameraIntrinsics=np.asarray(frame["intrinsics"]).tolist(),cameraToWorld=np.asarray(frame["cameraToWorld"]).tolist(),
            detectorGapInjected=False,detections=[b.record(w,h) for b in boxes],oldObservation=observation,
            detectorObservationMs=observation["detectionMs"],flowDirectionCalls={},actualCalls={},
            timingsMs=dict(fullPreparation=prep_ms,sharedPrep=working_ms+native_ms,workingDecode=working_ms,nativeDecode=native_ms))
        for lane in ("T","S"):
            cv2.setRNGSeed(650500+i);tick=perf_counter()
            result=engines[lane].update(frame,at,gray,boxes,native_gray=native) if lane=="T" else engines[lane].update(frame,at,gray,boxes)
            row[lane]=output(result,at);row["timingsMs"][lane]=1000*(perf_counter()-tick)
        order=LANES if i%2==0 else LANES[::-1]
        row["executionOrder"]=list(order)
        for lane in order:
            progress["phase"]="engine-"+lane
            cv2.setRNGSeed(650500+i);before=provider.direction_calls;tick=perf_counter()
            row[lane]=output(engines[lane].update(frame,at,gray,boxes,camera_surface=row["T"]),at)
            row["timingsMs"][lane]=1000*(perf_counter()-tick)
            row["flowDirectionCalls"][lane]=provider.direction_calls-before
            row["actualCalls"][lane]=dict(raft=provider.direction_calls-before)
        progress["phase"]="contracts-and-receipt-budget";tick=perf_counter()
        frame_contract(row,rows)
        row_bytes=len(json.dumps(row,separators=(",",":"),allow_nan=False).encode())
        require(budget["validatedBytes"]+row_bytes<=MAX_BYTES-1024**2,"Incremental receipt budget exhausted; no failed-point pruning permitted")
        budget["validatedBytes"]+=row_bytes;clip_bytes+=row_bytes;rows.append(row)
        progress["validatedFrames"]=rows
        progress["totalValidatedBytes"]=budget["validatedBytes"]
        validation_ms+=1000*(perf_counter()-tick)
        if i%10==0:print(json.dumps(dict(clip=clip["id"],frame=i,actualDirections=provider.direction_calls)),flush=True)
    return dict(id=clip["id"],frames=rows,detectorCalls=len(rows),detectorBatches=batches,
        detectorConfiguration=DETECTOR_CONFIGURATION,detectorBatchWallMs=batch_ms,stageWallMs=staging,
        actualFlowDirectionCallsByLane={l:sum(f["flowDirectionCalls"][l] for f in rows) for l in LANES},studyWallMs=1000*(perf_counter()-started),
        receiptValidationAndFrameSerializationMs=validation_ms,serializedFrameBytes=clip_bytes)


def replay(args):
    from assist_scene_global_field import GlobalRaftSmall
    started=perf_counter();deadline=started+MAX_SECONDS;inputs,root=load_input(args.input)
    require(1<=sum(len(c["frames"]) for c in inputs["clips"])<=MAX_FRAMES and args.device=="mps"
        and not args.output.exists() and not args.output.is_symlink(),"New bounded explicit MPS replay required")
    require(shutil.disk_usage(args.output.parent).free>=10*1024**3,"Disk floor10GiB")
    coverage=json.loads(args.review_coverage.read_text());coverage_contract(coverage,sha256(args.input))
    source_hashes={f["path"]:f["sha256"] for c in inputs["clips"] for f in c["frames"]}
    require(all(sha256(root/p)==h for p,h in source_hashes.items()),"Source bytes changed")
    before={n:sha256(HERE/n) for n in CODE};snapshot=policies();exe=args.sceneqa.resolve(strict=True);model=args.yolo.resolve(strict=True)
    hashes=model_hashes(model);exe_hash=sha256(exe);cv2.setNumThreads(1);tick=perf_counter()
    provider=GlobalRaftSmall(args.flow_weights,device="mps");startup=1000*(perf_counter()-tick);clips=[];receipt_budget=dict(validatedBytes=0)
    try:
        with tempfile.TemporaryDirectory(prefix=f"codex-tmp-m3q-{date.today():%Y%m%d}-",dir=args.output.parent) as temp:
            for i,clip in enumerate(inputs["clips"]):
                work=Path(temp)/str(i);work.mkdir();clips.append(run_clip(clip,root,work,exe,model,provider,deadline,receipt_budget))
        require(before=={n:sha256(HERE/n) for n in CODE} and snapshot==policies(),"Sources/policies changed during execution")
        require(provider.direction_calls==sum(c["actualFlowDirectionCallsByLane"][l] for c in clips for l in LANES),"Actual resident model directions differ")
        receipt=dict(schemaVersion=1,study="M3Q",dataset=inputs["dataset"],developmentOnly=False,inputSha256=sha256(args.input),
            reviewCoverageSha256=sha256(args.review_coverage),reviewedTruthSha256=coverage["boundTruthSha256"],
            clips=clips,codeSha256=before,policies=snapshot,provider=provider.metadata,weightsSha256=sha256(args.flow_weights),
            actualModelDirections=provider.direction_calls,sceneqaSha256=exe_hash,yoloModelHashes=hashes,
            serializedFrameBytes=receipt_budget["validatedBytes"],
            detectorProvenance=dict(kind="actual-local-CoreML-no-cached-observations"),opencv=cv2.__version__,numpy=np.__version__,
            python=platform.python_version(),platform=platform.platform(),device="mps",modelStartupMs=startup,replayWallMs=1000*(perf_counter()-started),
            maxWallSeconds=MAX_SECONDS,maxReceiptBytes=MAX_BYTES,
            timingScope="Counterbalanced serial actualA/B; one resident checkpoint, independent actualRAFT directions perarm. Includes ownfeature/verification, detector/staging/camera added in paired-product summaries. No UI/realtime/thermal acceptance.",
            countersScope="Actual RAFT directions only; no cached/historical fields counted as inference.")
        receipt_contract(receipt);write_new(args.output,receipt)
        print(json.dumps(dict(output=str(args.output),frames=sum(len(c["frames"]) for c in clips),actualDirections=provider.direction_calls)))
    except Exception as error:
        failure=dict(study="M3Q",status="FAILED-INCOMPLETE-NOT-SCORABLE",actualModelDirections=provider.direction_calls,
            completedValidatedClips=clips,partialClipProgress=getattr(error,"m3q_progress",None),
            validatedSerializedFrameBytes=receipt_budget["validatedBytes"],errorType=type(error).__name__,error=str(error)[:300],codeSha256=before)
        write_new(args.output.with_name(args.output.stem+"-incomplete.json"),failure)
        raise


def receipt_contract(receipt):
    from assist_scene_global_field import POLICY as FIELD
    finite_payload(receipt)
    require(receipt.get("schemaVersion")==1 and receipt.get("study")=="M3Q" and receipt.get("developmentOnly") is False
        and receipt.get("codeSha256")=={n:sha256(HERE/n) for n in CODE} and receipt.get("policies")==policies()
        and receipt.get("device")=="mps" and receipt.get("opencv")==cv2.__version__ and receipt.get("numpy")==np.__version__
        and receipt.get("provider",{}).get("policy")==dict(FIELD) and receipt.get("weightsSha256")==FIELD["weightSha256"],"Wrong runtime/source/policies")
    frames=sum(len(c["frames"]) for c in receipt["clips"])
    require(1<=frames<=MAX_FRAMES and receipt.get("actualModelDirections")==sum(c["actualFlowDirectionCallsByLane"][l] for c in receipt["clips"] for l in LANES)
        and receipt.get("maxWallSeconds")==MAX_SECONDS and receipt.get("maxReceiptBytes")==MAX_BYTES
        and 0<=receipt["replayWallMs"]<=MAX_SECONDS*1000,"Actual frame/call/time budget mismatch")
    for clip in receipt["clips"]:
        require(clip["detectorCalls"]==len(clip["frames"]) and clip["detectorConfiguration"]==DETECTOR_CONFIGURATION,"Wrong actual detector contract")
        for l in LANES:
            require(clip["actualFlowDirectionCallsByLane"][l]==sum(f["flowDirectionCalls"][l] for f in clip["frames"])
                and all(f["actualCalls"][l]==dict(raft=f["flowDirectionCalls"][l]) for f in clip["frames"]),"Directions relabelled or omitted")


def score(receipt,truth,inputs):
    receipt_contract(receipt);finite_payload(truth);bind_input(receipt,inputs)
    require(truth.get("schemaVersion")==1 and truth.get("inputSha256")==receipt["inputSha256"]
        and [c["id"] for c in truth["clips"]]==[c["id"] for c in receipt["clips"]],"Unbound reviewed truth")
    contract=legacy_score();totals={l:Counter(contract.empty()) for l in (*LANES,"S")};results=[];all_frames=[]
    for ci,(clip,ref) in enumerate(zip(receipt["clips"],truth["clips"],strict=True)):
        known={f["token"]:f for f in ref["frames"]};history=[];origin=clip["frames"][0]["timestampUs"]
        require(len(known)==len(ref["frames"]) and known.keys()<={f["token"] for f in clip["frames"]},"Duplicate/foreign review frame")
        stats={l:contract.empty() for l in (*LANES,"S")}
        for i,frame in enumerate(clip["frames"]):
            source=inputs["clips"][ci]["frames"][i]
            require(frame["index"]==i and frame["timeMs"]==(source["timestampUs"]-origin)/1000.
                and frame["sourceSha256"]==source["sha256"] and frame["sourcePoseTimestampUs"]==source["poseTimestampUs"]
                and frame["detectorGapInjected"] is False,"Wrong source clock/pose/detector gap")
            k=np.diag((frame["width"]/frame["nativeWidth"],frame["height"]/frame["nativeHeight"],1.))@np.asarray(source["intrinsics"])
            require(audit._same(frame["cameraIntrinsics"],k.tolist()) and audit._same(frame["cameraToWorld"],source["cameraToWorld"]),"Camera metadata differs")
            require(frame["detections"]==[b.record(frame["width"],frame["height"]) for b in parse_detect(frame["oldObservation"],frame["width"],frame["height"])],"Current boxes differ from actual detector")
            frame_contract(frame,history)
            labels=known.get(frame["token"])
            targets=None if labels is None else [{**t,"motion":{"approaching":"moving","not-approaching":"stationary","unknown":"unknown"}[t["approach"]]} for t in labels["targets"]]
            for l in (*LANES,"S"):contract.score_frame(frame,l,targets,stats[l])
            history.append(frame);all_frames.append(frame)
        for l in totals:totals[l].update(stats[l])
        results.append(dict(id=clip["id"],lanes=stats))
    return dict(schemaVersion=1,study="M3Q",inputSha256=receipt["inputSha256"],frames=len(all_frames),unit="reviewed target-keyframe",
        totals=totals,clips=results,noMetreChecks=len(all_frames)*len(SURFACES),
        pairedProductMs={l:_percentiles([f["detectorObservationMs"]+sum(f["timingsMs"][k] for k in ("fullPreparation","sharedPrep","T",l)) for f in all_frames]) for l in LANES},
        actualModelDirections=receipt["actualModelDirections"],timingScope=receipt["timingScope"],codeSha256=receipt["codeSha256"],
        limits="Complete reviewed selected-candidate sample only, not exhaustive scene labels. FP on labelled negatives plus unknown/unmatched/unreviewed notices separately; no metres, phone, safety, human certification or real-time acceptance.")


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);subs=p.add_subparsers(dest="mode",required=True)
    q=subs.add_parser("replay")
    for key in ("input","sceneqa","yolo","flow-weights","review-coverage","output"):q.add_argument("--"+key,type=Path,required=True)
    q.add_argument("--device",choices=("mps",),required=True)
    q=subs.add_parser("score")
    for key in ("receipt","truth","input","output"):q.add_argument("--"+key,type=Path,required=True)
    a=p.parse_args()
    if a.mode=="replay":replay(a)
    else:
        r=json.loads(a.receipt.read_text());t=json.loads(a.truth.read_text());i,_=load_input(a.input)
        require(sha256(a.truth)==r["reviewedTruthSha256"],"Reviewed truth changed after inference")
        write_new(a.output,score(r,t,i))
