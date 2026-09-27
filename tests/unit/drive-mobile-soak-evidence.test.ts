import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMobileSoakEvidence} from '../../src/drive/mobile-soak-evidence';

function fixture(durationMs=65_000) {
  const counts={presentedCallbacks:100,presentedFrameGaps:0,detectorStarted:10,detectorAccepted:10,detectorDropped:0,detectorBusySkips:0,overlays:10,alertOverlays:0,metricAttempts:0,metricAccepted:0,metricDropped:0,trackSnapshots:10,trackObservations:10,trackBirths:1,trackLosses:0,dropReasons:{}};
  const stages={decodeProcessing:{p95Ms:4},requestToResult:{p95Ms:40},frameToOverlay:{p95Ms:50}};
  const empty=()=>({counts:{...counts,detectorStarted:0,detectorAccepted:0},stages:{...stages,frameToOverlay:{p95Ms:null}}});
  return {sourceKind:'camera',synthetic:false,mobileSoak:{schema:'drivesense-mobile-soak-v1',session:{durationMs},privacy:{pixelFree:true,cameraSettingsAllowlist:true},camera:{settings:{width:1280,height:720,frameRate:30}},models:[{kind:'detector',outcome:'ready',resolvedBackend:'wasm'}],boundedState:{inflightTraces:0,maxInflightTraces:64,retainedFrameRows:0},overall:{counts,stages},windows:[{counts,stages},empty(),empty(),empty()]}};
}

test('complete one-minute report is smoke-observed and identifies detector request',()=>{
  const verdict=evaluateMobileSoakEvidence(fixture());
  assert.equal(verdict.contract.pass,true);assert.equal(verdict.status,'smoke-observed');assert.equal(verdict.dominantObservedStage,'frame-to-overlay');
});

test('twenty-minute slowdown is reported as a trend, not a safety claim',()=>{
  const input=fixture(21*60_000),soak=input.mobileSoak;
  soak.windows[0].counts={...soak.windows[0].counts,detectorStarted:5,detectorAccepted:5};
  soak.windows[0].stages={...soak.windows[0].stages,frameToOverlay:{p95Ms:50}};
  soak.windows[2].counts={...soak.windows[2].counts,detectorStarted:5,detectorAccepted:5};
  soak.windows[2].stages={...soak.windows[2].stages,frameToOverlay:{p95Ms:80}};
  const verdict=evaluateMobileSoakEvidence(input);
  assert.equal(verdict.contract.pass,true);assert.equal(verdict.performanceTrend.status,'degrading');assert.equal(verdict.performanceTrend.ratio,1.6);
  assert.match(verdict.claimBoundary,/does not validate distance accuracy/);
});

test('missing camera evidence and mismatched window totals fail closed',()=>{
  const input=fixture();delete input.mobileSoak.camera.settings.width;input.mobileSoak.windows[0].counts.detectorStarted=9;
  const verdict=evaluateMobileSoakEvidence(input);assert.equal(verdict.status,'invalid');assert.equal(verdict.contract.pass,false);
});
