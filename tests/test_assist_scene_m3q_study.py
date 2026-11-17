"""Authored structural guards only, never pretrained or road-quality evidence."""
from copy import deepcopy
from hashlib import sha256
import inspect
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3q_study as study
from assist_scene_global_field import geometry, POLICY as FIELD
from assist_scene_motion import Detection


def coverage():
    return dict(schemaVersion=1,study="M3Q",inputSha256="a"*64,
        completeSelectedCandidateReview=True,notExhaustiveSceneTruth=True,modelOutputsSeen=False,
        reviewedCandidateUnits=4,correctedBoxUnits=3,unscorableCandidateUnits=1,
        candidatesSha256="b"*64,selectionAccountingSha256="c"*64,checkedSha256="d"*64,boundTruthSha256="e"*64,
        omissions={"frame:2":"Occluded, unscorable"},scope="Sparse authored review")


def authored_history():
    class ZeroProvider:
        direction_calls=0
        metadata={"kind":"actual-local-pretrained-torchvision-global"}  # MOCK for proof-validator coverage only.
        def __call__(self,old,new):
            self.direction_calls+=2
            self.last_call={**geometry(old.shape),"status":"field-supported","device":"mps","modelDirectionCalls":2,
                "flowUpdatesPerDirection":12,"outputShape":[*old.shape,2],"wallMs":0.}
            return (np.zeros((*old.shape,2),np.float32),np.zeros((*old.shape,2),np.float32))
    provider=ZeroProvider();state=study.candidate.RootSiftGlobalWindowMotion(provider)
    gray=np.random.default_rng(650901).integers(0,256,(128,128),np.uint8)
    digest=sha256(gray.tobytes()).hexdigest();box=Detection("car",.94,(5.,5.,122.,122.));history=[]
    for i in range(8):
        frame=dict(token=f"authored-{i}",timestampUs=1_000_000+80_000*i,poseTimestampUs=1_000_000+80_000*i,
            epoch=0,intrinsics=[[100.,0.,64.],[0.,100.,64.],[0.,0.,1.]],cameraToWorld=np.eye(4).tolist(),sha256=digest)
        surface=dict(status="first-frame" if i==0 else "valid",epoch=0,
            tracks=[dict(id=100+i,**box.record(128,128))],events=[],diagnostics={})
        before=provider.direction_calls
        result=state.update(frame,float(i*80),gray,[box],camera_surface=surface)
        row=dict(token=frame["token"],timeMs=float(i*80),timestampUs=frame["timestampUs"],index=i,
            sourceSha256=digest,sourcePoseTimestampUs=frame["poseTimestampUs"],workingPixelsSha256=digest,
            width=128,height=128,cameraIntrinsics=frame["intrinsics"],cameraToWorld=frame["cameraToWorld"],
            detections=[box.record(128,128)],T=surface,B=result,detectorGapInjected=False,
            flowDirectionCalls=dict(B=provider.direction_calls-before),timingsMs=dict(T=0.,B=1000.))
        study.candidate_contract(row,history);history.append(row)
    return history


class M3QStudyTests(unittest.TestCase):
    def test_unchanged_frozen_floors_are_enforced(self):
        snapshot=study.policies()
        self.assertEqual(snapshot["A"]["minSupport"],snapshot["B"]["minSupport"])
        with patch.object(study.candidate,"POLICY",{**dict(study.candidate.POLICY),"minPoints":3}):
            with self.assertRaises(ValueError):study.policies()

    def test_complete_box_free_coverage_seal_and_mutations(self):
        study.coverage_contract(coverage(),"a"*64)
        for key,value in (("inputSha256","f"*64),("completeSelectedCandidateReview",False),
                ("modelOutputsSeen",True),("correctedBoxUnits",0),("reviewedCandidateUnits",3),("targets",[])):
            bad=coverage();bad[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):study.coverage_contract(bad,"a"*64)

    def test_incomplete_review_rejects_before_model_construction(self):
        args=SimpleNamespace(input=Path("authored-input.json"),device="mps",
            output=SimpleNamespace(exists=lambda:False,is_symlink=lambda:False,parent=study.HERE),
            review_coverage=SimpleNamespace(read_text=lambda:json.dumps({})))
        with patch.object(study,"load_input",return_value=({"clips":[{"frames":[{}]}]},study.HERE)),\
             patch.object(study,"sha256",return_value="a"*64),\
             patch("assist_scene_global_field.GlobalRaftSmall") as model:
            with self.assertRaises(ValueError):study.replay(args)
            model.assert_not_called()

    def test_replay_has_no_truth_boxes_or_detection_cache_parameter(self):
        for func in (study.replay,study.run_clip,study._run_clip):
            self.assertNotIn("truth",inspect.signature(func).parameters)
            self.assertNotIn("cached_observation",inspect.getsource(func))
        self.assertIn('mode="warped"',inspect.getsource(study._run_clip))
        self.assertIn('order=LANES if i%2==0 else LANES[::-1]',inspect.getsource(study._run_clip))

    def test_failed_partial_execution_exposes_validated_prefix_not_success(self):
        def fail(*args):
            progress=args[-1];progress.update(frameIndex=3,phase="engine-B",validatedFrames=[{"authored":True}])
            raise RuntimeError("authored failed inference")
        with patch.object(study,"_run_clip",side_effect=fail):
            with self.assertRaises(RuntimeError) as failure:
                study.run_clip({"id":"authored"},None,None,None,None,None,None)
        self.assertEqual(failure.exception.m3q_progress["frameIndex"],3)
        self.assertEqual(failure.exception.m3q_progress["validatedFrames"],[{"authored":True}])

    def test_incremental_budget_is_retained_not_point_pruning(self):
        source=inspect.getsource(study._run_clip)
        self.assertIn('budget["validatedBytes"]+row_bytes<=MAX_BYTES-1024**2',source)
        self.assertIn('progress["validatedFrames"]=rows',source)

    def test_supported_pixel_requires_explicit_unchanged_source_variance_floor(self):
        from test_assist_scene_m3q_correspondence import inventory
        method=study.candidate
        gray=np.random.default_rng(650901).integers(0,256,(128,128),np.uint8)
        inv=inventory(gray);matcher=method.RootSiftMatcher();matches=matcher.match(inv,inv)
        fields=(np.zeros((128,128,2),np.float32),np.zeros((128,128,2),np.float32))
        value=method.population(gray,gray,inv,inv,inv["selections"][0],matches,fields)
        self.assertTrue(value[3].all())
        exposure=dict(workingPixelsSha256=method._digest(gray))
        study._population(value[4],exposure,exposure,inv["selections"][0])
        for variance in (15.999999,None):
            bad=deepcopy(value[4]);bad["points"][0]["sourcePatchVariance"]=variance
            with self.subTest(variance=variance),self.assertRaises(ValueError):
                study._population(bad,exposure,exposure,inv["selections"][0])

    def test_candidate_actual_sift_authored_zero_flow_history_and_tampering(self):
        history=authored_history();row=history[-1]
        self.assertFalse(row["B"]["events"])
        self.assertGreater(len(row["B"]["diagnostics"]["globalFields"]),0)
        for case in ("source","calls","missing-rival","population","inventory"):
            bad=deepcopy(row);diag=bad["B"]["diagnostics"]
            if case=="source":diag["globalFields"][0]["oldWorkingPixelsSha256"]="f"*64
            elif case=="calls":bad["flowDirectionCalls"]["B"]+=2
            elif case=="missing-rival":diag["comparisons"].pop()
            elif case=="population":diag["populations"][0]["proof"]["seedPoints"]+=1
            else:diag["sourceSelections"]["sourceMs"]-=1
            with self.subTest(case=case),self.assertRaises(ValueError):study.candidate_contract(bad,history[:-1])

    def test_headline_model_counter_cannot_omit_or_relabel_directions(self):
        receipt=dict(schemaVersion=1,study="M3Q",developmentOnly=False,
            codeSha256={n:study.sha256(study.HERE/n) for n in study.CODE},policies=study.policies(),
            device="mps",opencv=study.cv2.__version__,numpy=np.__version__,provider={"policy":dict(FIELD)},weightsSha256=FIELD["weightSha256"],
            maxWallSeconds=study.MAX_SECONDS,maxReceiptBytes=study.MAX_BYTES,replayWallMs=1.,actualModelDirections=2,
            clips=[dict(detectorCalls=1,detectorConfiguration=study.DETECTOR_CONFIGURATION,
                actualFlowDirectionCallsByLane=dict(A=0,B=2),frames=[dict(flowDirectionCalls=dict(A=0,B=2),actualCalls=dict(A=dict(raft=0),B=dict(raft=2)))])])
        study.receipt_contract(receipt)
        receipt["actualModelDirections"]=0
        with self.assertRaises(ValueError):study.receipt_contract(receipt)


if __name__=="__main__":unittest.main()
