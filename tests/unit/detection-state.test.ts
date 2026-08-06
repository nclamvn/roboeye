import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverDetectionError } from '../../src/detection-state';

test('frame inference errors release busy state and keep the loaded engine ready', () => {
  assert.deepEqual(recoverDetectionError('infer'), {
    ready: true,
    busy: false,
    status: 'lỗi frame · đang thử lại'
  });
});

test('model loading errors release busy state but do not mark the engine ready', () => {
  assert.deepEqual(recoverDetectionError('load'), {
    ready: false,
    busy: false,
    status: 'lỗi tải model'
  });
});
