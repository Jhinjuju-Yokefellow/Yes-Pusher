import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config/machine-config.js';
import { WorldEngine } from '../src/game/world-engine.js';
import {
  SQUEAK_MAX_COINS,
  activateWave,
  maxToyCount,
  updateWaves,
} from '../apps/world-server/squeak-wave-patch.js';

test('Rubber Duck turns respect the configurable machine toy cap and spawn visibly from above', () => {
  const previous = process.env.YES_PUSHER_MAX_TOYS;
  process.env.YES_PUSHER_MAX_TOYS = '2';
  try {
    const engine = new WorldEngine({ seedMachine: false, seed: 7 });
    engine.initializeEmptyMachine();

    const first = engine.spawnRubberDuckForTurn({ id: 'turn-duck-1', playerId: 'player-a' });
    const second = engine.spawnRubberDuckForTurn({ id: 'turn-duck-2', playerId: 'player-b' });
    const blocked = engine.spawnRubberDuckForTurn({ id: 'turn-duck-3', playerId: 'player-c' });

    assert.equal(maxToyCount(), 2);
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.body.position.y, 10.65);
    assert.equal(second.body.position.y, 10.65);
    assert.equal(blocked, null);
    assert.equal(engine.toys.length, 2);
  } finally {
    if (previous === undefined) delete process.env.YES_PUSHER_MAX_TOYS;
    else process.env.YES_PUSHER_MAX_TOYS = previous;
  }
});

test('Squeak Wave selects at most six nearby front-edge coins and applies three controlled pulses', () => {
  const engine = new WorldEngine({ seedMachine: false, seed: 11 });
  engine.initializeEmptyMachine();
  const boardTopY = CONFIG.board.y + 0.42 / 2;
  const coinRestY = boardTopY + CONFIG.coin.thickness / 2 + 0.004;

  const coins = [];
  for (let index = 0; index < 8; index += 1) {
    coins.push(engine.createCoin({
      id: `edge-${index}`,
      x: (index - 3.5) * 0.26,
      y: coinRestY,
      z: CONFIG.board.front - 0.65 - (index % 2) * 0.08,
      flat: true,
      phase: 'board',
      planar: true,
    }));
  }
  engine.createCoin({
    id: 'far-coin',
    x: 0,
    y: coinRestY,
    z: CONFIG.board.front - 4,
    flat: true,
    phase: 'board',
    planar: true,
  });

  const duck = engine.createRubberDuckToy({
    id: 'toy-duck-wave',
    x: 0,
    y: coinRestY,
    z: CONFIG.board.front - 0.08,
    emitSpawn: false,
  });
  const before = new Map(coins.map((coin) => [coin.id, coin.body.velocity.clone()]));
  const wave = activateWave(engine, duck, 3.5);

  assert.ok(wave);
  assert.equal(wave.coinIds.length, SQUEAK_MAX_COINS);
  assert.equal(wave.coinIds.includes('far-coin'), false);
  assert.equal(wave.coinIds.every((id) => engine.coinById.has(id)), true);
  assert.equal(wave.coinIds.some((id) => {
    const coin = engine.coinById.get(id);
    const initial = before.get(id);
    return coin.body.velocity.distanceTo(initial) > 0;
  }), true);

  updateWaves(engine, 0.21);
  assert.equal(wave.nextPulseIndex, 2);
  updateWaves(engine, 0.21);
  assert.equal(wave.nextPulseIndex, 3);
  updateWaves(engine, 0.20);
  assert.equal(engine.activeSqueakWaves.length, 0);
});
