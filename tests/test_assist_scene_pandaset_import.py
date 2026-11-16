"""Synthetic PandaSet-format geometry/IO fixtures: no public data accessed."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from assist_scene_pandaset_import import build_manifests, camera_pose, cuboid_corners, deduplicate, motion, project


SPECS = ["001:0:11", "011:0:11"]
C2W = {"heading":{"w":.7071067811865476,"x":-.7071067811865476,"y":0,"z":0},
       "position":{"x":0,"y":0,"z":0}}


def cuboid(uid="object-1", label="Car", source=-1, sibling=None, status="Moving", **overrides):
    return {"uuid":uid,"label":label,"yaw":0.,"stationary":False,"camera_used":2,
            "position.x":.8,"position.y":9.,"position.z":0.,
            "dimensions.x":2.,"dimensions.y":3.,"dimensions.z":1.5,
            "attributes.object_motion":status,"cuboids.sibling_id":sibling,"cuboids.sensor_id":source,
            **overrides}


def save(root, name, payload):
    path=root/name
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(payload))


class FixtureTest(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory(prefix="codex-tmp-pandaset-tests-20261114-",dir=Path(__file__).parent)
        self.addCleanup(tmp.cleanup)
        self.base=Path(tmp.name)
        self.root,self.out=self.base/"data",self.base/"out"
        for idx,seq in enumerate(("001","011")):
            camera=Path(seq)/"camera/front_camera"
            base=1_550_000_000.+idx*60.
            stamps=[base+i*.1 for i in range(12)]
            save(self.root,camera/"poses.json",[C2W]*12)
            save(self.root,camera/"timestamps.json",stamps)
            save(self.root,camera/"intrinsics.json",{"fx":150,"fy":150,"cx":100,"cy":70})
            save(self.root,Path(seq)/"lidar/timestamps.json",[t+.022 for t in stamps])
            for i in range(12):
                target=self.root/camera/f"{i:02}.jpg"
                Image.new("RGB",(200,140),i+100).save(target,"JPEG")
                rows=[cuboid("vehicle-1", "Bus",0,"vehicle-2"), cuboid("vehicle-2","Bus",1,"vehicle-1"),
                      cuboid("vehicle-3", status="Stopped", **{"position.x":-2.5}), cuboid("vehicle-4"),
                      cuboid("person-1","Pedestrian",status=None,**{"position.x":-3, "position.y":6,
                                                                    "dimensions.x":.6,"dimensions.y":.5,"stationary":True}),
                      cuboid("ignored-4","Sign",status=None)]
                save(self.root,Path(seq)/f"annotations/cuboids_safe/{i:02}.json",rows)

    def manifests(self):
        return build_manifests(self.root,self.out,SPECS)

    def test_pairs_exact_and_no_truth_leaks(self):
        x,y=self.manifests()
        self.assertEqual(x["dataset"],"PandaSet-real")
        self.assertEqual(x["assetRoot"],"../data")
        for a,b in zip(x["clips"],y["clips"]):
            self.assertEqual(a["id"],b["id"])
            self.assertEqual(len(a["frames"]),12)
            for af,bf in zip(a["frames"],b["frames"]):
                self.assertEqual((af["token"],af["timestampUs"]),(bf["token"],bf["timestampUs"]))
                self.assertEqual(set(af),{"token","path","timestampUs","poseTimestampUs","cameraToWorld",
                                          "intrinsics","sha256","isKeyFrame"})
                self.assertEqual(af["timestampUs"],af["poseTimestampUs"])
                self.assertEqual(hashlib.sha256((self.root/af["path"]).read_bytes()).hexdigest(),af["sha256"])
                self.assertEqual([(t["instance"],t["classFamily"],t["motion"]) for t in bf["targets"]],
                                 [("person-1","person","stationary"),("vehicle-3","vehicle","stationary"),
                                  ("vehicle-4","vehicle","moving")])

    def test_skew_excludes_exact_index_not_neighbor(self):
        path=self.root/"001/lidar/timestamps.json"
        ts=json.loads(path.read_text())
        ts[5]+=.045
        path.write_text(json.dumps(ts))
        x,y=self.manifests()
        self.assertEqual(len(x["clips"][0]["frames"]),12)
        self.assertEqual(len(y["clips"][0]["frames"]),11)
        self.assertNotIn("pandaset-001-front-05",{f["token"] for f in y["clips"][0]["frames"]})

    def test_nonmonotonic_camera_and_no_pickle_fallback(self):
        path=self.root/"001/camera/front_camera/timestamps.json"
        ts=json.loads(path.read_text()); ts[3]=ts[2]; path.write_text(json.dumps(ts))
        with self.assertRaisesRegex(ValueError,"Non-monotonic camera"):
            self.manifests()
        ts[3]=ts[2]+.1; path.write_text(json.dumps(ts))
        j=self.root/"001/annotations/cuboids_safe/04.json"
        j.rename(j.with_suffix(".pkl.gz"))
        with self.assertRaises(FileNotFoundError):
            self.manifests()

    def test_cli_gate_and_escaped_inputs(self):
        command=[sys.executable,str(Path(__file__).resolve().parents[1]/"scripts/assist_scene_pandaset_import.py"),
                 "--dataset-root",str(self.root),"--output-dir",str(self.out),"--clip",SPECS[0],"--clip",SPECS[1]]
        call=subprocess.run(command,capture_output=True,check=False)
        self.assertNotEqual(call.returncode,0)
        self.assertIn(b"explicitly verified license",call.stderr)
        call=subprocess.run([*command,"--license-verified"],capture_output=True,check=False)
        self.assertEqual(call.returncode,0,call.stderr.decode())
        artifact=json.loads((self.out/"truth.json").read_text())
        self.assertEqual(artifact["inputSha256"],hashlib.sha256((self.out/"input.json").read_bytes()).hexdigest())
        report=json.loads((self.out/"import-report.json").read_text())["clips"][0]
        self.assertEqual(report["absSkewBinsMs"][">10–25"],12)
        self.assertEqual(report["exclusions"]["excludedDualObjects"],12)
        self.assertEqual(report["exclusions"]["sensorSpecificCuboids"],24)
        self.assertEqual(report["targetKeyframesByFamily"]["vehicle"]["moving"],12)
        escape=self.root/"001/camera/front_camera/01.jpg"
        actual=self.base/"outside.jpg"
        escape.rename(actual); escape.symlink_to(actual)
        with self.assertRaisesRegex(ValueError,"unsafe"):
            self.manifests()


class GeometryTest(unittest.TestCase):
    def test_camera_axis_signs_and_offscreen(self):
        m=camera_pose(C2W)
        np.testing.assert_allclose(m[:3,:3]@np.array([0,0,1]),[0,1,0],atol=1e-9)
        np.testing.assert_allclose(m[:3,:3]@np.array([0,1,0]),[0,0,-1],atol=1e-9)
        k=np.array([[150,0,100],[0,150,70],[0,0,1]])
        right=project(cuboid(**{"position.x":1.5}),m,k,200,140)
        left=project(cuboid(**{"position.x":-1.5}),m,k,200,140)
        self.assertGreater(right["x"],.50)
        self.assertLess(left["x"]+left["width"],.50)
        self.assertIsNone(project(cuboid(**{"position.y":-9.}),m,k,200,140))
        self.assertIsNone(project(cuboid(**{"position.x":90.}),m,k,200,140))

    def test_yaw_rotates_dimension_axes_like_official_devkit(self):
        c=cuboid(yaw=np.pi/2,**{"dimensions.y":5.})
        np.testing.assert_allclose(np.ptp(cuboid_corners(c),axis=0),[5.,2.,1.5],atol=1e-9)

    def test_sibling_and_flag_conflict_unknown_and_orphan_dropped(self):
        self.assertEqual([row[0] for row in deduplicate([cuboid("fused", sibling="-")])],["fused"])
        a,b=cuboid("a",source=0,sibling="b"),cuboid("b",source=1,sibling="a",status="Stopped")
        self.assertEqual(list(deduplicate([a,b])),[])
        self.assertEqual(list(deduplicate([a])),[])
        with self.assertRaisesRegex(ValueError,"duplicate"):
            list(deduplicate([a,a]))
        self.assertEqual(motion(cuboid(stationary=True)),"unknown")
        self.assertEqual(motion(cuboid(status="Ambiguous",stationary=True)),"unknown")
        self.assertEqual(motion(cuboid(status=None,stationary=False)),"unknown")


if __name__=="__main__":
    unittest.main()
