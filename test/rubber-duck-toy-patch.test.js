import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldEngine } from '../src/game/world-engine.js';
import { simulateRecordedTurn } from '../src/game/replay-package.js';
import '../apps/world-server/skin-loadout-patch.js';
import '../apps/world-server/rubber-duck-toy-patch.js';
import { bridge } from '../apps/world-server/skin-loadout-store.js';

function equip(wallet, skinId, name = 'Rubber Duck') {
  bridge.loadouts.set(wallet, {
    wallet,
    holdingId: `holding-${skinId}`,
    skinId,
    name,
    imageUrl: '',
    owned: true,
    verifiedAt: Date.now(),
    updatedAt: new Date().toISOString(),
  });
}

test('an authoritative Rubber Duck-skinned turn drops one persistent duck toy', () => {
  const wallet = '0x4444444444444444444444444444444444444444';
  equip(wallet, 'yes_drop.rubber_duck');
  try {
    const engine = new WorldEngine({ seedMachine: false });
    engine.initializeEmptyMachine();
    const turn = engine.startTurn({
      id: 'duck-toy-turn-1',
      playerId: `wallet:${wallet}`,
      coinsDropped: 1,
      seed: 9001,
    });

    assert.equal(engine.toys.length, 1);
    assert.equal(engine.toys[0].toyKey, 'rubber_duck');
    assert.equal(engine.toys[0].sourceTurnId, turn.id);
    assert.equal(engine.toys[0].sourcePlayerId, `wallet:${wallet}`);
    assert.equal(engine.toys[0].id, 'toy-rubber-duck-duck-toy-turn-1');

    const network = engine.getNetworkSnapshot({ packed: true });
    assert.equal(network.toyCount, 1);
    assert.equal(network.toys[0].id, engine.toys[0].id);
  } finally {
    bridge.loadouts.delete(wallet);
  }
});

test('other equipped coin skins do not seed a Rubber Duck toy', () => {
  const wallet = '0x5555555555555555555555555555555555555555';
  equip(wallet, 'yes_drop.bulldog', 'Bulldog');
  try {
    const engine = new WorldEngine({ seedMachine: false });
    engine.initializeEmptyMachine();
    engine.startTurn({
      id: 'bulldog-turn-1',
      playerId: `wallet:${wallet}`,
      coinsDropped: 1,
      seed: 11,
    });
    assert.equal(engine.toys.length, 0);
  } finally {
    bridge.loadouts.delete(wallet);
  }
});

test('Rubber Duck toy identity and physics state survive confirmed-world restoration', () => {
  const wallet = '0x6666666666666666666666666666666666666666';
  equip(wallet, 'yes_drop.rubber_duck');
  try {
    const engine = new WorldEngine({ seed: 21 });
    engine.startTurn({
      id: 'duck-persist-1',
      playerId: `wallet:${wallet}`,
      coinsDropped: 1,
      seed: 22,
    });
    const original = engine.toys[0];
    original.body.position.set(1.25, 1.75, 2.5);
    original.body.velocity.set(0.1, -0.2, 0.3);

    const confirmed = engine.exportConfirmedWorld();
    assert.equal(confirmed.toys.length, 1);
    assert.equal(confirmed.toys[0].id, original.id);

    const restored = new WorldEngine({ initialSnapshot: confirmed, seedMachine: false });
    const toy = restored.toyById.get(original.id);
    assert.ok(toy);
    assert.equal(toy.toyKey, 'rubber_duck');
    assert.deepEqual(
      [toy.body.position.x, toy.body.position.y, toy.body.position.z],
      [1.25, 1.75, 2.5],
    );
    assert.deepEqual(
      [toy.body.velocity.x, toy.body.velocity.y, toy.body.velocity.z],
      [0.1, -0.2, 0.3],
    );
  } finally {
    bridge.loadouts.delete(wallet);
  }
});

test('recorded replay frames include the spawned Rubber Duck toy', async () => {
  const wallet = '0x7777777777777777777777777777777777777777';
  equip(wallet, 'yes_drop.rubber_duck');
  try {
    const source = new WorldEngine({ seed: 31 });
    const replay = await simulateRecordedTurn({
      initialWorld: source.exportConfirmedWorld(),
      startBoundary: source.getNetworkSnapshot({ packed: true }),
      playerId: `wallet:${wallet}`,
      playerLabel: 'DUCK TESTER',
      coinsDropped: 1,
      seed: 32,
      turnId: 'duck-replay-1',
      frameRate: 5,
    });

    assert.equal(replay.frames[0].toys.length, 1);
    assert.equal(replay.frames[0].toys[0].id, 'toy-rubber-duck-duck-replay-1');
    assert.equal(replay.events.some((event) => event.type === 'toy-spawn'), true);
  } finally {
    bridge.loadouts.delete(wallet);
  }
});

test('a front toy payout is attributed to the player whose turn knocks it off', () => {
  const wallet = '0x8888888888888888888888888888888888888888';
  equip(wallet, 'yes_drop.rubber_duck');
  const events = [];
  try {
    const engine = new WorldEngine({ seedMachine: false, onEvent: (event) => events.push(event) });
    engine.initializeEmptyMachine();
    const turn = engine.startTurn({
      id: 'duck-payout-1',
      playerId: `wallet:${wallet}`,
      coinsDropped: 1,
      seed: 33,
    });
    const toy = engine.toys[0];
    toy.body.position.set(0, engine.boardTopY + 0.2, 5.4);
    engine.checkToyExits(1.25);

    const payout = events.find((event) => event.type === 'toy-payout');
    assert.ok(payout);
    assert.equal(payout.turnId, turn.id);
    assert.equal(payout.playerId, `wallet:${wallet}`);
    assert.equal(payout.toyId, toy.id);
  } finally {
    bridge.loadouts.delete(wallet);
  }
});
