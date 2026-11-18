import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("court_prepare_benchmark", ROOT / "scripts/court_prepare_benchmark.py")
court = importlib.util.module_from_spec(spec)
spec.loader.exec_module(court)


class CourtPreparationTests(unittest.TestCase):
    def test_fixed_uniform_sampling_before_predictions(self):
        self.assertEqual(court.sample_indices(120), [0, 10, 21, 32, 43, 54, 64, 75, 86, 97, 108, 119])
        self.assertEqual(court.sample_indices(12), list(range(12)))
        with self.assertRaises(ValueError):
            court.sample_indices(11)

    def test_fixed_sources_under_download_budget_and_new_match(self):
        self.assertEqual(len(court.FILES), 3)
        self.assertLess(sum(x["bytes"] for x in court.FILES), 20 * 1024 * 1024)
        self.assertEqual(len({x["sha256"] for x in court.FILES}), 3)
        self.assertTrue(all(len(x["sha256"]) == 64 for x in court.FILES))
        self.assertNotIn("T5rmWjvt8Os", str(court.FILES))


if __name__ == "__main__":
    unittest.main()
