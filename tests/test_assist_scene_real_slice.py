import gzip
from importlib.util import module_from_spec, spec_from_file_location
import pickle
from pathlib import Path
import unittest

import pandas as pd


def script(name):
    spec = spec_from_file_location(name, Path(__file__).resolve().parents[1] / "scripts" / f"{name}.py")
    m = module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class RealSliceTests(unittest.TestCase):
    def test_boreas_selects_motion_from_pose_only(self):
        loader = script("fetch-assist-scene-boreas-slice")
        loader.ANCHORS = (100_000, 10_000_000, 20_000_000, 30_000_000)
        rows = []
        for i, start in enumerate(loader.ANCHORS):
            for j in range(50):
                direction = (1., 0., 0.) if i != 1 or j < 25 else (0., 1., 0.)
                rows.append((start + j * 80_000, [10., 6., 0., 21.][i], direction))
        self.assertEqual([v[0] for _, v in loader.select(rows)], [10_000_000, 20_000_000, 30_000_000])

    def test_pandaset_rejects_unknown_pickle_globals(self):
        codec = script("convert-assist-scene-pandaset-labels")
        with self.assertRaises(pickle.UnpicklingError):
            codec.plain(gzip.compress(pickle.dumps(eval)))

    def test_pandaset_only_yields_expected_scalar_columns(self):
        codec = script("convert-assist-scene-pandaset-labels")
        df = pd.DataFrame({"uuid": pd.Series(["one"], dtype=object), "position.x": [float("nan")],
                           "not_an_input": pd.Series(["private"], dtype=object)})
        df.columns = pd.Index(df.columns.tolist(), dtype=object)
        self.assertEqual(codec.plain(gzip.compress(pickle.dumps(df))), [{"uuid": "one", "position.x": None}])
