#!/usr/bin/env python3
"""M3W authored ray-plane controls. Never a real-traffic or sensor-range reference.

This renderer does not import the independent evaluator's geometry. The plan is
source-only metadata and must be sealed before rendering. RGB-only publication
contains no K, pose, plane, material, mask or trajectory data.
"""
import argparse
import copy
import hashlib
import json
import math
import shutil
import time
from pathlib import Path

import cv2
import numpy as np

K = [[520., 0., 319.5], [0., 515., 239.5], [0., 0., 1.]]
SHAPE = [480, 640]
SOURCE_US, TARGET_US = 1000000, 1100000
OFFSETS_US = [-40000, -10000, 10000, 40000]
MAX_BYTES, MAX_SECONDS = 48 * 1024**2, 120
TUM_SHA = "671b2de2c6002715a78162181543d08156c774836a3e5f96dc4cf3fba5de2e9e"
HP_SHA = "049adf30ccfa019988fc1bcdaa3a9fcbf461459f3ebb5a52fa4f8198602d0d7f"
MOTIONS = {
    "stationary": {"kind": "world-polynomial-euler", "center": [[0], [0], [0]], "angles": [[0], [0], [0]]},
    "lateral": {"kind": "world-polynomial-euler", "center": [[0, .4], [0], [0]], "angles": [[0], [0], [0]]},
    "constant-body-twist": {"kind": "constant-body-twist", "bodyLinear": [.4, .03, .08], "bodyAngular": [.03, .45, .02]},
    "accelerating": {"kind": "world-polynomial-euler", "center": [[0, .15, 1], [0, .02, 0], [0, .05, .2]], "angles": [[0, .15, 1.8], [0, .03, .4], [0, 0, .05]]},
    "changing-direction": {"kind": "world-polynomial-euler", "center": [[0, .9, -3], [0, .1, .2], [0, .1, .8]], "angles": [[0, -.25, 2], [0, .02, -.3], [0, .08, -.2]]},
    "fast-reveal": {"kind": "world-polynomial-euler", "center": [[0, 1.2, .8], [0, .02, 0], [0, .15, .2]], "angles": [[0, 1.4, 1], [0, .1, .2], [0, .05, .1]]},
}
PLANES = [
    {"id": "near-left", "z": 4.5, "boundsXY": [-2, -1.3, -.35, 1.5], "uvScale": [.12, .12], "uvOffset": [.1, .07]},
    {"id": "mid-right", "z": 7., "boundsXY": [.1, -1.6, 2.4, 1.5], "uvScale": [.08, .08], "uvOffset": [.35, .13]},
    {"id": "center", "z": 3.5, "boundsXY": [-.38, -.4, .38, .35], "uvScale": [.14, .14], "uvOffset": [.5, .5]},
    {"id": "far", "z": 12., "boundsXY": None, "uvScale": [.045, .045], "uvOffset": [0., 0.]},
]


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def trajectory(split, motion):
    out = copy.deepcopy(MOTIONS[motion])
    if split == "holdout":
        if out["kind"] == "constant-body-twist":
            out["bodyLinear"][0] *= -1
            out["bodyAngular"][1:] = [-v for v in out["bodyAngular"][1:]]
        else:
            for key, axis in (("center", 0), ("angles", 0), ("angles", 2)):
                out[key][axis] = [-v for v in out[key][axis]]
    return out


def planes(split):
    out = copy.deepcopy(PLANES)
    if split == "holdout":
        for p, z in zip(out, [4.2, 6.8, 3.8, 13.]):
            p["z"] = z
            b = p["boundsXY"]
            if b is not None:
                p["boundsXY"] = [-b[2], b[1], -b[0], b[3]]
            p["uvOffset"] = [(p["uvOffset"][0] + .17) % 1, (p["uvOffset"][1] + .11) % 1]
    return out


def pose(spec, timestamp_us):
    """Independent renderer implementation of the declared camera-to-world data."""
    u = (timestamp_us - SOURCE_US) / 1e6
    if spec["kind"] == "constant-body-twist":
        w = np.asarray(spec["bodyAngular"], dtype=float) * u
        a = float(np.linalg.norm(w))
        W = np.array([[0, -w[2], w[1]], [w[2], 0, -w[0]], [-w[1], w[0], 0]])
        if a < 1e-10:
            R = np.eye(3) + W + W @ W / 2
            V = np.eye(3) + W / 2 + W @ W / 6
        else:
            R = np.eye(3) + math.sin(a) / a * W + (1 - math.cos(a)) / a**2 * (W @ W)
            V = np.eye(3) + (1 - math.cos(a)) / a**2 * W + (a - math.sin(a)) / a**3 * (W @ W)
        C = V @ (np.asarray(spec["bodyLinear"], dtype=float) * u)
    else:
        def poly(c):
            return sum(v * u**i for i, v in enumerate(c))
        C = np.array([poly(c) for c in spec["center"]])
        y, p, r = [poly(c) for c in spec["angles"]]
        Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
        Rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
        Rz = np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])
        R = Ry @ Rx @ Rz
    T = np.eye(4)
    T[:3, :3], T[:3, 3] = R, C
    return {"poseTimestampUs": timestamp_us, "cameraToWorld": T.tolist()}


def cast(scene_planes, camera_to_world, image_shape, intrinsics):
    """Nearest positive world-Z plane intersection at pixel centers, no warps."""
    h, w = image_shape
    yy, xx = np.indices((h, w), dtype=float)
    k, t = np.asarray(intrinsics), np.asarray(camera_to_world)
    local = np.stack(((xx - k[0, 2]) / k[0, 0], (yy - k[1, 2]) / k[1, 1], np.ones_like(xx)), axis=-1)
    rays = local @ t[:3, :3].T
    origin = t[:3, 3]
    best = np.full((h, w), np.inf)
    ids = np.full((h, w), -1, dtype=np.int16)
    world = np.zeros((h, w, 3))
    for i, plane in enumerate(scene_planes):
        with np.errstate(divide="ignore", invalid="ignore"):
            distance = (plane["z"] - origin[2]) / rays[..., 2]
            points = origin + distance[..., None] * rays
        ok = np.isfinite(distance) & (distance > 0) & (distance < best)
        b = plane["boundsXY"]
        if b is not None:
            ok &= (points[..., 0] >= b[0]) & (points[..., 0] <= b[2]) & (points[..., 1] >= b[1]) & (points[..., 1] <= b[3])
        best[ok], ids[ok], world[ok] = distance[ok], i, points[ok]
    return ids, world


def render(texture, scene_planes, camera_to_world, image_shape=SHAPE, intrinsics=K):
    ids, world = cast(scene_planes, camera_to_world, image_shape, intrinsics)
    out = np.zeros((*image_shape, 3), dtype=np.uint8)
    th, tw = texture.shape[:2]
    for i, p in enumerate(scene_planes):
        take = ids == i
        uv = (world[take, :2] * np.asarray(p["uvScale"]) + np.asarray(p["uvOffset"])) % 1
        xy = uv * np.array([tw - 1, th - 1])
        ij = np.floor(xy).astype(int)
        upper = np.minimum(ij + 1, [tw - 1, th - 1])
        f = xy - ij
        samples = (texture[ij[:, 1], ij[:, 0]] * ((1-f[:, 0])*(1-f[:, 1]))[:, None]
                   + texture[ij[:, 1], upper[:, 0]] * (f[:, 0]*(1-f[:, 1]))[:, None]
                   + texture[upper[:, 1], ij[:, 0]] * ((1-f[:, 0])*f[:, 1])[:, None]
                   + texture[upper[:, 1], upper[:, 0]] * (f[:, 0]*f[:, 1])[:, None])
        out[take] = np.clip(np.rint(samples), 0, 255).astype(np.uint8)
    return out


def make_plan(repo):
    repo = Path(repo).resolve()
    q = repo / "native/ios/.build-xcode/scene-qa"
    tum, hp = q / "tum-m3t/input.json", q / "m3q-hpatches-reference/manifest.json"
    require(sha(tum) == TUM_SHA and sha(hp) == HP_SHA, "Retained source manifest drift")
    td, hd = json.loads(tum.read_text()), json.loads(hp.read_text())
    sources = []
    for split, seq in zip(("analysis", "holdout"), td["sequences"]):
        rgb = seq["frames"][0]["rgb"]
        path = (tum.parent / td["assetRoot"] / rgb["path"]).resolve()
        require(sha(path) == rgb["sha256"], "Texture source drift")
        sources.append({"split": split, "path": str(path), "sha256": rgb["sha256"], "bytes": path.stat().st_size, "sourceFrameId": seq["frames"][0]["id"]})
    external = []
    for p in hd["pairs"]:
        item = {"id": p["id"], "imageShape": p["shape"], "H_1_2": p["H_1_2"], "authority": "real-images-estimated-planar-homography-not-3D-pose"}
        for key in ("old", "new", "homography"):
            path = hp.parent / p[key]
            row = next(f for f in hd["files"] if f["path"] == p[key])
            require(sha(path) == row["sha256"], "HPatches source drift")
            item[key] = {"path": str(path.resolve()), "sha256": row["sha256"], "bytes": path.stat().st_size}
        external.append(item)
    pairs = [{"id": f"m3w-{i:02d}", "split": split, "motionType": motion, "planes": planes(split), "trajectory": trajectory(split, motion)} for i, (split, motion) in enumerate((s, m) for s in ("analysis", "holdout") for m in MOTIONS)]
    return {"schemaVersion": 1, "study": "M3W-authored-controls-plan", "datasetId": "m3w-fixed-v1", "authority": "authored-rendered-not-real-traffic", "K": K, "imageShape": SHAPE, "sourceTimestampUs": SOURCE_US, "targetTimestampUs": TARGET_US, "clockOffsetsUs": OFFSETS_US, "textureSources": sources, "pairs": pairs, "externalPairs": external, "sourceManifests": [{"path": str(tum), "sha256": TUM_SHA}, {"path": str(hp), "sha256": HP_SHA}], "licenses": {"textureAdaptation": td["license"], "externalPlanarReference": hd["license"], "externalAttribution": hd["attribution"]}, "coordinateConvention": "Optical x-right/y-down/z-forward; cameraToWorld maps camera to world. Euler R=Ry(yaw)Rx(pitch)Rz(roll), ascending-power coefficients in u=(timestampUs-1000000)/1e6 seconds. Twist exp([omega,v]u), translation=V(omega*u)*(v*u).", "sampling": "Pixel centers at integer coordinates; nearest strictly positive ray/world-Z-plane hit; exact equal-distance tie keeps first listed panel; opaque finite panels with inclusive XY bounds and unbounded-XY finite-Z far plane. Material uv=(worldXY*uvScale+uvOffset) mod1; bilinear texture at uv*(width-1,height-1), numpy round-to-even uint8. Single center sample, no projective antialiasing/blur/noise. Lower UV scales nominally reduce texture undersampling but do not guarantee band limitation. Finite footprint visibility evaluated independently, never a seed mask.", "preOutputRevision": {"supersededProposalSha256": "6fab89bb3b84e737641f5a0c1ebdf09ec1f0fcb7bb8ce3906b10fe60f4fe9a00", "changes": "Before any actual images/outcomes, lower UV scales from [.32,.24,.45,.15] to [.12,.08,.14,.045] to reduce nominal undersampling; keep all trajectories unchanged. Remove motion metadata from RGB-only interface. Preserve proposal as unfrozen historical evidence."}, "limits": {"maxAssetsBytes": MAX_BYTES, "maxPreparationSeconds": MAX_SECONDS, "downloads": 0, "learnedModelCalls": 0, "noRuntimeMetres": True}, "codeSha256": sha(__file__)}


def publish(plan_path, expected_sha, output):
    start = time.monotonic()
    require(sha(plan_path) == expected_sha, "Plan seal mismatch")
    plan = json.loads(Path(plan_path).read_text())
    require(plan["codeSha256"] == sha(__file__), "Renderer changed after plan seal")
    require(shutil.disk_usage(Path(output).parent).free >= 10 * 1024**3, "Disk floor10GiB")
    output = Path(output)
    require(not output.exists(), "Output exists; no overwrite/retry")
    output.mkdir(parents=True)
    gold = copy.deepcopy(plan)
    gold["study"] = "M3W-authored-controls"
    gold["planSha256"] = expected_sha
    gold["pairs"] = []
    rgb = {"schemaVersion": 1, "study": "M3W-RGB-only-input", "datasetId": plan["datasetId"], "imageShape": plan["imageShape"], "pairs": []}
    textures = {}
    counters = {"renderedImages": 0, "renderedPairs": 0, "learnedModelCalls": 0, "flowDirections": 0, "networkBytes": 0}
    def bound():
        require(time.monotonic()-start <= MAX_SECONDS, "Preparation time cap")
        require(sum(p.stat().st_size for p in output.rglob("*") if p.is_file()) <= MAX_BYTES, "Asset byte cap")
    try:
        for source in plan["textureSources"]:
            require(sha(source["path"]) == source["sha256"], "Texture drift")
            textures[source["split"]] = cv2.imread(source["path"], cv2.IMREAD_COLOR)
            require(textures[source["split"]] is not None and list(textures[source["split"]].shape) == [480, 640, 3], "Texture format")
        for p in plan["pairs"]:
            bound()
            full, light = copy.deepcopy(p), {k: p[k] for k in ("id", "split")}
            light["kind"] = "authored"
            for key, stamp in (("source", SOURCE_US), ("target", TARGET_US)):
                at = pose(p["trajectory"], stamp)
                pixels = render(textures[p["split"]], p["planes"], at["cameraToWorld"])
                name = p["id"] + "-" + key + ".png"
                encoded_ok, encoded = cv2.imencode(".png", pixels)
                require(encoded_ok, "PNG encoding failure")
                # Reserve1MiB for manifests/failure prefix before writing each
                # asset; a cap failure preserves only the already valid prefix.
                current_bytes = sum(a.stat().st_size for a in output.rglob("*") if a.is_file())
                require(current_bytes + encoded.nbytes <= MAX_BYTES - 1024**2, "Asset byte cap before write")
                (output/name).write_bytes(encoded.tobytes())
                image = {"path": str((output/name).resolve()), "sha256": sha(output/name), "timestampUs": stamp, "bytes": (output/name).stat().st_size}
                light[key] = image
                full[key] = {**image, **at}
                counters["renderedImages"] += 1
                bound()
            full["clockVariants"] = [{"offsetUs": off, "source": pose(p["trajectory"], SOURCE_US+off), "target": pose(p["trajectory"], TARGET_US+off)} for off in OFFSETS_US]
            gold["pairs"].append(full)
            rgb["pairs"].append(light)
            counters["renderedPairs"] += 1
        # External images are referenced, not copied or rescaled; no H enters RGB.
        for p in plan["externalPairs"]:
            rgb["pairs"].append({"id": p["id"], "split": "external-planar-reference", "kind": "hpatches", "imageShape": p["imageShape"], "source": {**p["old"], "timestampUs": None}, "target": {**p["new"], "timestampUs": None}})
        gold["execution"] = {**counters, "elapsedSeconds": time.monotonic()-start, "requestedOpenCvThreads": 1, "observedOpenCvThreads": cv2.getNumThreads()}
        write_json(output/"controls.json", gold)
        rgb["controlsManifestSha256"] = sha(output/"controls.json")
        write_json(output/"rgb-only.json", rgb)
        bound()
        return {"complete": True, **counters, "assetBytes": sum(p.stat().st_size for p in output.rglob("*") if p.is_file()), "controlsSha256": sha(output/"controls.json"), "rgbOnlySha256": sha(output/"rgb-only.json"), "elapsedSeconds": time.monotonic()-start}
    except Exception as error:
        write_json(output/"failure-prefix.json", {"complete": False, **counters, "error": str(error), "planSha256": expected_sha, "elapsedSeconds": time.monotonic()-start, "preservedValidPrefix": True})
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--plan")
    parser.add_argument("--plan-sha256")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    cv2.setNumThreads(1)
    if args.plan:
        require(bool(args.plan_sha256), "Plan seal required")
        result = publish(args.plan, args.plan_sha256, args.output)
    else:
        require(not Path(args.output).exists(), "Plan output exists")
        write_json(Path(args.output), make_plan(args.repo))
        result = {"complete": True, "planSha256": sha(args.output), "actualImageRenders": 0, "learnedModelCalls": 0}
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
