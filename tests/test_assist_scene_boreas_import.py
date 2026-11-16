"""Boreas-format projected-world and provenance controls without real assets."""

import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_boreas_import import build_manifests, matches, motion, ypr


BASE=1_634_000_000_000_000


class TestBoreasImport(unittest.TestCase):
    def setUp(self):
        p=tempfile.TemporaryDirectory(prefix="codex-tmp-boreas-test-20261114-", dir=Path(__file__).parent)
        self.addCleanup(p.cleanup)
        self.base=Path(p.name)
        self.root=self.base/"assets"
        self.out=self.base/"out"
        self.spec=self.base/"scenes.json"
        for folder in ("applanix","camera","calib","labels_detection"):
            (self.root/folder).mkdir(parents=True)
        (self.root/"calib/P_camera.txt").write_text("150 0 120 0\n0 150 90 0\n0 0 1 0\n0 0 0 1\n")
        head="ROSTime,easting,northing,altitude,vel_east,vel_north,vel_up,roll,pitch,heading,angvel_z,angvel_y,angvel_x\n"
        cams=[head];lidars=[head];spec=[]
        for j in range(2):
            start=BASE+1_600_000*j
            camera=[]; labels=[]
            for i in range(12):
                ct=start+i*100_000; lt=ct+20_000
                camera.append(ct); labels.append(lt)
                # Camera optical z faces +world Y; lidar annotations reside
                # in a moving Y-forward frame with world axes unchanged.
                cy=i*.15; ly=cy+.03
                cams.append(f"{ct},0,{cy},0,0,0,0,{math.pi/2},0,0,0,0,0\n")
                lidars.append(f"{lt},0,{ly},0,0,0,0,0,0,0,0,0,0\n")
                Image.new("RGB",(240,180),100+i).save(self.root/f"camera/{ct}.png","PNG")
                (self.root/f"labels_detection/{lt}.txt").write_text(
                    f"moving car 2 3 1.5 1.5 {8+i*.21-ly} 0 0 16\n"
                    f"standing pedestrian .8 .8 1.8 -3 {8-ly} 0 0 15\n"
                    f"stationary car 2 3 1.5 -0.6 {10-ly} 0 0 11\n"
                    f"unsupported tree 1 1 2 0 {8-ly} 0 0 18\n"
                    f"unbacked car 2 3 1.5 2 {9-ly} 0 0 1\n")
            spec.append({"id":f"scene-{j}","cameraTimestampsUs":camera,"labelTimestampsUs":labels})
        (self.root/"applanix/camera_poses.csv").write_text("".join(cams))
        (self.root/"applanix/lidar_poses.csv").write_text("".join(lidars))
        self.spec.write_text(json.dumps({"schemaVersion":1,"clips":spec}))

    def test_labels_are_private_and_exact_camera_time(self):
        live,truth,report=build_manifests(self.root,self.spec,self.out)
        self.assertEqual(live["assetRoot"],"../assets")
        self.assertEqual(live["dataset"],"Boreas-real")
        for rc,tc,result in zip(live["clips"],truth["clips"],report["clips"]):
            self.assertEqual(len(tc["frames"]),12)
            self.assertEqual(result["maxAbsSkewUs"],20_000)
            self.assertEqual(result["counts"]["insufficientLidarPoints"],12)
            self.assertEqual(result["counts"]["unsupportedClassRows"],12)
            for i,(camera,oracle) in enumerate(zip(rc["frames"],tc["frames"])):
                self.assertEqual(set(camera),{"token","path","intrinsics","cameraToWorld","timestampUs",
                                              "poseTimestampUs","sha256","isKeyFrame"})
                self.assertFalse(camera["isKeyFrame"])  # Official camera stream has no annotation availability field.
                self.assertEqual(camera["token"],oracle["token"])
                self.assertEqual(camera["timestampUs"],oracle["timestampUs"])
                self.assertEqual(camera["sha256"],hashlib.sha256((self.root/camera["path"]).read_bytes()).hexdigest())
                self.assertEqual([(t["instance"],t["classFamily"],t["motion"]) for t in oracle["targets"]],
                                 [("moving","vehicle","moving" if i>=6 else "unknown"),
                                  ("standing","person","stationary" if i>=6 else "unknown"),
                                  ("stationary","vehicle","stationary" if i>=6 else "unknown")])
                self.assertGreater(oracle["targets"][0]["box"]["x"],oracle["targets"][1]["box"]["x"])

    def test_pose_time_strict_duplicate_and_gt_score_rejected(self):
        path=self.root/"applanix/camera_poses.csv"
        rows=path.read_text().splitlines()
        path.write_text("\n".join(rows[:2]+[rows[1]]+rows[2:]))
        with self.assertRaisesRegex(ValueError,"Duplicate or backward"):
            build_manifests(self.root,self.spec,self.out)
        path.write_text("\n".join(rows))
        (self.root/f"labels_detection/{BASE+20000}.txt").write_text("fake car 2 3 1.5 0 8 0 0 40 .99\n")
        with self.assertRaisesRegex(ValueError,"predicted-score"):
            build_manifests(self.root,self.spec,self.out)

    def test_cli_matches_hash_and_never_overwrites(self):
        cmd=[sys.executable,str(Path(__file__).resolve().parents[1]/"scripts/assist_scene_boreas_import.py"),
             "--dataset-root",str(self.root),"--clip-manifest",str(self.spec),"--output-dir",str(self.out)]
        job=subprocess.run(cmd,capture_output=True,check=False)
        self.assertEqual(job.returncode,0,job.stderr.decode())
        recorded=json.loads((self.out/"truth.json").read_text())["inputSha256"]
        self.assertEqual(recorded,hashlib.sha256((self.out/"input.json").read_bytes()).hexdigest())
        job=subprocess.run(cmd,capture_output=True,check=False)
        self.assertNotEqual(job.returncode,0)
        self.assertIn(b"never overwritten",job.stderr)


class TestBoreasMath(unittest.TestCase):
    def test_ypr_matches_optical_and_heading_conventions(self):
        r=ypr(math.pi/2,0,0)
        np.testing.assert_allclose(r@np.array([1,0,0]),[0,-1,0],atol=1e-9)
        r=ypr(0,0,math.pi/2)
        np.testing.assert_allclose(r@np.array([0,0,1]),[0,1,0],atol=1e-9)
        np.testing.assert_allclose(r@np.array([0,1,0]),[0,0,-1],atol=1e-9)

    def test_mutually_unique_nearest_drops_ties_reuse_and_skew(self):
        self.assertEqual(matches([BASE,BASE+40_000],[BASE+20_000]),{})
        self.assertEqual(matches([BASE,BASE+70_000],[BASE+13_000]),{BASE:BASE+13_000})
        self.assertEqual(matches([BASE,BASE+40_000],[BASE+100_001]),{})

    def test_history_only_recent_and_consistent_displacement(self):
        time=[BASE+i*100_000 for i in range(8)]
        self.assertEqual(motion([(t,np.array([i*.2,0,0])) for i,t in enumerate(time)]),"moving")
        self.assertEqual(motion([(t,np.array([.01*i,0,0])) for i,t in enumerate(time)]),"stationary")
        self.assertEqual(motion([(t,np.array([(-1)**i*1.,0,0])) for i,t in enumerate(time)]),"unknown")
        self.assertEqual(motion([(t,np.array([i*.2,0,0])) for i,t in enumerate(time[:3])]),"unknown")


if __name__=="__main__":
    unittest.main()
