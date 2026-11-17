import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/"scripts"))
import assist_scene_m3q_review as review
import fetch_assist_scene_m3q_boreas as fetch


def target(identifier, *, motion="moving", approach="approaching", family="vehicle", side=.05):
    return dict(instance=identifier, motion=motion, approach=approach, classFamily=family,
                box=dict(x=.1, y=.2, width=side, height=side))


class ReviewAccountingTests(unittest.TestCase):
    def test_all_source_targets_have_explicit_non_negative_accounting(self):
        first=target("a", side=.1); duplicate=target("b", side=.08)
        small=target("c", family="person", side=.01)
        unknown=target("d", family="bicycle", motion="unknown", approach="unknown")
        items=review.account_frame([first,duplicate,small,unknown],[first])
        self.assertEqual(len(items),4)
        reasons={r["instance"]:r["selectionReason"] for r in items}
        self.assertEqual(reasons,{"a":"selected-for-blind-review","b":"duplicate-reference-stratum",
                                  "c":"below-fixed-normalized-size","d":"both-reference-labels-unknown"})

    def test_selector_mismatch_rejects_instead_of_hiding_missing_targets(self):
        with self.assertRaisesRegex(ValueError,"differs"):
            review.account_frame([target("a")],[])

    def test_unknown_approach_with_known_motion_is_not_relabelled_negative(self):
        obj=target("a",approach="unknown")
        result=review.account_frame([obj],[obj])
        self.assertEqual(result[0]["approach"],"unknown")
        self.assertEqual(result[0]["selectionReason"],"selected-for-blind-review")

    def test_fixed_cap_retains_explicit_omission(self):
        rows=[target(str(i),family=str(i)) for i in range(11)]
        result=review.account_frame(rows,rows[:9])
        self.assertEqual(sum(r["selectionReason"]=="selected-for-blind-review" for r in result),9)
        self.assertEqual(sum(r["selectionReason"]=="fixed-nine-candidate-cap" for r in result),2)


class SlicePlanTests(unittest.TestCase):
    def test_fixed_two_disjoint_new_metadata_windows_and_budget(self):
        self.assertEqual(fetch.WINDOWS,(("boreas-m3q-city",1598989140031027),("boreas-m3q-turn",1598987802079070)))
        self.assertEqual(fetch.IMAGE_BUDGET,500*1024**2)
        for name in ("M3D","M3E","M3F","M3G","M3H","M3I","M3J","M3K","M3L","M3M","M3N","M3O"):
            for _,prior in getattr(fetch.old,name):
                for _,new in fetch.WINDOWS:
                    self.assertTrue(new>prior+4_000_000 or prior>new+4_000_000)

    def test_metadata_incomplete_cadence_refuses_before_label_network(self):
        body=b"timestamp,a\n1598989140055117,0\n"
        with patch.object(fetch.old,"label_times") as labels:
            with self.assertRaisesRegex(ValueError,"cadence"):
                fetch.select_windows(body)
            labels.assert_not_called()

    def test_unsorted_pose_timeline_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"timeline"):
            fetch.select_windows(b"timestamp,a\n2,0\n1,0\n")


if __name__=="__main__": unittest.main()
