import assert from 'node:assert/strict';
import test from 'node:test';
import { createCocoExport, createRelative3dExport, createYoloExport } from '../../src/annotations';
import type { DetBox } from '../../src/detection-types';

const boxes: DetBox[] = [
  { label: 'person', score: 0.98765, x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6 },
  { label: 'chair', score: 0.45678, x0: 0.5, y0: 0.1, x1: 0.9, y1: 0.4 },
  { label: 'person', score: 0.8, x0: 0, y0: 0, x1: 0.2, y1: 0.2 }
];

test('YOLO export keeps first-seen class order and normalized xywh', () => {
  const out = createYoloExport(boxes);
  assert.deepEqual(out.classes, ['person', 'chair']);
  assert.equal(out.classesText, 'person\nchair\n');
  assert.equal(
    out.labelsText,
    [
      '0 0.300000 0.400000 0.400000 0.400000',
      '1 0.700000 0.250000 0.400000 0.300000',
      '0 0.100000 0.100000 0.200000 0.200000',
      ''
    ].join('\n')
  );
});

test('COCO export maps duplicate labels to stable category IDs and pixel xywh', () => {
  const out = createCocoExport(boxes, { width: 100, height: 50 });
  assert.deepEqual(out.categories, [
    { id: 1, name: 'person' },
    { id: 2, name: 'chair' }
  ]);
  assert.deepEqual(out.annotations[0], {
    id: 1,
    image_id: 1,
    category_id: 1,
    bbox: [10, 10, 40, 20],
    area: 800,
    score: 0.988,
    iscrowd: 0
  });
  assert.equal(out.annotations[2].category_id, 1);
});

test('3D export is explicitly relative and preserves missing fused boxes', () => {
  const out = createRelative3dExport(boxes.slice(0, 2), { width: 640, height: 360 }, [
    { cx: 1.23456, cy: -0.5, cz: 2, hx: 0.1, hy: 0.2, hz: 0.3 }
  ]);
  assert.equal(out.scale, 'relative');
  assert.match(out.note, /không phải mét thật/);
  assert.doesNotMatch(out.note, /Depth Pro|metric mode/i);
  assert.deepEqual(out.objects[0].box3d, {
    center: [1.235, -0.5, 2],
    half_extents: [0.1, 0.2, 0.3]
  });
  assert.equal(out.objects[1].box3d, null);
});

test('empty annotation input produces empty deterministic payloads', () => {
  const yolo = createYoloExport([]);
  assert.deepEqual(yolo.classes, []);
  assert.equal(yolo.labelsText, '');
  assert.equal(yolo.classesText, '');

  const coco = createCocoExport([], { width: 1, height: 1 });
  assert.deepEqual(coco.categories, []);
  assert.deepEqual(coco.annotations, []);

  const relative3d = createRelative3dExport([], { width: 1, height: 1 }, []);
  assert.deepEqual(relative3d.objects, []);
});
