#!/usr/bin/env python3
"""Combine independently sealed blind reviews without altering their sources.

Only path prefixes and the derived input hash change; pixels, poses, object
references and visual decisions remain verbatim. No inference is performed.
"""
import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path

from assist_scene_motion_m3c import load_input


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def write_new(path,value):
    with path.open("x") as stream: json.dump(value,stream,indent=2,allow_nan=False);stream.write("\n")


def combine(components,out,common):
    if out.exists() or out.is_symlink():raise ValueError("Choose a new combined output")
    common=common.resolve(strict=True);sources=[];runtime=[];truths=[];rows=[];account=[];decisions={};omissions={};counts=Counter()
    identifiers=set();files=set();unit_counts=Counter();base_review=[]
    for raw in components:
        if len(raw)!=6:raise ValueError("Each component needs input,truth,coverage,candidates,accounting,checked")
        ip,tp,cp,gp,ap,dp=[Path(p).resolve(strict=True) for p in raw]
        # A sealed individual stop slice has one clip; the frozen runtime
        # loader deliberately requires2..5 clips. Validate the complete derived
        # three-clip runtime with that loader below, without changing its floor.
        inputs=json.loads(ip.read_text());root=(ip.parent/inputs.get("assetRoot",".")).resolve(strict=True)
        if inputs.get("schemaVersion")!=1 or inputs.get("dataset")!="Boreas-real" or not 1<=len(inputs["clips"])<=2:
            raise ValueError("Unexpected component runtime")
        gt,cov,gold,ledger,checked=[json.loads(p.read_text()) for p in (tp,cp,gp,ap,dp)]
        ih=digest(ip)
        if (gt["inputSha256"]!=ih or cov["inputSha256"]!=ih or gold["inputSha256"]!=ih or ledger["inputSha256"]!=ih or checked["inputSha256"]!=ih
                or cov["boundTruthSha256"]!=digest(tp) or cov["candidatesSha256"]!=digest(gp)
                or cov["selectionAccountingSha256"]!=digest(ap) or cov["checkedSha256"]!=digest(dp)
                or cov["completeSelectedCandidateReview"] is not True or cov["modelOutputsSeen"] is not False):
            raise ValueError("Component review/source/hash coverage mismatch")
        if not root.is_relative_to(common):raise ValueError("Component media must remain inside common existing QA root")
        prefix=root.relative_to(common)
        for clip in inputs["clips"]:
            if clip["id"] in identifiers:raise ValueError("Duplicate component clip")
            identifiers.add(clip["id"]);copy=deepcopy(clip)
            for f in copy["frames"]:
                source=root/f["path"]
                if source.is_symlink() or digest(source)!=f["sha256"]:raise ValueError("Component source pixel bytes changed")
                f["path"]=(prefix/f["path"]).as_posix()
                if f["path"] in files:raise ValueError("Duplicate source exposure")
                files.add(f["path"])
            runtime.append(copy)
        truths.extend(gt["clips"])
        for row in gold["rows"]:
            copy=deepcopy(row);tile=gp.parent/(row["key"]+".jpg")
            if digest(tile)!=row["tileSha256"]:raise ValueError("Component blind sheet changed")
            copy["tilePath"]=str(tile);rows.append(copy)
        account.extend(ledger["frames"]);counts.update(ledger["counts"])
        if set(decisions)&set(checked["frames"]):raise ValueError("Duplicate visual decision")
        decisions.update(checked["frames"]);omissions.update(checked.get("review",{}).get("omissions",{}))
        for k in ("reviewedCandidateUnits","correctedBoxUnits","unscorableCandidateUnits"):unit_counts[k]+=cov[k]
        base_review.append(checked["review"])
        sources.append(dict(input=str(ip),inputSha256=ih,truth=str(tp),truthSha256=digest(tp),
            coverage=str(cp),coverageSha256=digest(cp),candidates=str(gp),candidatesSha256=digest(gp),
            accounting=str(ap),accountingSha256=digest(ap),checked=str(dp),checkedSha256=digest(dp)))
    if len(files)!=150 or len(runtime)!=3:raise ValueError("Expected preregistered three150-frame slices")
    out.mkdir()
    combined=dict(schemaVersion=1,dataset="Boreas-real",assetRoot=os.path.relpath(common,out),clips=runtime)
    write_new(out/"input.json",combined);load_input(out/"input.json");ih=digest(out/"input.json")
    write_new(out/"candidates.json",dict(schemaVersion=1,inputSha256=ih,rows=rows,componentEvidence=sources))
    write_new(out/"selection-accounting.json",dict(schemaVersion=1,study="M3Q",inputSha256=ih,
        candidatesSha256=digest(out/"candidates.json"),scope="Combined fixed checkpoint strata, not exhaustive scene labels",
        counts=dict(counts),frames=account,componentEvidence=sources,modelCalls=0))
    visual=dict(kind="derived-binding-of-source-sealed-assistant-visual-reviews-before-model-inference",
        scope="No boxes/labels changed during combining; component reviews retained verbatim",omissions=omissions,
        components=base_review)
    write_new(out/"checked.json",dict(schemaVersion=1,inputSha256=ih,candidatesSha256=digest(out/"candidates.json"),
        selectionAccountingSha256=digest(out/"selection-accounting.json"),review=visual,frames=decisions))
    write_new(out/"truth-reviewed.json",dict(schemaVersion=1,inputSha256=ih,review=visual,
        reviewSha256=digest(out/"checked.json"),clips=truths))
    cover=dict(schemaVersion=1,study="M3Q",inputSha256=ih,candidatesSha256=digest(out/"candidates.json"),
        selectionAccountingSha256=digest(out/"selection-accounting.json"),checkedSha256=digest(out/"checked.json"),
        boundTruthSha256=digest(out/"truth-reviewed.json"),**unit_counts,omissions=omissions,
        scope="Combined fixed checkpoint strata; all selected candidates decided, not exhaustive scene truth",
        completeSelectedCandidateReview=True,notExhaustiveSceneTruth=True,modelOutputsSeen=False)
    write_new(out/"truth-reviewed-coverage.json",cover)
    write_new(out/"component-lineage.json",dict(schemaVersion=1,components=sources,
        combinedInputSha256=ih,combinedTruthSha256=cover["boundTruthSha256"],imageFiles=150,modelCalls=0))
    print(json.dumps(dict(inputSha256=ih,truthSha256=cover["boundTruthSha256"],counts=dict(unit_counts),
        targetsByApproach=dict(Counter(t["approach"] for c in truths for f in c["frames"] for t in f["targets"])))))


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--component",nargs=6,action="append",required=True,metavar=("INPUT","TRUTH","COVERAGE","CANDIDATES","ACCOUNTING","CHECKED"))
    p.add_argument("--common-root",type=Path,required=True);p.add_argument("--output-dir",type=Path,required=True)
    a=p.parse_args();combine(a.component,a.output_dir,a.common_root)
