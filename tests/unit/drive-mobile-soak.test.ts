import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileSoakTelemetry, safeCameraSettings } from '../../src/drive/mobile-soak';

test('camera settings use a closed privacy allowlist', () => {
  const settings = safeCameraSettings({ width: 1920, height: 1080, frameRate: 29.97, aspectRatio: 16 / 9,
    facingMode: 'environment', resizeMode: 'crop-and-scale', deviceId: 'secret-id', groupId: 'secret-group', label: 'My phone' });
  assert.deepEqual(settings, { width: 1920, height: 1080, frameRate: 29.97, aspectRatio: 16 / 9,
    facingMode: 'environment', resizeMode: 'crop-and-scale' });
  const json = JSON.stringify(settings);
  for (const forbidden of ['secret-id', 'secret-group', 'My phone', 'deviceId', 'groupId', 'label']) assert.equal(json.includes(forbidden), false);
});

test('mobile soak assigns events to four deterministic time windows', () => {
  const soak = new MobileSoakTelemetry();
  assert.equal(soak.cameraOpened(4, 1000, { width: 1280, height: 720, frameRate: 30 }), true);
  soak.modelLoadStarted('detector', 'webgpu', 1100); soak.modelReady('detector', 'webgpu', 1400);
  soak.modelLoadStarted('metric-depth', 'webgpu', 1500); soak.modelReady('metric-depth', 'wasm', 2100, 125);
  const offsets = [1000, 6 * 60_000, 11 * 60_000, 21 * 60_000];
  offsets.forEach((offset, index) => {
    const at = 1000 + offset, id = index + 1;
    soak.presentedFrame(at, { presentedFrames: index ? index + 2 : 1, expectedDisplayTime: at - 2,
      captureTime: at - 12, processingDuration: .004 });
    assert.equal(soak.begin(id, 4, at), true); soak.dispatched(id, at + 3); soak.result(id, at + 43);
    soak.accept(id); soak.tracks(at + 44, index < 2 ? [8] : [9]); soak.overlay(id, at + 53, index === 3);
    soak.metricAttempt(at + 60); soak.metricResult(at + 80, 20 + index, index !== 2);
  });
  const report = soak.report(1000 + 21 * 60_000 + 1000);
  assert.equal(report.overall.counts.detectorStarted, 4);
  assert.equal(report.overall.counts.detectorAccepted, 4);
  assert.equal(report.overall.counts.presentedFrameGaps, 1);
  assert.equal(report.overall.stages.requestToResult.p95Ms, 40);
  assert.equal(report.overall.stages.frameToOverlay.p95Ms, 53);
  assert.deepEqual(report.windows.map(window => window.counts.detectorStarted), [1, 1, 1, 1]);
  assert.deepEqual(report.windows.map(window => window.counts.metricAccepted), [1, 1, 0, 1]);
  assert.equal(report.models[0].totalLoadMs, 300);
  assert.equal(report.models[1].warmupMs, 125);
  assert.equal(report.boundedState.retainedFrameRows, 0);
  assert.match(report.claims.trackSetTurnover, /proxy-only/);
});

test('busy, drop, lifecycle and unavailable metadata remain explicit', () => {
  const soak = new MobileSoakTelemetry(); soak.cameraOpened(1, 0, { width: 640, deviceId: 'never-export' });
  soak.presentedFrame(10); soak.busy(11); soak.begin(1, 1, 20); soak.dispatched(1, 22); soak.result(1, 30);
  assert.equal(soak.drop(1, 'stale-result'), true);
  soak.event('visibilityHidden'); soak.timelineReset(2); soak.event('visibilityVisible'); soak.cameraEnded(100);
  const report = soak.report(200), text = JSON.stringify(report);
  assert.equal(report.active, false); assert.equal(report.session.durationMs, 100);
  assert.equal(report.overall.counts.detectorBusySkips, 1);
  assert.equal(report.overall.counts.dropReasons['stale-result'], 1);
  assert.equal(report.overall.stages.captureToCallback.samples, 0);
  assert.equal(report.lifecycle.visibilityHidden, 1); assert.equal(report.lifecycle.timelineReset, 1);
  assert.equal(text.includes('never-export'), false);
});

test('72,000-frame session keeps bounded trace state and cumulative histograms', () => {
  const soak = new MobileSoakTelemetry(); soak.cameraOpened(1, 0, { width: 1280, height: 720 });
  for (let id = 1; id <= 72_000; id++) {
    const at = id * 100;
    soak.presentedFrame(at, { presentedFrames: id, expectedDisplayTime: at - 1, processingDuration: .002 });
    soak.begin(id, 1, at); soak.dispatched(id, at + 2); soak.result(id, at + 12); soak.accept(id); soak.overlay(id, at + 16, false);
  }
  const report = soak.report(7_200_100);
  assert.equal(report.overall.counts.detectorStarted, 72_000);
  assert.equal(report.overall.stages.frameToOverlay.samples, 72_000);
  assert.equal(report.overall.stages.frameToOverlay.p99Ms, 16);
  assert.equal(report.boundedState.inflightTraces, 0);
  assert.equal(report.boundedState.maxInflightTraces, 64);
  assert.equal(report.boundedState.retainedFrameRows, 0);
});
