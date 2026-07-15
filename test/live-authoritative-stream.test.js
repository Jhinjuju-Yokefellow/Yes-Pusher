import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorldServer } from '../apps/world-server/server.js';
import { isLiveStreamSnapshot } from '../src/network/live-stream-view-patch.js';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('live server starts a queued turn without preparing or replay packaging', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'yes-pusher-live-'));
  const instance = await createWorldServer({
    port: 0,
    dataDir,
    testMode: true,
    requireWallet: false,
    tickRate: 60,
    broadcastRate: 12,
  });

  try {
    instance.queue.join('test-player', 'TEST PLAYER', 3);
    await wait(180);

    const snapshot = instance.publicSnapshot('test-player', {
      playerId: 'test-player',
      label: 'TEST PLAYER',
      wallet: null,
      authenticated: false,
    });

    assert.equal(isLiveStreamSnapshot(snapshot), true);
    assert.equal(snapshot.protocolVersion, 5);
    assert.equal(snapshot.syncMode, 'live-stream');
    assert.equal(snapshot.prepare, null);
    assert.equal(snapshot.replay, null);
    assert.notEqual(snapshot.turn.state, 'preparing');
    assert.ok(snapshot.turn.currentTurn);
    assert.equal(snapshot.turn.currentTurn.coinsDropped, 3);
  } finally {
    await instance.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('live browser snapshots are identified independently of replay state', () => {
  assert.equal(isLiveStreamSnapshot({
    kind: 'yes-pusher-shared-world',
    syncMode: 'live-stream',
    coins: [],
  }), true);
  assert.equal(isLiveStreamSnapshot({
    kind: 'yes-pusher-shared-world',
    syncMode: 'recorded-replay',
    coins: [],
  }), false);
});
