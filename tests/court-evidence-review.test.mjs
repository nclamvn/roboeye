import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_REVIEW_POLICY, proposeEvidenceReviews, proposeContactWindows, judgeVerifiedContact } from '../tools/court/contact.mjs';

const source = n => ({ sha256: 'a'.repeat(64), width: 400, height: 300, fps: 25, frameCount: n, durationSeconds: n / 25 });
function session(points = [[200,200],[170,260],[160,280]], indices = [5,8,9], count = 35) {
  const positions = new Map(indices.map((index, i) => [index, points[i]]));
  return { source: source(count), frames: Array.from({ length: count }, (_, index) => ({ index, timeSeconds: index / 25,
    status: positions.has(index) ? 'observed' : 'missing', ball: positions.has(index) ? { x: positions.get(index)[0], y: positions.get(index)[1] } : null })) };
}
test('frozen sparse actual approach plus decoded loss yields replay, never contact', () => {
  assert.ok(Object.isFrozen(EVIDENCE_REVIEW_POLICY));
  const s = session(), result = proposeEvidenceReviews({ specialist: s }), p = result.proposals[0];
  assert.equal(result.proposals.length, 1); assert.equal(p.kind, 'edge-loss-review'); assert.equal(p.index, 9);
  assert.deepEqual(p.point, [160,280]); assert.deepEqual(p.supportFrames, [5,8,9]);
  assert.deepEqual(p.missingFrames, [10,11,12,13,14,15,16]); assert.equal(p.contact, null);
  assert.equal(p.decision, 'insufficient-evidence'); assert.deepEqual(p.reviewInterval, { startFrame: 5, endFrame: 16 });
  assert.deepEqual(p.clipWindow, { startFrame: 0, endFrame: 34 });
  assert.deepEqual(p.supports[0].velocitiesPixelsPerFrame, [[-10,20],[-10,20]]);
});
test('stationary, horizontally drifting, upward and jump cases are not edge-loss evidence', () => {
  for (const points of [[[160,280],[160,280],[160,280]], [[100,280],[130,280],[160,280]],
    [[200,295],[170,285],[160,275]], [[1,200],[395,260],[390,280]]]) {
    assert.equal(proposeEvidenceReviews({ specialist: session(points) }).proposals.length, 0);
  }
});
test('missing support, long gaps, mid-image loss and end-of-file never manufacture an exit', () => {
  for (const s of [session([[170,260],[160,280]],[8,9]), session(undefined,[1,8,9]),
    session([[200,50],[170,90],[160,120]]), session(undefined,undefined,15)]) {
    assert.equal(proposeEvidenceReviews({ specialist: s }).proposals.length, 0);
  }
});
test('ambiguous, stale, malformed or briefly reacquired future evidence does not prove sustained loss', () => {
  for (const mutate of [s => s.frames[12].status = 'ambiguous', s => s.frames[12].timeSeconds += .2,
    s => s.frames[12].index = 11, s => { s.frames[12].status = 'observed'; s.frames[12].ball = { x:160,y:280 }; },
    s => s.frames[8].timeSeconds += .2]) {
    const s = session(); mutate(s); assert.equal(proposeEvidenceReviews({ specialist: s }).proposals.length, 0);
  }
});
test('source mismatch rejected and a second stream cannot supply missing supports', () => {
  const a = session([[200,200]],[5]), b = session([[170,260],[160,280]],[8,9]);
  assert.equal(proposeEvidenceReviews({ classical: a, specialist: b }).proposals.length, 0);
  b.source.sha256 = 'b'.repeat(64); assert.throws(() => proposeEvidenceReviews({ classical: a, specialist: b }), /video/);
});
test('agreeing two-stream cues merge real support without averaging the anchor', () => {
  const a = session(), b = session([[201,201],[171,261],[161,281]]);
  const p = proposeEvidenceReviews({ classical:a, specialist:b }).proposals;
  assert.equal(p.length,1); assert.deepEqual(p[0].point,[160,280]); assert.equal(p[0].supports.length,2);
});
test('same-time spatially conflicting edge cues stay separate and disclose ambiguity', () => {
  const a=session(),b=session([[340,200],[310,260],[300,280]]);
  const p=proposeEvidenceReviews({classical:a,specialist:b}).proposals;
  assert.equal(p.length,2);assert.deepEqual(p[0].conflicts,[p[1].id]);assert.deepEqual(p[1].conflicts,[p[0].id]);
});
test('M4 pure API and original turn fields are preserved by the wrapper', () => {
  const s = session([[20,30],[25,40],[30,50],[35,40],[40,30]],[0,1,2,3,4],8);
  const baseline = proposeContactWindows({ specialist:s }).proposals;
  const wrapped = proposeEvidenceReviews({ specialist:s }).proposals;
  assert.equal(wrapped.length,baseline.length);
  for (const [key,value] of Object.entries(baseline[0])) assert.deepEqual(wrapped[0][key],value);
});

function verified(point = [200,150]) {
  return { source:source(35), contact:{ verified:true, kind:'verified-floor-contact', sourceSha256:'a'.repeat(64),
    coordinateSpace:'source-image-floor-plane', calibrationId:'cal1', applicableZoneId:'applicable-zone', frameIndex:10,
    point, uncertaintyRadiusPixels:2, provenance:{ kind:'human-reviewed-contact',id:'authored-contact-fixture' } },
    boundary:{ verified:true,kind:'verified-effective-court-zone',sourceSha256:'a'.repeat(64),
      coordinateSpace:'source-image-floor-plane',calibrationId:'cal1',applicableZoneId:'applicable-zone',
      calibratedImageBounds:{left:0,top:0,right:400,bottom:300},
      validFrameRange:{startFrame:0,endFrame:34},polygon:[[100,100],[300,100],[300,250],[100,250]],
      uncertaintyPixels:1,provenance:{kind:'human-reviewed-boundary',id:'authored-zone-fixture'} } };
}
test('analytic verified footprint inside/outside works in either convex polygon orientation', () => {
  for (const reverse of [false,true]) {
    const inside = verified(), outside = verified([80,150]);
    if (reverse) { inside.boundary.polygon.reverse(); outside.boundary.polygon.reverse(); }
    assert.equal(judgeVerifiedContact(inside).decision,'in'); assert.equal(judgeVerifiedContact(outside).decision,'out');
  }
});
test('touch, overlap and uncertainty band cannot certify in/out', () => {
  for (const point of [[100,150],[98,150],[103,150],[200,99]]) assert.equal(judgeVerifiedContact(verified(point)).decision,'insufficient-evidence');
});
test('raw automatic model/review point cannot satisfy verified contact intake', () => {
  assert.equal(judgeVerifiedContact({source:source(35),contact:{point:[200,150]},boundary:verified().boundary}).decision,'insufficient-evidence');
  const x=verified();x.contact.provenance.kind='model-prediction';assert.equal(judgeVerifiedContact(x).decision,'insufficient-evidence');
});
test('wrong source, stale calibration, wrong applicable zone and nonconvex zones fail closed', () => {
  for (const mutate of [x=>x.contact.sourceSha256='b'.repeat(64), x=>x.contact.calibrationId='other',
    x=>x.contact.applicableZoneId='other',x=>x.contact.frameIndex=34,x=>x.boundary.polygon=[[100,100],[300,100],[150,150],[100,250]],
    x=>x.contact.point=[NaN,150]]) {
    const x=verified();if(mutate.toString().includes('frameIndex'))x.boundary.validFrameRange.endFrame=20;
    mutate(x);assert.equal(judgeVerifiedContact(x).decision,'insufficient-evidence');
  }
});
test('unverified spatial calibration range cannot extrapolate an out call', () => {
  const missing=verified();delete missing.boundary.calibratedImageBounds;
  assert.equal(judgeVerifiedContact(missing).decision,'insufficient-evidence');
  const outside=verified([80,150]);outside.boundary.calibratedImageBounds.left=90;
  assert.equal(judgeVerifiedContact(outside).decision,'insufficient-evidence');
});
