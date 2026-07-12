import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  TOWER_LAYOUT,
  playableHalfWidthAtZ,
} from '../src/config/machine-config.js';
import { createStartingBedPlan } from '../src/game/initial-layout.js';
import { WorldEngine } from '../src/game/world-engine.js';

test('starting layout uses one centered jackpot tower', () => {
  assert.deepEqual(TOWER_LAYOUT, [{ x: 0, z: 3.62, height: 18 }]);
});

test('starting loose coins remain inside the visible guide walls', () => {
  const plan = createStartingBedPlan(() => 0.5);
  assert.ok(plan.length >= 170, `expected a loaded field, received ${plan.length} loose coins`);

  for (const coin of plan) {
    const allowed = playableHalfWidthAtZ(coin.z, CONFIG.coin.radius + 0.12);
    assert.ok(
      Math.abs(coin.x) <= allowed + 1e-9,
      `coin at (${coin.x}, ${coin.z}) starts outside the guide wall (${allowed})`,
    );
    assert.ok(coin.z > CONFIG.pusher.frontZ + CONFIG.pusher.depth / 2);
    assert.ok(coin.z <= CONFIG.board.front - CONFIG.coin.radius + 1e-9);
  }
});

test('extra starting layers are concentrated on both payout sides', () => {
  const plan = createStartingBedPlan(() => 0.5);
  const upper = plan.filter((coin) => coin.layer > 0);
  assert.ok(upper.length >= 60);
  assert.ok(upper.some((coin) => coin.x < -3));
  assert.ok(upper.some((coin) => coin.x > 3));
  assert.ok(upper.every((coin) => Math.abs(coin.x) >= 1.95));
});

test('authoritative world starts with the new loaded center-tower field', () => {
  const engine = new WorldEngine({ seed: 33 });
  const snapshot = engine.getNetworkSnapshot();
  const towerCoins = snapshot.coins.filter((coin) => coin.tower);
  const looseCoins = snapshot.coins.filter((coin) => !coin.tower);

  assert.ok(snapshot.coinCount > 240);
  assert.ok(towerCoins.length > 70);
  assert.ok(looseCoins.length >= 170);
  assert.ok(towerCoins.every((coin) => Math.abs(coin.position[0]) < 0.8));
});
