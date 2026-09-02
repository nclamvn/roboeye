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
