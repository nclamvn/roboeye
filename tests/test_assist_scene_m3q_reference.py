import copy
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import fetch_assist_scene_m3q_reference as reference


class M3QReferenceTests(unittest.TestCase):
    def test_exact_predeclared_members_and_size_floors(self):
        entries = {f"hpatches-sequences-release/{s}/{n}": {"size": 100, "compressedSize": 50}
                   for s in reference.SEQUENCES for n in reference.FILES}
        self.assertEqual(len(reference.selected(entries)), 6)
        broken = copy.deepcopy(entries); broken.pop(next(iter(broken)))
        with self.assertRaises(ValueError): reference.selected(broken)
        broken = copy.deepcopy(entries); broken[next(iter(broken))]["size"] = 8*1024**2
        with self.assertRaises(ValueError): reference.selected(broken)

    def test_explicit_dataset_license_and_original_image_source(self):
        meta = {"id": "vbalnt/hpatches", "sha": reference.HF_REVISION,
                "private": False, "gated": False, "cardData": {"license": "mit"}}
        args = ["license: mit", "https://huggingface.co/datasets/vbalnt/hpatches/resolve/main/hpatches-sequences-release.zip",
                "MIT License\nCopyright (c) 2020 HPatches",
                "i_londonbridge - []\nv_abstract - []\n[] - First introduced in this dataset."]
        reference.verify_rights(meta, *args)
        for key in ("private", "gated"):
            bad = copy.deepcopy(meta); bad[key] = True
            with self.assertRaises(ValueError): reference.verify_rights(bad, *args)
        with self.assertRaises(ValueError):
            reference.verify_rights(meta, *args[:-1], args[-1].replace("v_abstract - []", "v_abstract - [OXF]"))

    def test_pair_requires_images_and_finite_invertible_homography(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3q-reference-tests-") as temporary:
            root = Path(temporary); folder = root/"hpatches-sequences-release"/"v_abstract"
            folder.mkdir(parents=True)
            image = np.zeros((64, 96, 3), np.uint8)
            for name in ("1.ppm", "2.ppm"): cv2.imwrite(str(folder/name), image)
            (folder/"H_1_2").write_text("1 0 0\n0 1 0\n0 0 1\n")
            self.assertEqual(reference.verify_pair(root, "v_abstract")["shape"], [64, 96])
            (folder/"H_1_2").write_text("0 0 0\n0 0 0\n0 0 0\n")
            with self.assertRaises(ValueError): reference.verify_pair(root, "v_abstract")

    def test_network_budget_fails_before_dispatch(self):
        reader = reference.Reader(); reader.reserved = reference.MAX_NETWORK
        with patch.object(reference.subprocess, "run") as run:
            with self.assertRaises(ValueError): reader.get("https://example.invalid", 100)
            run.assert_not_called()

    def test_no_full_archive_range_or_oversize_member(self):
        reader = reference.Reader()
        with patch.object(reference.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                reader.get(reference.ARCHIVE, reference.ARCHIVE_SIZE,
                           interval=(0, reference.ARCHIVE_SIZE-1), total=reference.ARCHIVE_SIZE)
            run.assert_not_called()


if __name__ == "__main__": unittest.main()
