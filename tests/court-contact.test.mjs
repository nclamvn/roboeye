import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONTACT_POLICY, contextSlots, createFrameCapture, createCaptureController,
  proposeContactWindows, proposeContactReviews } from '../tools/court/contact.mjs';
import { ORIGINAL_PUBLIC_SOURCE, sha256, SOURCE_ROOT } from '../scripts/export-court-public.mjs';

const source = n => ({ name: 'authored-mechanics', sha256: 'a'.repeat(64), width: 400, height: 300,
  fps: 25, frameCount: n, durationSeconds: n / 25 });
const session = points => ({ source: source(points.length), frames: points.map((point, index) => ({ index,
  timeSeconds: index / 25, status: point ? 'observed' : 'missing', ball: point ? { x: point[0], y: point[1] } : null })) });
const bounce = [[20, 30], [25, 40], [30, 50], [35, 40], [40, 30]];

test('policy is frozen and aliases are exactly the same shared implementation', () => {
  assert.ok(Object.isFrozen(CONTACT_POLICY)); assert.equal(proposeContactReviews, proposeContactWindows);
  assert.equal(createCaptureController, createFrameCapture); assert.equal(CONTACT_POLICY.contextRadius, 2);
});
test('five real consecutive authored points support only an inconclusive image turn', () => {
  const result = proposeContactWindows({ specialist: session(bounce) });
  assert.equal(result.proposals.length, 1);
  const p = result.proposals[0]; assert.equal(p.index, 2); assert.equal(p.frame, 2); assert.equal(p.timeSeconds, .08);
  assert.deepEqual(p.supportFrames, [0, 1, 2, 3, 4]); assert.deepEqual(p.supports[0].points, bounce);
  assert.equal(p.sourceSha256, 'a'.repeat(64)); assert.equal(p.decision, 'insufficient-evidence');
  assert.match(result.limitation, /chạm vợt/);
});
test('straight motion near a line is not a contact proposal', () => {
  const s = session([[20, 30], [25, 35], [30, 40], [35, 45], [40, 50]]);
  s.lineSuggestions = [{ a: [0, 40], b: [400, 40] }];
  assert.deepEqual(proposeContactWindows({ classical: s }).proposals, []);
});
test('missing or ambiguous points never bridge to a five-observation proposal', () => {
  for (let i = 0; i < 5; i++) {
    const s = session(bounce); s.frames[i].status = i % 2 ? 'ambiguous' : 'missing'; s.frames[i].ball = null;
    assert.equal(proposeContactWindows({ classical: s }).proposals.length, 0);
  }
});
test('small jitter, disconnected jumps and inconsistent zigzags are rejected', () => {
  for (const points of [
    [[10, 10], [10.1, 10.2], [10.2, 10.4], [10.3, 10.2], [10.4, 10]],
    [[10, 10], [11, 15], [300, 100], [301, 90], [302, 80]],
    [[20, 20], [25, 50], [30, 30], [35, 10], [40, 30]],
  ]) assert.equal(proposeContactWindows({ specialist: session(points) }).proposals.length, 0);
});
test('an image apex is never relabelled as confirmed floor contact', () => {
  const s = session([[20, 70], [25, 60], [30, 50], [35, 60], [40, 70]]);
  const result = proposeContactWindows({ specialist: s });
  for (const proposal of result.proposals) {
    assert.equal(proposal.decision, 'insufficient-evidence');
    assert.equal(proposal.supports[0].kind, 'image-direction-change');
  }
  assert.match(result.limitation, /đỉnh quỹ đạo/);
});
test('spatially agreeing same-source A/B events merge without averaging points', () => {
  const a = session(bounce), b = session(bounce.map(([x, y]) => [x + 1, y + 1]));
  const p = proposeContactWindows({ classical: a, specialist: b }).proposals;
  assert.equal(p.length, 1); assert.deepEqual(p[0].arms, ['classical', 'specialist']);
  assert.equal(p[0].supports.length, 2); assert.deepEqual(p[0].point, bounce[2]);
});
test('same-time spatially conflicting A/B points remain separate and disclosed', () => {
  const a = session(bounce), b = session(bounce.map(([x, y]) => [x + 150, y]));
  const p = proposeContactWindows({ classical: a, specialist: b }).proposals;
  assert.equal(p.length, 2); assert.deepEqual(p[0].conflicts, [p[1].id]); assert.deepEqual(p[1].conflicts, [p[0].id]);
});
test('source mismatch, shifted timeline or invalid point cannot grant support', () => {
  const a = session(bounce), b = session(bounce); b.source.sha256 = 'b'.repeat(64);
  assert.throws(() => proposeContactWindows({ classical: a, specialist: b }), /video/);
  a.frames[1].timeSeconds += .2; assert.equal(proposeContactWindows({ classical: a }).proposals.length, 0);
  const bad = session(bounce); bad.frames[2].ball.x = NaN;
  assert.equal(proposeContactWindows({ classical: bad }).proposals.length, 0);
});
test('short/empty evidence produces no filler timestamps or synthetic proposals', () => {
  for (const points of [[null], [null, null, null], bounce.slice(0, 4)]) assert.equal(proposeContactWindows({ classical: session(points) }).proposals.length, 0);
});
test('chronological cap is bounded and explicitly reports undisplayed proposals', () => {
  const points = Array.from({ length: 18 }, () => [...bounce, null, null]).flat();
  const result = proposeContactWindows({ specialist: session(points) });
  assert.equal(result.proposals.length, 10); assert.equal(result.diagnostics.rawProposals, 18);
  assert.equal(result.diagnostics.truncatedProposals, 8);
  assert.ok(result.proposals.every((proposal, index) => index === 0 || proposal.index > result.proposals[index - 1].index));
});
test('context has five ordered exact slots, no clamped duplicate at start/end', () => {
  const first = contextSlots(0, source(5)); assert.deepEqual(first.map(slot => slot.index), [null, null, 0, 1, 2]);
  assert.deepEqual(first.map(slot => slot.requestedIndex), [-2, -1, 0, 1, 2]);
  assert.deepEqual(contextSlots(4, source(5)).map(slot => slot.index), [2, 3, 4, null, null]);
  assert.throws(() => contextSlots(-1, source(5))); assert.throws(() => contextSlots(5, source(5)));
});
test('original frozen raw sessions yield one proposal, not an invented contact grid', async () => {
  const [a, b] = await Promise.all(['classical', 'specialist'].map(async arm => {
    const bytes = await readFile(`${SOURCE_ROOT}/${ORIGINAL_PUBLIC_SOURCE[arm].file}`);
    assert.equal(sha256(bytes), ORIGINAL_PUBLIC_SOURCE[arm].sha256);
    return JSON.parse(bytes);
  }));
  const result = proposeContactWindows({ classical: a, specialist: b });
  assert.equal(result.diagnostics.completeSupport, 17); assert.equal(result.diagnostics.perArm.classical.completeSupport, 4);
  assert.equal(result.diagnostics.perArm.specialist.completeSupport, 13); assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].index, 101); assert.equal(result.proposals[0].timeSeconds, 4.04);
  assert.deepEqual(result.proposals[0].supportFrames, [99, 100, 101, 102, 103]);
  assert.equal(result.proposals[0].decision, 'insufficient-evidence');
});
