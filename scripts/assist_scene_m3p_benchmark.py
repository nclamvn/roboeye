#!/usr/bin/env python3
"""Bounded M3P component A/B/C on independent Spring rendered flow reference.

Not official leaderboard scoring, real-road warning acceptance or metre output.
Spring GT has four spatial samples per native image pixel, but vectors already
use NATIVE IMAGE pixel units: never divide by two. Native-pixel error is minimum
endpoint error among those four samples, not error against their average.
Primary convention: https://www.spring-benchmark.org/faq and pinned code
https://github.com/cv-stuttgart/springwebsite/blob/b27a29c3af0c85f40f05a439311a6e02f706f764/springeval/management/commands/evaluation.py
https://github.com/cv-stuttgart/springwebsite/blob/b27a29c3af0c85f40f05a439311a6e02f706f764/subsampling/create_evalfiles.py
"""

import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import platform
import resource
import shutil
import subprocess
from time import perf_counter

import cv2
import numpy as np


HERE = Path(__file__).resolve().parent
MAX_PAIRS, MAX_SECONDS, MAX_RAW_BYTES = 4, 900, 80*1024**2
LANES = ("A-gray640", "B-RGB640", "C-RGB768")
CODE = ("assist_scene_m3p_benchmark.py", "assist_scene_m3p_field.py",
        "assist_scene_global_field.py", "assist_scene_learned_region.py",
        "fetch_assist_scene_flow_reference.py")
CONVENTION = {"groundTruthGrid": "2H,2W,2; four vectors per native H,W pixel",
    "groundTruthVectorUnit": "native-image-pixels-not-superresolved-grid-pixels",
    "pixelError": "minimum norm over 2x2 GT samples, no GT vector averaging or divide2",
    "invalidReference": "exclude native pixel if any of four GT vectors is nonfinite, matching official np.min then NaN exclusion",
    "invalidPrediction": "retain in valid-GT denominator, count as outlier, full mean unknown",
    "predictionRestoration": "whole-working-field bilinear half-pixel resize then actual per-axis vector scaling to native image",
    "Fl3and5": "EPE>3 AND EPE>0.05*maximum norm of four GT vectors",
    "matchMap": "native-H,W three-channel PNG: channel0>0 OR channel1>0, per official map loader",
    "scope": "all native pixels in selected train pairs, NOT official withheld subsampling/leaderboard"}


def require(condition, message):
    if not condition: raise ValueError(message)


def digest(path):
    with Path(path).open("rb") as stream: return __import__("hashlib").file_digest(stream, "sha256").hexdigest()


def restore_native(field, native_shape):
    require(isinstance(field, np.ndarray) and field.dtype == np.float32 and field.ndim == 3
        and field.shape[2] == 2 and min(field.shape[:2]) >= 1, "Expected working H,W,2 float32 flow")
    require(isinstance(native_shape, (tuple, list)) and len(native_shape) == 2
        and all(type(n) is int and n > 0 for n in native_shape), "Invalid native geometry")
    nh, nw = native_shape; h, w = field.shape[:2]
    result = field.copy() if (nh, nw) == (h, w) else cv2.resize(field, (nw, nh), interpolation=cv2.INTER_LINEAR)
    result[:, :, 0] *= nw/w; result[:, :, 1] *= nh/h
    return result


def superresolved_errors(prediction, reference):
    """Pure native-grid metrics, with bounded row chunks rather than 4x copies."""
    require(isinstance(prediction, np.ndarray) and prediction.ndim == 3 and prediction.shape[2] == 2,
        "Expected native H,W,2 prediction")
    h, w = prediction.shape[:2]
    require(isinstance(reference, np.ndarray) and reference.shape == (2*h, 2*w, 2),
        "Spring reference must have exactly double spatial dimensions")
    errors = np.full((h, w), np.nan, np.float64)
    valid_gt = np.zeros((h, w), bool)
    valid_prediction = np.isfinite(prediction).all(axis=-1)
    gt_max_norm = np.zeros((h, w), np.float64)
    for y in range(0, h, 64):
        stop = min(h, y+64)
        block = np.stack([reference[2*y+dy:2*stop:2, dx::2] for dy, dx in ((0,0),(1,0),(0,1),(1,1))], axis=2).astype(np.float64)
        valid_gt[y:stop] = np.isfinite(block).all(axis=(2,3))
        diff = block-prediction[y:stop, :, None, :].astype(np.float64)
        errors[y:stop] = np.min(np.linalg.norm(diff, axis=-1), axis=2)
        gt_max_norm[y:stop] = np.max(np.linalg.norm(block, axis=-1), axis=2)
    return errors, valid_gt, valid_prediction, gt_max_norm


def summarize(errors, valid_gt, valid_prediction, gt_max_norm, mask=None):
    selected = valid_gt if mask is None else valid_gt & mask
    n = int(selected.sum()); finite = selected & valid_prediction & np.isfinite(errors)
    invalid = n-int(finite.sum())
    values = errors[finite]
    onepx = selected & (~valid_prediction | ~np.isfinite(errors) | (errors > 1.))
    fl = selected & (~valid_prediction | ~np.isfinite(errors) | ((errors > 3.) & (errors > .05*gt_max_norm)))
    return {"gtValidPixels": n, "finitePredictedPixels": int(finite.sum()), "invalidPredictionPixels": invalid,
        "meanEpeNativePx": float(values.mean()) if n and invalid == 0 else None,
        "finiteOnlyMeanEpeNativePx": float(values.mean()) if len(values) else None,
        "p50FiniteEpeNativePx": float(np.percentile(values,50)) if len(values) else None,
        "p95FiniteEpeNativePx": float(np.percentile(values,95)) if len(values) else None,
        "onePxOutlierPixels": int(onepx.sum()), "onePxOutlierFraction": int(onepx.sum())/n if n else None,
        "fl3and5OutlierPixels": int(fl.sum()), "fl3and5OutlierFraction": int(fl.sum())/n if n else None}


def match_mask(image, native_shape):
    require(isinstance(image,np.ndarray) and image.shape == (*native_shape,3)
        and image.dtype == np.uint8, "Spring matchmap requires native-H,W,3 uint8 PNG")
    # PNG channels here are RGB, loaded explicitly below with Pillow. OpenCV
    # BGR decoding would reverse channel0 and corrupt the reference partition.
    return (image[:,:,0] > 0) | (image[:,:,1] > 0)


def evaluate(field, reference, native_shape, matched=None):
    native = restore_native(field, native_shape)
    errors, valid_gt, valid_prediction, maximum = superresolved_errors(native, reference)
    metrics = {"all": summarize(errors, valid_gt, valid_prediction, maximum)}
    if matched is not None:
        require(matched.dtype == bool and matched.shape == tuple(native_shape), "Bad native match partition")
        metrics.update(matched=summarize(errors,valid_gt,valid_prediction,maximum,matched),
            unmatched=summarize(errors,valid_gt,valid_prediction,maximum,~matched))
    return {"nativeShape": list(native_shape), "referenceShape": list(reference.shape),
        "invalidReferencePixels": int(valid_gt.size-valid_gt.sum()), "metrics": metrics}


def load_reference(path):
    require(path.is_file() and path.stat().st_size <= 2*1024**2, "Missing or oversized reference manifest")
    manifest=json.loads(path.read_text()); records=manifest.get("files")
    require(manifest.get("schemaVersion")==1 and manifest.get("complete") is True
        and manifest.get("dataset")=="Spring-v2-independent-rendered-flow-reference"
        and manifest.get("datasetVersion")=="2.0" and manifest.get("datasetDoi")=="doi:10.18419/DARUS-3376"
        and manifest.get("license",{}).get("uri")=="http://creativecommons.org/licenses/by/4.0",
        "Incomplete or unbound Spring-v2 licensed reference")
    require(isinstance(records,list) and 1 <= len(records) <= 60, "Bounded source files required")
    root=(path.parent/manifest.get("assetRoot",".")).resolve(strict=True)
    # Repeat the fetcher's independently obtained official metadata checks,
    # including archive restriction state, rather than trusting a manifest label.
    from fetch_assist_scene_flow_reference import verify_metadata
    metadata_path=path.parent/"dataset-metadata.json"
    require(metadata_path.is_file() and metadata_path.stat().st_size<=1024**2
        and digest(metadata_path)==manifest.get("metadataSha256"),"Official metadata fingerprint missing/changed")
    verify_metadata(json.loads(metadata_path.read_text()))
    files={}; hashes={}
    for row in records:
        rel=row.get("path"); require(isinstance(rel,str) and not Path(rel).is_absolute(), "Relative source path required")
        target=(root/rel).resolve(strict=True);require(target.is_relative_to(root) and target.is_file() and target.stat().st_size <= 100*1024**2,
            "Source escapes root or exceeds file budget")
        require(rel not in files and digest(target)==row.get("sha256"), "Duplicate or changed reference bytes")
        files[rel]=target;hashes[rel]=row["sha256"]
    def one(seq,name,*,optional=False):
        found=[(rel,p) for rel,p in files.items() if f"/{seq}/" in "/"+rel and p.name==name]
        require(len(found) <= 1 and (optional or len(found)==1),f"Missing or ambiguous {seq}/{name}")
        return found[0] if found else None
    pairs=[]
    for seq in ("0001","0002"):
        first=one(seq,"frame_left_0001.png");second=one(seq,"frame_left_0002.png")
        pairs.append({"id":f"spring-{seq}-left-0001-0002","first":first,"second":second,
            "forward":one(seq,"flow_FW_left_0001.flo5"),"backward":one(seq,"flow_BW_left_0002.flo5"),
            "forwardMatch":one(seq,"matchmap_flow_FW_left_0001.png",optional=True),
            "backwardMatch":one(seq,"matchmap_flow_BW_left_0002.png",optional=True)})
    require(1 <= len(pairs) <= MAX_PAIRS,"Pair budget exceeded")
    return manifest,root,pairs,hashes


def system_state():
    usage=resource.getrusage(resource.RUSAGE_SELF)
    swap=subprocess.run(["sysctl","vm.swapusage"],capture_output=True,text=True,timeout=10)
    return {"processPeakRssBytes":int(usage.ru_maxrss),"rssUnit":"macOS ru_maxrss bytes; peak since process start, not per-lane",
        "swap":swap.stdout.strip() if swap.returncode==0 else None}


def run(args):
    from PIL import Image
    from assist_scene_global_field import GlobalRaftSmall
    from assist_scene_m3p_field import ColorGlobalRaftSmall
    manifest,root,pairs,hashes=load_reference(args.reference)
    require(args.device=="mps" and not args.output.exists() and not args.output.is_symlink(), "Explicit MPS and new output required")
    require(shutil.disk_usage(args.output.parent).free >= 10*1024**3,"Less than10GiB free disk")
    raw_path=args.output.with_name(args.output.stem+"-fields.npz")
    require(not raw_path.exists() and not raw_path.is_symlink(),"Raw field output already exists")
    source_before={n:digest(HERE/n) for n in CODE};reference_hash=digest(args.reference)
    weight_hash=digest(args.weights);state_before=system_state()
    cv2.setNumThreads(1);started=perf_counter();tick=perf_counter()
    base=GlobalRaftSmall(args.weights,device=args.device)
    providers={LANES[0]:base,LANES[1]:ColorGlobalRaftSmall.from_provider(base,processed_side=640),
        LANES[2]:ColorGlobalRaftSmall.from_provider(base,processed_side=768)}
    startup_ms=1000*(perf_counter()-tick);results=[];raw={};telemetry={"completedPairs":0,"completedLaneCalls":0}
    try:
        for index,pair in enumerate(pairs):
            require(perf_counter()-started <= MAX_SECONDS,"Bounded component benchmark time exceeded")
            tick=perf_counter();images=[]
            for key in ("first","second"):
                image=cv2.imread(str(pair[key][1]),cv2.IMREAD_COLOR|cv2.IMREAD_IGNORE_ORIENTATION)
                require(image is not None and image.dtype==np.uint8 and image.shape==(1080,1920,3),"Expected original Spring HD BGR frame")
                images.append(image)
            h,w=images[0].shape[:2];wh,ww=round(h*768/w),768
            working=[cv2.resize(im,(ww,wh),interpolation=cv2.INTER_AREA) for im in images]
            grayscale=[cv2.cvtColor(im,cv2.COLOR_BGR2GRAY) for im in working]
            prep_ms=1000*(perf_counter()-tick)
            order=LANES if index%2==0 else tuple(reversed(LANES))
            lane_reports={};fields={}
            for lane in order:
                telemetry.update(pair=pair["id"],lane=lane,phase="model-pair")
                tick=perf_counter();before=providers[lane].direction_calls
                returned=providers[lane](*(grayscale if lane==LANES[0] else working))
                elapsed=1000*(perf_counter()-tick)
                require(providers[lane].direction_calls-before==2 and len(returned)==2,"Wrong actual direction count")
                fields[lane]=returned
                for direction,field in zip(("forward","backward"),returned,strict=True):
                    require(field.shape==(wh,ww,2) and field.dtype==np.float32 and np.isfinite(field).all(),"Invalid working field")
                    raw[f"pair{index}_{lane[0]}_{direction}"]=field
                telemetry["completedLaneCalls"]+=1
                lane_reports[lane]={"actualModelDirections":2,"fieldPairWallMs":elapsed,"pairedPreparationAndFieldMs":prep_ms+elapsed,
                    "provider":providers[lane].metadata,"lastCall":deepcopy(providers[lane].last_call),
                    "fieldSha256":{d:sha256(f.tobytes()).hexdigest() for d,f in zip(("forward","backward"),returned,strict=True)}}
            # Reference flow/maps are read ONLY AFTER every lane has returned.
            # They never select provider inputs, source points or inference arms.
            telemetry["phase"]="reference-score"
            import h5py
            for direction,mapkey in (("forward","forwardMatch"),("backward","backwardMatch")):
                with h5py.File(pair[direction][1],"r") as f:
                    require(set(f.keys())=={"flow"},"Unexpected .flo5 datasets")
                    require(isinstance(f.get("flow",getlink=True),h5py.HardLink),"External/soft HDF5 links forbidden")
                    dataset=f["flow"]
                    require(isinstance(dataset,h5py.Dataset) and dataset.shape==(2*h,2*w,2)
                        and np.issubdtype(dataset.dtype,np.floating) and dataset.dtype.itemsize<=8
                        and not dataset.is_virtual and not dataset.external,"Unexpected linked/oversized flow dataset")
                    reference=dataset[()]
                require(reference.shape==(2*h,2*w,2),"Expected superresolved flow GT")
                matched=None
                if pair[mapkey] is not None:
                    # Preserve PNG logical RGB order, not OpenCV BGR.
                    matched=match_mask(np.asarray(Image.open(pair[mapkey][1]).convert("RGB")),(h,w))
                for lane in LANES:
                    lane_reports[lane][direction]=evaluate(fields[lane][0 if direction=="forward" else 1],reference,(h,w),matched)
                del reference
            results.append({"id":pair["id"],"nativeShape":[h,w],"workingShape":[wh,ww],"laneOrder":list(order),
                "sharedPreparationMs":prep_ms,"oldWorkingBgrSha256":sha256(working[0].tobytes()).hexdigest(),
                "newWorkingBgrSha256":sha256(working[1].tobytes()).hexdigest(),"lanes":lane_reports})
            telemetry["completedPairs"]+=1
        require(sum(f.nbytes for f in raw.values())<=MAX_RAW_BYTES,"Raw field budget exceeded")
        require(source_before=={n:digest(HERE/n) for n in CODE} and digest(args.reference)==reference_hash and digest(args.weights)==weight_hash
            and all(digest(root/p)==h for p,h in hashes.items()),"Source/reference bytes drifted")
        with raw_path.open("xb") as stream:np.savez_compressed(stream,**raw)
        require(raw_path.stat().st_size<=MAX_RAW_BYTES,"Compressed raw output exceeds budget")
        result={"schemaVersion":1,"study":"M3P-independent-Spring-component","createdUtc":datetime.now(timezone.utc).isoformat(),
            "referenceSha256":reference_hash,"referenceFiles":hashes,"referenceLicence":manifest.get("licence",manifest.get("license")),
            "codeSha256":source_before,"weightSha256":digest(args.weights),"device":args.device,"platform":platform.platform(),
            "opencv":cv2.__version__,"numpy":np.__version__,"convention":CONVENTION,"maxPairs":MAX_PAIRS,"maxSeconds":MAX_SECONDS,
            "pairCount":len(results),"actualModelDirections":{l:providers[l].direction_calls for l in LANES},
            "modelStartupMs":startup_ms,"benchmarkWallMs":1000*(perf_counter()-started),"systemBefore":state_before,"systemAfter":system_state(),
            "rawFields":{"path":raw_path.name,"bytes":raw_path.stat().st_size,"sha256":digest(raw_path),
                "arrayConvention":"pair{index}_{A|B|C}_{forward|backward}; float32 original working H,W,2"},"pairs":results,
            "limits":"Two selected rendered training-sequence pairs, not road video, warning recall, official leaderboard, phone or safety acceptance. Fixed counterbalanced two-pair order does not fully control cold/warm/shape history. All arms share one pretrained model sequentially. Metrics native image pixels, never metres."}
        with args.output.open("x") as stream:json.dump(result,stream,indent=2,allow_nan=False);stream.write("\n")
        return result
    except Exception as error:
        failure={"schemaVersion":1,"study":"M3P-independent-Spring-component","completeStudy":False,"status":"FAILED-NOT-SCORABLE",
            **telemetry,"error":f"{type(error).__name__}: {error}","codeSha256":source_before,
            "actualModelDirections":{l:providers[l].direction_calls for l in LANES},"wallMs":1000*(perf_counter()-started)}
        sidecar=args.output.with_name(args.output.name+".failure.json")
        if not sidecar.exists():
            with sidecar.open("x") as stream:json.dump(failure,stream,indent=2,allow_nan=False);stream.write("\n")
        raise


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("reference","weights","output"):parser.add_argument("--"+name,type=Path,required=True)
    parser.add_argument("--device",choices=("mps",),required=True)
    run(parser.parse_args())
