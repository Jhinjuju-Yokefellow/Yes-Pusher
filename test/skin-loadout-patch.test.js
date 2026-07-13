import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldEngine } from '../src/game/world-engine.js';
import { simulateRecordedTurn } from '../src/game/replay-package.js';
import '../apps/world-server/skin-loadout-patch.js';
import {
  bridge,
  normalizeHolding,
} from '../apps/world-server/skin-loadout-store.js';

test('Yokefellow minted holding maps to the existing Rubber Duck skin', () => {
  const holding = normalizeHolding({
    id: 'holding-1',
    classId: 'class-duck',
    className: 'Rubber Duck',
    classSlug: 'yes_drop.rubber_duck',
    contractAddress: '0x1111111111111111111111111111111111111111',
    tokenId: '7',
    quantity: 1,
    status: 'current',
    meta: {
      imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783627385/Rubber_Duck_ze5wif.png',
    },
  });

  assert.equal(holding.holdingId, 'holding-1');
  assert.equal(holding.skinId, 'yes_drop.rubber_duck');
  assert.equal(holding.name, 'Rubber Duck');
});

test('equipped wallet skin is locked into new turn coins and survives confirmed-world restoration', () => {
  const wallet = '0x2222222222222222222222222222222222222222';
  bridge.loadouts.set(wallet, {
    wallet,
    holdingId: 'holding-duck',
    skinId: 'yes_drop.rubber_duck',
    name: 'Rubber Duck',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783627385/Rubber_Duck_ze5wif.png',
    owned: true,
    verifiedAt: Date.now(),
    updatedAt: new Date().toISOString(),
  });

  const engine = new WorldEngine({ seedMachine: false });
  engine.initializeEmptyMachine();
  engine.startTurn({
    id: 'skin-turn-1',
    playerId: `wallet:${wallet}`,
    coinsDropped: 1,
    seed: 1234,
  });

  const dropped = engine.coins.find((coin) => coin.phase === 'peg');
  assert.ok(dropped);
  assert.equal(dropped.skinId, 'yes_drop.rubber_duck');
  const packed = engine.serializeCoin(dropped, { packed: true });
  assert.equal(packed.at(-1), 'yes_drop.rubber_duck');

  const confirmed = engine.exportConfirmedWorld();
  assert.equal(confirmed.coins.find((coin) => coin.id === dropped.id)?.skinId, 'yes_drop.rubber_duck');

  const restored = new WorldEngine({ initialSnapshot: confirmed, seedMachine: false });
  assert.equal(restored.coinById.get(dropped.id)?.skinId, 'yes_drop.rubber_duck');
  bridge.loadouts.delete(wallet);
});


test('authoritative replay package carries the equipped skin through frames and final handoff', async () => {
  const wallet = '0x3333333333333333333333333333333333333333';
  bridge.loadouts.set(wallet, {
    wallet,
    holdingId: 'holding-duck-replay',
    skinId: 'yes_drop.rubber_duck',
    name: 'Rubber Duck',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783627385/Rubber_Duck_ze5wif.png',
    owned: true,
    verifiedAt: Date.now(),
    updatedAt: new Date().toISOString(),
  });

  const source = new WorldEngine({ seed: 9 });
  const replay = await simulateRecordedTurn({
    initialWorld: source.exportConfirmedWorld(),
    startBoundary: source.getNetworkSnapshot({ packed: true }),
    playerId: `wallet:${wallet}`,
    playerLabel: 'DUCK PLAYER',
    coinsDropped: 1,
    seed: 44,
    turnId: 'skin-replay-1',
    frameRate: 5,
  });

  const frameHasSkin = replay.frames.some((frame) => frame.coins.some((coin) => Array.isArray(coin) && coin.at(-1) === 'yes_drop.rubber_duck'));
  const finalHasSkin = replay.finalWorld.coins.some((coin) => coin.skinId === 'yes_drop.rubber_duck');
  assert.equal(frameHasSkin, true);
  assert.equal(finalHasSkin, true);
  bridge.loadouts.delete(wallet);
});
