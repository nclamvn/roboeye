"""Authored source-binding tests, no model or real identity judgement."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3p_identity as m


BOX={"x":.1,"y":.2,"width":.2,"height":.3}


def fixture():
    def raw(token,at):return {"token":token,"timestampUs":at,"path":token+".png","sha256":token*64,
        "intrinsics":[[1,0,0],[0,1,0],[0,0,1]],"cameraToWorld":[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}
    def row(token,at,index):return {"token":token,"timestampUs":at,"sourceSha256":token*64,"index":index,
        "width":100,"height":80,"nativeWidth":200,"nativeHeight":160,"cameraIntrinsics":[[.5,0,0],[0,.5,0],[0,0,1]],
        "cameraToWorld":[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
        "detections":[{"label":"car","score":.9,"box":deepcopy(BOX)}],
        "T":{"tracks":[{"id":7,"label":"car","score":.9,"box":deepcopy(BOX)}]}}
    a,b,c=[row(t,at,j) for j,(t,at) in enumerate((("a",100),("b",200),("c",300)))];b["detections"].append({"label":"car","score":.8,"box":{**BOX,"x":.5}})
    target={"instance":"object-1","classFamily":"vehicle","approach":"approaching","box":deepcopy(BOX)}
    pair={"startToken":"b","endToken":"c","startDetectionIndex":0,"endDetectionIndex":0,"startSha256":"b"*64,"startBox":[10,16,30,40]}
    lanes={}
    for lane in "ABC":
        p=deepcopy(pair)
        if lane=="C":p.update(startDetectionIndex=1,startBox=[50,16,70,40])
        c[lane]={"diagnostics":{"windowEvidence":{"7":{"fresh":p}}}}
        lanes[lane]={"fresh":deepcopy(p),"anchor":None}
    inp={"clips":[{"id":"clip","frames":[raw(t,at) for t,at in (("a",100),("b",200),("c",300))]}]}
    receipt={"study":"M3O","developmentOnly":False,"inputSha256":"I","clips":[{"id":"clip","frames":[a,b,c]}]}
    truth={"inputSha256":"I","clips":[{"id":"clip","frames":[{"token":"c","timestampUs":300,"targets":[target]}]}]}
    match=m.matching_graph(c["T"]["tracks"],[target],m.legacy_score())["hits"][0]
    diagnosis={"inputSha256":"I","receiptSha256":"R","truthSha256":"T","cases":[{
        "clipId":"clip","frameToken":"c","frameIndex":2,"sourceSha256":"c"*64,"target":target,"currentHandle":7,
        "currentTrackMatch":match,"lanes":lanes}]}
    return inp,receipt,truth,diagnosis


class IdentityReviewTests(unittest.TestCase):
    def test_native_coordinate_scaling_and_original_geometry(self):
        row={"width":100,"height":80,"nativeWidth":200,"nativeHeight":160}
        self.assertEqual(m.native_box([10,16,30,40],row),[20,32,60,80])
        for box in ([1,2,0,3],[-1,0,10,20],[0,0,float("nan"),2],[0,0,101,80]):
            with self.assertRaises(ValueError):m.native_box(box,row)

    def test_distinct_selected_boxes_preserved_and_shared_lanes_deduplicated(self):
        records=m.plan(*fixture(),"I","R","T");self.assertEqual(len(records),1)
        source=records[0]["sources"][0]
        self.assertEqual(source["role"],"fresh");self.assertEqual(len(source["options"]),2)
        self.assertEqual(source["options"][0]["lanes"],["A","B"])
        self.assertEqual(source["options"][1]["lanes"],["C"])
        self.assertEqual(len(records[0]["units"]),2)

    def test_missing_sources_not_synthesized_or_auto_labelled_same(self):
        inp,receipt,truth,diagnosis=fixture()
        for lane in "ABC":
            receipt["clips"][0]["frames"][-1][lane]["diagnostics"]["windowEvidence"]["7"]={}
            diagnosis["cases"][0]["lanes"][lane]={"fresh":None,"anchor":None}
        record=m.plan(inp,receipt,truth,diagnosis,"I","R","T")[0]
        self.assertEqual(record["units"],[]);self.assertEqual(record["sources"],[])
        self.assertNotIn("identity",record)

    def test_input_clock_box_and_target_tampering_fail_closed(self):
        for change in ("receipt-binding","clock","source-box","target","qualification"):
            args=list(fixture())
            if change=="receipt-binding":args[3]["receiptSha256"]="wrong"
            if change=="clock":args[0]["clips"][0]["frames"][1]["timestampUs"]=350
            if change=="source-box":args[1]["clips"][0]["frames"][-1]["A"]["diagnostics"]["windowEvidence"]["7"]["fresh"]["startBox"][0]=11
            if change=="target":args[3]["cases"][0]["target"]={**args[3]["cases"][0]["target"],"instance":"other"}
            if change=="qualification":args[3]["cases"][0]["currentTrackMatch"]["iou"]=.8
            with self.subTest(change=change),self.assertRaises(ValueError):m.plan(*args,"I","R","T")

    def test_all_qualified_positives_must_be_present_even_when_no_sources(self):
        args=list(fixture());args[3]["cases"]=[]
        with self.assertRaisesRegex(ValueError,"omitted"):m.plan(*args,"I","R","T")

    def test_camera_intrinsics_and_pose_are_bound_to_actual_source(self):
        for kind in ("intrinsics","pose"):
            args=list(fixture());row=args[1]["clips"][0]["frames"][-1]
            if kind=="intrinsics":row["cameraIntrinsics"][0][0]=999
            else:row["cameraToWorld"][0][3]=1
            with self.subTest(kind=kind),self.assertRaisesRegex(ValueError,"Camera"):m.plan(*args,"I","R","T")

    def test_explicit_review_requires_every_unit_uncertainty_and_sheet_hash(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3p-identity-test-") as temp:
            root=Path(temp);sheet=root/"sheet.png";sheet.write_bytes(b"authored-test-png-placeholder")
            manifest={"cases":[{"units":["u1","u2"],"sheet":"sheet.png","sheetSha256":m.sha256(sheet)}]}
            mp=root/"manifest.json";m.write(mp,manifest)
            dec={"manifestSha256":m.sha256(mp),"review":{"kind":"authored-test"},"units":{"u1":{"identity":"same","note":"authored fixture"},"u2":{"identity":"unknown","note":"occluded fixture"}}}
            dp=root/"decisions.json";m.write(dp,dec);out=root/"result.json";m.review(mp,dp,out)
            result=json.loads(out.read_text());self.assertEqual(result["counts"],{"same":1,"unknown":1})
            self.assertNotIn("different",result["counts"])
            sheet.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError,"sheet changed"):m.review(mp,dp,root/"failed.json")
            self.assertFalse((root/"failed.json").exists())

    def test_incomplete_or_automatic_review_rejected(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3p-identity-test-") as temp:
            root=Path(temp);mp=root/"manifest.json";dp=root/"decisions.json"
            m.write(mp,{"cases":[{"units":["u"],"sheet":"not-read-if-incomplete","sheetSha256":"x"}]})
            m.write(dp,{"manifestSha256":m.sha256(mp),"units":{}})
            with self.assertRaisesRegex(ValueError,"Every selected"):m.review(mp,dp,root/"out.json")


if __name__=="__main__":unittest.main()
