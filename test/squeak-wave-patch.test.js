import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config/machine-config.js';
import { WorldEngine } from '../src/game/world-engine.js';
import {
  SQUEAK_MAX_COINS,
  SQUEAK_PULSE_TIMES,
  activatePendingWave,
  activateWave,
  maxToyCount,
  queueDuckPower,
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

test('Squeak Wave chooses the six closest edge coins and gives them a visible forward pull', () => {
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
      z: CONFIG.board.front - 0.42 - index * 0.05,
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
  const wave = activateWave(engine, duck, 3.5);

  assert.ok(wave);
  assert.equal(wave.coinIds.length, SQUEAK_MAX_COINS);
  assert.equal(wave.coinIds.includes('far-coin'), false);
  assert.equal(wave.coinIds.every((id) => engine.coinById.has(id)), true);
  assert.equal(wave.coinIds.every((id) => engine.coinById.get(id).body.velocity.z >= 0.95), true);

  for (let index = 1; index < SQUEAK_PULSE_TIMES.length; index += 1) updateWaves(engine, 0.23);
  assert.equal(wave.nextPulseIndex, SQUEAK_PULSE_TIMES.length);
  updateWaves(engine, 0.35);
  assert.equal(engine.activeSqueakWaves.length, 0);
});

test('a scored duck queues its power until settlement activation', () => {
  const engine = new WorldEngine({ seedMachine: false, seed: 12 });
  engine.initializeEmptyMachine();
  const boardTopY = CONFIG.board.y + 0.42 / 2;
  const coinRestY = boardTopY + CONFIG.coin.thickness / 2 + 0.004;
  engine.createCoin({
    id: 'edge-pull',
    x: 0.4,
    y: coinRestY,
    z: CONFIG.board.front - 0.35,
    flat: true,
    phase: 'board',
    planar: true,
  });
  const duck = engine.createRubberDuckToy({
    id: 'toy-deferred-duck',
    x: 0.2,
    y: coinRestY,
    z: CONFIG.board.front - 0.08,
    emitSpawn: false,
  });

  const queued = queueDuckPower(engine, duck, 4.2);
  assert.ok(queued);
  assert.equal(engine.activeSqueakWaves.length, 0);
  assert.equal(engine.pendingSqueakPowers.length, 1);

  const wave = activatePendingWave(engine);
  assert.ok(wave);
  assert.equal(engine.pendingSqueakPowers.length, 0);
  assert.equal(engine.activeSqueakWaves.length, 1);
  assert.equal(wave.coinIds.includes('edge-pull'), true);
});
