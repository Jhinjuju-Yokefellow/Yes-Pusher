import test from 'node:test';
import assert from 'node:assert/strict';
import '../apps/world-server/skin-loadout-patch.js';
import '../apps/world-server/skin-image-url-patch.js';
import { normalizeSkinImageUrl } from '../apps/world-server/skin-image-url-patch.js';
import { bridge } from '../apps/world-server/skin-loadout-store.js';
import { getCoinSkin } from '../src/config/skin-catalog.js';
import { normalizePackedReplayCoin } from '../src/game/replay-coin-delta.js';
import { WorldEngine } from '../src/game/world-engine.js';
import {
  skinMetadataFromDeltaValues,
  skinMetadataFromRaw,
} from '../src/skin-image-view-patch.js';

const wallet = `0x${'1'.repeat(40)}`;
const playerId = `wallet:${wallet}`;
const skinId = 'yes_drop.rubber_duck';
const holdingImageUrl = 'https://res.cloudinary.com/example/image/upload/custom-rubber-duck.png';

test('equipped NFT image URL follows its coins through packed replay and confirmed restore', () => {
  bridge.loadouts.set(wallet, {
    wallet,
    holdingId: 'holding-rubber-duck',
    skinId,
    imageUrl: holdingImageUrl,
    owned: true,
    verifiedAt: Date.now(),
  });

  try {
    const engine = new WorldEngine({ seed: 41, seedMachine: false });
    const turn = engine.startTurn({
      id: 'turn-skin-image-url',
      playerId,
      coinsDropped: 1,
      seed: 411,
    });
    const coin = engine.coins[0];

    assert.equal(turn.skinId, skinId);
    assert.equal(turn.skinImageUrl, holdingImageUrl);
    assert.equal(coin.skinId, skinId);
    assert.equal(coin.skinImageUrl, holdingImageUrl);

    const packed = engine.serializeCoin(coin, { packed: true });
    assert.deepEqual(skinMetadataFromRaw(packed), {
      skinId,
      skinImageUrl: holdingImageUrl,
    });

    const normalizedPacked = normalizePackedReplayCoin(engine.serializeCoin(coin));
    assert.deepEqual(skinMetadataFromDeltaValues(normalizedPacked.slice(1)), {
      skinId,
      skinImageUrl: holdingImageUrl,
    });

    const snapshot = engine.exportConfirmedWorld();
    assert.equal(snapshot.coins[0].skinImageUrl, holdingImageUrl);

    const restored = new WorldEngine({ initialSnapshot: snapshot, seedMachine: false });
    assert.equal(restored.coins[0].skinId, skinId);
    assert.equal(restored.coins[0].skinImageUrl, holdingImageUrl);
  } finally {
    bridge.loadouts.delete(wallet);
  }
});

test('malformed NFT image fields fall back to the catalog image instead of JSON text', () => {
  const fallback = getCoinSkin(skinId).imageUrl;
  assert.equal(normalizeSkinImageUrl('{"name":"not-an-image"}', fallback), fallback);
});
