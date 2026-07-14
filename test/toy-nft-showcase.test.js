import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToyHolding } from '../apps/world-server/skin-loadout-store.js';

test('normalizes YES Pusher toy NFT metadata for the showcase', () => {
  const holding = normalizeToyHolding({
    id: 'mint-cucumber-small',
    classId: 'class-cucumber-small',
    classKey: 'yes_pusher.toy.cucumber.small',
    className: 'Cucumber Toy — Small',
    imageUrl: 'https://res.cloudinary.com/example/image/upload/cucumber-small.png',
    quantity: 2,
    meta: {
      objectType: 'machine_toy_reward',
      toyKey: 'cucumber',
      sizeTier: 'small',
      powerKey: 'cucumber_chop',
      craftFamily: 'cucumber',
      craftTier: 1,
      walletEligible: true,
    },
  });

  assert.deepEqual(holding, {
    holdingId: 'mint-cucumber-small',
    name: 'Cucumber Toy — Small',
    imageUrl: 'https://res.cloudinary.com/example/image/upload/cucumber-small.png',
    classId: 'class-cucumber-small',
    classKey: 'yes_pusher.toy.cucumber.small',
    tokenId: null,
    contractAddress: null,
    quantity: 2,
    status: 'current',
    mintedAt: null,
    objectType: 'machine_toy_reward',
    toyKey: 'cucumber',
    sizeTier: 'small',
    powerKey: 'cucumber_chop',
    craftFamily: 'cucumber',
    craftTier: 1,
    walletEligible: true,
  });
});

test('does not classify coin skins as toy NFTs', () => {
  assert.equal(normalizeToyHolding({
    id: 'mint-skin',
    classKey: 'yes_drop.cucumber_slice',
    meta: { outputKey: 'yes_drop.cucumber_slice' },
  }), null);
});
