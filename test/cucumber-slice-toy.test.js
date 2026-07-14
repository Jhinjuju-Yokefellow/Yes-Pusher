import test from 'node:test';
import assert from 'node:assert/strict';
import '../apps/world-server/rubber-duck-toy-patch.js';
import {
  CUCUMBER_REWARD_MAX,
  CUCUMBER_REWARD_MIN,
  CUCUMBER_SLICE_TOY_KEY,
  cucumberRewardForToyId,
} from '../apps/world-server/cucumber-slice-toy-patch.js';
import { CONFIG } from '../src/config/machine-config.js';
import { WorldEngine } from '../src/game/world-engine.js';

test('cucumber payout adds one deterministic 6-10 coin reward to the active turn', () => {
  const events = [];
  const engine = new WorldEngine({ seed: 7, seedMachine: false, onEvent: (event) => events.push(event) });
  engine.startTurn({
    id: 'turn-cucumber-test',
    playerId: 'wallet:0000000000000000000000000000000000000001',
    coinsDropped: 1,
    seed: 77,
  });

  const toyId = 'toy-cucumber-test-reward';
  const expected = cucumberRewardForToyId(toyId);
  assert.ok(expected >= CUCUMBER_REWARD_MIN && expected <= CUCUMBER_REWARD_MAX);

  engine.createCucumberSliceToy({
    id: toyId,
    x: 0,
    y: CONFIG.board.y + 0.60,
    z: CONFIG.board.front,
    emitSpawn: false,
  });
  engine.checkToyExits(1.25);

  const snapshot = engine.turnController.getSnapshot();
  assert.equal(snapshot.currentTurn.coinsWon, expected);
  const payout = events.find((event) => event.type === 'toy-payout' && event.toyId === toyId);
  assert.equal(payout.toyKey, CUCUMBER_SLICE_TOY_KEY);
  assert.equal(payout.rewardCoins, expected);
  assert.equal(payout.reason, 'cucumber-chop');

  engine.checkToyExits(1.50);
  assert.equal(engine.turnController.getSnapshot().currentTurn.coinsWon, expected);
});

test('cucumber toy survives confirmed-world export and restore', () => {
  const first = new WorldEngine({ seed: 3, seedMachine: false });
  first.createCucumberSliceToy({
    id: 'toy-cucumber-persistent',
    x: -0.8,
    y: CONFIG.board.y + 0.75,
    z: CONFIG.board.front - 1.8,
    rotationY: 0.3,
    emitSpawn: false,
  });
  const saved = first.exportConfirmedWorld();

  const restored = new WorldEngine({ initialSnapshot: saved, seedMachine: false });
  const toy = restored.toyById.get('toy-cucumber-persistent');
  assert.ok(toy);
  assert.equal(toy.toyKey, CUCUMBER_SLICE_TOY_KEY);
});
