import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerQueue } from '../apps/world-server/player-queue.js';
import { fastQueueJoin } from '../apps/world-server/fast-queue-join.js';

test('fast queue join records the player without preparing a world snapshot', () => {
  const queue = new PlayerQueue();
  const result = fastQueueJoin({
    queue,
    identity: {
      playerId: 'wallet:0x1111111111111111111111111111111111111111',
      label: 'PLAYER 1111',
      authenticated: true,
    },
    requireWallet: true,
    requestedCoins: 10,
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.payload, {
    ok: true,
    accepted: true,
    queued: true,
    position: 1,
  });
  assert.equal(queue.activeId(), 'wallet:0x1111111111111111111111111111111111111111');
  assert.equal(queue.activeRequest().requestedCoins, 10);
});

test('fast queue join preserves wallet requirements', () => {
  const queue = new PlayerQueue();
  const result = fastQueueJoin({
    queue,
    identity: { playerId: 'guest:1234', label: 'GUEST', authenticated: false },
    requireWallet: true,
  });

  assert.equal(result.status, 401);
  assert.equal(queue.activeId(), null);
});
