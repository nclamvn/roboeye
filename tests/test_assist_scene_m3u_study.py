"""M3U authored wiring checks; no detector, RAFT or source study execution."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
import numpy as np
import cv2
from time import perf_counter

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3u_study as m


class CameraStudyTests(unittest.TestCase):
    def test_lane_validator_projection_has_own_camera_and_no_mutation(self):
        row=dict(T_A=dict(status="invalid",epoch=3),T_B=dict(status="valid",epoch=0),
            A=dict(name="measurementA"),B=dict(name="measurementB"),
            flowDirectionCalls=dict(A=0,B=4),timingsMs=dict(T_A=1.,T_B=2.,A=0.,B=10.))
        sealed=deepcopy(row);a=m.lane_view(row,"A");b=m.lane_view(row,"B")
        self.assertEqual(a["T"],row["T_A"]);self.assertEqual(b["T"],row["T_B"])
        self.assertEqual(b["A"],row["B"]);self.assertEqual(b["flowDirectionCalls"]["A"],4)
        self.assertEqual(b["timingsMs"]["A"],10.);self.assertEqual(b["timingsMs"]["T"],2.)
        self.assertEqual(row,sealed)

    def test_bounded_actual_duplicate_compute_and_frozen_measurement_policy(self):
        from assist_scene_textured_window import POLICY
        self.assertEqual(m.MAX_FRAMES,100);self.assertEqual(m.MAX_SECONDS,900)
        self.assertEqual(m.MAX_BYTES,192*1024**2)
        self.assertEqual(m.policies()["measurement"],__import__('json').loads(__import__('json').dumps(dict(POLICY))))
        self.assertEqual(m.policies()["cameraB"]["maxResidualPx"],1.3)
        self.assertEqual(m.LANES,("A","B"))
        self.assertIn("assist_scene_m3u_pixel_camera.py",m.CODE)
        self.assertIn("assist_scene_global_window.py",m.CODE)

    def test_per_frame_source_pose_calibration_and_detector_binding(self):
        source=dict(token="authored",timestampUs=1_000_000,poseTimestampUs=1_000_000,sha256="a"*64,
            intrinsics=[[240.,0.,160.],[0.,240.,160.],[0.,0.,1.]],cameraToWorld=np.eye(4).tolist())
        row=dict(index=0,token="authored",timestampUs=1_000_000,sourcePoseTimestampUs=1_000_000,
            timeMs=0.,sourceSha256="a"*64,sourcePoseEpoch=None,detectorGapInjected=False,width=160,height=160,
            nativeWidth=320,nativeHeight=320,cameraIntrinsics=[[120.,0.,80.],[0.,120.,80.],[0.,0.,1.]],
            cameraToWorld=np.eye(4).tolist(),detections=[],oldObservation=dict(width=160,height=160,orientation=1,tracks=[]))
        self.assertTrue(m.bind_frame_source(row,source,0,1_000_000))
        for key,value in (("sourceSha256","b"*64),("sourcePoseTimestampUs",1_000_001),("sourcePoseEpoch",1),("timeMs",1.),("detectorGapInjected",True)):
            bad=deepcopy(row);bad[key]=value
            with self.assertRaises(ValueError):m.bind_frame_source(bad,source,0,1_000_000)
        for key in ("cameraIntrinsics","cameraToWorld"):
            bad=deepcopy(row);bad[key][0][0]+=.01
            with self.assertRaises(ValueError):m.bind_frame_source(bad,source,0,1_000_000)
        bad=deepcopy(row);bad["detections"]=[dict(label="car",score=.9,box=dict(x=.2,y=.2,width=.2,height=.2))]
        with self.assertRaises(ValueError):m.bind_frame_source(bad,source,0,1_000_000)

    def test_actual_no_detection_wiring_uses_two_independent_camera_histories(self):
        from assist_scene_cohort_loom import CohortWindowLoom
        from assist_scene_textured_window import TexturedGlobalWindowMotion
        from test_assist_scene_m3u_pixel_camera import frame
        class NoModels:
            direction_calls=0
            def __call__(self,*args):raise AssertionError("no actual models in authored integration")
        provider=NoModels();cams=dict(A=CohortWindowLoom(),B=m.camera.PixelCameraAuthority())
        measurements={lane:TexturedGlobalWindowMotion(provider,mode="warped")for lane in m.LANES}
        rng=np.random.default_rng(651007);image=cv2.GaussianBlur(rng.integers(0,256,(160,160),np.uint8),(3,3),.6)
        rows=[]
        for index in range(2):
            source=frame(index,image=image);row=dict(index=index,token=source["token"],timestampUs=source["timestampUs"],timeMs=float(index*80),
                sourceSha256=source["sha256"],sourcePoseTimestampUs=source["poseTimestampUs"],sourcePoseEpoch=None,
                workingPixelsSha256=m.sha256_bytes(image),width=160,height=160,nativeWidth=160,nativeHeight=160,
                cameraIntrinsics=source["intrinsics"],cameraToWorld=source["cameraToWorld"],detections=[],
                flowDirectionCalls=dict(A=0,B=0),actualCalls=dict(A=dict(raft=0),B=dict(raft=0)),timingsMs={})
            for lane in m.LANES:
                cv2.setRNGSeed(650500+index);tick=perf_counter()
                row["T_"+lane]=m.output(cams[lane].update(source,float(index*80),image,[]),float(index*80))
                row["timingsMs"]["T_"+lane]=1000*(perf_counter()-tick)
                tick=perf_counter();row[lane]=m.output(measurements[lane].update(source,float(index*80),image,[],camera_surface=row["T_"+lane]),float(index*80))
                row["timingsMs"][lane]=1000*(perf_counter()-tick)
            sealed=deepcopy(row);self.assertTrue(m.frame_contract(row,rows));self.assertEqual(row,sealed);rows.append(row)
        self.assertEqual(provider.direction_calls,0)


if __name__=="__main__":unittest.main()
