"""Deterministic geometry/safety tests, not real model quality evidence."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_motion import Detection
from assist_scene_roi_redetect import Crop, POLICY, RoiRedetector


WORK=(384,768)
RAW=(1152,2304)
TARGET=Detection("car",.8,(320.,200.,340.,220.))


def local(crop, box=TARGET, label=None, score=.9):
    x,y,_,_=crop.rect
    a,b,r,s=box.xyxy
    return Detection(label or box.label,score,(3*a-x,3*b-y,3*r-x,3*s-y))


class RoiRedetectTests(unittest.TestCase):
    def setUp(self):
        self.engine=RoiRedetector()

    def test_original_coordinate_crop_budget_no_upscale(self):
        boxes=[Detection("car",.8,(60.+100*i,100.,80.+100*i,120.)) for i in range(6)]
        crops=self.engine.plan(boxes,[],RAW,WORK)
        self.assertEqual(len(crops),2)
        for c in crops:
            x,y,r,b=c.rect
            self.assertLessEqual(r-x,512)
            self.assertLessEqual(b-y,512)
            self.assertGreaterEqual(min(x,y),0)
            self.assertEqual(c.source,"current")
        self.assertEqual(self.engine.plan([TARGET],[],WORK,WORK),[])

    def test_exact_global_mapping_and_replace(self):
        crops=self.engine.plan([TARGET],[],RAW,WORK)
        result,diag=self.engine.merge([TARGET],crops,[[local(crops[0])]],RAW,WORK)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0].xyxy,TARGET.xyxy)
        self.assertEqual(diag["reasons"]["replaced"],1)

    def test_prior_one_gap_recovery_without_hallucinating_stale_box(self):
        crops=self.engine.plan([], [TARGET], RAW,WORK,gap_ms=80.)
        self.assertEqual(len(crops),1)
        self.assertEqual(crops[0].source,"previous")
        result,diag=self.engine.merge([],crops,[[local(crops[0])]],RAW,WORK)
        self.assertEqual(result[0].xyxy,TARGET.xyxy)
        self.assertEqual(diag["reasons"]["recovered"],1)
        result,diag=self.engine.merge([],crops,[[]],RAW,WORK)
        self.assertEqual(result,[])
        self.assertEqual(diag["accepted"],0)
        for time in (None,-1,0,221,float("nan")):
            self.assertEqual(self.engine.plan([],[TARGET],RAW,WORK,gap_ms=time),[])

    def test_crop_edge_low_confidence_and_conflicting_class_fail_closed(self):
        crops=self.engine.plan([TARGET],[],RAW,WORK)
        for detections in ([local(crops[0],score=.59)], [local(crops[0],label="bus")],
                           [local(crops[0]),local(crops[0],label="truck")]):
            out,diag=self.engine.merge([TARGET],crops,[detections],RAW,WORK)
            self.assertEqual(out,[TARGET]); self.assertEqual(diag["accepted"],0)
        # A tight crop would let a truncated object overlap its seed. Refuse it.
        crop=Crop((950,590,1014,654),TARGET,"current",0)
        cut=Detection("car",.95,(0.,10.,60.,64.))
        out,diag=self.engine.merge([TARGET],[crop],[[cut]],RAW,WORK)
        self.assertEqual(out,[TARGET]); self.assertEqual(diag["reasons"]["crop-edge"],1)

    def test_current_competitor_and_cross_crop_duplicate_do_not_increase_counts(self):
        target2=Detection("car",.85,(321.,201.,341.,221.))
        crops=self.engine.plan([TARGET,target2],[],RAW,WORK)
        out,diag=self.engine.merge([TARGET,target2],crops,[[local(crops[0])]],RAW,WORK)
        self.assertEqual(out,[TARGET,target2]); self.assertEqual(diag["accepted"],0)
        c=self.engine.plan([],[TARGET],RAW,WORK,gap_ms=80.)[0]
        out,diag=self.engine.merge([],[c,c],[[local(c)],[local(c)]],RAW,WORK)
        self.assertEqual(len(out),1)
        self.assertEqual(diag["reasons"]["cross-crop-duplicate"],1)

    def test_prior_is_not_selected_when_current_box_is_present(self):
        self.assertTrue(all(c.source=="current" for c in self.engine.plan([TARGET],[TARGET],RAW,WORK,gap_ms=80)))

    def test_malformed_geometry_boxes_and_budget_rejected(self):
        for shape in ((384,4097),(100,100),(1152,2000)):
            with self.assertRaises(ValueError):self.engine.plan([TARGET],[],shape,WORK)
        with self.assertRaises(ValueError):self.engine.plan([TARGET]*13,[],RAW,WORK)
        with self.assertRaises(ValueError):self.engine.plan([Detection("car",.8,(-1.,0.,2.,3.))],[],RAW,WORK)
        with self.assertRaises(ValueError):self.engine.merge([],[],[[]],RAW,WORK)
        self.assertEqual(self.engine.plan([Detection("car",.8,(0.,0.,20.,20.))],[],RAW,WORK),[])
