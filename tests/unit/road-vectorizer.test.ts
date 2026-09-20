import test from 'node:test';
import assert from 'node:assert/strict';
import { vectorizeRoadMask, vectorizeRoadMaskV1, vectorizeRoadMaskV2 } from '../../src/drive/road-vectorizer';

function drawMark(labels: Uint8Array, width: number, height: number, xAt: (y: number) => number, visible: (y: number) => boolean): void {
  for (let y = 0; y < height; y += 1) {
    const normalizedY = y / height;
    if (!visible(normalizedY)) continue;
    const centre = Math.round(xAt(normalizedY) * width);
    for (let dx = -2; dx <= 2; dx += 1) {
      const x = centre + dx;
      if (x >= 0 && x < width) labels[y * width + x] = 3;
    }
  }
}

function lineRms(line: { points: Array<{ x: number; y: number }> }, truth: (y: number) => number, width: number): number {
  return Math.sqrt(line.points.reduce((sum, point) => sum + ((point.x - truth(point.y)) * width) ** 2, 0) / line.points.length);
}

test('vectorizer extracts drivable polygon and typed ego corridor from a four-class mask', () => {
  const width = 160, height = 96, labels = new Uint8Array(width * height);
  for (let y = 35; y < height; y += 1) {
    const progress = (y - 35) / (height - 35);
    const left = Math.round(72 - 65 * progress), right = Math.round(88 + 65 * progress);
    for (let x = left; x <= right; x += 1) labels[y * width + x] = 1;
    const egoLeft = Math.round(76 - 38 * progress), egoRight = Math.round(84 + 38 * progress);
    for (let dx = -1; dx <= 1; dx += 1) {
      labels[y * width + egoLeft + dx] = 3;
      labels[y * width + egoRight + dx] = 3;
    }
  }
  const result = vectorizeRoadMask(labels, width, height);
  assert.equal(result.areas.length, 1);
  assert.deepEqual(result.lines.map(line => line.role), ['ego-left', 'ego-right']);
  assert.ok(result.areas[0].points.length >= 6);
  assert.ok(result.diagnostics.roadRows > 5);
});

test('vectorizer fails closed for invalid shape and empty evidence', () => {
  assert.throws(() => vectorizeRoadMask(new Uint8Array(10), 100, 100), /shape/);
  const empty = vectorizeRoadMask(new Uint8Array(64 * 64), 64, 64);
  assert.deepEqual(empty.lines, []);
  assert.deepEqual(empty.areas, []);
  assert.equal(empty.diagnostics.horizonY, null);
});

test('v2 bridges dashed curved lanes without switching to adjacent distractors', () => {
  const width = 240, height = 144, labels = new Uint8Array(width * height), horizon = .4;
  const progress = (y: number) => Math.max(0, (y - horizon) / (1 - horizon));
  const left = (y: number) => .49 - .28 * progress(y) - .035 * progress(y) ** 2;
  const right = (y: number) => .51 + .27 * progress(y) + .025 * progress(y) ** 2;
  for (let y = Math.round(horizon * height); y < height; y += 1) {
    const t = progress(y / height), roadLeft = Math.round((.49 - .48 * t) * width), roadRight = Math.round((.51 + .48 * t) * width);
    for (let x = Math.max(0, roadLeft); x <= Math.min(width - 1, roadRight); x += 1) labels[y * width + x] = 1;
  }
  const egoDash = (y: number) => y >= horizon && Math.floor((y - horizon) * height / 11) % 2 === 0;
  const adjacentDash = (y: number) => y >= horizon && !egoDash(y);
  drawMark(labels, width, height, left, egoDash);
  drawMark(labels, width, height, right, egoDash);
  drawMark(labels, width, height, y => .49 - .45 * progress(y), adjacentDash);
  drawMark(labels, width, height, y => .51 + .45 * progress(y), adjacentDash);
  for (let y = 102; y < 106; y += 1) for (let x = 55; x < 185; x += 1) labels[y * width + x] = 3;

  const baseline = vectorizeRoadMaskV1(labels, width, height);
  const result = vectorizeRoadMaskV2(labels, width, height);
  assert.deepEqual(result.lines.map(line => line.role), ['ego-left', 'ego-right']);
  const leftLine = result.lines.find(line => line.role === 'ego-left')!;
  const rightLine = result.lines.find(line => line.role === 'ego-right')!;
  const v2Error = (lineRms(leftLine, left, width) + lineRms(rightLine, right, width)) / 2;
  const v1Error = (lineRms(baseline.lines.find(line => line.role === 'ego-left')!, left, width)
    + lineRms(baseline.lines.find(line => line.role === 'ego-right')!, right, width)) / 2;
  assert.ok(v2Error < 5, `v2 RMS ${v2Error}: ${JSON.stringify({ lines: result.lines, diagnostics: result.diagnostics })}`);
  assert.ok(v2Error < v1Error * .5, `expected v2 ${v2Error} < half v1 ${v1Error}`);
  assert.equal(result.diagnostics.vectorizerVersion, 2);
  assert.equal(result.diagnostics.paths.left?.accepted, true);
  assert.equal(result.diagnostics.paths.right?.accepted, true);
  assert.ok((result.diagnostics.paths.left?.confidence ?? 0) > .3);
});

test('v2 fails closed for short or horizontally implausible mark evidence', () => {
  const width = 160, height = 96, labels = new Uint8Array(width * height);
  for (let y = 60; y < 68; y += 1) {
    for (let x = 25; x < 29; x += 1) labels[y * width + x] = 3;
    for (let x = 131; x < 135; x += 1) labels[y * width + x] = 3;
  }
  for (let y = 72; y < 75; y += 1) for (let x = 35; x < 125; x += 1) labels[y * width + x] = 3;
  const result = vectorizeRoadMaskV2(labels, width, height);
  assert.deepEqual(result.lines, []);
  assert.equal(result.diagnostics.paths.left?.accepted, false);
  assert.equal(result.diagnostics.paths.right?.accepted, false);
});

test('v2 abstains when two materially different left paths have equivalent evidence', () => {
  const width = 240, height = 144, labels = new Uint8Array(width * height), horizon = .4;
  const progress = (y: number) => Math.max(0, (y - horizon) / (1 - horizon));
  drawMark(labels, width, height, y => .49 - .15 * progress(y), y => y >= horizon && !(y >= .55 && y < .62));
  drawMark(labels, width, height, y => .42 - .16 * progress(y), y => y >= horizon);
  const result = vectorizeRoadMaskV2(labels, width, height);
  assert.equal(result.lines.some(line => line.role === 'ego-left'), false);
  assert.equal(result.diagnostics.paths.left?.reason, 'ambiguous');
});
