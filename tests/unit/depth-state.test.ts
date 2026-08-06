import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverDepthError } from '../../src/depth-state';

test('depth infer error releases busy state and keeps the loaded model ready', () => {
  assert.deepEqual(recoverDepthError('infer'), {
    ready: true,
    busy: false,
    retry: false,
    status: 'Khung depth lỗi · đang thử frame tiếp theo'
  });
});

test('depth load error stops frames and exposes explicit retry', () => {
  assert.deepEqual(recoverDepthError('load'), {
    ready: false,
    busy: false,
    retry: true,
    status: 'Model depth chưa tải được'
  });
});
