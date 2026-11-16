import importlib.util
from pathlib import Path
from copy import deepcopy
import json
import sys
import tempfile
import unittest

import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from assist_scene_motion_m3c import background, load_input
from assist_scene_pose_motion import pose_pair

spec=importlib.util.spec_from_file_location("m3c_scoring",ROOT/"scripts/score-assist-scene-motion-m3c.py")
scorer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(scorer)


class M3CPipeline(unittest.TestCase):
    def test_high_texture_background_does_not_exceed_pose_point_budget(self):
        img=np.random.default_rng(1988).integers(0,256,(432,768),np.uint8)
        img=cv2.GaussianBlur(img,(3,3),0)
        K=[[540,0,384],[0,540,216],[0,0,1]]
        f=dict(timestampUs=1_000_000,poseTimestampUs=1_000_000,
               cameraToWorld=np.eye(4).tolist(),intrinsics=K)
        g=deepcopy(f)
        g.update(timestampUs=1_100_000,poseTimestampUs=1_100_000)
        g["cameraToWorld"][0][3]=.1
        moved=cv2.warpAffine(img,np.float32([[1,0,-5],[0,1,0]]),(768,432))
        pair,_=pose_pair(f,g,768,432)
        good,diag=background(pair,img,moved,[],[],pair.floor_px)
        self.assertTrue(good)
        self.assertGreaterEqual(diag["points"],24)
        self.assertLessEqual(diag["points"],256)
        self.assertFalse(background(pair,img,np.zeros_like(img),[],[],pair.floor_px)[0])

    def test_inference_input_rejects_label_material(self):
        with tempfile.TemporaryDirectory() as wk:
            p=Path(wk)/"input.json"
            row={"timestampUs":100,"targets":[]}
            p.write_text(json.dumps({"schemaVersion":1,"dataset":"synthetic-m3c",
                                    "clips":[{"id":i,"frames":[row]*4} for i in ("x","y")]}))
            with self.assertRaisesRegex(ValueError,"unseparated truth"):
                load_input(p)

    def test_target_keyframe_scoring_reports_fp_and_fn_separately(self):
        rect=dict(x=.2,y=.2,width=.2,height=.2)
        track=dict(id=1,label="car",box=rect)
        lane=dict(events=[dict(trackId=1,label="car",timeMs=100,epoch=1)],tracks=[track],
                  answers={"distance":{"metres":None}},epoch=1)
        row=dict(token="i",timestampUs=109_100,timeMs=100,A=lane,B={**lane,"events":[]})
        truth={"schemaVersion":1,"clips":[dict(id="x",frames=[
            dict(token="i",timestampUs=109_100,targets=[
                dict(instance="car-1",classFamily="vehicle",box=rect,motion="stationary"),
                dict(instance="car-2",classFamily="vehicle",
                     box={**rect,"x":.7},motion="moving")])])]}
        receipt=dict(schemaVersion=1,clips=[dict(id="x",frames=[row])])
        result=scorer.score(receipt,truth)[0]["lanes"]
        self.assertEqual((result["A"]["fp"],result["A"]["fn"],result["B"]["fp"],result["B"]["fn"]),(1,1,0,1))
        truth["clips"][0]["frames"][0]["timestampUs"]+=1
        with self.assertRaisesRegex(ValueError,"Wrong timestamp"):
            scorer.score(receipt,truth)

    def test_scorer_refuses_distance_in_rgb_receipt(self):
        row={"A":{"events":[],"tracks":[],"answers":{"distance":{"metres":5}}}}
        with self.assertRaisesRegex(ValueError,"distance"):
            scorer.score_frame(row,"A",[],scorer.empty())

    def test_detection_overlap_coverage_does_not_count_as_a_motion_notice(self):
        rect=dict(x=.25,y=.25,width=.25,height=.25)
        lane=dict(events=[],tracks=[],answers={"distance":{"metres":None}},epoch=1,status="valid")
        row=dict(token="rgb",timestampUs=110_000,timeMs=100,A=lane,B={**lane,"status":"pose-skew"},
                 detections=[dict(label="person",box=rect)])
        truth={"schemaVersion":1,"clips":[dict(id="x",frames=[
            dict(token="rgb",timestampUs=110_000,targets=[
                dict(instance="person-1",classFamily="person",box=rect,motion="moving")])])]}
        result=scorer.score(dict(schemaVersion=1,clips=[dict(id="x",frames=[row])]),truth)[0]
        self.assertEqual(result["rawDetectionCoverage"]["person.moving"],
                         dict(targets=1,overlapped=1,gateAValid=1,gateBValid=0))
        self.assertEqual(result["lanes"]["A"]["fn"],1)
        self.assertEqual(result["lanes"]["B"]["fn"],1)
