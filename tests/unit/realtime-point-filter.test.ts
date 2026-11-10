import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimePointFilter } from '../../src/realtime-point-filter';

test('1€ filter reduces stationary landmark jitter without freezing fast motion', () => {
  const filter = new RealtimePointFilter({ maxPredictionMs: 35, maxPredictionDistance: 0.035 });
  const raw: number[] = [];
  const stable: number[] = [];
  for (let index = 0; index < 24; index++) {
    const x = 0.5 + (index % 2 === 0 ? -0.01 : 0.01);
    raw.push(x);
    stable.push(filter.update({ x, y: 0.5 }, index * 16, index * 16).stable.x);
  }
  const tailRaw = raw.slice(8);
  const tailStable = stable.slice(8);
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  assert.ok(spread(tailStable) < spread(tailRaw) * 0.45, 'stationary jitter is materially reduced');

  const moved = filter.update({ x: 0.8, y: 0.5 }, 400, 438);
  assert.ok(moved.stable.x > 0.64, 'speed-adaptive cutoff follows an intentional movement');
  assert.ok(moved.display.x >= moved.stable.x, 'display point compensates measured result age');
  assert.ok(moved.display.x - moved.stable.x <= 0.035001, 'prediction stays bounded');
});
