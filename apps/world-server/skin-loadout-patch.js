import http from 'node:http';
import { WorldEngine } from '../../src/game/world-engine.js';
import { getCoinSkin } from '../../src/config/skin-catalog.js';
import { WalletAuthStore } from './wallet-auth.js';
import {
  bridge,
  clean,
  copyLoadout,
  equippedForWallet,
  fetchInventory,
  normalizeWallet,
  queueSave,
  refreshWallet,
} from './skin-loadout-store.js';

function walletFromPlayerId(playerId) {
  const value = clean(playerId);
  return value.startsWith('wallet:') ? normalizeWallet(value.slice(7)) : '';
}

function patchMethod(prototype, key, wrap) {
  const original = prototype[key];
  if (typeof original !== 'function' || original.__skinLoadoutPatched) return;
  const patched = wrap(original);
  Object.defineProperty(patched, '__skinLoadoutPatched', { value: true });
  prototype[key] = patched;
}

patchMethod(WalletAuthStore.prototype, 'readRequest', (original) => function readSkinRequest(...args) {
  bridge.authStore = this;
  return original.apply(this, args);
});

patchMethod(WorldEngine.prototype, 'startTurn', (original) => function startSkinnedTurn(request = {}) {
  const wallet = walletFromPlayerId(request.playerId);
  const loadout = wallet ? bridge.loadouts.get(wallet) : null;
  this.activeTurnSkinId = loadout?.owned ? loadout.skinId : null;
  const turn = original.call(this, request);
  if (this.dropSequence) this.dropSequence.skinId = this.activeTurnSkinId;
  return this.activeTurnSkinId ? { ...turn, skinId: this.activeTurnSkinId } : turn;
});

patchMethod(WorldEngine.prototype, 'createCoin', (original) => function createSkinnedCoin(options = {}) {
  const coin = original.call(this, options);
  const requested = clean(options.skinId || this.__restoringSkinId);
  const turnSkin = this.dropSequence && options.phase === 'peg' ? clean(this.activeTurnSkinId) : '';
  coin.skinId = getCoinSkin(requested || turnSkin)?.id ?? null;
  return coin;
});

patchMethod(WorldEngine.prototype, 'serializeCoin', (original) => function serializeSkinnedCoin(coin, options = {}) {
  const value = original.call(this, coin, options);
  const skinId = getCoinSkin(coin?.skinId)?.id ?? null;
  if (Array.isArray(value)) return skinId ? [...value, skinId] : value;
  return { ...value, skinId };
});

patchMethod(WorldEngine.prototype, 'restoreCoin', (original) => function restoreSkinnedCoin(saved) {
  this.__restoringSkinId = getCoinSkin(saved?.skinId)?.id ?? null;
  try {
    const value = original.call(this, saved);
    const coin = saved?.id ? this.coinById?.get(saved.id) : null;
    if (coin) coin.skinId = this.__restoringSkinId;
    return value;
  } finally {
    this.__restoringSkinId = null;
  }
});

function setCors(request, response) {
  const origin = clean(request.headers.origin);
  if (!origin) return;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-credentials', 'true');
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type, authorization');
  response.setHeader('vary', 'origin');
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request, limit = 16_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function identity(request) {
  return bridge.authStore?.readRequest(request) ?? null;
}

function starter() {
  return { skinId: null, name: 'Starter YES Coin', imageUrl: '/assets/coin-face.svg' };
}

async function handleSkinRoute(request, response) {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
  if (request.method === 'OPTIONS' && pathname.startsWith('/api/skins/')) {
    setCors(request, response);
    response.writeHead(204);
    response.end();
    return true;
  }
  if (!['/api/skins/self', '/api/skins/equip'].includes(pathname)) return false;
  setCors(request, response);
  const session = identity(request);
  if (!session?.wallet || !session?.playerId) {
    writeJson(response, 401, { ok: false, error: 'Connect and sign with a wallet first.' });
    return true;
  }

  if (request.method === 'GET' && pathname === '/api/skins/self') {
    const inventory = await refreshWallet(session.wallet);
    writeJson(response, 200, {
      ok: true,
      skins: {
        starter: starter(),
        owned: inventory.owned,
        queued: inventory.queued,
        equipped: equippedForWallet(session.wallet, inventory),
      },
    });
    return true;
  }

  if (request.method === 'POST' && pathname === '/api/skins/equip') {
    const body = await readJsonBody(request);
    const holdingId = clean(body?.holdingId);
    const inventory = await fetchInventory(session.wallet);
    if (!holdingId) {
      bridge.loadouts.delete(normalizeWallet(session.wallet));
      await queueSave();
      writeJson(response, 200, {
        ok: true,
        skins: { starter: starter(), owned: inventory.owned, queued: inventory.queued, equipped: null },
      });
      return true;
    }

    const selected = inventory.owned.find((item) => item.holdingId === holdingId);
    if (!selected) {
      writeJson(response, 403, { ok: false, error: 'That NFT is not a current YES Pusher skin holding for this wallet.' });
      return true;
    }
    const saved = {
      wallet: normalizeWallet(session.wallet),
      ...selected,
      owned: true,
      verifiedAt: Date.now(),
      updatedAt: new Date().toISOString(),
    };
    bridge.loadouts.set(saved.wallet, saved);
    await queueSave();
    writeJson(response, 200, {
      ok: true,
      skins: {
        starter: starter(),
        owned: inventory.owned,
        queued: inventory.queued,
        equipped: copyLoadout(saved),
      },
    });
    return true;
  }

  writeJson(response, 405, { ok: false, error: 'Method not allowed.' });
  return true;
}

async function verifyQueueJoin(request) {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
  if (request.method !== 'POST' || pathname !== '/api/queue/join') return;
  const session = identity(request);
  if (!session?.wallet || !bridge.loadouts.has(normalizeWallet(session.wallet))) return;
  try {
    await refreshWallet(session.wallet);
  } catch {
    const wallet = normalizeWallet(session.wallet);
    const current = bridge.loadouts.get(wallet);
    if (current) bridge.loadouts.set(wallet, { ...current, owned: false, verifiedAt: 0 });
  }
}

const previousCreateServer = http.createServer.bind(http);
if (!http.createServer.__skinLoadoutPatched) {
  const patchedCreateServer = function createSkinServer(listener, ...args) {
    if (typeof listener !== 'function') return previousCreateServer(listener, ...args);
    return previousCreateServer(async (request, response) => {
      try {
        if (await handleSkinRoute(request, response)) return;
        await verifyQueueJoin(request);
      } catch (error) {
        const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
        if (pathname.startsWith('/api/skins/')) {
          setCors(request, response);
          writeJson(response, 500, {
            ok: false,
            error: error instanceof Error ? error.message : 'Skin inventory request failed.',
          });
          return;
        }
      }
      return listener(request, response);
    }, ...args);
  };
  Object.defineProperty(patchedCreateServer, '__skinLoadoutPatched', { value: true });
  http.createServer = patchedCreateServer;
}

const refreshTimer = setInterval(() => {
  for (const wallet of bridge.loadouts.keys()) void refreshWallet(wallet).catch(() => null);
}, 30_000);
refreshTimer.unref?.();

export { bridge, handleSkinRoute };
