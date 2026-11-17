#!/usr/bin/env python3
"""M3Q external planar-reference A/B component test, never road-warning recall.

All image-only selections precede model inference. External H is opened only
after both arms' endpoint/mask outputs; neither matcher receives reference H.
The arms select different source points: this is a compound-method comparison,
not a common-query benchmark, official HPatches score or occlusion evaluation.
"""
import argparse
from copy import deepcopy
from hashlib import sha256
import io
import json
from pathlib import Path
import shutil
from time import perf_counter

import cv2
import numpy as np

import assist_scene_texture_patches as baseline
import assist_scene_m3q_correspondence as candidate
import fetch_assist_scene_m3q_reference as reference

HERE = Path(__file__).resolve().parent
CODE = ("assist_scene_m3q_reference_study.py", "assist_scene_m3q_correspondence.py",
        "fetch_assist_scene_m3q_reference.py", "fetch_assist_scene_flow_reference.py",
        "assist_scene_texture_patches.py", "assist_scene_global_field.py",
        "assist_scene_learned_region.py", "assist_scene_global_window.py",
        "assist_scene_textured_window.py")
MAX_SECONDS = 180
CORRECT_FLOOR = 1.3


def require(value, message):
    if not value: raise ValueError(message)


def file_hash(path): return sha256(Path(path).read_bytes()).hexdigest()
def pixel_hash(array): return sha256(np.ascontiguousarray(array).tobytes()).hexdigest()
def canonical(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def load_reference(manifest_path):
    path = Path(manifest_path).resolve(strict=True)
    require(not path.is_symlink() and path.stat().st_size < 1024**2, "Invalid reference manifest")
    value = json.loads(path.read_text()); root = path.parent
    require(value.get("study") == "M3Q" and value.get("complete") is True
            and value.get("dataset") == "HPatches-original-planar-reference"
            and [p["id"] for p in value.get("pairs", [])] == list(reference.SEQUENCES),
            "Complete predeclared independent reference required before model allocation")
    expected = {f"hpatches-sequences-release/{s}/{n}" for s in reference.SEQUENCES for n in reference.FILES}
    expected |= {"hf-metadata.json", "dataset-card.md", "official-readme.md", "LICENSE", "references.txt"}
    records = value.get("files", [])
    require(len(records) == len(expected) and {r["path"] for r in records} == expected,
            "Reference source coverage differs")
    for record in records:
        item = root/record["path"]
        require(item.is_file() and not item.is_symlink() and item.stat().st_size == record["bytes"]
                and file_hash(item) == record["sha256"], "Reference bytes changed")
    reference.verify_rights(json.loads((root/"hf-metadata.json").read_text()),
        *((root/n).read_text() for n in ("dataset-card.md", "official-readme.md", "LICENSE", "references.txt")))
    require(value["archive"]["url"] == reference.ARCHIVE
            and value["archive"]["size"] == reference.ARCHIVE_SIZE
            and value["archive"]["publishedLfsSha256"] == reference.ARCHIVE_LFS_SHA256,
            "Independent reference archive identity differs")
    for p in value["pairs"]:
        # Validate member naming and image size without loading H before inference.
        for key, name in (("old", "1.ppm"), ("new", "2.ppm"), ("homography", "H_1_2")):
            require(p[key] == f'hpatches-sequences-release/{p["id"]}/{name}', "Wrong fixed pair members")
    return value, root


def stage(path):
    native = cv2.imread(str(path), cv2.IMREAD_COLOR|cv2.IMREAD_IGNORE_ORIENTATION)
    require(native is not None, "Missing source image")
    h, w = native.shape[:2]; scale = min(1., 768/max(h, w)); nh, nw = round(h*scale), round(w*scale)
    image = native if (nh, nw) == (h, w) else cv2.resize(native, (nw, nh), interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 93])
    require(ok, "JPEG93 staging failed")
    gray = cv2.imdecode(encoded, cv2.IMREAD_GRAYSCALE)
    require(gray is not None and gray.shape == (nh, nw), "Wrong staged image shape")
    # Pixel-center mapping for OpenCV area resize; do not assume exact isotropic
    # scaling after dimensions round. Translation matters for homography GT.
    sx, sy = nw/w, nh/h
    transform = np.array([[sx, 0., (sx-1.)/2], [0., sy, (sy-1.)/2], [0., 0., 1.]])
    return gray, transform, {"sourceSha256": file_hash(path), "nativeShape": [h, w],
                            "workingShape": [nh, nw], "jpegSha256": pixel_hash(encoded),
                            "graySha256": pixel_hash(gray), "nativeToWorking": transform.tolist()}


def apply_homography(matrix, points):
    p = np.asarray(points, float).reshape(-1, 2)
    projected = np.column_stack((p, np.ones(len(p))))@np.asarray(matrix, float).T
    valid = np.isfinite(projected).all(axis=1) & (np.abs(projected[:, 2]) > 1e-10)
    answer = np.full((len(p), 2), np.nan)
    answer[valid] = projected[valid, :2]/projected[valid, 2:]
    return answer, valid


def score_population(population, native_h, source_transform, target_transform, target_shape):
    a, b, cycles, accepted, proof = population
    a = np.asarray(a, float).reshape(-1, 2); b = np.asarray(b, float).reshape(-1, 2)
    accepted = np.asarray(accepted, bool).reshape(-1)
    require(a.shape == b.shape and len(a) == len(accepted) and np.isfinite(a).all(), "Invalid retained source denominator")
    require(np.asarray(native_h).shape == (3, 3) and np.isfinite(native_h).all()
            and abs(np.linalg.det(native_h)) > 1e-10, "Invalid external homography")
    original, v1 = apply_homography(np.linalg.inv(source_transform), a)
    target_native, v2 = apply_homography(native_h, original)
    target, v3 = apply_homography(target_transform, target_native)
    projectable = v1 & v2 & v3
    h, w = target_shape
    in_bounds = projectable & (target[:, 0] >= 0) & (target[:, 0] <= w-1) & (target[:, 1] >= 0) & (target[:, 1] <= h-1)
    finite_prediction = np.isfinite(b).all(axis=1)
    require(not np.any(accepted & ~finite_prediction), "Accepted nonfinite prediction")
    epe = np.linalg.norm(b-target, axis=1)
    predicted_native, vp = apply_homography(np.linalg.inv(target_transform), b)
    native_epe = np.linalg.norm(predicted_native-target_native, axis=1)
    correct = in_bounds & finite_prediction & (epe <= CORRECT_FLOOR)
    counts = {"selected": len(a), "referenceInImageBounds": int(in_bounds.sum()),
              "acceptedCorrect": int(np.count_nonzero(accepted & correct)),
              "acceptedWrong": int(np.count_nonzero(accepted & in_bounds & ~correct)),
              "missingInBounds": int(np.count_nonzero(~accepted & in_bounds)),
              "outsideReferenceImageBounds": int(np.count_nonzero(projectable & ~in_bounds)),
              "invalidReferenceProjection": int(np.count_nonzero(~projectable)),
              "acceptedOutsideReferenceImageBounds": int(np.count_nonzero(accepted & ~in_bounds))}
    require(counts["selected"] == counts["acceptedCorrect"]+counts["acceptedWrong"]+counts["missingInBounds"]
            +counts["outsideReferenceImageBounds"]+counts["invalidReferenceProjection"], "Dropped reference denominator")
    rows = []
    for i in range(len(a)):
        rows.append({"index": i, "sourceWorking": a[i].tolist(), "sourceNative": original[i].tolist(),
            "predictedWorking": b[i].tolist() if finite_prediction[i] else None,
            "externalHWorking": target[i].tolist() if projectable[i] else None,
            "referenceInImageBounds": bool(in_bounds[i]), "accepted": bool(accepted[i]),
            "epeWorkingPx": float(epe[i]) if finite_prediction[i] and projectable[i] else None,
            "epeNativePx": float(native_epe[i]) if vp[i] and v2[i] else None,
            "correctAtFixed1_3WorkingPx": bool(correct[i])})
    return {"counts": counts, "points": rows, "verifierProof": proof,
            "correctnessFloorWorkingPx": CORRECT_FLOOR,
            "limits": "Reference image bounds are not an independent nonocclusion mask; errors include external estimated-H uncertainty."}


def replay(args):
    # Deliberately resolve all complete file/rights contracts before importing or
    # allocating the model. Complete reference H values are not passed to replay.
    manifest, root = load_reference(args.manifest)
    from assist_scene_global_field import GlobalRaftSmall
    field_dir = args.output.with_name(args.output.stem+"-fields")
    require(args.device == "mps" and not args.output.exists() and not args.output.is_symlink()
            and not field_dir.exists() and not field_dir.is_symlink(),
            "Explicit MPS and new output required")
    require(shutil.disk_usage(args.output.parent).free >= 10*1024**3, "Less than10GiB free")
    started = perf_counter(); before = {n: file_hash(HERE/n) for n in CODE}
    weights_hash = file_hash(args.weights); manifest_hash = file_hash(args.manifest)
    matcher = candidate.RootSiftMatcher(); staged = []
    for p in manifest["pairs"]:
        a, sa, ma = stage(root/p["old"]); b, sb, mb = stage(root/p["new"])
        require(a.shape == b.shape, "Pair working shapes differ")
        h, w = a.shape; box = [4., 4., float(w-4), float(h-4)]
        selections = [baseline.select_seeds(image, box) for image in (a, b)]
        inventories = [matcher.prepare(image, [box]) for image in (a, b)]
        seals = [canonical(s) for s in selections]
        seals += [canonical(i["selections"][0]) for i in inventories]
        matches = matcher.match(*inventories)
        staged.append((p, a, b, sa, sb, ma, mb, box, selections, inventories, seals, matches))
    prep_ms = 1000*(perf_counter()-started)
    provider = GlobalRaftSmall(args.weights, device="mps")
    startup_ms = 1000*(perf_counter()-started)-prep_ms
    rows = []; archive_bytes = 0; field_dir.mkdir()
    for index, (p, a, b, sa, sb, ma, mb, box, selections, inventories, seals, matches) in enumerate(staged):
        require(perf_counter()-started < MAX_SECONDS, "Component wall budget exhausted")
        t = perf_counter(); count = provider.direction_calls
        fields = provider(a, b)
        require(provider.direction_calls-count == 2, "Actual model direction count differs")
        field_ms = 1000*(perf_counter()-t)
        pair_order = ("A", "B") if index == 0 else ("B", "A")
        output = {}; timings = {}
        for lane in pair_order:
            t = perf_counter(); values = []
            for reverse in (False, True):
                first, second = (b, a) if reverse else (a, b)
                fs = fields[::-1] if reverse else fields
                if lane == "A":
                    pop = baseline.population(first, second, box, *fs, mode="warped",
                                              selection=deepcopy(selections[int(reverse)]))
                else:
                    inv1, inv2 = inventories[::-1] if reverse else inventories
                    pop = candidate.population(first, second, inv1, inv2,
                              inv1["selections"][0], matches, fs, reverse=reverse)
                values.append(pop)
            output[lane] = values; timings[lane] = 1000*(perf_counter()-t)
        require(seals == [canonical(s) for s in selections]+[canonical(i["selections"][0]) for i in inventories],
                "Source-only inventory changed after inference")
        # Reference H is loaded after both lane outputs, only for scoring.
        external_h = np.loadtxt(root/p["homography"], dtype=np.float64)
        scored = {}
        for lane, values in output.items():
            scored[lane] = {name: score_population(pop, np.linalg.inv(external_h) if rev else external_h,
                            sb if rev else sa, sa if rev else sb, a.shape)
                           for rev, (name, pop) in enumerate(zip(("forward", "reverse"), values))}
        raw = io.BytesIO(); np.savez_compressed(raw, forward=fields[0], backward=fields[1]); raw = raw.getvalue()
        archive_bytes += len(raw)
        require(archive_bytes <= 80*1024**2, "Field archive budget exceeded")
        archive_path = field_dir/(p["id"]+".npz")
        with archive_path.open("xb") as target: target.write(raw)
        rows.append({"id": p["id"], "oldPixels": ma, "newPixels": mb, "fixedBox": box,
                     "sourceOnlySelectionSha256s": seals, "laneOrder": pair_order,
                     "actualDirections": 2, "sharedFieldMs": field_ms,
                     "fieldSha256": {n: pixel_hash(f) for n, f in zip(("forward", "backward"), fields)},
                     "fieldArchive": {"path": str(archive_path.resolve()), "bytes": len(raw),
                                      "sha256": sha256(raw).hexdigest()},
                     "verificationMs": timings, "descriptorMatchMs": matches["matchMs"],
                     "descriptorMatchSha256": canonical(matches), "arms": scored})
        print("M3Q external component", p["id"], "complete", flush=True)
    require(provider.direction_calls == 4 and len(rows) == 2, "Incomplete component execution")
    require(perf_counter()-started <= MAX_SECONDS and before == {n: file_hash(HERE/n) for n in CODE}
            and weights_hash == file_hash(args.weights) and manifest_hash == file_hash(args.manifest),
            "Budget exceeded or source/config/model drift")
    load_reference(args.manifest)
    return {"schemaVersion": 1, "study": "M3Q-external-planar-component", "complete": True,
            "manifestSha256": manifest_hash, "weightsSha256": weights_hash, "codeSha256": before,
            "provider": provider.metadata, "baselinePolicy": dict(baseline.POLICY),
            "candidatePolicy": dict(candidate.POLICY), "matcher": matcher.metadata,
            "actualDirections": provider.direction_calls, "archiveBytes": archive_bytes, "modelStartupMs": startup_ms,
            "preparationMs": prep_ms, "wallMs": 1000*(perf_counter()-started), "maxWallSeconds": MAX_SECONDS,
            "pairs": rows, "opencv": cv2.__version__, "numpy": np.__version__,
            "limits": "Different source selectors; external estimated planar homography, not dense flow, warning FP/FN, metres or phone acceptance."}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--weights", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--device", choices=("mps",), required=True)
    args = p.parse_args(); result = replay(args)
    with args.output.open("x") as target:
        target.write(json.dumps(result, indent=2, allow_nan=False)+"\n")
