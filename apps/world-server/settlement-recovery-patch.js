import http from 'node:http';
import { PlayerProgressStore } from './player-progress.js';
import { SettlementOutbox } from './settlement-outbox.js';
import { WalletAuthStore } from './wallet-auth.js';

const BRIDGE_KEY = Symbol.for('yes-pusher:settlement-recovery-bridge');
const bridge = globalThis[BRIDGE_KEY] ??= {
  progressStore: null,
  settlementStore: null,
  authStore: null,
};

function registerProgress(store) {
  bridge.progressStore = store;
  return store;
}

function registerSettlement(store) {
  bridge.settlementStore = store;
  reconcile(store);
  return store;
}

function registerAuth(store) {
  bridge.authStore = store;
  return store;
}

function reconcile(store = bridge.settlementStore) {
  const progress = bridge.progressStore;
  if (!store || !progress) return false;
  let changed = progress.reconcileSettlementRecords(store.allRecords());
  for (const record of store.recordsAwaitingSkinProgressConfirmation()) {
    const confirmed = progress.confirmSkinMilestone(
      record.playerId,
      record.skinDropMilestoneNumber,
      record.id,
    );
    if (confirmed || progress.view(record.playerId).confirmedSkinMilestones >= record.skinDropMilestoneNumber) {
      changed = store.markSkinProgressConfirmed(record.id) || changed;
    }
  }
  return changed;
}

function patchPrototype(prototype, name, wrap) {
  const original = prototype[name];
  if (typeof original !== 'function' || original.__settlementRecoveryPatched) return;
  const patched = wrap(original);
  Object.defineProperty(patched, '__settlementRecoveryPatched', { value: true });
  prototype[name] = patched;
}

patchPrototype(PlayerProgressStore.prototype, 'finalizeTurn', (original) => function patchedFinalizeTurn(...args) {
  registerProgress(this);
  return original.apply(this, args);
});

patchPrototype(PlayerProgressStore.prototype, 'decorateTurnSnapshot', (original) => function patchedDecorateTurnSnapshot(...args) {
  registerProgress(this);
  reconcile();
  return original.apply(this, args);
});

patchPrototype(SettlementOutbox.prototype, 'viewForPlayer', (original) => function patchedViewForPlayer(...args) {
  registerSettlement(this);
  return original.apply(this, args);
});

patchPrototype(SettlementOutbox.prototype, 'process', (original) => async function patchedProcess(...args) {
  registerSettlement(this);
  const changed = await original.apply(this, args);
  return reconcile(this) || changed;
});

patchPrototype(WalletAuthStore.prototype, 'readRequest', (original) => function patchedReadRequest(...args) {
  registerAuth(this);
  return original.apply(this, args);
});

function setCors(request, response) {
  const origin = String(request.headers.origin ?? '').trim();
  if (!origin) return;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-credentials', 'true');
  response.setHeader('vary', 'origin');
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function handleSettlementRetry(request, response) {
  if (request.method !== 'POST') return false;
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
  const channel = pathname === '/api/settlements/skin/retry'
    ? 'skin'
    : pathname === '/api/settlements/credit/retry'
      ? 'credit'
      : null;
  if (!channel) return false;

  setCors(request, response);
  const authStore = bridge.authStore;
  const settlementStore = bridge.settlementStore;
  if (!authStore || !settlementStore) {
    writeJson(response, 503, { ok: false, error: 'Settlement service is still starting' });
    return true;
  }

  const identity = authStore.readRequest(request);
  if (!identity?.playerId) {
    writeJson(response, 401, { ok: false, error: 'Connect and sign with a wallet first' });
    return true;
  }

  const retried = channel === 'skin'
    ? settlementStore.retryFailedSkinDropsForPlayer(identity.playerId)
    : settlementStore.retryFailedCreditsForPlayer(identity.playerId);
  const processed = retried ? await settlementStore.process() : false;
  reconcile(settlementStore);
  writeJson(response, 200, {
    ok: true,
    channel,
    retried,
    processed,
    settlement: settlementStore.viewForPlayer(identity.playerId),
  });
  return true;
}

const originalCreateServer = http.createServer.bind(http);
if (!http.createServer.__settlementRecoveryPatched) {
  const patchedCreateServer = function createPatchedServer(listener, ...args) {
    if (typeof listener !== 'function') return originalCreateServer(listener, ...args);
    return originalCreateServer(async (request, response) => {
      try {
        if (await handleSettlementRetry(request, response)) return;
      } catch (error) {
        setCors(request, response);
        writeJson(response, 500, {
          ok: false,
          error: error instanceof Error ? error.message : 'Settlement retry failed',
        });
        return;
      }
      return listener(request, response);
    }, ...args);
  };
  Object.defineProperty(patchedCreateServer, '__settlementRecoveryPatched', { value: true });
  http.createServer = patchedCreateServer;
}

export { bridge, handleSettlementRetry, reconcile };
