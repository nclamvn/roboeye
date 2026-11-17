"""M3R data-contract tests: authored metadata only, no network or model calls."""
from copy import deepcopy
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import fetch_assist_scene_m3r_boreas as source


def fixture():
    values = {k: b"authored metadata" for k in source.shared.METADATA}
    clips = []
    for name, first, last, labels in source.CLIP_ENDPOINTS:
        clips.append(dict(id=name, cameraTimestampsUs=[first+(last-first)*i//49 for i in range(50)],
                          labelTimestampsUs=[first+i*200000 for i in range(labels)]))
    heads = [dict(path=f"camera/{s}.png", bytes=3400000, etag='"authored"')
             for c in clips for s in c["cameraTimestampsUs"]]
    heads[-1]["bytes"] += source.IMAGE_BYTES-sum(r["bytes"] for r in heads)
    plan = dict(study="M3R", status="PROPOSED-HEAD-ONLY", rgbTransfers=0, modelCalls=0,
        headImageBytes=source.IMAGE_BYTES, imageBudgetBytes=source.IMAGE_BUDGET,
        metadataSource="authored", metadata={k:dict(bytes=len(v),sha256=source.shared.digest(v))
            for k,v in values.items()}, clips=clips, imageHeads=heads)
    return values, plan


class M3RDataTests(unittest.TestCase):
    def validate(self, plan, values):
        raw = json.dumps(plan).encode()
        with patch.object(source,"PLAN_SHA256",source.shared.digest(raw)), \
             patch.object(source.shared,"metadata",return_value=values):
            return source.validate_plan(raw)

    def test_complete_fixed_metadata_and_150_heads(self):
        values, plan = fixture()
        registered, reused = self.validate(plan, values)
        self.assertEqual(len(registered["imageHeads"]),150)
        self.assertEqual(sum(len(c["labelTimestampsUs"]) for c in plan["clips"]),59)
        self.assertEqual(reused,values)

    def test_source_hash_fails_before_metadata_read_or_network(self):
        with patch.object(source.shared,"metadata") as metadata, patch.object(source,"urlopen") as network:
            with self.assertRaises(ValueError): source.validate_plan(b"not approved plan")
            metadata.assert_not_called(); network.assert_not_called()

    def test_changed_windows_budget_or_head_coverage_fail_closed(self):
        values, plan = fixture()
        for change in ("scope","budget","window","head","overlap","metadata"):
            bad = deepcopy(plan)
            if change == "scope": bad["rgbTransfers"] = 1
            elif change == "budget": bad["headImageBytes"] += 1
            elif change == "window": bad["clips"][0]["id"] = "different"
            elif change == "head": bad["imageHeads"][0]["bytes"] += 1
            elif change == "overlap": bad["clips"][0]["cameraTimestampsUs"][1] = bad["clips"][0]["cameraTimestampsUs"][0]
            else: bad["metadata"][source.shared.METADATA[0]]["sha256"] = "a"*64
            with self.subTest(change=change), self.assertRaises(ValueError): self.validate(bad,values)

    def test_png_requires_both_signature_and_complete_end_marker(self):
        good = b"\x89PNG\r\n\x1a\n"+b"authored"+b"\x00\x00\x00\x00IEND\xaeB`\x82"
        self.assertTrue(source.valid_png(good))
        for bad in (good[:-1],good[1:],b""):
            self.assertFalse(source.valid_png(bad))

    def test_disk_floor_rejects_before_dispatch(self):
        output = SimpleNamespace(exists=lambda:False,is_symlink=lambda:False,parent=Path("."))
        with patch.object(source.shutil,"disk_usage",return_value=SimpleNamespace(free=9*1024**3)), \
             patch.object(source,"urlopen") as network:
            with self.assertRaises(ValueError): source.fetch(Path("unused"),output)
            network.assert_not_called()


if __name__ == "__main__": unittest.main()
