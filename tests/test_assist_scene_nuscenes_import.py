"""Synthetic official-format records; no nuScenes assets or license needed."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from assist_scene_nuscenes_import import VERSION, build_manifests, causal_motion, pose, project_box


def token(n):
    return f"{n:032x}"


SPECS = ["scene-0001:0:2", "scene-0002:0:2"]
C2E = [0.5, -0.5, 0.5, -0.5]
I = [1, 0, 0, 0]


class Fixture:
    def __init__(self, root):
        self.root = root / "data"
        self.out = root / "out"
        self.meta = self.root / VERSION
        self.tables = {t: [] for t in ("scene", "sample", "sample_data", "sensor", "calibrated_sensor", "ego_pose",
                                      "sample_annotation", "instance", "category")}
        self.meta.mkdir(parents=True)
        self.add("sensor", 1, channel="CAM_FRONT", modality="camera")
        self.add("calibrated_sensor", 2, sensor_token=token(1), translation=[0, 0, 1.5], rotation=C2E,
                 camera_intrinsic=[[120, 0, 80], [0, 120, 60], [0, 0, 1]])
        for i, kind in enumerate(("vehicle.car", "human.pedestrian.adult", "movable_object.debris", "vehicle.truck")):
            self.add("category", 3+i, name=kind)
        for scene in (1, 2):
            offset = 1000 * scene
            base = 1_600_000_000_000_000 + scene * 25_000_000
            self.add("scene", offset, name=f"scene-000{scene}", nbr_samples=5,
                     first_sample_token=token(offset+100), last_sample_token=token(offset+104))
            for i in range(5):
                self.add("sample", offset+100+i, timestamp=base+i*500_000+10_000, scene_token=token(offset),
                         next=token(offset+101+i) if i<4 else "", prev=token(offset+99+i) if i else "")
                for typ in range(4):
                    first = offset+400+typ*10
                    self.add("sample_annotation", first+i, sample_token=token(offset+100+i),
                             instance_token=token(offset+200+typ), visibility_token="2" if typ == 3 else "4",
                             translation=[7+.5*i if typ == 0 else 8, (-1, 2, 0, 1)[typ], 1.1],
                             size=[1.6, 3.4, 1.8] if typ in (0,3) else [.6, .5, 1.7], rotation=I,
                             prev=token(first+i-1) if i else "", next=token(first+i+1) if i<4 else "")
            for typ in range(4):
                self.add("instance", offset+200+typ, category_token=token(3+typ))
            for i in range(25):
                ns = base+round(i*1_000_000/12)
                self.add("ego_pose", offset+300+i, timestamp=ns, translation=[.5*i/6, 0, 0], rotation=I)
                is_key = i%6==0
                rel = f"{'samples' if is_key else 'sweeps'}/CAM_FRONT/synthetic-{scene}-{i}.jpg"
                image = self.root / rel
                image.parent.mkdir(parents=True, exist_ok=True)
                encoded, data = cv2.imencode(".jpg", np.full((120,160,3), 110+i+scene, np.uint8))
                assert encoded
                image.write_bytes(data.tobytes())
                self.add("sample_data", offset+500+i, timestamp=ns, ego_pose_token=token(offset+300+i),
                         calibrated_sensor_token=token(2), sample_token=token(offset+100+(i+5)//6),
                         is_key_frame=is_key, width=160, height=120, filename=rel,
                         next=token(offset+501+i) if i<24 else "", prev=token(offset+499+i) if i else "")
        self.save()

    def add(self, table, i, **fields):
        self.tables[table].append({"token": token(i), **fields})

    def save(self, *tables):
        for name in tables or self.tables:
            (self.meta / f"{name}.json").write_text(json.dumps(self.tables[name]))

    def build(self):
        return build_manifests(self.root, self.out, SPECS)


class TestImporter(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="codex-tmp-nuscenes-synthetic-20261114-", dir=Path(__file__).parent)
        self.addCleanup(self.tmp.cleanup)
        self.f = Fixture(Path(self.tmp.name))

    def test_frames_truth_parity_and_no_leakage(self):
        inputs, truth = self.f.build()
        self.assertEqual(inputs["dataset"], "nuScenes-v1.0-mini")
        self.assertEqual(inputs["assetRoot"], "../data")
        self.assertEqual([len(c["frames"]) for c in inputs["clips"]], [25,25])
        source_fields = {"token", "timestampUs", "poseTimestampUs", "isKeyFrame", "cameraToWorld", "intrinsics", "path", "sha256"}
        for rgb, gt in zip(inputs["clips"], truth["clips"]):
            self.assertEqual(len(gt["frames"]), 5)
            self.assertEqual([(f["token"],f["timestampUs"]) for f in rgb["frames"] if f["isKeyFrame"]],
                             [(f["token"],f["timestampUs"]) for f in gt["frames"]])
            for r in rgb["frames"]:
                self.assertEqual(set(r), source_fields)
                self.assertEqual(r["sha256"], hashlib.sha256((self.f.root / r["path"]).read_bytes()).hexdigest())
            for j, f in enumerate(gt["frames"]):
                self.assertEqual([t["classFamily"] for t in f["targets"]], ["vehicle", "person"])
                self.assertEqual([t["motion"] for t in f["targets"]], ["moving", "stationary"] if j>=2 else ["unknown"]*2)
        rgb_first = inputs["clips"][0]["frames"][0]
        np.testing.assert_allclose(np.array(rgb_first["cameraToWorld"]), [[0,0,1,0],[-1,0,0,0],[0,-1,0,1.5],[0,0,0,1]])
        gt_first = truth["clips"][0]["frames"][0]["targets"]
        self.assertGreater(gt_first[0]["box"]["x"], gt_first[1]["box"]["x"])

    def test_truth_skew_excluded_but_camera_frames_retained(self):
        self.f.tables["sample"][2]["timestamp"] += 120_000
        self.f.save("sample")
        rgb, gt = self.f.build()
        token_at_middle = rgb["clips"][0]["frames"][12]["token"]
        self.assertTrue(rgb["clips"][0]["frames"][12]["isKeyFrame"])
        self.assertNotIn(token_at_middle, [f["token"] for f in gt["clips"][0]["frames"]])

    def test_backward_and_colliding_records_fail_closed(self):
        rows = self.f.tables["sample_data"]
        rows[5]["timestamp"] = rows[4]["timestamp"]
        self.f.save("sample_data")
        with self.assertRaisesRegex(ValueError, "Backward"):
            self.f.build()
        rows[5]["timestamp"] += 83_333
        rows[5]["token"] = rows[4]["token"]
        self.f.save("sample_data")
        with self.assertRaisesRegex(ValueError, "colliding"):
            self.f.build()

    def test_invalid_pose_time_and_path_traversal(self):
        row = self.f.tables["ego_pose"][1]
        row["timestamp"] += 100_000
        self.f.save("ego_pose")
        with self.assertRaisesRegex(ValueError, "timestamps disagree"):
            self.f.build()
        row["timestamp"] -= 100_000
        self.f.tables["sample_data"][1]["filename"] = "sweeps/CAM_FRONT/../../else.jpg"
        self.f.save("ego_pose", "sample_data")
        with self.assertRaisesRegex(ValueError, "asset path"):
            self.f.build()

    def test_symlink_out_of_approved_root_rejected(self):
        path = self.f.root / self.f.tables["sample_data"][1]["filename"]
        other = self.f.root.parent / "other.jpg"
        path.rename(other)
        path.symlink_to(other)
        with self.assertRaisesRegex(ValueError, "unsafe"):
            self.f.build()

    def test_resized_jpeg_rejected_before_truth_appears(self):
        row = self.f.tables["sample_data"][1]
        row["height"] -= 10
        self.f.save("sample_data")
        with self.assertRaisesRegex(ValueError, "dimensions disagree"):
            self.f.build()
        self.assertFalse(self.f.out.exists())

    def test_no_future_annotation_and_conflicting_direction(self):
        a = {v["token"]: v.copy() for v in self.f.tables["sample_annotation"]}
        samples = {v["token"]: v for v in self.f.tables["sample"]}
        first_vehicle = a[token(1400)]
        first_vehicle["next"] = "unread missing future"
        self.assertEqual(causal_motion(first_vehicle, a, samples), "unknown")
        a[token(1400)]["next"] = token(1401)
        current = a[token(1402)]
        current["next"] = "unused future"
        self.assertEqual(causal_motion(current, a, samples), "moving")
        current["translation"] = [7, -1, 1.1]
        self.assertEqual(causal_motion(current, a, samples), "unknown")
        current["prev"] = token(1411)
        with self.assertRaisesRegex(ValueError, "cross-instance"):
            causal_motion(current, a, samples)

    def test_projection_abstains_for_near_and_offscreen_objects(self):
        c2w = pose({"translation": [0,0,1.5], "rotation": C2E})
        k = np.asarray([[120,0,80],[0,120,60],[0,0,1]])
        a = {"rotation": I, "size": [2,3,2], "translation": [.5,0,0]}
        self.assertIsNone(project_box(a, c2w, k, 160, 120))
        a["translation"] = [9,-40,1.5]
        self.assertIsNone(project_box(a, c2w, k, 160, 120))

    def test_cli_rights_gate_and_no_overwrite(self):
        script = Path(__file__).resolve().parents[1] / "scripts/assist_scene_nuscenes_import.py"
        cmd = [sys.executable,str(script),"--dataset-root",str(self.f.root),"--output-dir",str(self.f.out),
               "--clip",SPECS[0],"--clip",SPECS[1]]
        p = subprocess.run(cmd, capture_output=True, text=True, check=False)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("explicitly verified license", p.stderr)
        self.assertFalse(self.f.out.exists())
        p = subprocess.run([*cmd, "--license-verified"], capture_output=True, text=True, check=False)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue((self.f.out / "truth.json").is_file())
        p = subprocess.run([*cmd, "--license-verified"], capture_output=True, text=True, check=False)
        self.assertIn("existing manifests", p.stderr)


if __name__ == "__main__":
    unittest.main()
