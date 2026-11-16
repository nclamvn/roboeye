"""Receipt joining, null metric and fair detection coverage tests."""

from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_m3f_study import score
from assist_scene_m3e_study import output, CLAIM


BOX={"x":.4,"y":.4,"width":.05,"height":.05}


def sample():
    track={"id":1,"label":"car","box":BOX}
    frames=[]; targets=[]
    for i,state in enumerate(("approaching","not-approaching",None)):
        lane=output({"epoch":0,"status":"valid","tracks":[track],"diagnostics":{},"events":[]},i*80.)
        newer=deepcopy(lane)
        newer["events"]=[{"trackId":1,"label":"car","kind":CLAIM,"epoch":0,"timeMs":i*80.}]
        frames.append({"token":str(i),"timestampUs":i*80_000,"timeMs":i*80.,
                       "detections":[],"candidateDetections":[track],"A":lane,"B":newer,
                       "roi":{"crops":[],"merge":{"reasons":{}}},
                       "timingsMs":dict.fromkeys(("detector","sharedPrep","roiPreparation","roiInferenceWall","roiMerge","A","B","candidateExtraToReady"),1.)})
        if state:
            targets.append({"token":str(i),"timestampUs":i*80_000,
                            "targets":[{"instance":"one","classFamily":"vehicle","box":BOX,"approach":state}]})
    receipt={"schemaVersion":1,"dataset":"fixture","inputSha256":"hash","platform":"test","opencv":"test",
             "codeSha256":{},"clips":[{"id":"clip","detectorConfiguration":{},"frames":frames}]}
    truth={"schemaVersion":1,"inputSha256":"hash","clips":[{"id":"clip","frames":targets}]}
    return receipt,truth


class M3FStudyTests(unittest.TestCase):
    def test_reports_separate_box_coverage_and_approach(self):
        s=score(*sample())
        self.assertEqual(s["totals"]["A"]["fn"],1)
        self.assertEqual(s["totals"]["B"]["tp"],1)
        self.assertEqual(s["totals"]["B"]["fp"],1)
        self.assertEqual(s["totals"]["B"]["unscoredFrameReports"],1)
        self.assertEqual(s["clips"][0]["detectionOverlap"]["A"]["approaching.overlapped"],0)
        self.assertEqual(s["clips"][0]["detectionOverlap"]["B"]["approaching.overlapped"],1)
        self.assertEqual(s["noMetreChecks"],6)

    def test_metre_stale_crop_budget_or_truth_mismatch_fails(self):
        for what in ("metre","stale","crops","truth"):
            with self.subTest(what=what):
                rec,truth=sample(); f=rec["clips"][0]["frames"][0]
                if what=="metre":f["B"]["answers"]["distance"]["metres"]=4
                elif what=="stale":f["B"]["events"][0]["epoch"]=5
                elif what=="crops":f["roi"]["crops"]=[{}]*3
                elif what=="truth":truth["inputSha256"]="other"
                with self.assertRaises(ValueError):score(rec,truth)
