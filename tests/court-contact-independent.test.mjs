import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { proposeContactWindows, contextSlots, CONTACT_POLICY } from '../tools/court/contact.mjs';

const source = { name: 'authored-point-mechanics', sha256: 'a'.repeat(64), width: 320, height: 180, fps: 25, frameCount: 5, durationSeconds: .2 };
const fixture = () => ({ source: { ...source }, frames: [[30, 10], [35, 20], [40, 30], [45, 20], [50, 10]].map(([x, y], index) => ({ index, timeSeconds: index / 25, status: 'observed', ball: { x, y } })) });

test('authored point turn proposes an uncertain review, never a floor-contact verdict', () => {
  const result = proposeContactWindows({ classical: fixture() });
  assert.equal(result.proposals.length, 1); assert.equal(result.proposals[0].index, 2);
  assert.equal(result.proposals[0].decision, 'insufficient-evidence'); assert.deepEqual(result.proposals[0].supportFrames, [0, 1, 2, 3, 4]);
  assert.match(result.limitation, /Không chứng minh chạm sàn/);
});

test('missing or ambiguous middle observation is not bridged into an invented turn', () => {
  for (const status of ['missing', 'ambiguous']) {
    const session = fixture(); session.frames[2] = { ...session.frames[2], status, ball: null };
    assert.equal(proposeContactWindows({ classical: session }).proposals.length, 0);
  }
  const other = fixture(); other.source.sha256 = 'b'.repeat(64);
  assert.throws(() => proposeContactWindows({ classical: fixture(), specialist: other }), /timeline|video/);
});

test('context slots preserve temporal order and explicit empty boundaries, never clamp duplicates', () => {
  assert.deepEqual(contextSlots(0, source).map(s => [s.offset, s.requestedIndex, s.index, s.status]), [[-2, -2, null, 'out-of-range'], [-1, -1, null, 'out-of-range'], [0, 0, 0, 'pending'], [1, 1, 1, 'pending'], [2, 2, 2, 'pending']]);
  assert.deepEqual(contextSlots(4, source).map(s => s.index), [2, 3, 4, null, null]);
  for (const index of [-1, 5, 1.5]) assert.throws(() => contextSlots(index, source));
});

test('actual original proposal supports are exact frozen observations; counts are mechanics, not accuracy', async () => {
  const hash = '767842eec2a34d478f8d4a5f3680c18f6eac889147f81fa332f7a02730542474';
  const classical = JSON.parse(await readFile(new URL(`../.court-cache/${hash}/session.json`, import.meta.url)));
  const specialist = JSON.parse(await readFile(new URL(`../.court-cache/${hash}/specialist/46932bb5bc5d99a1c972a2e3fc72f4bad03635c369099889567f6e763574a0d4/session.json`, import.meta.url)));
  const sessions = { classical, specialist }, before = JSON.stringify(sessions), result = proposeContactWindows(sessions);
  let complete = 0;
  for (const session of Object.values(sessions)) for (let i = 2; i < 335; i++) if ([-2, -1, 0, 1, 2].every(offset => session.frames[i + offset].status === 'observed' && session.frames[i + offset].ball)) complete++;
  assert.equal(complete, 17); assert.equal(result.diagnostics.completeSupport, complete);
  assert.equal(result.sourceSha256, hash); assert.ok(result.proposals.length <= CONTACT_POLICY.maxProposals);
  for (const proposal of result.proposals) {
    assert.equal(proposal.sourceSha256, hash); assert.equal(proposal.decision, 'insufficient-evidence');
    for (const support of proposal.supports) {
      assert.equal(support.indices.length, 5);
      for (const [i, frame] of support.indices.entries()) {
        assert.equal(frame, support.indices[0] + i);
        const raw = sessions[support.arm].frames[frame]; assert.equal(raw.status, 'observed'); assert.deepEqual(support.points[i], [raw.ball.x, raw.ball.y]);
      }
    }
  }
  assert.equal(JSON.stringify(sessions), before);
});
