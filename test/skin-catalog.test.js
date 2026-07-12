import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COIN_SKINS,
  RANDOM_SKIN_DROP_OFFERING_NAME,
  RANDOM_SKIN_DROP_TRIGGER_KEY,
  getCoinSkin,
} from '../src/config/skin-catalog.js';

test('random skin catalog contains the 15 existing Yokefellow outputs', () => {
  assert.equal(RANDOM_SKIN_DROP_OFFERING_NAME, 'Random Coin Skin Drop');
  assert.equal(RANDOM_SKIN_DROP_TRIGGER_KEY, 'coin_pusher.random_skin_drop');
  assert.equal(COIN_SKINS.length, 15);
  assert.equal(new Set(COIN_SKINS.map((skin) => skin.id)).size, 15);
  assert.ok(COIN_SKINS.every((skin) => skin.id.startsWith('yes_drop.')));
  assert.ok(COIN_SKINS.every((skin) => skin.imageUrl.startsWith('https://res.cloudinary.com/dr2hz2tmw/')));
  assert.equal(getCoinSkin('yes_drop.rubber_duck')?.name, 'Rubber Duck');
});
