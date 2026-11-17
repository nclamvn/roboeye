"""Authored analytic/mocked controls, not empirical camera accuracy."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3w_factor_audit as audit


K=np.array([[100.,0,50],[0,100.,40],[0,0,1]])
PLANES=[dict(id="front",z=4.,boundsXY=[-.2,-.2,.2,.2]),dict(id="far",z=8.,boundsXY=None)]


class FactorAuditTests(unittest.TestCase):
    def test_independent_ray_projection_known_material(self):
        pose=np.eye(4);world,ids=audit.material_rays([[50,40],[90,40]],K,pose,PLANES)
        np.testing.assert_allclose(world,[[0,0,4],[3.2,0,8]])
        self.assertEqual(ids.tolist(),[0,1])
        target=np.eye(4);target[0,3]=.4
        q,z=audit.project_material(world,K,target)
        np.testing.assert_allclose(q,[[40,40],[85,40]])
        np.testing.assert_allclose(z,[4,8])

    def test_analytic_plane_homography(self):
        source=np.eye(4);target=np.eye(4);target[:3,3]=[.2,.1,0]
        p=np.array([[25.,25],[30,50],[70,60]])
        world,_=audit.material_rays(p,K,source,[dict(z=8,boundsXY=None)])
        projected,_=audit.project_material(world,K,target)
        # Hard-coded frontoparallel plane homography: dx=-f*Cx/Z.
        np.testing.assert_allclose(projected,p-[2.5,1.25],atol=1e-12)

    def test_occlusion_out_of_view_and_mixed_patch_kept(self):
        source=np.eye(4);target=np.eye(4);target[0,3]=.4
        ref=audit.oracle_centers([[45,40],[0,40],[90,40]],K,source,target,PLANES,(80,100))
        self.assertEqual(len(ref["status"]),3)
        self.assertIn("target-out-of-view",ref["status"])
        # x=55 is a material boundary of the finite near plane.
        patch=audit.patch_strata([[55,40]],[[55,40]],[0],K,source,source,PLANES,(80,100),3)
        self.assertEqual(patch,[False])

    def test_projection_behind_not_a_reference_pass(self):
        target=np.eye(4);target[2,3]=10
        ref=audit.oracle_centers([[50,40]],K,np.eye(4),target,PLANES,(80,100))
        self.assertEqual(ref["status"],["target-behind"])

    def test_endpoint_original_denominator_and_wrong(self):
        controls=dict(originalSeedCount=4,endpoints=[[1,1],[20,20],[3,3],[4,4]],
            lkAccepted=[True,True,False,True],photometric=[True]*4)
        ref=dict(endpoints=[[1,1],[2,2],[3,3],[4,4]],status=["visible"]*3+["occluded"])
        out=audit.endpoint_counts(controls,ref,[True]*4)
        self.assertEqual(out["originalSeeds"],4)
        self.assertEqual(out["counts"],{"accepted-right":1,"accepted-wrong":1,"missed-valid":1,
            "accepted-invisible":1,"reference-unavailable":0})
        self.assertEqual(out["componentConfusion"]["fpIncludingInvisible"],2)
        self.assertEqual(out["acceptedInvisibleByStatus"],{"occluded":1})
        self.assertEqual(out["componentConfusion"]["fpTotalKnown"],2)
        self.assertEqual(out["componentConfusion"]["knownUnmatchableFP"],1)
        self.assertEqual(out["componentConfusion"]["sourceUnavailableUnknown"],0)

    def test_true_clock_preserved_and_only_one_factor_changed(self):
        pair=dict(source=dict(timestampUs=1000000,poseTimestampUs=1000000,cameraToWorld=np.eye(4).tolist()),
            target=dict(timestampUs=1100000,poseTimestampUs=1100000,cameraToWorld=np.eye(4).tolist()),clockVariants=[])
        for offset in audit.POLICY["clockOffsetsUs"]:
            pair["clockVariants"].append(dict(offsetUs=offset,source=dict(poseTimestampUs=1000000+offset,cameraToWorld=np.eye(4).tolist()),
                target=dict(poseTimestampUs=1100000+offset,cameraToWorld=np.eye(4).tolist())))
        a,b=audit.frames_for(K,pair,40000)
        self.assertEqual(a["timestampUs"],1000000);self.assertEqual(a["poseTimestampUs"],1040000)
        self.assertEqual(b["timestampUs"],1100000)
        controls=dict(originalSeedCount=0,sourceSeeds=[],endpoints=[],lkAccepted=[],photometric=[],outsideCurrentForeground=[])
        result=audit.gate(controls,K,pair,(80,100),40000)
        self.assertEqual(result["status"],"pose-skew");self.assertFalse(result["qualified"])

    def test_frozen_raw_evidence_equivalence_mocked_no_flow(self):
        old=np.tile(np.arange(80,dtype=np.uint8),(64,1))*3;new=old.copy()
        a=np.array([[[15.,15]],[[30,30]],[[40,40]]],np.float32)
        b=a.copy();back=a.copy();back[2,0,0]+=2
        status=np.ones((3,1),np.uint8)
        def fixture():
            return patch.multiple(audit.cv2,goodFeaturesToTrack=lambda *args,**kw:a.copy(),
                calcOpticalFlowPyrLK=unittest.mock.Mock(side_effect=[(b.copy(),status.copy(),None),(back.copy(),status.copy(),None)]))
        # The mocked cv2 calls are not real LK/data execution.
        with fixture():expected=audit.camera.source_controls(old,new,(),())
        with fixture():actual=audit.observe_pair(old,new)
        for key in ("sourceSeeds","endpoints","backwardEndpoints","forwardStatus","backwardStatus", "lkAccepted","photometric","outsideCurrentForeground"):
            self.assertEqual(actual[key],expected[key],key)
        self.assertEqual(actual["cyclePx"],[0.,0.,2.])
        self.assertEqual(len(actual["patchMetrics"]),3)

    def test_profile_restored_on_error(self):
        original=sys.getprofile()
        with patch.object(audit.frozen,"correspondences",side_effect=RuntimeError("controlled")):
            with self.assertRaises(RuntimeError):audit.observe_pair(np.zeros((40,40),np.uint8),np.zeros((40,40),np.uint8))
        self.assertIs(sys.getprofile(),original)

    def test_observe_never_opens_gold_poison(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3w-20261117-") as temporary:
            root=Path(temporary);manifest=dict(schemaVersion=1,study="M3W-RGB-only-input",datasetId="m3w-fixed-v1",imageShape=[480,640],controlsManifestSha256="a"*64,pairs=[])
            for i in range(14):
                pair_id=f"m3w-{i:02d}"if i<12 else ["i_londonbridge","v_abstract"][i-12]
                manifest["pairs"].append(dict(id=pair_id,split="analysis"if i<6 else "holdout"if i<12 else "external-planar-reference",kind="authored"if i<12 else "hpatches",
                    source=dict(path="unread-image",sha256="b"*64,timestampUs=1000000),
                    target=dict(path="unread-image",sha256="c"*64,timestampUs=1100000)))
            path=root/"rgb.json";path.write_text(json.dumps(manifest))
            expected=sha256(path.read_bytes()).hexdigest();opened=[];original_read=audit.read_sealed
            def guarded(path,expected):
                opened.append(Path(path).name)
                if Path(path).name!="rgb.json":raise AssertionError("gold accessed")
                return original_read(path,expected)
            empty=dict(originalSeedCount=0,sourceSeeds=[],endpoints=[],backwardEndpoints=[],forwardStatus=[],
                backwardStatus=[],lkAccepted=[],photometric=[],outsideCurrentForeground=[],lkDirectionCalls=0,cyclePx=[],patchMetrics=[])
            with patch.object(audit,"read_sealed",side_effect=guarded),patch.object(audit,"image_asset",return_value=np.zeros((480,640),np.uint8)), \
                    patch.object(audit,"observe_pair",return_value=empty):
                result=audit.observe(path,expected,root/"obs.json")
            self.assertEqual(opened,["rgb.json"]);self.assertEqual(result["goldFileOpens"],0)
            self.assertEqual(len(result["pairs"]),14)

    def test_rgb_manifest_rejects_oracle_fields(self):
        manifest=dict(schemaVersion=1,study="M3W-RGB-only-input",datasetId="m3w-fixed-v1",imageShape=[480,640],pairs=[])
        for i in range(14):manifest["pairs"].append(dict(id=f"m3w-{i:02d}"if i<12 else ["i_londonbridge","v_abstract"][i-12],
            split="analysis"if i<6 else "holdout"if i<12 else "external-planar-reference",kind="authored"if i<12 else "hpatches",source={},target={}))
        audit.validate_rgb_manifest(manifest)
        manifest["pairs"][0]["K"]=np.eye(3).tolist()
        with self.assertRaisesRegex(ValueError,"oracle-field"):audit.validate_rgb_manifest(manifest)

    def test_bad_sha_before_asset_open_and_failure_prefix(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3w-20261117-") as temporary:
            root=Path(temporary);path=root/"input.json";path.write_text("{}")
            with patch.object(audit,"image_asset",side_effect=AssertionError("should not open")):
                with self.assertRaisesRegex(ValueError,"source-seal"):audit.observe(path,"a"*64,root/"output.json")
            prefix=json.loads((root/"output.json-incomplete.json").read_text())
            self.assertFalse(prefix["complete"]);self.assertEqual(prefix["actualLkDirections"],0)

    def test_oracle_not_promoted_as_measured_lk(self):
        measured=dict(originalSeedCount=3,sourceSeeds=[[1,1],[2,2],[3,3]])
        reference=dict(endpoints=[[1,1],[2,2],[3,3]],status=["visible","occluded","visible"])
        out=audit.oracle_controls(measured,reference,[True,True,False])
        self.assertEqual(out["originalSeedCount"],3)
        self.assertEqual(out["lkAccepted"],[True,False,False])
        self.assertEqual(out["authority"],"oracle-component-only-not-measured-LK")

    def test_body_twist_group_and_polynomial_hard_fixture(self):
        trajectory=dict(kind="constant-body-twist",bodyAngular=[0,1,0],bodyLinear=[1,0,0])
        p=audit.trajectory_pose(trajectory,1200000);half=audit.trajectory_pose(trajectory,1100000)
        np.testing.assert_allclose(p,half@half,atol=1e-14)
        np.testing.assert_allclose(p[:3,3],[np.sin(.2),0,np.cos(.2)-1],atol=1e-14)
        poly=dict(kind="world-polynomial-euler",center=[[1,2],[3,4],[5,6]],angles=[[0],[0],[0]])
        np.testing.assert_allclose(audit.trajectory_pose(poly,1100000)[:3,3],[1.2,3.4,5.6])

    def test_actual_frozen_gate_and_along_epiline_limitation(self):
        # Analytic controls only: no image rendering or LK invocation.
        K=np.array([[520.,0,319.5],[0,515,239.5],[0,0,1]])
        a=np.array([(x,y)for x in np.linspace(50,590,8)for y in np.linspace(50,430,6)])
        p0=np.eye(4);p1=np.eye(4);p1[0,3]=.04
        pair=dict(source=dict(timestampUs=1000000,poseTimestampUs=1000000,cameraToWorld=p0.tolist()),
            target=dict(timestampUs=1100000,poseTimestampUs=1100000,cameraToWorld=p1.tolist()))
        b=a-[2.6,0];n=len(a)
        controls=dict(sourceSeeds=a.tolist(),endpoints=b.tolist(),originalSeedCount=n,lkAccepted=[True]*n,
            photometric=[True]*n,outsideCurrentForeground=[True]*n)
        correct=audit.gate(controls,K,pair,(480,640));self.assertTrue(correct["qualified"])
        perpendicular=audit.wrong_endpoints(controls,K,pair,"perpendicular")
        along=audit.wrong_endpoints(controls,K,pair,"along")
        self.assertFalse(audit.gate(perpendicular,K,pair,(480,640))["qualified"])
        self.assertTrue(audit.gate(along,K,pair,(480,640))["qualified"])

    def test_postflow_failure_retains_count(self):
        with patch.object(audit,"finish_observation",side_effect=RuntimeError("postflow failure")):
            # Pure mocked Python correspondences => 0 C invocations is honest.
            with patch.object(audit.frozen,"correspondences",return_value=(np.empty((0,2)),np.empty((0,2)))):
                with self.assertRaises(RuntimeError)as caught:
                    audit.observe_pair(np.zeros((40,40),np.uint8),np.zeros((40,40),np.uint8))
            self.assertEqual(caught.exception.m3w_lk_directions,0)

    def test_synthetic_two_call_trace_postflow_failure_and_prefix(self):
        # Inject two c_call trace events, not two actual flow computations.
        # This exercises failure accounting without running the heldout study.
        holder={};original=sys.getprofile()
        def set_profile(callback):holder["callback"]=callback
        def correspondences(*args):
            for _ in range(2):holder["callback"](None,"c_call",audit.cv2.calcOpticalFlowPyrLK)
        with patch.object(audit.sys,"setprofile",side_effect=set_profile), \
                patch.object(audit.frozen,"correspondences",side_effect=correspondences), \
                patch.object(audit,"finish_observation",side_effect=RuntimeError("NCC after matching")):
            with self.assertRaises(RuntimeError)as caught:
                audit.observe_pair(np.zeros((40,40),np.uint8),np.zeros((40,40),np.uint8))
        self.assertEqual(caught.exception.m3w_lk_directions,2)
        self.assertIs(holder["callback"],original)

    def test_bilinear_fractional_support_not_only_query_centers(self):
        # At x54.8 a radius0 fractional query blends x54 and55. Boundary54.9
        # would be missed by checking only the center ray at54.8.
        planes=[dict(id="near",z=4,boundsXY=[-100,-100,.196,100]),dict(id="far",z=8,boundsXY=None)]
        result=audit.patch_strata([[54.8,40]],[[54.8,40]],[0],K,np.eye(4),np.eye(4),planes,(80,100),0)
        self.assertEqual(result,[False])

    def test_raw_backflow_cannot_be_forged_to_promote_match(self):
        controls=dict(originalSeedCount=1,sourceSeeds=[[10,10]],endpoints=[[10,10]],backwardEndpoints=[[20,20]],
            forwardStatus=[[1]],backwardStatus=[[1]],lkAccepted=[True],photometric=[False],outsideCurrentForeground=[True],
            cyclePx=[0],patchMetrics=[dict(interior=False,normProduct=None,dotProduct=None,supported=False)],lkDirectionCalls=2)
        with self.assertRaisesRegex(ValueError,"raw-LK-failure"):audit.validate_controls(controls,(80,100))

    def test_preexisting_output_rejected_before_any_input_or_flow(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3w-20261117-")as temporary:
            root=Path(temporary)
            for suffix in ("","-incomplete.json"):
                output=root/("receipt"+str(len(suffix))+".json")
                Path(str(output)+suffix).write_text("preserved")
                with patch.object(audit,"read_sealed",side_effect=AssertionError("should not read input")), \
                        patch.object(audit,"observe_pair",side_effect=AssertionError("should not run matcher")):
                    with self.assertRaisesRegex(ValueError,"already-exists"):audit.observe(root/"input.json","a"*64,output)
                    with self.assertRaisesRegex(ValueError,"already-exists"):
                        audit.evaluate(root/"input.json","a"*64,root/"obs.json","b"*64,output,"c"*64)


if __name__=="__main__":unittest.main()
