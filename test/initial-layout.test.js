import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  TOWER_LAYOUT,
  playableHalfWidthAtZ,
} from '../src/config/machine-config.js';
import { createStartingBedPlan } from '../src/game/initial-layout.js';
import { WorldEngine } from '../src/game/world-engine.js';

test('starting layout has no towers', () => {
  assert.deepEqual(TOWER_LAYOUT, []);
});

test('every starting coin is on one flat layer inside the visible walls', () => {
  const plan = createStartingBedPlan(() => 0.5);
  assert.ok(plan.length >= 130, `expected a loaded flat field, received ${plan.length} coins`);
  assert.ok(plan.every((coin) => coin.layer === 0));

  for (const coin of plan) {
    const allowed = playableHalfWidthAtZ(coin.z, CONFIG.coin.radius + 0.08);
    assert.ok(
      Math.abs(coin.x) <= allowed + 1e-9,
      `coin at (${coin.x}, ${coin.z}) starts outside the guide wall (${allowed})`,
    );
    assert.ok(coin.z > CONFIG.pusher.frontZ + CONFIG.pusher.depth / 2);
    assert.ok(coin.z <= CONFIG.board.front - CONFIG.coin.radius + 1e-9);
  }
});

test('starting flat coins do not overlap', () => {
  const plan = createStartingBedPlan(() => 0.5);
  const minimumDistance = CONFIG.coin.radius * 2;
  for (let index = 0; index < plan.length; index += 1) {
    for (let other = index + 1; other < plan.length; other += 1) {
      const dx = plan[index].x - plan[other].x;
      const dz = plan[index].z - plan[other].z;
      assert.ok(
        Math.hypot(dx, dz) >= minimumDistance - 1e-9,
        `starting coins ${index} and ${other} overlap`,
      );
    }
  }
});

test('authoritative world starts with only flat non-tower coins', () => {
  const engine = new WorldEngine({ seed: 47 });
  const snapshot = engine.getNetworkSnapshot();

  assert.equal(snapshot.coinCount, 135);
  assert.ok(snapshot.coins.every((coin) => coin.tower === false));
  assert.ok(snapshot.coins.every((coin) => coin.position[1] < engine.boardTopY + 0.12));
});
