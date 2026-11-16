#!/usr/bin/env python3
"""One bounded lane-C QA reconstruction; no truth/model-detector input path.

Wrap only the unchanged cumulative measurement to retain discarded numeric
evidence. Every complete engine output must exactly reproduce saved M3K C.
This is not a new inference algorithm or an estimate of recovered warnings.
"""

import argparse
from collections import Counter
from copy import deepcopy
from datetime import date
from hashlib import sha256 as bytes_sha256
import json
import math
from pathlib import Path
import shutil
import tempfile
from time import perf_counter

import cv2
import numpy as np

from assist_scene_cohort_loom import POLICY
from assist_scene_learned_region import LearnedCohortWindowLoom, TorchvisionRaftSmall
from assist_scene_m3e_study import DROPPED, output, read_frame, write_new
from assist_scene_m3f_study import stage
from assist_scene_m3g_study import bind_input, finite_payload, lane_contract
from assist_scene_m3h_study import cached_observation, cohort_contract, read_json
from assist_scene_m3k_study import HERE, _read_native, flow_contract, receipt_contract
from assist_scene_motion import sha256
from assist_scene_motion_m3c import load_input
import assist_scene_window_loom as window


MAX_EXPOSURES = 99
MAX_DIRECTION_CALLS = 2376
MAX_SECONDS = 30*60
MAX_RECORDS_PER_FRAME = POLICY["maxTracks"]*POLICY["maxCohortsPerIdentity"]
MAX_OUTPUT_BYTES = 12*1024**2


def numeric_gates(evidence, history, intrinsics):
    """Exact frozen gate arithmetic, separately labelled from returned fields."""
    needed = ("angularLogGrowth", "angularLogMad", "robustPointGrowth", "robustBoxGrowth", "currentAngularLogGrowth")
    if not all(key in evidence for key in needed):
        return {"status": "not-evaluated", "reason": evidence.get("reason"), "checks": {},
                "pointSlopeP25PerSecond": None}
    net, mad, point, box, recent = (evidence[key] for key in needed)
    growths = [window.angular_growth(history[0][1], points, intrinsics) for _, points, _ in history]
    if any(growth is None for growth in growths):
        raise ValueError("Diagnostic angular support differs from the returned numeric measurement")
    times = np.asarray([at for at, _, _ in history])/1000.
    a, b = np.triu_indices(len(times), 1)
    logs = np.asarray([growth[0] for growth in growths])
    quartile = float(np.percentile((logs[b]-logs[a])/(times[b]-times[a]), 25))
    checks = {"dispersionWithinMadLimit": mad <= POLICY["maxAngularLogMad"],
        "netGrowthAboveFloorAndThreeMad": net >= max(POLICY["minNetAngularGrowth"], 3*mad),
        "robustPointGrowthAboveFloor": point >= POLICY["minNetAngularGrowth"],
        "pointSlopeLowerQuartilePositive": quartile > 0,
        "robustBoxGrowthAboveFloor": box >= POLICY["minNetBoxGrowth"],
        "pointBoxAgreement": abs(box-point) <= POLICY["maxGrowthDisagreement"],
        "freshCurrentGrowthAboveFloor": recent >= POLICY["minCurrentAngularGrowth"]}
    if all(checks.values()) != evidence["confirmed"]:
        raise ValueError("Diagnostic numeric gates disagree with the original confirmation")
    return {"status": "evaluated-on-exact-same-correspondences", "checks": checks,
        "failedChecks": [key for key, passed in checks.items() if not passed],
        "pointSlopeP25PerSecond": quartile,
        "signs": {"netPositive": net > 0, "robustPointPositive": point > 0,
                  "robustBoxPositive": box > 0, "currentPositive": recent > 0},
        "scope": "Pure post-return arithmetic; no RANSAC, no randomness, no changed runtime value"}


class GrowthAuditLoom(LearnedCohortWindowLoom):
    """Only interception point: the same measurement returns unchanged."""

    def _cumulative_evidence(self, tube, intrinsics):
        started = perf_counter()
        evidence = super()._cumulative_evidence(tube, intrinsics)
        history = list(tube.history)
        records = getattr(self, "_growth_audit_records", None)
        if records is None:
            records = []; self._growth_audit_records = records
        if len(records) >= MAX_RECORDS_PER_FRAME:
            raise ValueError("Excessive cumulative evidence calls in one frame")
        record = {"callIndex": len(records), "trackId": tube.id,
            "historyStartMs": history[0][0], "currentMs": history[-1][0],
            "historyTimesMs": [at for at, _, _ in history],
            "historyPointCounts": [len(points) for _, points, _ in history],
            "initialPoints": tube.initial, "currentPoints": len(tube.points),
            "currentPointsSha256": bytes_sha256(np.ascontiguousarray(tube.points).tobytes()).hexdigest(),
            "returnedEvidence": deepcopy(evidence),
            "derivedNumericGates": numeric_gates(evidence, history, intrinsics)}
        record["measurementAndAuditWallMs"] = 1000*(perf_counter()-started)
        records.append(record)
        return evidence


class BudgetedFlow:
    """No retries/fallback: stop before a call exceeds fixed total limits."""

    def __init__(self, provider, deadline):
        self.provider, self.deadline = provider, deadline

    @property
    def metadata(self):
        return self.provider.metadata

    @property
    def direction_calls(self):
        return self.provider.direction_calls

    def __call__(self, first, second):
        if perf_counter() >= self.deadline:
            raise TimeoutError("Thirty-minute reconstruction budget exhausted")
        if self.direction_calls+2 > MAX_DIRECTION_CALLS:
            raise ValueError("Actual model direction-call budget exhausted")
        result = self.provider(first, second)
        if perf_counter() > self.deadline:
            raise TimeoutError("Thirty-minute reconstruction budget exhausted during a field call")
        return result


def drain_growth(engine, surface, frame):
    """Associate actual born times only; never guess a missing cohort ID."""
    records = getattr(engine, "_growth_audit_records", [])
    engine._growth_audit_records = []
    diagnostics = surface.get("diagnostics", {})
    for record in records:
        if record["currentMs"] != frame["timeMs"]:
            raise ValueError("Growth evidence is not current")
        key = str(record["trackId"])
        current = diagnostics.get("cohorts", {}).get(key, [])
        retired = diagnostics.get("retiredCohorts", {}).get(key, [])
        ids = [c["cohortId"] for c in current if abs(c["bornMs"]-record["historyStartMs"]) <= .000001]
        ids += [c["cohortId"] for c in retired if abs(frame["timeMs"]-c["ageMs"]-record["historyStartMs"]) <= .000001]
        record.update(token=frame["token"], sourceSha256=frame["sourceSha256"],
            cohortIdCandidates=sorted(set(ids)),
            cohortIdAttribution="unique-born-time-match" if len(set(ids)) == 1 else "unknown-no-unique-born-time-match")
    return records


def _without_field_timing(records):
    return [{key: value for key, value in record.items() if key != "wallMs"} for record in records]


def assert_reproduced(current, original, trace, original_trace):
    if current != original:
        raise ValueError("Complete reconstructed C engine output differs from frozen M3K; no causal numeric claim allowed")
    if _without_field_timing(trace) != _without_field_timing(original_trace):
        raise ValueError("Learned field executions differ from frozen C, apart from timing")


def replay_clip(clip, original, root, work, provider, deadline):
    engine = GrowthAuditLoom(provider)
    rows = []; origin = clip["frames"][0]["timestampUs"]
    for index, (source, old) in enumerate(zip(clip["frames"], original["frames"], strict=True)):
        if perf_counter() >= deadline:
            raise TimeoutError("Thirty-minute reconstruction budget exhausted")
        started = perf_counter()
        folder = work/str(index); folder.mkdir()
        frames, samples, shapes = stage({"frames": [source]}, root, folder)
        frame = frames[0]; h, w, nh, nw = shapes[0]
        at = (source["timestampUs"]-origin)/1000.
        if old["timeMs"] != at or old["index"] != index:
            raise ValueError("Reconstruction exposure clock/order differs")
        gray = read_frame(samples[0][2], cv2.IMREAD_GRAYSCALE)
        native = cv2.cvtColor(_read_native(root/source["path"], source["sha256"]), cv2.COLOR_BGR2GRAY)
        if gray.shape != (h, w) or native.shape != (nh, nw):
            raise ValueError("Native/working reconstruction geometry differs")
        boxes, _ = cached_observation(old, w, h, nw, nh)
        preparation_ms = 1000*(perf_counter()-started)
        cv2.setRNGSeed(650500+index)
        before = provider.direction_calls; started = perf_counter()
        current = output(engine.update(frame, at, gray, boxes, native_gray=native), at)
        engine_ms = 1000*(perf_counter()-started)
        trace = [dict(r, token=source["token"], timeMs=at, sourceSha256=source["sha256"]) for r in engine.drain_trace()]
        row = {"index": index, "token": source["token"], "timestampUs": source["timestampUs"],
            "timeMs": at, "sourceSha256": source["sha256"], "C": current,
            "learnedFlow": {"C": trace}, "flowDirectionCalls": {"C": provider.direction_calls-before},
            "timingsMs": {"C": engine_ms}, "preparationMs": preparation_ms}
        lane_contract(current, at, old["detectorGapInjected"]); cohort_contract(current, at)
        flow_contract(row, "C")
        assert_reproduced(current, old["C"], trace, old["learnedFlow"]["C"])
        row["growthMeasurements"] = drain_growth(engine, current, row)
        row["completeEngineExactlyReproduced"] = True
        rows.append(row)
        print(f"Reconstructed {clip['id']} {index+1}/{len(clip['frames'])}: {len(row['growthMeasurements'])} measurements", flush=True)
    return {"id": clip["id"], "frames": rows}


def validate_binding(inputs, receipt, input_hash, device):
    receipt_contract(receipt); bind_input(receipt, inputs)
    count = sum(len(c["frames"]) for c in inputs["clips"])
    if (receipt.get("study") != "M3K" or receipt.get("developmentOnly") is not False
            or receipt["inputSha256"] != input_hash or not 1 <= count <= MAX_EXPOSURES
            or device != "mps" or receipt.get("device") != device):
        raise ValueError("Only exact original actual M3K source on the same explicit MPS device is permitted")
    for source, old in zip(inputs["clips"], receipt["clips"], strict=True):
        origin = source["frames"][0]["timestampUs"]
        for index, (frame, record) in enumerate(zip(source["frames"], old["frames"], strict=True)):
            if (record.get("sourceSha256") != frame["sha256"] or record.get("index") != index
                    or record.get("timeMs") != (frame["timestampUs"]-origin)/1000.
                    or record.get("detectorGapInjected") != (index in DROPPED.get(source["id"], ()))):
                raise ValueError("Unbound original pixels, exact clock, order or gap")


def run(args):
    started = perf_counter(); deadline = started+MAX_SECONDS
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("Choose a new reconstruction path")
    if shutil.disk_usage(args.output.parent).free < 10*1024**3:
        raise ValueError("Less than 10 GB free; stop before staging")
    inputs, root = load_input(args.input); receipt = read_json(args.receipt)
    input_hash, receipt_hash = sha256(args.input), sha256(args.receipt)
    validate_binding(inputs, receipt, input_hash, args.device)
    code_hash = sha256(Path(__file__))
    source_before = {f["path"]: sha256(root/f["path"]) for c in inputs["clips"] for f in c["frames"]}
    if any(source_before[f["path"]] != f["sha256"] for c in inputs["clips"] for f in c["frames"]):
        raise ValueError("Original source bytes changed before reconstruction")
    tick = perf_counter(); backend = TorchvisionRaftSmall(args.flow_weights, device=args.device)
    startup_ms = 1000*(perf_counter()-tick)
    if backend.metadata != receipt["learnedFlow"]:
        raise ValueError("Actual checkpoint, device or library versions differ from the original trial")
    provider = BudgetedFlow(backend, deadline)
    cv2.setNumThreads(1)
    with tempfile.TemporaryDirectory(prefix=f"codex-tmp-m3k-growth-{date.today():%Y%m%d}-", dir=args.output.parent) as temp:
        clips = []
        for index, (clip, old) in enumerate(zip(inputs["clips"], receipt["clips"], strict=True)):
            work = Path(temp)/str(index); work.mkdir()
            clips.append(replay_clip(clip, old, root, work, provider, deadline))
    source_after = {path: sha256(root/path) for path in source_before}
    if (source_after != source_before or sha256(args.input) != input_hash or sha256(args.receipt) != receipt_hash
            or sha256(Path(__file__)) != code_hash
            or any(sha256(HERE/name) != digest for name, digest in receipt["codeSha256"].items())
            or sha256(args.flow_weights) != backend.metadata["weightsSha256"]):
        raise ValueError("Source, checkpoint, input, receipt or frozen implementation changed during reconstruction")
    measurements = [m for c in clips for f in c["frames"] for m in f["growthMeasurements"]]
    actual_calls = sum(f["flowDirectionCalls"]["C"] for c in clips for f in c["frames"])
    if actual_calls != backend.direction_calls or actual_calls > MAX_DIRECTION_CALLS or perf_counter() > deadline:
        raise ValueError("Actual call accounting or fixed thirty-minute budget violated")
    result = {"schemaVersion": 1, "study": "M3K-growth-reconstruction", "lane": "C",
        "inputSha256": input_hash, "originalReceiptSha256": receipt_hash, "diagnosticCodeSha256": code_hash,
        "frozenInferenceCodeSha256": receipt["codeSha256"], "policies": receipt["policies"],
        "flowProvenance": backend.metadata, "modelStartupMs": startup_ms,
        "wallMs": 1000*(perf_counter()-started), "actualDirectionCalls": actual_calls,
        "actualDetectorCalls": 0, "sourceSha256Before": source_before, "sourceSha256After": source_after,
        "budget": {"maxExposures": MAX_EXPOSURES, "maxDirectionCalls": MAX_DIRECTION_CALLS, "maxWallSeconds": MAX_SECONDS},
        "framesExactlyReproduced": sum(len(c["frames"]) for c in clips),
        "summary": {"measurements": len(measurements),
            "returnedReasons": dict(Counter(m["returnedEvidence"]["reason"] for m in measurements)),
            "failedNumericGateCountsOverlapping": dict(Counter(k for m in measurements for k in m["derivedNumericGates"].get("failedChecks", [])))},
        "clips": clips,
        "limits": "Actual same-input reconstruction, not unseen validation or a new warning method. No labels opened, no detector inference. Failed numeric measurements exist only where a cohort survived long enough to be measured; retired/missing cohorts do not acquire invented growth. Time includes audit overhead and is not comparable product latency. No physical range output."}
    finite_payload(result)
    if len(json.dumps(result, allow_nan=False).encode()) > MAX_OUTPUT_BYTES:
        raise ValueError("Growth reconstruction exceeds fixed artifact byte budget")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("input", "receipt", "flow-weights", "output"):
        parser.add_argument("--"+key, type=Path, required=True)
    parser.add_argument("--device", choices=("mps",), required=True)
    args = parser.parse_args()
    result = run(args)
    write_new(args.output, result)
    print(json.dumps(result["summary"], indent=2))
