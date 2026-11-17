"""M3R runner/receipt guards, authored metadata only; not road-quality evidence."""
from copy import deepcopy
import inspect
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3r_study as study
from assist_scene_global_field import POLICY as FIELD


def coverage():
    return dict(schemaVersion=1, study="M3Q", inputSha256="a"*64,
        completeSelectedCandidateReview=True, notExhaustiveSceneTruth=True, modelOutputsSeen=False,
        reviewedCandidateUnits=4, correctedBoxUnits=3, unscorableCandidateUnits=1,
        candidatesSha256="b"*64, selectionAccountingSha256="c"*64,
        checkedSha256="d"*64, boundTruthSha256="e"*64,
        omissions={"authored:1":"Occluded, not a true negative"}, scope="Authored reference seal")


def receipt():
    return dict(schemaVersion=1, study="M3R", developmentOnly=False,
        codeSha256={name:study.sha256(study.HERE/name) for name in study.CODE}, policies=study.policies(),
        device="mps", opencv=study.cv2.__version__, numpy=study.np.__version__,
        provider={"policy":dict(FIELD)}, weightsSha256=FIELD["weightSha256"],
        maxWallSeconds=study.MAX_SECONDS, maxReceiptBytes=study.MAX_BYTES,
        replayWallMs=1., actualModelDirections=2, reviewFormatStudy="M3Q",
        clips=[dict(detectorCalls=1, detectorConfiguration=study.DETECTOR_CONFIGURATION,
            actualFlowDirectionCallsByLane=dict(A=2,B=0), frames=[dict(
                flowDirectionCalls=dict(A=2,B=0), actualCalls=dict(A=dict(raft=2),B=dict(raft=0)),
                measurementDirectionsRequired=dict(B=2))])])


class M3RStudyTests(unittest.TestCase):
    def test_reused_review_format_is_new_input_bound_and_box_free(self):
        study.coverage_contract(coverage(), "a"*64)
        for key, value in (("inputSha256","f"*64), ("modelOutputsSeen",True),
                ("completeSelectedCandidateReview",False), ("targets",[]), ("correctedBoxUnits",0)):
            bad=coverage();bad[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):
                study.coverage_contract(bad,"a"*64)

    def test_incomplete_review_rejects_before_model_allocation(self):
        args=SimpleNamespace(input=Path("authored-input.json"),device="mps",
            output=SimpleNamespace(exists=lambda:False,is_symlink=lambda:False,parent=study.HERE),
            review_coverage=SimpleNamespace(read_text=lambda:json.dumps({})))
        with patch.object(study,"load_input",return_value=({"clips":[{"frames":[{}]}]},study.HERE)), \
             patch.object(study,"sha256",return_value="a"*64), \
             patch("assist_scene_global_field.GlobalRaftSmall") as model:
            with self.assertRaises(ValueError):study.replay(args)
            model.assert_not_called()

    def test_actual_measurement_counted_once_b_required_cost_retained(self):
        value=receipt();study.receipt_contract(value)
        for change in ("total","extraB","missingRequired","omittedA","source","reviewFormat"):
            bad=deepcopy(value);frame=bad["clips"][0]["frames"][0]
            if change=="total":bad["actualModelDirections"]=0
            elif change=="extraB":
                frame["flowDirectionCalls"]["B"]=2;frame["actualCalls"]["B"]["raft"]=2
                bad["clips"][0]["actualFlowDirectionCallsByLane"]["B"]=2
            elif change=="missingRequired":frame["measurementDirectionsRequired"]["B"]=0
            elif change=="omittedA":frame["actualCalls"]["A"]["raft"]=0
            elif change=="source":bad["codeSha256"]["assist_scene_m3r_association.py"]="f"*64
            else:bad["reviewFormatStudy"]="unbound-new-format"
            with self.subTest(change=change),self.assertRaises(ValueError):study.receipt_contract(bad)

    def test_frozen_warped_measurement_and_no_second_feature_model(self):
        body=inspect.getsource(study._run_clip)
        self.assertIn('mode="warped"',body)
        self.assertIn('B=association.IdentityChainWindowMotion()',body)
        self.assertIn('measurement_surface=row["A"]',body)
        self.assertIn('canonical(row["A"]) == a_seal',body)
        self.assertIn('canonical(row["T"]) == t_seal',body)
        self.assertNotIn("RootSift",body)
        self.assertNotIn("DINO",body)
        self.assertIn('row["timingsMs"]["A"]+row["timingsMs"]["BOverlay"]',body)
        for function in (study.replay,study.run_clip,study._run_clip):
            self.assertNotIn("truth",inspect.signature(function).parameters)

    def test_partial_failure_keeps_prefix_and_rethrows(self):
        error=ValueError("authored proof failure")
        def fail(*args):
            progress=args[-1]
            progress.update(validatedFrames=[{"token":"authored-complete-prefix"}],frameIndex=1)
            raise error
        with patch.object(study,"_run_clip",side_effect=fail):
            with self.assertRaises(ValueError) as caught:
                study.run_clip({"id":"authored"},None,None,None,None,None,None,{"validatedBytes":0})
        self.assertIs(caught.exception,error)
        self.assertEqual(error.m3r_progress["validatedFrames"],[{"token":"authored-complete-prefix"}])

    def test_incremental_budget_does_not_prune_evidence(self):
        body=inspect.getsource(study._run_clip)
        self.assertIn('budget["validatedBytes"]+size <= MAX_BYTES-1024**2',body)
        self.assertIn('progress.update(validatedFrames=rows',body)
        self.assertIn('receiptValidationAndFrameSerializationMs=validation_ms',body)


if __name__=="__main__":unittest.main()
