import assert from 'node:assert/strict';
import test from 'node:test';
import { AirDeskController } from '../../src/airdesk';
import type { HandLandmark } from '../../src/airsketch-types';

function hand(pinch = false): HandLandmark[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.7, z: 0 }));
  points[0] = { x: 0.5, y: 0.82, z: 0 };
  points[5] = { x: 0.42, y: 0.62, z: 0 };
  points[17] = { x: 0.62, y: 0.63, z: 0 };
  for (const [pip, tip, x] of [[6, 8, 0.32], [10, 12, 0.43], [14, 16, 0.55], [18, 20, 0.66]] as const) {
    points[pip] = { x, y: 0.49, z: 0 };
    points[tip] = { x, y: 0.24, z: 0 };
  }
  points[4] = pinch ? { x: 0.33, y: 0.245, z: 0 } : { x: 0.25, y: 0.52, z: 0 };
  return points;
}

function handTransform(options: { x: number; ratio: number; angle?: number; flipped?: boolean; open?: boolean }): HandLandmark[] {
  const points = hand(true);
  const span = Math.hypot(points[5].x - points[17].x, points[5].y - points[17].y);
  points[8] = { x: options.x, y: 0.24, z: 0 };
  points[4] = { x: options.x + span * options.ratio, y: 0.24, z: 0 };
  if (!options.open) {
    // A held object uses thumb + index while the other fingers stay curled.
    for (const tip of [12, 16, 20]) points[tip] = { ...points[tip], y: 0.72 };
  }
  if (options.angle != null) {
    const radius = 0.14;
    // Controller measures the mirrored wrist → middle-MCP vector.
    points[9] = {
      x: points[0].x - Math.cos(options.angle) * radius,
      y: points[0].y + Math.sin(options.angle) * radius,
      z: 0
    };
  }
  if (options.flipped) {
    const indexX = points[5].x;
    points[5] = { ...points[5], x: points[17].x };
    points[17] = { ...points[17], x: indexX };
  }
  return points;
}

test('AirDesk exposes five fingertip affordances and pinch edges', () => {
  const desk = new AirDeskController();
  const hover = desk.hand(hand(false), 10)!;
  const down = desk.hand(hand(true), 30)!;
  const held = desk.hand(hand(true), 50)!;
  assert.equal(hover.fingertips.length, 5);
  assert.ok(hover.fingertips.filter((finger) => finger.extended).length >= 4);
  assert.equal(down.justPinched, true);
  assert.equal(held.justPinched, false);
  assert.equal(held.pinch, true);
});

test('AirDesk keeps image drag, scale, rotation, flip and annotation independent', () => {
  const desk = new AirDeskController();
  desk.begin({ x: 0.5, y: 0.5, t: 0 }, 'move');
  desk.move({ x: 0.7, y: 0.6, t: 20 });
  desk.end();
  assert.ok(desk.getTransform().x > 0.19 && desk.getTransform().y > 0.09);
  desk.begin({ x: 0.5, y: 0.5, t: 30 }, 'scale');
  desk.move({ x: 0.65, y: 0.42, t: 40 });
  desk.end();
  assert.ok(desk.getTransform().scale > 1.2);
  desk.perform('rotate-right');
  desk.perform('flip-x');
  assert.equal(desk.getTransform().rotation, 15);
  assert.equal(desk.getTransform().flipX, true);
  desk.perform('toggle-draw');
  desk.beginDrawing({ x: 0.2, y: 0.3, t: 0 });
  desk.draw({ x: 0.3, y: 0.4, t: 20 });
  desk.end();
  assert.equal(desk.getPaths()[0].length, 2);
});

test('AirDesk two-finger transform moves across the stage, scales, rotates and flips naturally', () => {
  const desk = new AirDeskController();
  const start = desk.hand(handTransform({ x: 0.32, ratio: 0.30, angle: -Math.PI / 2 }), 0)!;
  assert.equal(start.justPinched, true);
  desk.beginSpatialTransform(start);

  let changed = start;
  for (let frame = 1; frame <= 8; frame++) {
    changed = desk.hand(handTransform({
      x: 0.32 + (0.84 - 0.32) * frame / 8,
      ratio: 0.30 + (0.66 - 0.30) * frame / 8,
      angle: -Math.PI / 2 + Math.PI / 2 * frame / 8
    }), frame * 33)!;
    desk.moveSpatialTransform(changed);
  }
  const transformed = desk.getTransform();
  assert.ok(transformed.x < -0.45, `translation=${transformed.x}`);
  assert.ok(transformed.scale > 1.6, `scale=${transformed.scale}`);
  assert.ok(transformed.rotation > 45, `rotation=${transformed.rotation}`);

  for (let index = 0; index < 8; index++) {
    const flipped = desk.hand(handTransform({ x: 0.84, ratio: 0.66, angle: 0, flipped: true }), 66 + index * 33)!;
    desk.moveSpatialTransform(flipped);
  }
  assert.equal(desk.getTransform().flipX, true, 'đổi mặt bàn tay được xác nhận trước khi lật ảnh');

  // Separating only the two control fingers remains zoom; it cannot drop.
  const wide = desk.hand(handTransform({ x: 0.84, ratio: 1.10, angle: 0, flipped: true }), 350)!;
  assert.equal(wide.pinch, true, 'tách hai ngón vẫn giữ ảnh để zoom');
  const release1 = desk.hand(handTransform({ x: 0.84, ratio: 1.10, angle: 0, flipped: true, open: true }), 383)!;
  const release2 = desk.hand(handTransform({ x: 0.84, ratio: 1.10, angle: 0, flipped: true, open: true }), 416)!;
  const release3 = desk.hand(handTransform({ x: 0.84, ratio: 1.10, angle: 0, flipped: true, open: true }), 449)!;
  assert.equal(release1.pinch, true, 'một frame xòe tay chưa làm rơi ảnh');
  assert.equal(release2.pinch, true, 'hai frame xòe tay vẫn chờ xác nhận');
  assert.equal(release3.justReleased, true, 'ba frame xòe tay xác nhận thao tác đặt');
  desk.end();
  assert.equal(desk.isSpatialTransforming(), false);
});
