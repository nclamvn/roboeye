import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveTelemetry } from '../../src/drive/live-telemetry';

test('normal live trace exposes exact capture, inference, risk and overlay durations', () => {
  const metric = new LiveTelemetry(); metric.reset(3);
  assert.equal(metric.begin(7, 3, 1000, 10), true);
  metric.captureDone(7, 12); metric.dispatched(7, 13); metric.result(7, 43); metric.accept(7, 44);
  metric.risk(7, 45, true); metric.overlay(7, 50, true); metric.audio(7, 55);
  const report = metric.report();
  assert.equal(report.session.durationMs, 0);
  assert.equal(report.stages.frameCallbackToCapture.p95Ms, 2);
  assert.equal(report.stages.requestToResult.p95Ms, 30);
  assert.equal(report.stages.frameAgeAtAcceptance.p95Ms, 34);
  assert.equal(report.stages.riskToAlertOverlay.p95Ms, 5);
  assert.equal(report.stages.frameToAlertOverlay.p95Ms, 40);
  assert.equal(report.stages.frameToAudioRequest.p95Ms, 45);
});

test('busy callback and stale result are counted without fabricating alert latency', () => {
  const metric = new LiveTelemetry(); metric.reset(1); metric.skip('busy');
  metric.begin(1, 1, 0, 0); metric.captureDone(1, 2); metric.dispatched(1, 3); metric.result(1, 1004);
  assert.equal(metric.drop(1, 'stale-result'), true);
  const report = metric.report();
  assert.equal(report.counts.skipped, 1); assert.equal(report.counts.dropReasons['stale-result'], 1);
  assert.equal(report.counts.accepted, 0); assert.equal(report.stages.frameToAlertOverlay.p95Ms, null);
});

test('source reset invalidates old traces and missing risk/audio stay unavailable', () => {
  const metric = new LiveTelemetry(); metric.reset(1); metric.begin(1, 1, 0, 0); metric.captureDone(1, 2);
  metric.reset(2); assert.equal(metric.result(1, 3), false); assert.equal(metric.report().counts.started, 0);
  metric.begin(2, 2, 0, 10); metric.captureDone(2, 11); metric.dispatched(2, 12); metric.result(2, 20); metric.accept(2, 21);
  metric.risk(2, 22, false); metric.overlay(2, 23, false);
  const report = metric.report();
  assert.equal(report.stages.frameToOverlay.p95Ms, 13);
  assert.equal(report.stages.frameToAudioRequest.samples, 0);
  assert.equal(report.stages.frameToAudioRequest.unavailable, 0, 'no alert means no audio denominator');
});

test('timestamps and epochs fail closed', () => {
  const metric = new LiveTelemetry(); metric.reset(5);
  assert.equal(metric.begin(1, 4, 0, 0), false);
  assert.equal(metric.begin(1, 5, 0, 10), true);
  assert.equal(metric.result(1, 9), false);
  assert.equal(metric.result(1, Number.NaN), false);
});

test('two-hour-like stream keeps bounded trace rows and cumulative totals', () => {
  const metric = new LiveTelemetry(50); metric.reset(1);
  for (let i = 0; i < 72_000; i++) {
    const at = i * 100; metric.begin(i, 1, at, at); metric.captureDone(i, at + 1); metric.dispatched(i, at + 2);
    metric.result(i, at + 10); metric.accept(i, at + 11); metric.risk(i, at + 12, false); metric.overlay(i, at + 13, false);
  }
  const report = metric.report();
  assert.equal(report.counts.started, 72_000); assert.equal(report.counts.accepted, 72_000);
  assert.equal(report.session.durationMs, 7_199_900);
  assert.equal(report.percentileWindow.retained, 50); assert.equal(report.traceRows.length, 50);
});
