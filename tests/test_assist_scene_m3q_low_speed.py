import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import fetch_assist_scene_m3q_low_speed as fetcher


class M3QLowSpeedFetchTests(unittest.TestCase):
    def test_joint_budget_is_finite_and_includes_old_two_windows(self):
        self.assertLess(fetcher.JOINT_IMAGE_BYTES,700*1024**2)
        self.assertEqual(fetcher.JOINT_IMAGE_BYTES-fetcher.IMAGE_BYTES,389469299)

    def test_changed_preregistration_rejects_before_any_network_or_output(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3q-low-speed-tests-") as temporary:
            root=Path(temporary);plan=root/"plan.json";out=root/"out"
            plan.write_text(json.dumps({"complete":True}))
            with patch.object(fetcher.shared,"metadata") as meta,patch.object(fetcher,"urlopen") as network:
                with self.assertRaises(ValueError):fetcher.fetch(plan,out)
                network.assert_not_called();meta.assert_not_called()
            self.assertFalse(out.exists())

    def test_existing_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3q-low-speed-existing-") as temporary:
            root=Path(temporary)
            with self.assertRaises(ValueError):fetcher.fetch(root/"absent.json",root)


if __name__=="__main__":unittest.main()
