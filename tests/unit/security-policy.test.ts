import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateAudit,
  hasNativeBundleExposure,
  hasSourceSharpExposure
} from '../../scripts/security-policy.mjs';

const acceptedRisk = {
  id: 'GHSA-f88m-g3jw-g9cj',
  package: 'sharp',
  severity: 'high',
  reviewBy: '2026-09-06'
};

function auditWith(advisory = acceptedRisk.id) {
  return {
    '@huggingface/transformers': { severity: 'high', via: ['sharp'] },
    sharp: {
      severity: 'high',
      via: [
        {
          name: 'sharp',
          severity: 'high',
          url: `https://github.com/advisories/${advisory}`
        }
      ]
    }
  };
}

test('allows only the reviewed advisory before its deadline', () => {
  const result = evaluateAudit(auditWith(), [acceptedRisk], '2026-08-06');
  assert.deepEqual(result.unexpected, []);
  assert.deepEqual(result.observedAccepted, [acceptedRisk.id]);
  assert.deepEqual(result.violations, []);
});

test('rejects a new high advisory propagated through the same dependency', () => {
  const result = evaluateAudit(auditWith('GHSA-aaaa-bbbb-cccc'), [acceptedRisk], '2026-08-06');
  assert.deepEqual(result.unexpected.sort(), ['@huggingface/transformers', 'sharp']);
});

test('rejects an accepted advisory after its review deadline', () => {
  const result = evaluateAudit(auditWith(), [acceptedRisk], '2026-09-07');
  assert.deepEqual(result.unexpected.sort(), ['@huggingface/transformers', 'sharp']);
  assert.match(result.violations[0], /hết hạn/);
});

test('rejects an advisory when package or severity no longer matches', () => {
  const result = evaluateAudit(auditWith(), [{ ...acceptedRisk, package: 'other' }], '2026-08-06');
  assert.deepEqual(result.unexpected.sort(), ['@huggingface/transformers', 'sharp']);
});

test('detects sharp imports in application source', () => {
  assert.equal(hasSourceSharpExposure("import sharp from 'sharp';"), true);
  assert.equal(hasSourceSharpExposure("import { pipeline } from '@huggingface/transformers';"), false);
});

test('detects native sharp/libvips markers in a browser bundle', () => {
  assert.equal(hasNativeBundleExposure('VipsForeignLoadTiff'), true);
  assert.equal(hasNativeBundleExposure('node_modules/sharp'), true);
  assert.equal(hasNativeBundleExposure('const mode = "webgpu";'), false);
});
