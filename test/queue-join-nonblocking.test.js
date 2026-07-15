import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { bridge, verifyQueueJoin } from '../apps/world-server/skin-loadout-patch.js';

const WALLET = '0x1111111111111111111111111111111111111111';

test('queue join verification returns immediately when Yokefellow inventory stalls', () => {
  const originalFetch = globalThis.fetch;
  const originalAuthStore = bridge.authStore;
  const originalLoadout = bridge.loadouts.get(WALLET);

  globalThis.fetch = () => new Promise(() => {});
  bridge.authStore = {
    readRequest: () => ({
      wallet: WALLET,
      playerId: `wallet:${WALLET}`,
      authenticated: true,
    }),
  };
  bridge.loadouts.set(WALLET, {
    wallet: WALLET,
    holdingId: 'holding-1',
    skinId: 'yes_drop.rubber_duck',
    owned: true,
  });

  try {
    const startedAt = performance.now();
    const result = verifyQueueJoin({
      method: 'POST',
      url: '/api/queue/join',
      headers: { host: 'localhost' },
    });
    const elapsed = performance.now() - startedAt;

    assert.equal(result, undefined);
    assert.ok(elapsed < 25, `queue join verification blocked for ${elapsed.toFixed(1)}ms`);
  } finally {
    globalThis.fetch = originalFetch;
    bridge.authStore = originalAuthStore;
    if (originalLoadout) bridge.loadouts.set(WALLET, originalLoadout);
    else bridge.loadouts.delete(WALLET);
  }
});
