"""Authored metric fixtures; never actual model or downloaded-data acceptance."""

import json
from hashlib import sha256
from pathlib import Path
import sys
import tempfile
import unittest

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3p_benchmark as bench


class SpringMetricTests(unittest.TestCase):
    def reference(self,h=3,w=4):
        gt=np.zeros((h*2,w*2,2),np.float32)
        gt[::2,::2]=[1.,0.];gt[1::2,::2]=[5.,0.]
        gt[::2,1::2]=[9.,0.];gt[1::2,1::2]=[13.,0.]
        return gt

    def test_four_native_pixel_vectors_minimum_not_average_or_divide_two(self):
        gt=self.reference();field=np.ones((3,4,2),np.float32);field[:,:,1]=0
        report=bench.evaluate(field,gt,(3,4))
        self.assertEqual(report["metrics"]["all"]["meanEpeNativePx"],0.)
        field[:,:,0]=9.
        self.assertEqual(bench.evaluate(field,gt,(3,4))["metrics"]["all"]["meanEpeNativePx"],0.)
        field[:,:,0]=7.
        self.assertEqual(bench.evaluate(field,gt,(3,4))["metrics"]["all"]["meanEpeNativePx"],2.)

    def test_gt_nan_in_any_of_four_is_reference_invalid_not_prediction_conditioned(self):
        gt=self.reference();gt[1,1,0]=np.nan
        field=np.zeros((3,4,2),np.float32)
        report=bench.evaluate(field,gt,(3,4))
        self.assertEqual(report["invalidReferencePixels"],1)
        self.assertEqual(report["metrics"]["all"]["gtValidPixels"],11)
        self.assertEqual(report["metrics"]["all"]["meanEpeNativePx"],1.)

    def test_invalid_prediction_keeps_gt_denominator_outlier_and_unknown_full_mean(self):
        gt=self.reference();field=np.zeros((3,4,2),np.float32);field[0,0]=np.nan
        report=bench.evaluate(field,gt,(3,4))["metrics"]["all"]
        self.assertEqual(report["gtValidPixels"],12)
        self.assertEqual(report["invalidPredictionPixels"],1)
        self.assertIsNone(report["meanEpeNativePx"])
        self.assertEqual(report["finiteOnlyMeanEpeNativePx"],1.)
        self.assertEqual(report["onePxOutlierPixels"],1)
        json.dumps(report,allow_nan=False)

    def test_resize_flow_to_native_actual_axes_not_superresolution_scale(self):
        field=np.empty((2,3,2),np.float32);field[:]=[2.,4.]
        native=bench.restore_native(field,(5,12))
        np.testing.assert_allclose(native[:,:,0],8.)
        np.testing.assert_allclose(native[:,:,1],10.)
        self.assertEqual(native.shape,(5,12,2))
        np.testing.assert_array_equal(field[0,0],[2.,4.])

    def test_half_pixel_resize_endpoint_geometry(self):
        yy,xx=np.indices((4,5),dtype=np.float32);field=np.stack((xx*.2,yy*.4),axis=-1)
        native=bench.restore_native(field,(8,15));x,y=7,4
        mx,my=(x+.5)*5/15-.5,(y+.5)*4/8-.5
        np.testing.assert_allclose(native[y,x],[mx*.2*3,my*.4*2],atol=1e-6)

    def test_matching_partition_uses_first_two_rgb_channels_not_bgr(self):
        m=np.zeros((3,4,3),np.uint8);m[0,0,0]=255;m[0,1,1]=255;m[0,2,2]=255
        mask=bench.match_mask(m,(3,4));self.assertEqual(int(mask.sum()),2)
        field=np.zeros((3,4,2),np.float32);report=bench.evaluate(field,self.reference(),(3,4),mask)
        self.assertEqual(report["metrics"]["matched"]["gtValidPixels"],2)
        self.assertEqual(report["metrics"]["unmatched"]["gtValidPixels"],10)

    def test_fl_requires_both_absolute_and_relative_error(self):
        prediction=np.zeros((1,3,2),np.float32)
        gt=np.zeros((2,6,2),np.float32)
        # Pixel0 error4, norm4 =>outlier; pixel1 error4,norm100 =>notoutlier;
        # pixel2 error2,norm2 =>notoutlier despite >5percent.
        for x,values in enumerate(([4.,0.],[100.,0.],[2.,0.])):gt[:,2*x:2*x+2]=values
        prediction[0,1]=[96.,0.]
        errors,valid,pv,norm=bench.superresolved_errors(prediction,gt)
        report=bench.summarize(errors,valid,pv,norm)
        self.assertEqual(report["fl3and5OutlierPixels"],1)
        self.assertEqual(report["onePxOutlierPixels"],3)

    def test_empty_reference_partition_unknown_not_perfect(self):
        gt=np.full((2,2,2),np.nan,np.float32);field=np.zeros((1,1,2),np.float32)
        report=bench.evaluate(field,gt,(1,1))["metrics"]["all"]
        self.assertEqual(report["gtValidPixels"],0)
        self.assertIsNone(report["meanEpeNativePx"])
        self.assertIsNone(report["onePxOutlierFraction"])

    def test_bad_shapes_dtypes_and_resolution_fail_closed(self):
        field=np.zeros((3,4,2),np.float32);gt=self.reference()
        for bad in (field.astype(float),field[:,:,0],field[:,:,:1]):
            with self.assertRaises(ValueError):bench.restore_native(bad,(3,4))
        with self.assertRaises(ValueError):bench.evaluate(field,gt[:-1],(3,4))
        with self.assertRaises(ValueError):bench.match_mask(np.zeros((6,8,3),np.uint8),(3,4))

    def manifest_fixture(self,root):
        manifest={"schemaVersion":1,"dataset":"Spring-v2-independent-rendered-flow-reference",
            "datasetVersion":"2.0","datasetDoi":"doi:10.18419/DARUS-3376",
            "complete":True,"license":{"uri":"http://creativecommons.org/licenses/by/4.0"},"files":[]}
        from fetch_assist_scene_flow_reference import ARCHIVES,LICENSE
        metadata={"status":"OK","data":{"id":198926,"latestVersion":{"versionState":"RELEASED",
            "versionNumber":2,"versionMinorNumber":0,"license":{"name":"CC BY 4.0","uri":LICENSE,
                "iconUri":"https://licensebuttons.net/l/by/4.0/88x31.png"},
            "files":[{"label":name,"restricted":False,"dataFile":{"id":id_,"filesize":size}} for name,(id_,size) in ARCHIVES.items()]}}}
        meta=json.dumps(metadata).encode();(root/"dataset-metadata.json").write_bytes(meta)
        manifest["metadataSha256"]=sha256(meta).hexdigest()
        for seq in ("0001","0002"):
            for name in ("frame_left_0001.png","frame_left_0002.png","flow_FW_left_0001.flo5","flow_BW_left_0002.flo5"):
                rel=f"archive/spring/train/{seq}/{name}";path=root/rel;path.parent.mkdir(parents=True,exist_ok=True)
                data=(seq+name).encode();path.write_bytes(data)
                manifest["files"].append({"path":rel,"sha256":sha256(data).hexdigest()})
        path=root/"manifest.json";path.write_text(json.dumps(manifest))
        return manifest,path

    def test_manifest_derives_pairs_without_reference_values_entering_inference(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3p-benchmark-20261117-") as folder:
            root=Path(folder);manifest,path=self.manifest_fixture(root)
            actual,base,pairs,hashes=bench.load_reference(path)
            self.assertEqual(actual,manifest);self.assertEqual(base,root.resolve())
            self.assertEqual(len(pairs),2);self.assertEqual(len(hashes),8)
            self.assertTrue(pairs[0]["forward"][0].endswith("flow_FW_left_0001.flo5"))
            self.assertTrue(pairs[0]["backward"][0].endswith("flow_BW_left_0002.flo5"))
            self.assertIsNone(pairs[0]["forwardMatch"])

    def test_incomplete_reference_or_source_fingerprint_mutation_rejected(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3p-benchmark-20261117-") as folder:
            root=Path(folder);manifest,path=self.manifest_fixture(root)
            manifest["complete"]=False;path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,"Incomplete"):bench.load_reference(path)
            manifest["complete"]=True;path.write_text(json.dumps(manifest))
            (root/manifest["files"][0]["path"]).write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError,"changed"):bench.load_reference(path)

    def test_duplicate_or_missing_pair_member_does_not_get_silent_fallback(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3p-benchmark-20261117-") as folder:
            root=Path(folder);manifest,path=self.manifest_fixture(root)
            manifest["files"]=[r for r in manifest["files"] if not r["path"].endswith("0001/flow_FW_left_0001.flo5")]
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,"Missing"):bench.load_reference(path)


if __name__=="__main__":unittest.main()
