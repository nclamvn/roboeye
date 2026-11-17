import copy
from hashlib import sha256
import sys
from pathlib import Path
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import cv2
import numpy as np

import assist_scene_m3q_correspondence as method
import assist_scene_global_window as frozen
import assist_scene_texture_patches as texture
from assist_scene_motion import Detection


def inventory(image,points=None,*,size=1.,box=(5.,5.,122.,122.),duplicate=False):
    if points is None:points=[[x,y] for y in (24.,48.,72.,96.) for x in (24.,48.,72.,96.)]
    records=[{"point":list(p),"size":size,"angle":0.,"response":1.,"octave":0,
        "radius":method.descriptor_radius(size)} for p in points]
    desc=np.eye(128,dtype=np.float32)[:len(points)].copy()
    if duplicate and len(desc)>1:desc[1]=desc[0]
    selection=method._selection(method._digest(image),image.shape,records,box)
    return {"sourceOnly":True,"sourceSha256":method._digest(image),"sourceShape":list(image.shape),
        "keypoints":records,"descriptors":desc,"descriptorsSha256":method._digest(desc),
        "catalogSha256":method.canonical(records),"selections":[selection],
        "selectionSha256s":[method.canonical(selection)],"prepareMs":0.}


class RootSiftTests(unittest.TestCase):
    def setUp(self):
        self.image=np.random.default_rng(650901).integers(0,256,(128,128),np.uint8)
        self.inv=inventory(self.image)
        self.matcher=method.RootSiftMatcher()
        self.fields=(np.zeros((128,128,2),np.float32),np.zeros((128,128,2),np.float32))

    def population(self,other=None,fields=None):
        other=self.inv if other is None else other
        pair=self.matcher.match(self.inv,other)
        return method.population(self.image,self.image,self.inv,other,self.inv["selections"][0],pair,
            self.fields if fields is None else fields)

    def test_policy_preserves_frozen_warning_and_pixel_floors(self):
        for key,value in frozen.POLICY.items():
            if key!="method":self.assertEqual(method.POLICY[key],value,key)
        self.assertEqual(method.POLICY["pixelVerification"],dict(texture.POLICY))
        self.assertEqual(method.POLICY["strictFlowAgreementPx"],1.3)
        self.assertEqual(method.POLICY["ratio"],.70)

    def test_rootsift_normalization_and_invalid_descriptors(self):
        result=method.rootsift(np.full((1,128),4.,np.float32))
        self.assertAlmostEqual(float(np.linalg.norm(result)),1.,places=6)
        self.assertFalse(method.rootsift(np.zeros((1,128),np.float32)).any())
        for bad in (np.zeros((2,12)),np.full((1,128),np.nan),np.full((1,128),-1.)):
            with self.assertRaises(ValueError):method.rootsift(bad)

    def test_canonical_sift_descriptor_radius_is_not_7x7_patch(self):
        self.assertEqual(method.descriptor_radius(2.),11)
        self.assertEqual(method.descriptor_radius(4.),21)
        self.assertFalse(method.footprint_inside([20,20],21,[0,0,100,100]))

    def test_global_reciprocal_ratio_retains_duplicate_ambiguity(self):
        pair=self.matcher.match(self.inv,self.inv)
        self.assertEqual(pair["pairCount"],16)
        duplicate=inventory(self.image,duplicate=True)
        ambiguous=self.matcher.match(duplicate,duplicate)
        self.assertNotIn(0,[p["oldIndex"] for p in ambiguous["pairs"]])
        self.assertNotIn(1,[p["oldIndex"] for p in ambiguous["pairs"]])
        self.assertEqual(duplicate["selections"][0]["seedPoints"],16)

    def test_author_constructed_static_positive_retains_every_seed(self):
        result=self.population()
        self.assertEqual(len(result[0]),16)
        self.assertTrue(result[3].all())
        self.assertTrue(np.allclose(result[2],0))
        box=Detection("car",1.,(5.,5.,122.,122.))
        proof=method.direction(result,box,box,np.eye(3))
        self.assertTrue(proof["supported"],proof)
        self.assertEqual(proof["seedPoints"],16)
        self.assertEqual(proof["points"],16)

    def test_descriptor_cycle_zero_does_not_hide_independent_flow_error(self):
        fwd=self.fields[0].copy();fwd[:,:,0]=1.31
        result=self.population(fields=(fwd,self.fields[1]))
        self.assertFalse(result[3].any())
        self.assertEqual(result[4]["reasonCounts"],{"independent-raft-endpoint-or-return":16})
        self.assertEqual(result[4]["seedPoints"],16)
        self.assertTrue(all(p["centerCyclePx"]==0 for p in result[4]["points"]))

    def test_independent_return_error_rejects_at_same_unchanged_floor(self):
        back=self.fields[1].copy();back[:,:,1]=1.31
        result=self.population(fields=(self.fields[0],back))
        self.assertFalse(result[3].any())
        self.assertEqual(result[4]["seedPoints"],16)

    def test_source_descriptor_outside_own_box_unknown_not_denominator_removal(self):
        wide=inventory(self.image,size=12.)
        pair=self.matcher.match(wide,wide)
        result=method.population(self.image,self.image,wide,wide,wide["selections"][0],pair,self.fields)
        self.assertEqual(result[4]["seedPoints"],16)
        self.assertFalse(result[3].any())
        self.assertEqual(result[4]["reasonCounts"],{"source-descriptor-leaves-object":16})

    def test_target_support_gate_after_global_matching_keeps_unknowns(self):
        result=self.population()
        first=Detection("car",1.,(5.,5.,122.,122.));last=Detection("car",1.,(20.,20.,100.,100.))
        proof=method.direction(result,first,last,np.eye(3))
        self.assertEqual(proof["seedPoints"],16)
        self.assertGreater(len(proof["targetDescriptorSupportUnknownIndices"]),0)
        self.assertFalse(proof["supported"])
        self.assertEqual(self.inv["selectionSha256s"],[method.canonical(self.inv["selections"][0])])

    def test_verified_endpoints_outside_rival_are_not_unknowns(self):
        result=self.population();source=Detection("car",1.,(5.,5.,122.,122.))
        rival=Detection("car",1.,(100.,5.,127.,122.))
        proof=method.direction(result,source,rival,np.eye(3))
        self.assertEqual(proof["verifiedPoints"],16)
        self.assertEqual(proof["assignedPoints"],0)
        self.assertEqual(proof["unknownPoints"],0)

    def test_tampering_and_nonfinite_fields_rejected(self):
        bad=copy.deepcopy(self.inv);bad["descriptors"][0,0]=.2
        with self.assertRaises(ValueError):self.matcher.match(bad,self.inv)
        pair=self.matcher.match(self.inv,self.inv);selection=copy.deepcopy(self.inv["selections"][0]);selection["points"].pop()
        with self.assertRaises(ValueError):method.population(self.image,self.image,self.inv,self.inv,selection,pair,self.fields)
        field=self.fields[0].copy();field[0,0]=np.nan
        with self.assertRaises(ValueError):self.population(fields=(field,self.fields[1]))

    def test_prepare_source_only_actual_opencv_and_empty_inventory(self):
        empty=np.zeros((128,128),np.uint8)
        value=self.matcher.prepare(empty,[(5.,5.,122.,122.)])
        self.assertTrue(method.validate_inventory(value,empty))
        self.assertEqual(value["selections"][0]["seedPoints"],0)
        self.assertEqual(self.matcher.match(value,value)["pairs"],[])
        self.assertTrue(self.matcher.metadata["parameters"])

    def test_forged_matches_duplicate_indices_and_inventory_cells_fail(self):
        pair=self.matcher.match(self.inv,self.inv)
        for case in ("source","catalog","duplicate","endpoint","ratio"):
            bad=copy.deepcopy(pair)
            if case=="source":bad["oldSourceSha256"]="a"*64
            elif case=="catalog":bad["newCatalogSha256"]="a"*64
            elif case=="duplicate":bad["pairs"].append(copy.deepcopy(bad["pairs"][0]));bad["pairCount"]+=1
            elif case=="endpoint":bad["pairs"][0]["newIndex"]+=1
            else:bad["pairs"][0]["forward"]["ratio"]+=.1
            with self.subTest(case=case),self.assertRaises(ValueError):
                method.population(self.image,self.image,self.inv,self.inv,self.inv["selections"][0],bad,self.fields)
        bad=copy.deepcopy(self.inv);bad["selections"][0]["cells"][0]=[7,7]
        bad["selectionSha256s"]=[method.canonical(bad["selections"][0])]
        with self.assertRaises(ValueError):method.validate_inventory(bad)
        bad=copy.deepcopy(self.inv);bad["keypoints"][0]["angle"]=float("nan")
        with self.assertRaises(ValueError):method.validate_inventory(bad)

    def test_three_exposure_class_integration_uses_actual_sift_but_authored_zero_fields(self):
        class ZeroProvider:
            def __init__(self):self.direction_calls=0;self.last_call={};self.metadata={"kind":"authored-zero-field-not-pretrained"}
            def __call__(self,old,new):
                self.direction_calls+=2;self.last_call={"modelDirectionCalls":0,"authoredDirections":2}
                return (np.zeros((*old.shape,2),np.float32),np.zeros((*old.shape,2),np.float32))
        provider=ZeroProvider();state=method.RootSiftGlobalWindowMotion(provider)
        box=Detection("car",.94,(5.,5.,122.,122.));outputs=[]
        for i in range(3):
            frame={"token":f"m3q-authored-{i}","timestampUs":1_000_000+80_000*i,
                "poseTimestampUs":1_000_000+80_000*i,"epoch":0,"intrinsics":[[100.,0.,64.],[0.,100.,64.],[0.,0.,1.]],
                "cameraToWorld":np.eye(4).tolist(),"sha256":method._digest(self.image)}
            surface={"status":"first-frame" if i==0 else "valid","epoch":0,"tracks":[{"id":100+i,**box.record(128,128)}],
                "events":[],"diagnostics":{}}
            result=state.update(frame,float(i*80),self.image,[box],camera_surface=surface);outputs.append(result)
            self.assertFalse(result["events"])
            self.assertEqual(result["diagnostics"]["method"],method.POLICY["method"])
            self.assertEqual(result["diagnostics"]["sourceSelections"]["sourceToken"],frame["token"])
        self.assertEqual(provider.direction_calls,4)
        self.assertEqual(state.matcher.prepare_calls,3)
        self.assertEqual(state.matcher.match_calls,2)
        final=outputs[-1]["diagnostics"]
        self.assertEqual(len(final["globalFields"]),1)
        self.assertEqual(len(final["populations"]),2)
        self.assertEqual(len({p["populationId"] for p in final["populations"]}),2)
        self.assertEqual(len(final["comparisons"]),1)
        self.assertTrue(final["sourceSelectionBeforeCorrespondence"])
        self.assertNotIn("metres",str(outputs))

    def test_low_contrast_source_floor_retains_original_unknown_denominator(self):
        yy,xx=np.mgrid[:128,:128]
        # Authored catalog isolates the hard-floor guard: these are not actual
        # detector/SIFT successes on an intrinsically uninformative surface.
        image=(126+((xx+yy)%2)*4).astype(np.uint8)
        inv=inventory(image);pair=self.matcher.match(inv,inv)
        result=method.population(image,image,inv,inv,inv["selections"][0],pair,self.fields)
        self.assertEqual(result[4]["seedPoints"],16)
        self.assertEqual(len(result[0]),16)
        self.assertFalse(result[3].any())
        self.assertEqual(result[4]["reasonCounts"],{"source-low-variance":16})
        self.assertTrue(all(0<=p["sourcePatchVariance"]<16 for p in result[4]["points"]))
        self.assertTrue(method.validate_source_variance(result[4]))

    def test_fractional_source_variance_is_actual_subpixel_patch_not_integer_map(self):
        points=[[24.25,24.75],[48.25,48.75],[72.25,72.75],[96.25,96.75]]
        inv=inventory(self.image,points=points);pair=self.matcher.match(inv,inv)
        result=method.population(self.image,self.image,inv,inv,inv["selections"][0],pair,self.fields)
        for record in result[4]["points"]:
            actual=cv2.getRectSubPix(self.image,(7,7),tuple(record["sourcePoint"]))
            self.assertEqual(record["sourcePatchVariance"],float(np.var(actual.astype(np.float64))))

    def test_forged_or_missing_source_variance_fails_closed(self):
        result=self.population();source=Detection("car",1.,(5.,5.,122.,122.))
        self.assertTrue(all(p["sourcePatchVariance"]>=16 for p in result[4]["points"] if p["good"]))
        for value in (None,-1.,float("nan"),15.999):
            bad=list(copy.deepcopy(result));bad[4]["points"][0]["sourcePatchVariance"]=value
            with self.subTest(value=value),self.assertRaises(ValueError):method.direction(tuple(bad),source,source,np.eye(3))
        bad=list(copy.deepcopy(result));del bad[4]["points"][0]["sourcePatchVariance"]
        with self.assertRaises(ValueError):method.direction(tuple(bad),source,source,np.eye(3))


if __name__=="__main__":unittest.main()
