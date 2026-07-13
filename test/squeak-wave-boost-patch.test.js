import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config/machine-config.js';
import { WorldEngine } from '../src/game/world-engine.js';
import {
  SQUEAK_BOOST_FORWARD_SPEED,
  applySqueakBoost,
} from '../apps/world-server/squeak-wave-boost-patch.js';

test('strong Squeak Wave rapidly pulls an edge coin toward the duck and payout', () => {
  const engine = new WorldEngine({ seedMachine: false, seed: 41 });
  engine.initializeEmptyMachine();
  const boardTopY = CONFIG.board.y + 0.42 / 2;
  const coin = engine.createCoin({
    id: 'boost-edge-coin',
    x: 1.4,
    y: boardTopY + CONFIG.coin.thickness / 2 + 0.004,
    z: CONFIG.board.front - 1.15,
    flat: true,
    phase: 'board',
    planar: true,
  });

  engine.activeSqueakWaves = [{
    origin: { x: 0, y: boardTopY + 0.58, z: CONFIG.board.front - 0.08 },
    coinIds: [coin.id],
  }];

  for (let index = 0; index < 8; index += 1) applySqueakBoost(engine, 1 / 45);

  assert.ok(coin.body.velocity.x < -1.5);
  assert.ok(coin.body.velocity.z > 3.5);
  assert.ok(coin.body.velocity.z <= SQUEAK_BOOST_FORWARD_SPEED + 0.2);
  assert.ok(coin.body.velocity.y > 0.2);
});
