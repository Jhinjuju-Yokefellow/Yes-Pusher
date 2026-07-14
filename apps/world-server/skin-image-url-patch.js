import { getCoinSkin } from '../../src/config/skin-catalog.js';
import { WorldEngine } from '../../src/game/world-engine.js';
import { bridge, clean, normalizeWallet } from './skin-loadout-store.js';

const PATCH_KEY = Symbol.for('yes-pusher:skin-image-url-patch');

function walletFromPlayerId(playerId) {
  const value = clean(playerId);
  return value.startsWith('wallet:') ? normalizeWallet(value.slice('wallet:'.length)) : '';
}

function normalizeSkinImageUrl(value, fallback = '') {
  const candidate = clean(value);
  if (/^(https?:\/\/|\/|data:image\/|blob:)/i.test(candidate)) return candidate;
  const backup = clean(fallback);
  return /^(https?:\/\/|\/|data:image\/|blob:)/i.test(backup) ? backup : '';
}

function patchMethod(prototype, key, wrap) {
  const original = prototype[key];
  if (typeof original !== 'function' || original[PATCH_KEY]) return;
  const patched = wrap(original);
  Object.defineProperty(patched, PATCH_KEY, { value: true });
  prototype[key] = patched;
}

function installSkinImageUrlPatch() {
  const prototype = WorldEngine.prototype;
  if (prototype.skinImageUrlPatchInstalled) return;

  patchMethod(prototype, 'startTurn', (original) => function startTurnWithSkinImage(request = {}) {
    const wallet = walletFromPlayerId(request.playerId);
    const loadout = wallet ? bridge.loadouts.get(wallet) : null;
    const skin = loadout?.owned ? getCoinSkin(loadout.skinId) : null;
    this.activeTurnSkinImageUrl = skin
      ? normalizeSkinImageUrl(loadout?.imageUrl, skin.imageUrl) || null
      : null;

    const turn = original.call(this, request);
    if (this.dropSequence) this.dropSequence.skinImageUrl = this.activeTurnSkinImageUrl;
    return this.activeTurnSkinImageUrl ? { ...turn, skinImageUrl: this.activeTurnSkinImageUrl } : turn;
  });

  patchMethod(prototype, 'createCoin', (original) => function createCoinWithSkinImage(options = {}) {
    const coin = original.call(this, options);
    const skin = getCoinSkin(coin?.skinId);
    if (!skin) {
      coin.skinImageUrl = null;
      return coin;
    }

    const requested = normalizeSkinImageUrl(options.skinImageUrl || this.__restoringSkinImageUrl);
    const turnImage = options.phase === 'peg'
      ? normalizeSkinImageUrl(
        options.skinImageUrl || this.dropSequence?.skinImageUrl || this.activeTurnSkinImageUrl,
        skin.imageUrl,
      )
      : '';
    coin.skinImageUrl = requested || turnImage || normalizeSkinImageUrl(skin.imageUrl) || null;
    return coin;
  });

  patchMethod(prototype, 'serializeCoin', (original) => function serializeCoinWithSkinImage(coin, options = {}) {
    const value = original.call(this, coin, options);
    const skin = getCoinSkin(coin?.skinId);
    if (!skin) return value;
    const imageUrl = normalizeSkinImageUrl(coin?.skinImageUrl, skin.imageUrl);

    if (Array.isArray(value)) {
      const result = [...value];
      const skinIndex = result[8] === 1 ? 10 : 16;
      result[skinIndex] = skin.id;
      result[skinIndex + 1] = imageUrl;
      return result;
    }

    return {
      ...value,
      skinId: skin.id,
      skinImageUrl: imageUrl || null,
    };
  });

  patchMethod(prototype, 'restoreCoin', (original) => function restoreCoinWithSkinImage(saved) {
    const skin = getCoinSkin(saved?.skinId);
    this.__restoringSkinImageUrl = skin
      ? normalizeSkinImageUrl(saved?.skinImageUrl, skin.imageUrl) || null
      : null;
    try {
      const value = original.call(this, saved);
      const coin = saved?.id ? this.coinById?.get(saved.id) : null;
      if (coin) coin.skinImageUrl = this.__restoringSkinImageUrl;
      return value;
    } finally {
      this.__restoringSkinImageUrl = null;
    }
  });

  Object.defineProperty(prototype, 'skinImageUrlPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installSkinImageUrlPatch();

export { installSkinImageUrlPatch, normalizeSkinImageUrl };
