"""DIS is measured on the same authored mechanism tests, not a phone claim."""

from pathlib import Path
import sys
from unittest.mock import patch
import unittest

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_dense_window import DenseWindowLoom, POLICY, _dense_seed, _sample
import assist_scene_window_loom as sparse
import test_assist_scene_window_loom as fixtures


class DenseWindowTests(fixtures.WindowLoomTests):
    def setUp(self):
        super().setUp()
        # Reuse identical pixel scenarios and assertions for a fair comparison.
        scope=patch.object(fixtures,"WindowLoom",DenseWindowLoom)
        scope.start();self.addCleanup(scope.stop)

    def test_same_decision_floors_and_real_dis_engine(self):
        state=DenseWindowLoom()
        self.assertEqual(state._dis.getPatchSize(),8)
        self.assertEqual(state._dis.getGradientDescentIterations(),25)
        for key,value in sparse.POLICY.items():
            self.assertEqual(POLICY[key],value,key)

    def test_feature_turnover_reseeds_identity_and_uses_real_bounded_anchors(self):
        # This inherited R2-specific test name instead checks the DIS/R1
        # invariant: no newly sampled points are spliced into old trajectories.
        state=DenseWindowLoom()
        for i in range(10):
            fixtures.run(state,i,1.015**i)
            for tube in state._previous[3]:
                self.assertEqual(len(tube.anchors),0)
                self.assertTrue(all(len(points)==len(tube.points) for _,points,_ in tube.history))

    def test_dense_grid_is_bounded_texture_checked_and_not_a_detection(self):
        _,pixels,box=fixtures.image(0)
        points=_dense_seed(pixels,box.xyxy,[],np.eye(3))
        self.assertGreaterEqual(len(points),POLICY["minPoints"])
        self.assertLessEqual(len(points),POLICY["maxPoints"])
        self.assertTrue(sparse.base._inside(points,box.xyxy,.1).all())
        self.assertIsNone(_dense_seed(np.full_like(pixels,127),box.xyxy,[],np.eye(3)))
        self.assertIsNone(_dense_seed(pixels,box.xyxy,[box],np.eye(3)))

    def test_dense_sampling_refuses_outside_and_nonfinite_locations(self):
        field=np.full((30,30,2),2.,np.float32)
        points=np.array([[10.,10.],[-1.,10.],[30.,20.],[np.nan,10.]],np.float32)
        values,valid=_sample(field,points)
        self.assertEqual(valid.tolist(),[True,False,False,False])
        self.assertTrue(np.array_equal(values[0],[2.,2.]))


if __name__=="__main__":unittest.main()
