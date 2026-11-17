#!/usr/bin/env python3
"""Posthoc source-identity review sheets, never runtime association evidence.

Original attributed PNGs are read only after byte/clock/geometry bindings pass.
Every distinct A/B/C selected box is retained; no match is labelled same merely
because a tracker, 3D label, or pixel verifier selected it. No model execution.
"""

import argparse
from collections import Counter
from functools import lru_cache
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw
import numpy as np

from assist_scene_motion import sha256
from assist_scene_motion_m3c import load_input
from assist_scene_m3e_study import legacy_score
from diagnose_assist_scene_m3k_misses import matching_graph


MAX_CASES, MAX_BYTES = 12, 256*1024**2
IDENTITIES = ("same", "different", "unknown")
COLORS = {"A": "#ffcf66", "B": "#7dd5ff", "C": "#db9dff"}


def require(value, message):
    if not value: raise ValueError(message)


def read(path, limit=MAX_BYTES):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= limit,
            "Missing, symlinked or oversized JSON")
    return json.loads(path.read_text())


def _box(value, width, height):
    require(isinstance(value, (list, tuple)) and len(value) == 4
        and all(type(x) in (int, float) and math.isfinite(x) for x in value), "Invalid box")
    x,y,r,b = map(float,value)
    require(0 <= x < r <= width and 0 <= y < b <= height, "Box outside source geometry")
    return [x,y,r,b]


def native_box(box, frame):
    bounds = _box(box, frame["width"], frame["height"])
    sx,sy = frame["nativeWidth"]/frame["width"],frame["nativeHeight"]/frame["height"]
    return [bounds[0]*sx,bounds[1]*sy,bounds[2]*sx,bounds[3]*sy]


def normalized_box(box, frame):
    return _box([box["x"]*frame["width"],box["y"]*frame["height"],
        (box["x"]+box["width"])*frame["width"],(box["y"]+box["height"])*frame["height"]],
        frame["width"],frame["height"])


def plan(inputs, receipt, truth, diagnosis, input_hash, receipt_hash, truth_hash):
    require(receipt.get("study") == "M3O" and receipt.get("developmentOnly") is False
        and receipt.get("inputSha256") == truth.get("inputSha256") == diagnosis.get("inputSha256") == input_hash
        and diagnosis.get("receiptSha256") == receipt_hash and diagnosis.get("truthSha256") == truth_hash,
        "Review does not bind the exact M3O input/receipt/truth/diagnosis")
    source = {(c["id"],f["token"]):f for c in inputs["clips"] for f in c["frames"]}
    rows = {(c["id"],f["token"]):f for c in receipt["clips"] for f in c["frames"]}
    refs = {(c["id"],f["token"]):f for c in truth["clips"] for f in c["frames"]}
    require(len(rows) == sum(len(c["frames"]) for c in receipt["clips"]), "Duplicate receipt frame")
    expected=set()
    for key,ref in refs.items():
        current=rows[key];graph=matching_graph(current["T"]["tracks"],ref["targets"],legacy_score())
        for index,match in graph["hits"].items():
            if ref["targets"][index]["approach"]=="approaching":expected.add((*key,ref["targets"][index]["instance"]))
    listed={(c["clipId"],c["frameToken"],c["target"]["instance"]) for c in diagnosis["cases"] if c.get("currentTrackMatch") is not None}
    require(listed==expected,"Diagnosis omitted or invented a qualified positive case")
    output = []
    for case in diagnosis["cases"]:
        if case.get("currentTrackMatch") is None: continue
        key = (case["clipId"],case["frameToken"]); current = rows[key]; raw = source[key]; ref = refs[key]
        require(current["timestampUs"] == raw["timestampUs"] == ref["timestampUs"]
            and current["sourceSha256"] == raw["sha256"] == case["sourceSha256"]
            and current["index"] == case["frameIndex"], "Current source/clock mismatch")
        require(case["target"] in ref["targets"] and case["target"]["approach"] == "approaching", "Target changed")
        graph = matching_graph(current["T"]["tracks"],ref["targets"],legacy_score())
        target_index = ref["targets"].index(case["target"])
        require(graph["hits"].get(target_index) == case["currentTrackMatch"], "Current qualification changed")
        j = case["currentTrackMatch"]["reportIndex"]; track = current["T"]["tracks"][j]
        require(track["id"] == case["currentHandle"], "Current handle changed")
        ident = f'{case["clipId"]}-{current["index"]:02d}-{case["target"]["instance"][:8]}'
        record = {"caseId":ident,"clipId":case["clipId"],"current":_exposure(raw,current),
            "target":case["target"],"currentHandle":track["id"],"currentDetectionIndex":j,
            "currentDetectorBox":normalized_box(track["box"],current),
            "currentTargetBox":normalized_box(case["target"]["box"],current),"sources":[],"units":[]}
        for role in ("fresh","anchor"):
            exposures = {}
            for lane in "ABC":
                selected = current[lane]["diagnostics"]["windowEvidence"].get(str(track["id"]),{}).get(role)
                stored = case["lanes"][lane].get(role)
                if selected is None or not selected.get("startToken"):
                    require(stored is None or not stored.get("startToken"), "Diagnostic/source availability mismatch")
                    continue
                require(stored is not None and all(stored.get(k) == selected.get(k) for k in
                    ("startToken","endToken","startDetectionIndex","endDetectionIndex")), "Selected hypothesis changed")
                token = selected["startToken"]; old = rows[(case["clipId"],token)]; original = source[(case["clipId"],token)]
                require(old["timestampUs"] == original["timestampUs"] < current["timestampUs"]
                    and old["sourceSha256"] == original["sha256"] == selected["startSha256"]
                    and selected["endToken"] == current["token"] and selected["endDetectionIndex"] == j,
                    "Past source/clock/current binding mismatch")
                k = selected["startDetectionIndex"]; box = normalized_box(old["detections"][k]["box"],old)
                require(all(abs(a-b) <= 1e-5 for a,b in zip(box,selected["startBox"])), "Past detector box changed")
                exposure = exposures.setdefault(token,{"role":role,**_exposure(original,old),"options":[]})
                option = next((o for o in exposure["options"] if o["detectionIndex"] == k),None)
                if option is None:
                    unit_id=f'{ident}|{role}|{token}|{k}'
                    option={"unitId":unit_id,"detectionIndex":k,"lanes":[],"workingBox":box,
                        "nativeBox":native_box(box,old),"label":old["detections"][k]["label"]}
                    exposure["options"].append(option);record["units"].append(unit_id)
                option["lanes"].append(lane)
            require(len(exposures) <= 1, "More than one selected exposure per role")
            record["sources"].extend(exposures.values())
        require(len(record["sources"]) <= 2, "More than two source exposures")
        output.append(record)
    require(0 < len(output) <= MAX_CASES and len({r["caseId"] for r in output}) == len(output), "Case budget/identity violation")
    return output


def _exposure(original, row):
    require(all(type(row[k]) is int and row[k]>1 for k in ("width","height","nativeWidth","nativeHeight")),"Invalid source dimensions")
    scale=np.diag((row["width"]/row["nativeWidth"],row["height"]/row["nativeHeight"],1.))
    k=np.asarray(original["intrinsics"],float);working=np.asarray(row["cameraIntrinsics"],float)
    require(k.shape==working.shape==(3,3) and np.isfinite(k).all() and np.isfinite(working).all()
        and np.allclose(scale@k,working,atol=1e-8,rtol=0),"Camera intrinsics not bound to source resize")
    require(original["cameraToWorld"]==row["cameraToWorld"],"Camera pose changed")
    return {"token":original["token"],"timestampUs":original["timestampUs"],"path":original["path"],
        "sourceSha256":original["sha256"],"index":row["index"],"nativeSize":[row["nativeWidth"],row["nativeHeight"]],
        "workingSize":[row["width"],row["height"]],"intrinsics":original["intrinsics"],
        "workingIntrinsics":row["cameraIntrinsics"],"cameraToWorld":original["cameraToWorld"]}


def _panel(image, options, heading):
    canvas=Image.new("RGB",(640,850),"#101820");draw=ImageDraw.Draw(canvas)
    draw.text((12,10),heading,fill="white")
    thumb=image.copy();thumb.thumbnail((640,535));canvas.paste(thumb,(0,45))
    sx,sy=thumb.width/image.width,thumb.height/image.height
    for number,option in enumerate(options):
        box=option["nativeBox"];color=COLORS[option["lanes"][0]]
        rect=[box[0]*sx,45+box[1]*sy,box[2]*sx,45+box[3]*sy]
        draw.rectangle(rect,outline=color,width=3)
        draw.text((rect[0],max(45,rect[1]-14)),f'{number+1}: {"/".join(option["lanes"])} idx{option["detectionIndex"]}',fill=color)
        cx,cy=(box[0]+box[2])/2,(box[1]+box[3])/2;half_w=max(64.,(box[2]-box[0])*.75);half_h=max(64.,(box[3]-box[1])*.75)
        crop=image.crop((max(0,int(cx-half_w)),max(0,int(cy-half_h)),min(image.width,math.ceil(cx+half_w)),min(image.height,math.ceil(cy+half_h))))
        crop.thumbnail((620//max(1,len(options)),220))
        x=10+number*(620//max(1,len(options)));canvas.paste(crop,(x,590))
        draw.text((x,815),f'{number+1} native box '+','.join(str(round(v,1)) for v in box),fill=color)
    return canvas


def build(args):
    inputs,root=load_input(args.input);receipt=read(args.receipt);truth=read(args.truth,4*1024**2);diagnosis=read(args.diagnosis,8*1024**2)
    hashes={k:sha256(getattr(args,k)) for k in ("input","receipt","truth","diagnosis")}
    records=plan(inputs,receipt,truth,diagnosis,hashes["input"],hashes["receipt"],hashes["truth"])
    require(not args.output.exists() and not args.output.is_symlink(),"Choose a new review directory")
    args.output.mkdir()
    @lru_cache(maxsize=4)
    def original(path,digest,size):
        source=root/path;require(source.is_file() and sha256(source)==digest,"Original PNG bytes changed")
        with Image.open(source) as image:
            require(image.format=="PNG" and image.size==size,"Original native PNG geometry changed")
            return image.convert("RGB")
    for r in records:
        cur=r["current"];image=original(cur["path"],cur["sourceSha256"],tuple(cur["nativeSize"]))
        row=next(f for c in receipt["clips"] for f in c["frames"] if f["token"]==cur["token"])
        current_options=[{"nativeBox":native_box(r["currentDetectorBox"],row),"lanes":["A","B","C"],"detectionIndex":r["currentDetectionIndex"]}]
        sheet=Image.new("RGB",(1920,910),"#101820");draw=ImageDraw.Draw(sheet)
        draw.text((12,8),r["caseId"]+"  CURRENT GT INSTANCE "+r["target"]["instance"]+"  POSTHOC ONLY",fill="white")
        panel=_panel(image,current_options,f'CURRENT index{cur["index"]} timestamp{cur["timestampUs"]}')
        target=native_box(r["currentTargetBox"],row);sx,sy=min(640/image.width,535/image.height),min(640/image.width,535/image.height)
        ImageDraw.Draw(panel).rectangle((target[0]*sx,45+target[1]*sy,target[2]*sx,45+target[3]*sy),outline="#4de2a8",width=2)
        sheet.paste(panel,(0,40))
        by_role={s["role"]:s for s in r["sources"]}
        for col,role in enumerate(("fresh","anchor"),1):
            source=by_role.get(role)
            if source is None:
                draw.text((640*col+12,60),role.upper()+": NO SELECTED SOURCE EVIDENCE",fill="white");continue
            image=original(source["path"],source["sourceSha256"],tuple(source["nativeSize"]))
            sheet.paste(_panel(image,source["options"],f'{role.upper()} index{source["index"]} timestamp{source["timestampUs"]}'),(640*col,40))
        draw.text((12,890),"Green=current reviewed target; source boxes are model hypotheses. Review SAME / DIFFERENT / UNKNOWN; no automatic identity claim.",fill="white")
        name=r["caseId"]+".png";sheet.save(args.output/name)
        r.update(sheet=name,sheetSha256=sha256(args.output/name))
    require(hashes=={k:sha256(getattr(args,k)) for k in hashes},"Review inputs changed while rendering")
    manifest={"schemaVersion":1,"study":"M3P-posthoc-source-identity-review","inputBindings":hashes,
        "sourceRoot":str(root),"generatorSha256":sha256(Path(__file__)),"cases":records,
        "attribution":"Boreas CC BY4.0, ASRL/UTIAS/University of Toronto and coauthors; derived review graphics; no endorsement.",
        "limits":"Assistant-authored visible identity review pending, not pixel-flow GT, human certification, motion inference or runtime evidence."}
    write(args.output/"manifest.json",manifest)
    print(json.dumps({"cases":len(records),"reviewUnits":sum(len(r["units"]) for r in records),"manifest":str(args.output/"manifest.json")}))


def review(manifest_path, decisions_path, output):
    manifest=read(manifest_path,8*1024**2);decisions=read(decisions_path,2*1024**2)
    require(decisions.get("manifestSha256")==sha256(manifest_path),"Decisions do not bind this manifest")
    units={u for c in manifest["cases"] for u in c["units"]};answers=decisions.get("units",{})
    require(set(answers)==units,"Every selected source hypothesis needs an explicit decision")
    for c in manifest["cases"]:
        require(sha256(manifest_path.parent/c["sheet"])==c["sheetSha256"],"Rendered review sheet changed")
    for a in answers.values():
        require(isinstance(a,dict) and a.get("identity") in IDENTITIES and isinstance(a.get("note"),str) and bool(a["note"].strip()),"Identity/uncertainty needs a note")
    counts=Counter(a["identity"] for a in answers.values())
    write(output,{"schemaVersion":1,"study":"M3P-posthoc-source-identity-decisions","manifestSha256":sha256(manifest_path),
        "decisionsSha256":sha256(decisions_path),"review":decisions.get("review"),"counts":dict(counts),"units":answers,
        "limits":"Visible identity judgement only, not learned matching or runtime rescue; unknown must not be counted different or same. No metric distance."})


def write(path,value):
    require(not path.is_symlink(),"Output symlink forbidden")
    with path.open("x") as stream:json.dump(value,stream,indent=2,allow_nan=False);stream.write("\n")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest="mode",required=True)
    p=sub.add_parser("build")
    for key in ("input","truth","receipt","diagnosis","output"):p.add_argument("--"+key,type=Path,required=True)
    p=sub.add_parser("review")
    for key in ("manifest","decisions","output"):p.add_argument("--"+key,type=Path,required=True)
    args=parser.parse_args()
    if args.mode=="build":build(args)
    else:review(args.manifest,args.decisions,args.output)
