#!/usr/bin/env python3
"""M3R association-only A/B on fresh source- and review-bound road clips.

A runs frozen warped RAFT measurement. B consumes the exact immutable A proof
surface plus independently checked native appearance chains. Actual fields are
computed ONCE, not counted as two executions or advertised as zero-cost for B.
The generic M3Q review-format seal is reused with NEW M3R input/source hashes.
Ground-truth object boxes and approach labels are opened by score only.
"""
import argparse
from collections import Counter
from datetime import date
from hashlib import sha256 as pixel_sha
import json
from pathlib import Path
import platform
import shutil
import tempfile
from time import perf_counter

import cv2
import numpy as np

import assist_scene_m3o_study as baseline
import assist_scene_m3q_study as shared
import assist_scene_m3r_association as association
from assist_scene_motion import parse_detect, sha256
from assist_scene_motion_m3c import load_input
from assist_scene_m3e_study import output, read_frame, legacy_score
from assist_scene_m3f_study import stage
from assist_scene_m3g_study import (
    DETECTOR_CONFIGURATION, bind_input, finite_payload, model_hashes, _percentiles,
)

HERE = Path(__file__).resolve().parent
LANES = ("A", "B")
CODE = tuple(dict.fromkeys((*baseline.CODE, "assist_scene_m3q_study.py",
    "assist_scene_m3q_correspondence.py", "assist_scene_m3r_association.py", "assist_scene_m3r_study.py")))
MAX_FRAMES, MAX_SECONDS, MAX_BYTES = 150, 1800, 256*1024**2
require, canonical = baseline._require, baseline.canonical_hash
coverage_contract = shared.coverage_contract


def policies():
    from assist_scene_textured_window import POLICY as measurement
    return json.loads(json.dumps(dict(measurement=dict(measurement), identity=dict(association.POLICY))))


def write_new(path, value):
    data = json.dumps(value, separators=(",", ":"), allow_nan=False).encode()
    require(len(data) <= MAX_BYTES and not path.exists() and not path.is_symlink(),
            "Output exists or exceeds bounded receipt budget")
    with path.open("xb") as stream:
        stream.write(data)


def frame_contract(frame, history):
    shared.surface_contract(frame)
    baseline.global_contract(frame, history, "A")
    association.validate_frame(frame, history)
    require(frame["flowDirectionCalls"]["B"] == 0
        and frame["actualCalls"]["B"] == dict(raft=0)
        and frame["measurementDirectionsRequired"]["B"] == frame["flowDirectionCalls"]["A"],
        "Shared required measurement is missing or counted twice as inference")


def run_clip(clip, root, work, exe, model, provider, deadline, budget):
    progress = dict(clipId=clip["id"], frameIndex=None, phase="staging", validatedFrames=[])
    try:
        return _run_clip(clip, root, work, exe, model, provider, deadline, budget, progress)
    except Exception as error:
        error.m3r_progress = progress
        raise


def _run_clip(clip, root, work, exe, model, provider, deadline, budget, progress):
    from assist_scene_textured_window import TexturedGlobalWindowMotion
    from assist_scene_cohort_loom import CohortWindowLoom
    from assist_scene_m3d_study import BoxBaseline
    started = perf_counter()
    origin = clip["frames"][0]["timestampUs"]
    prepared, rows = [], []
    for index, source in enumerate(clip["frames"]):
        baseline.old._deadline(deadline)
        tick = perf_counter(); folder = work/str(index); folder.mkdir()
        frames, samples, shapes = stage(dict(frames=[source]), root, folder)
        prepared.append((frames[0], samples[0][2], shapes[0], 1000*(perf_counter()-tick)))
    staging_ms = 1000*(perf_counter()-started)
    samples = [(i, (source["timestampUs"]-origin)/1000., prepared[i][1])
               for i, source in enumerate(clip["frames"])]
    progress["phase"] = "detector"
    found, detector_batch_ms, batches = baseline.old.previous.previous._detect_batched(samples, exe, model)
    engines = dict(T=CohortWindowLoom(), S=BoxBaseline(),
        A=TexturedGlobalWindowMotion(provider, mode="warped"), B=association.IdentityChainWindowMotion())
    validation_ms, serialized_bytes = 0., 0
    for index, (frame, filename, shape, prep_ms) in enumerate(prepared):
        progress.update(frameIndex=index, phase="source-preparation")
        baseline.old._deadline(deadline)
        height, width, native_height, native_width = shape
        at = samples[index][1]
        tick = perf_counter()
        gray = read_frame(filename, cv2.IMREAD_GRAYSCALE)
        decode_ms = 1000*(perf_counter()-tick)
        tick = perf_counter()
        native = cv2.cvtColor(baseline.old.previous.previous._read_native(root/frame["path"], frame["sha256"]), cv2.COLOR_BGR2GRAY)
        native_digest = pixel_sha(native.tobytes()).hexdigest()
        native_ms = 1000*(perf_counter()-tick)
        found_at, observation = found[index]
        require(found_at == at, "Actual detector and exposure clocks differ")
        boxes = parse_detect(observation, width, height)
        row = dict(index=index, token=frame["token"], timestampUs=frame["timestampUs"], timeMs=at,
            sourceSha256=frame["sha256"], sourcePoseTimestampUs=frame.get("poseTimestampUs"),
            sourcePoseEpoch=frame.get("epoch"), workingPixelsSha256=pixel_sha(gray.tobytes()).hexdigest(),
            nativeGraySha256=native_digest, width=width, height=height,
            nativeWidth=native_width, nativeHeight=native_height,
            cameraIntrinsics=np.asarray(frame["intrinsics"]).tolist(), cameraToWorld=np.asarray(frame["cameraToWorld"]).tolist(),
            detectorGapInjected=False, detections=[b.record(width, height) for b in boxes],
            oldObservation=observation, detectorObservationMs=observation["detectionMs"],
            flowDirectionCalls={}, actualCalls={}, measurementDirectionsRequired={},
            timingsMs=dict(fullPreparation=prep_ms, sharedPrep=decode_ms+native_ms,
                           workingDecode=decode_ms, nativeDecodeAndFingerprint=native_ms))
        for lane in ("T", "S"):
            cv2.setRNGSeed(650500+index); tick = perf_counter()
            result = (engines[lane].update(frame, at, gray, boxes, native_gray=native) if lane == "T"
                      else engines[lane].update(frame, at, gray, boxes))
            row[lane] = output(result, at)
            row["timingsMs"][lane] = 1000*(perf_counter()-tick)
        progress["phase"] = "actual-A-measurement"
        cv2.setRNGSeed(650500+index); before = provider.direction_calls; tick = perf_counter()
        row["A"] = output(engines["A"].update(frame, at, gray, boxes, camera_surface=row["T"]), at)
        row["timingsMs"]["A"] = 1000*(perf_counter()-tick)
        row["flowDirectionCalls"]["A"] = provider.direction_calls-before
        row["actualCalls"]["A"] = dict(raft=provider.direction_calls-before)
        a_seal, t_seal = canonical(row["A"]), canonical(row["T"])
        progress["phase"] = "B-independent-identity-overlay"
        cv2.setRNGSeed(650500+index); before = provider.direction_calls; tick = perf_counter()
        row["B"] = output(engines["B"].update(frame, at, gray, boxes, native_gray=native,
            camera_surface=row["T"], measurement_surface=row["A"]), at)
        row["timingsMs"]["BOverlay"] = 1000*(perf_counter()-tick)
        row["timingsMs"]["BStandaloneMeasurementAndOverlay"] = row["timingsMs"]["A"]+row["timingsMs"]["BOverlay"]
        row["flowDirectionCalls"]["B"] = provider.direction_calls-before
        row["actualCalls"]["B"] = dict(raft=provider.direction_calls-before)
        row["measurementDirectionsRequired"]["B"] = row["flowDirectionCalls"]["A"]
        require(row["flowDirectionCalls"]["B"] == 0 and canonical(row["A"]) == a_seal and canonical(row["T"]) == t_seal,
                "Association overlay mutated measurement/camera evidence or executed extra inference")
        progress["phase"] = "contracts-and-receipt-budget"; tick = perf_counter()
        frame_contract(row, rows)
        size = len(json.dumps(row, separators=(",", ":"), allow_nan=False).encode())
        require(budget["validatedBytes"]+size <= MAX_BYTES-1024**2,
                "Incremental receipt budget exceeded; no failed-point/rival pruning allowed")
        budget["validatedBytes"] += size; serialized_bytes += size; rows.append(row)
        progress.update(validatedFrames=rows, totalValidatedBytes=budget["validatedBytes"])
        validation_ms += 1000*(perf_counter()-tick)
        if index % 10 == 0:
            print(json.dumps(dict(clip=clip["id"], frame=index, actualDirections=provider.direction_calls)), flush=True)
    return dict(id=clip["id"], frames=rows, detectorCalls=len(rows), detectorBatches=batches,
        detectorConfiguration=DETECTOR_CONFIGURATION, detectorBatchWallMs=detector_batch_ms,
        stageWallMs=staging_ms, studyWallMs=1000*(perf_counter()-started),
        receiptValidationAndFrameSerializationMs=validation_ms, serializedFrameBytes=serialized_bytes,
        actualFlowDirectionCallsByLane={lane:sum(f["flowDirectionCalls"][lane] for f in rows) for lane in LANES})


def replay(args):
    started = perf_counter(); deadline = started+MAX_SECONDS
    inputs, root = load_input(args.input)
    require(1 <= sum(len(c["frames"]) for c in inputs["clips"]) <= MAX_FRAMES and args.device == "mps"
        and not args.output.exists() and not args.output.is_symlink(), "New bounded explicit-MPS replay required")
    require(shutil.disk_usage(args.output.parent).free >= 10*1024**3, "Disk floor10GiB")
    coverage = json.loads(args.review_coverage.read_text())
    coverage_contract(coverage, sha256(args.input))
    require(all(sha256(root/f["path"]) == f["sha256"] for c in inputs["clips"] for f in c["frames"]),
            "Original source image bytes changed")
    before = {name:sha256(HERE/name) for name in CODE}; policy = policies()
    exe, model = args.sceneqa.resolve(strict=True), args.yolo.resolve(strict=True)
    exe_hash, yolo_hashes = sha256(exe), model_hashes(model)
    from assist_scene_global_field import GlobalRaftSmall
    cv2.setNumThreads(1); tick = perf_counter()
    provider = GlobalRaftSmall(args.flow_weights, device="mps")
    startup_ms = 1000*(perf_counter()-tick)
    clips, budget = [], dict(validatedBytes=0)
    try:
        with tempfile.TemporaryDirectory(prefix=f"codex-tmp-m3r-{date.today():%Y%m%d}-", dir=args.output.parent) as temporary:
            for index, clip in enumerate(inputs["clips"]):
                work = Path(temporary)/str(index); work.mkdir()
                clips.append(run_clip(clip, root, work, exe, model, provider, deadline, budget))
        require(before == {name:sha256(HERE/name) for name in CODE} and policy == policies(),
                "Source/policy changed during actual replay")
        receipt = dict(schemaVersion=1, study="M3R", dataset=inputs["dataset"], developmentOnly=False,
            inputSha256=sha256(args.input), reviewCoverageSha256=sha256(args.review_coverage),
            reviewedTruthSha256=coverage["boundTruthSha256"], reviewFormatStudy=coverage["study"],
            clips=clips, codeSha256=before, policies=policy, provider=provider.metadata,
            weightsSha256=sha256(args.flow_weights), actualModelDirections=provider.direction_calls,
            sceneqaSha256=exe_hash, yoloModelHashes=yolo_hashes,
            detectorProvenance=dict(kind="actual-local-CoreML-no-cached-observations"),
            serializedFrameBytes=budget["validatedBytes"], opencv=cv2.__version__, numpy=np.__version__,
            python=platform.python_version(), platform=platform.platform(), device="mps",
            modelStartupMs=startup_ms, replayWallMs=1000*(perf_counter()-started),
            maxWallSeconds=MAX_SECONDS, maxReceiptBytes=MAX_BYTES,
            timingScope="One actual A RAFT measurement and independent B association overlay. StandaloneB includes required A measurement plus overlay; detector/staging/camera included in paired-product summaries. No UI/realtime/thermal acceptance.",
            countersScope="Shared actual model directions counted once. B additional0 is not zero required inference; required directions recorded separately.")
        receipt_contract(receipt); write_new(args.output, receipt)
        print(json.dumps(dict(output=str(args.output), frames=sum(len(c["frames"]) for c in clips),
                              actualDirections=provider.direction_calls)))
    except Exception as error:
        write_new(args.output.with_name(args.output.stem+"-incomplete.json"), dict(study="M3R",
            status="FAILED-INCOMPLETE-NOT-SCORABLE", actualModelDirections=provider.direction_calls,
            completedValidatedClips=clips, partialClipProgress=getattr(error, "m3r_progress", None),
            validatedSerializedFrameBytes=budget["validatedBytes"], errorType=type(error).__name__,
            error=str(error)[:300], codeSha256=before))
        raise


def receipt_contract(receipt):
    from assist_scene_global_field import POLICY as field
    finite_payload(receipt)
    require(receipt.get("schemaVersion") == 1 and receipt.get("study") == "M3R"
        and receipt.get("developmentOnly") is False
        and receipt.get("codeSha256") == {name:sha256(HERE/name) for name in CODE}
        and receipt.get("policies") == policies() and receipt.get("device") == "mps"
        and receipt.get("opencv") == cv2.__version__ and receipt.get("numpy") == np.__version__
        and receipt.get("provider", {}).get("policy") == dict(field)
        and receipt.get("weightsSha256") == field["weightSha256"], "Wrong runtime/source/policy receipt")
    frames = sum(len(c["frames"]) for c in receipt["clips"])
    require(1 <= frames <= MAX_FRAMES and receipt.get("maxWallSeconds") == MAX_SECONDS
        and receipt.get("maxReceiptBytes") == MAX_BYTES and 0 <= receipt["replayWallMs"] <= MAX_SECONDS*1000,
        "Exceeded actual frame/time/output scope")
    require(receipt.get("reviewFormatStudy") == "M3Q", "Wrong reused blind-review format provenance")
    for clip in receipt["clips"]:
        require(clip["detectorCalls"] == len(clip["frames"]) and clip["detectorConfiguration"] == DETECTOR_CONFIGURATION,
                "Actual detector observation count/configuration differs")
        for lane in LANES:
            require(clip["actualFlowDirectionCallsByLane"][lane] == sum(f["flowDirectionCalls"][lane] for f in clip["frames"])
                and all(f["actualCalls"][lane] == dict(raft=f["flowDirectionCalls"][lane]) for f in clip["frames"]),
                "Actual directions missing or counted twice")
        require(clip["actualFlowDirectionCallsByLane"]["B"] == 0
            and all(f["measurementDirectionsRequired"]["B"] == f["flowDirectionCalls"]["A"] for f in clip["frames"]),
            "Shared required field cost relabelled as no inference")
    require(receipt["actualModelDirections"] == sum(c["actualFlowDirectionCallsByLane"]["A"] for c in receipt["clips"]),
            "Actual resident model counter differs from all A field directions")


def score(receipt, truth, inputs):
    receipt_contract(receipt); finite_payload(truth); bind_input(receipt, inputs)
    require(truth.get("schemaVersion") == 1 and truth.get("inputSha256") == receipt["inputSha256"]
        and [c["id"] for c in truth["clips"]] == [c["id"] for c in receipt["clips"]], "Unbound reviewed reference")
    contract = legacy_score()
    totals = {lane:Counter(contract.empty()) for lane in (*LANES, "S")}
    results, all_frames = [], []
    for index, (clip, reference) in enumerate(zip(receipt["clips"], truth["clips"], strict=True)):
        labels = {f["token"]:f for f in reference["frames"]}
        require(len(labels) == len(reference["frames"]) and labels.keys() <= {f["token"] for f in clip["frames"]},
                "Duplicate/foreign reviewed frame")
        stats = {lane:contract.empty() for lane in (*LANES, "S")}; history = []
        origin = clip["frames"][0]["timestampUs"]
        for frame_index, frame in enumerate(clip["frames"]):
            source = inputs["clips"][index]["frames"][frame_index]
            require(frame["index"] == frame_index and frame["timeMs"] == (source["timestampUs"]-origin)/1000.
                and frame["sourceSha256"] == source["sha256"]
                and frame["sourcePoseTimestampUs"] == source["poseTimestampUs"] and frame["detectorGapInjected"] is False,
                "Source clock/pose or detector drop differs")
            camera = np.diag((frame["width"]/frame["nativeWidth"], frame["height"]/frame["nativeHeight"], 1.))@np.asarray(source["intrinsics"])
            require(baseline.audit._same(frame["cameraIntrinsics"], camera.tolist())
                and baseline.audit._same(frame["cameraToWorld"], source["cameraToWorld"]), "Camera metadata differs")
            require(frame["detections"] == [b.record(frame["width"], frame["height"]) for b in
                parse_detect(frame["oldObservation"], frame["width"], frame["height"])], "Current boxes differ from actual detector")
            frame_contract(frame, history)
            reviewed = labels.get(frame["token"])
            targets = None if reviewed is None else [{**t, "motion":
                {"approaching":"moving", "not-approaching":"stationary", "unknown":"unknown"}[t["approach"]]}
                for t in reviewed["targets"]]
            for lane in stats:
                contract.score_frame(frame, lane, targets, stats[lane])
            history.append(frame); all_frames.append(frame)
        for lane in totals:
            totals[lane].update(stats[lane])
        results.append(dict(id=clip["id"], lanes=stats))
    timing = {}
    for lane in LANES:
        own = "A" if lane == "A" else "BStandaloneMeasurementAndOverlay"
        timing[lane] = _percentiles([f["detectorObservationMs"]+sum(f["timingsMs"][k]
            for k in ("fullPreparation", "sharedPrep", "T", own)) for f in all_frames])
    return dict(schemaVersion=1, study="M3R", inputSha256=receipt["inputSha256"],
        frames=len(all_frames), unit="reviewed target-keyframe", totals=totals, clips=results,
        noMetreChecks=len(all_frames)*4, pairedProductMs=timing,
        actualModelDirections=receipt["actualModelDirections"], timingScope=receipt["timingScope"],
        codeSha256=receipt["codeSha256"], detectorVsGT=baseline.detector_gt_metrics(receipt, truth),
        limits="Selected checkpoint/stratum sample, not exhaustive scene truth. Unknown/unmatched/unreviewed notices remain separate. No metres/phone/safety/human or realtime acceptance.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    jobs = parser.add_subparsers(dest="job", required=True)
    p = jobs.add_parser("replay")
    for key in ("input", "review-coverage", "sceneqa", "yolo", "flow-weights", "output"):
        p.add_argument("--"+key, type=Path, required=True)
    p.add_argument("--device", choices=("mps",), required=True)
    p = jobs.add_parser("score")
    for key in ("receipt", "truth", "input", "output"):
        p.add_argument("--"+key, type=Path, required=True)
    args = parser.parse_args()
    if args.job == "replay":
        replay(args)
    else:
        receipt = json.loads(args.receipt.read_text()); truth = json.loads(args.truth.read_text())
        inputs, _ = load_input(args.input)
        require(sha256(args.truth) == receipt["reviewedTruthSha256"], "Reviewed truth changed after actual inference")
        result = score(receipt, truth, inputs)
        result.update(receiptSha256=sha256(args.receipt), truthSha256=sha256(args.truth))
        write_new(args.output, result)
