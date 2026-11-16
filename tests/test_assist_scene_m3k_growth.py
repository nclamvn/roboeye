"""QA wrapper/gate/budget tests using authored arrays, never a model call."""

from collections import deque
from copy import deepcopy
import inspect
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import reconstruct_assist_scene_m3k_growth as audit
from assist_scene_learned_region import LearnedCohortWindowLoom
from test_assist_scene_m3k_study import sample


def tube(growth=.065, steps=7):
    x, y = np.meshgrid(np.linspace(20, 65, 5), np.linspace(20, 60, 4))
    points = np.column_stack((x.ravel(), y.ravel())).astype(np.float32)
    history = deque((float(i*80), points*np.exp(growth*i/max(1, steps-1)),
                     np.asarray([80., 80.])*np.exp(growth*i/max(1, steps-1))) for i in range(steps))
    return SimpleNamespace(id=17, initial=len(points), points=history[-1][1].copy(), history=history)


def engine():
    return audit.GrowthAuditLoom(lambda *_: (_ for _ in ()).throw(AssertionError("No model call in this test")))


class GrowthAuditTests(unittest.TestCase):
    def test_subclass_overrides_only_measurement_not_any_runtime_gate(self):
        for name in ("update", "_field", "_cohort_flow", "_seed_cohort", "_new_points", "_reset"):
            self.assertIs(getattr(audit.GrowthAuditLoom, name), getattr(LearnedCohortWindowLoom, name))
        self.assertNotIn("truth", inspect.signature(audit.run).parameters)
        self.assertNotIn("truth", inspect.signature(audit.replay_clip).parameters)
        self.assertNotIn(".detect(", inspect.getsource(audit))

    def test_wrapper_returns_exact_original_object_and_does_not_mutate_tube(self):
        state = engine(); values = tube(); before = deepcopy(values)
        evidence = {"confirmed": False, "reason": "warming-window", "observationMs": 80.}
        with patch.object(LearnedCohortWindowLoom, "_cumulative_evidence", return_value=evidence):
            returned = state._cumulative_evidence(values, np.eye(3))
        self.assertIs(returned, evidence)
        np.testing.assert_array_equal(values.points, before.points)
        self.assertEqual(state._growth_audit_records[0]["trackId"], 17)
        self.assertEqual(state._growth_audit_records[0]["historyStartMs"], 0.)
        self.assertNotIn("cohortId", state._growth_audit_records[0])
        self.assertEqual(state._growth_audit_records[0]["returnedEvidence"], evidence)

    def test_real_frozen_arithmetic_positive_and_nonpositive_controls(self):
        intrinsics = np.diag([1000., 1000., 1.])
        for growth, expected in ((.065, True), (0., False), (-.06, False)):
            with self.subTest(growth=growth):
                state = engine(); values = tube(growth)
                expected_return = LearnedCohortWindowLoom._cumulative_evidence(values, intrinsics)
                actual = state._cumulative_evidence(values, intrinsics)
                self.assertEqual(actual, expected_return)
                self.assertEqual(actual["confirmed"], expected)
                gates = state._growth_audit_records[0]["derivedNumericGates"]
                self.assertEqual(all(gates["checks"].values()), expected)
                if not expected:
                    self.assertIn("netGrowthAboveFloorAndThreeMad", gates["failedChecks"])

    def test_warming_or_unavailable_numeric_values_are_not_invented(self):
        state = engine(); values = tube(steps=2)
        state._cumulative_evidence(values, np.eye(3))
        gates = state._growth_audit_records[0]["derivedNumericGates"]
        self.assertEqual(gates["status"], "not-evaluated")
        self.assertEqual(gates["checks"], {})
        self.assertIsNone(gates["pointSlopeP25PerSecond"])

    def test_drain_matches_only_exact_track_and_born_time(self):
        state = engine(); values = tube()
        state._cumulative_evidence(values, np.diag([1000., 1000., 1.]))
        frame = {"timeMs": 480., "token": "current", "sourceSha256": "c"*64}
        result = audit.drain_growth(state, {"diagnostics": {}}, frame)
        self.assertEqual(result[0]["cohortIdCandidates"], [])
        self.assertEqual(result[0]["cohortIdAttribution"], "unknown-no-unique-born-time-match")
        self.assertEqual(audit.drain_growth(state, {}, {"timeMs": 480.}), [])
        state._cumulative_evidence(values, np.diag([1000., 1000., 1.]))
        surface = {"diagnostics": {"cohorts": {"17": [{"cohortId": 9, "bornMs": 0.}],
                                                         "18": [{"cohortId": 10, "bornMs": 0.}]}}}
        result = audit.drain_growth(state, surface, frame)
        self.assertEqual(result[0]["cohortIdCandidates"], [9])
        self.assertEqual(result[0]["cohortIdAttribution"], "unique-born-time-match")

    def test_complete_engine_and_field_equivalence_allow_only_timing_differences(self):
        current = {"status": "valid", "events": [], "diagnostics": {"proof": 2}}
        trace = [{"wallMs": 1., "status": "field-supported", "modelDirectionCalls": 2}]
        original_trace = [{**trace[0], "wallMs": 3.}]
        audit.assert_reproduced(current, deepcopy(current), trace, original_trace)
        bad = deepcopy(current); bad["diagnostics"]["proof"] = 3
        with self.assertRaises(ValueError): audit.assert_reproduced(bad, current, trace, original_trace)
        with self.assertRaises(ValueError): audit.assert_reproduced(current, current, trace, [])

    def test_model_call_and_time_budgets_stop_before_work_and_never_retry(self):
        class Provider:
            metadata = {"kind": "test"}
            direction_calls = 0
            def __call__(self, *_): self.direction_calls += 2; return "fields"
        provider = Provider(); bounded = audit.BudgetedFlow(provider, deadline=100.)
        with patch.object(audit, "perf_counter", return_value=1.):
            self.assertEqual(bounded(None, None), "fields")
            provider.direction_calls = audit.MAX_DIRECTION_CALLS
            with self.assertRaises(ValueError): bounded(None, None)
        provider.direction_calls = 0
        with patch.object(audit, "perf_counter", return_value=101.):
            with self.assertRaises(TimeoutError): bounded(None, None)
        self.assertEqual(provider.direction_calls, 0)

    def test_bound_receipt_source_device_policy_and_fresh_trial(self):
        receipt, _ = sample()
        inputs = {"dataset": receipt["dataset"], "clips": [{"id": c["id"], "frames": [
            {"token": f["token"], "timestampUs": f["timestampUs"], "sha256": f["sourceSha256"]} for f in c["frames"]]} for c in receipt["clips"]]}
        audit.validate_binding(inputs, receipt, receipt["inputSha256"], "mps")
        for case in ("hash", "device", "source", "clock", "development"):
            with self.subTest(case=case):
                changed = deepcopy(receipt); source = deepcopy(inputs); digest = receipt["inputSha256"]
                if case == "hash": digest = "wrong"
                elif case == "device": changed["device"] = "cpu"
                elif case == "source": source["clips"][0]["frames"][0]["sha256"] = "d"*64
                elif case == "clock": source["clips"][0]["frames"][0]["timestampUs"] += 1
                else: changed["developmentOnly"] = True
                with self.assertRaises(ValueError): audit.validate_binding(source, changed, digest, "mps")

    def test_runner_wiring_uses_cached_detections_exact_pixels_and_no_model_for_empty_fixture(self):
        receipt, _ = sample(); old = deepcopy(receipt["clips"][0]["frames"][0])
        old.update(width=96, height=64, nativeWidth=96, nativeHeight=64)
        class Provider:
            direction_calls = 0
        class FrozenFixtureEngine:
            def __init__(self, provider): pass
            def update(self, *args, **kwargs): return deepcopy(old["C"])
            def drain_trace(self): return []
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3k-growth-test-20261116-") as folder:
            root = Path(folder); path = root/"source.png"
            ok, encoded = cv2.imencode(".png", np.zeros((64, 96, 3), np.uint8))
            self.assertTrue(ok); path.write_bytes(encoded.tobytes())
            source = {"path": path.name, "token": old["token"], "timestampUs": old["timestampUs"], "sha256": audit.sha256(path)}
            old["sourceSha256"] = source["sha256"]
            work = root/"stage"; work.mkdir()
            with patch.object(audit, "GrowthAuditLoom", FrozenFixtureEngine):
                result = audit.replay_clip({"id": "fixture", "frames": [source]}, {"frames": [old]}, root, work, Provider(), float("inf"))
            row = result["frames"][0]
            self.assertTrue(row["completeEngineExactlyReproduced"])
            self.assertEqual(row["growthMeasurements"], [])
            self.assertEqual(row["flowDirectionCalls"]["C"], 0)


if __name__ == "__main__":
    unittest.main()
