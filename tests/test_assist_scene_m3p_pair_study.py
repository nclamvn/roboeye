"""Authored component contracts, no pretrained model execution."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3p_pair_study as m
from assist_scene_m3o_correspondence_audit import analytic_fields


def exposure(token,at):
    return {"token":token,"timestampUs":at,"path":token+".png","sourceSha256":"0"*64,
        "nativeSize":[224,160],"workingSize":[224,160],"intrinsics":[[200,0,112],[0,200,80],[0,0,1]],
        "workingIntrinsics":[[200,0,112],[0,200,80],[0,0,1]],"cameraToWorld":np.eye(4).tolist(),"index":0}


def fixture():
    source={**exposure("old",1),"role":"anchor","options":[{"unitId":"u1","lanes":["A","B"],
        "workingBox":[20,20,90,90],"detectionIndex":0,"label":"car"},{"unitId":"u2","lanes":["C"],
        "workingBox":[120,20,190,90],"detectionIndex":1,"label":"car"}]}
    return {"schemaVersion":1,"study":"M3P-posthoc-source-identity-review","cases":[{"caseId":"c1",
        "current":exposure("new",2),"currentDetectorBox":[20,20,90,90],"currentDetectionIndex":0,
        "sources":[source],"units":["u1","u2"]}]}


class PairStudyTests(unittest.TestCase):
    def test_timestamp_pair_deduplicated_without_dropping_distinct_source_boxes(self):
        groups=m.plan(fixture());self.assertEqual(len(groups),1)
        self.assertEqual(len(groups[0]["units"]),2)
        self.assertEqual(groups[0]["units"][0]["oldBox"],[20,20,90,90])
        self.assertEqual(groups[0]["units"][1]["oldBox"],[120,20,190,90])

    def test_manifest_identity_claims_do_not_enter_model_fixture_plan(self):
        before=m.plan(fixture());manifest=fixture()
        manifest["cases"][0]["sources"][0]["options"][0]["identity"]="same"
        manifest["identityDecisions"]={"u1":"different"}
        self.assertEqual(before,m.plan(manifest))

    def test_counterbalanced_order_visits_each_lane_in_every_position(self):
        orders=[m.lane_order(i) for i in range(3)]
        self.assertEqual(orders,[["A","B","C"],["B","C","A"],["C","A","B"]])
        for position in range(3):self.assertEqual({o[position] for o in orders},set("ABC"))

    def test_noncausal_pair_duplicate_units_and_missing_coverage_rejected(self):
        for kind in ("clock","duplicate","coverage"):
            manifest=fixture()
            if kind=="clock":manifest["cases"][0]["sources"][0]["timestampUs"]=3
            if kind=="duplicate":manifest["cases"][0]["sources"][0]["options"][1]["unitId"]="u1"
            if kind=="coverage":manifest["cases"][0]["units"].append("u3")
            with self.subTest(kind=kind),self.assertRaises(ValueError):m.plan(manifest)

    def test_analytic_real_verifier_positive_preserves_fixed_floors(self):
        rng=np.random.default_rng(650901);old=cv2.GaussianBlur(rng.integers(0,256,(160,224),np.uint8),(3,3),.6)
        matrix=cv2.getRotationMatrix2D((112,80),0,1.08);new=cv2.warpAffine(old,matrix,(224,160))
        old_box=[40.,30.,180.,130.];points=np.array([[40,30],[180,130]],float)@matrix[:,:2].T+matrix[:,2]
        unit={"label":"car","oldBox":old_box,"newBox":points.reshape(-1).tolist()}
        fields=analytic_fields(matrix,old.shape);a=m.seal(old,unit["oldBox"]);b=m.seal(new,unit["newBox"])
        proof=m.pair_evidence(old,new,unit,fields,np.eye(3),a,b)
        self.assertTrue(proof["supported"],proof["reason"])
        self.assertLessEqual(proof["growthSpan"],.005)
        self.assertEqual(proof["populations"]["forward"]["selection"],a)
        self.assertEqual(m.engine.POLICY["minSupport"],.70)
        self.assertEqual(m.engine.POLICY["minRepresentedWorkingSidePx"],18.)

    def test_small_object_veto_retains_all_source_seeds_as_unknown(self):
        rng=np.random.default_rng(7);old=rng.integers(0,256,(160,224),np.uint8)
        unit={"label":"person","oldBox":[40,30,57,90],"newBox":[40,30,57,90]}
        a=m.seal(old,unit["oldBox"]);b=m.seal(old,unit["newBox"])
        proof=m.pair_evidence(old,old,unit,(np.zeros((160,224,2),np.float32),)*2,np.eye(3),a,b)
        self.assertFalse(proof["supported"])
        for d in ("forward","reverse"):
            self.assertEqual(proof["directions"][d]["unknownPoints"],proof["directions"][d]["seedPoints"])
            self.assertEqual(proof["populations"][d]["status"],"not-measured")

    def test_selection_from_another_image_fails(self):
        old=np.zeros((160,224),np.uint8);new=old.copy();new[0,0]=1
        unit={"label":"car","oldBox":[20,20,90,90],"newBox":[20,20,90,90]}
        with self.assertRaisesRegex(ValueError,"Selection changed"):
            m.pair_evidence(old,new,unit,(None,None),np.eye(3),m.seal(old,unit["oldBox"]),m.seal(old,unit["newBox"]))

    def test_field_archive_retains_exact_finite_original_arrays_and_budget(self):
        fields=tuple(np.full((32,40,2),i,np.float32) for i in (1,2))
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3p-pair-test-") as temp:
            root=Path(temp);r=m.archive_fields(root,"f.npz",fields,0)
            with np.load(root/"f.npz",allow_pickle=False) as loaded:
                np.testing.assert_array_equal(loaded["forward"],fields[0]);np.testing.assert_array_equal(loaded["backward"],fields[1])
            self.assertEqual(m.sha256(root/"f.npz"),r["sha256"])
            with self.assertRaisesRegex(ValueError,"300MiB"):m.archive_fields(root,"not-written.npz",fields,m.MAX_ARCHIVE_BYTES)
            self.assertFalse((root/"not-written.npz").exists())

    def test_score_same_different_unknown_not_warning_recall(self):
        receipt={"study":"M3P-real-pair-component","identityDecisionsRead":False,"manifestSha256":"M",
            "pairs":[{"pairId":"p","preparationMs":1.,"units":[{"unitId":"u1"},{"unitId":"u2"}],"arms":{
                l:{"actualDirections":2,"fieldMs":2.,"verificationMs":3.,"units":[{"unitId":"u1","supported":True,"reason":"pair-only"},
                    {"unitId":"u2","supported":False,"reason":"unknown"}]} for l in "ABC"}}]}
        decisions={"manifestSha256":"M","units":{"u1":{"identity":"same"},"u2":{"identity":"unknown"}}}
        with patch.object(m,"receipt_contract",return_value=True):out=m.score(receipt,decisions)
        self.assertEqual(out["totals"]["A"]["sameSupported"],1)
        self.assertEqual(out["totals"]["A"]["unknownUnsupported"],1)
        self.assertNotIn("tp",out["totals"]["A"])
        for changed in ("leak","hash","missing"):
            r=deepcopy(receipt);d=deepcopy(decisions)
            if changed=="leak":r["identityDecisionsRead"]=True
            if changed=="hash":d["manifestSha256"]="wrong"
            if changed=="missing":del d["units"]["u2"]
            with self.subTest(changed=changed),patch.object(m,"receipt_contract",return_value=True),self.assertRaises(ValueError):m.score(r,d)

    def test_receipt_authority_gate_rejects_before_provider_claims(self):
        with self.assertRaisesRegex(ValueError,"authority"):m.receipt_contract({"schemaVersion":1,"study":"M3P-real-pair-component","identityDecisionsRead":True})

    def test_frozen_policy_snapshot_is_stable_after_json_roundtrip(self):
        value=m.policy_snapshot();self.assertEqual(value,json.loads(json.dumps(value)))
        self.assertEqual(value["geometry"]["maxEstimatorLogGrowthSpan"],.005)

    def test_inventory_cannot_be_reassigned_to_a_different_box(self):
        old=np.zeros((160,224),np.uint8);unit={"label":"car","oldBox":[20,20,90,90],"newBox":[20,20,90,90]}
        with self.assertRaisesRegex(ValueError,"different source box"):
            m.pair_evidence(old,old,unit,(None,None),np.eye(3),m.seal(old,[21,20,91,90]),m.seal(old,unit["newBox"]))


if __name__=="__main__":unittest.main()
