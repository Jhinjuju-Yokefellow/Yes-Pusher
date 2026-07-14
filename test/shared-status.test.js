import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSharedStatus,
  sharedStatusNeedsBoundary,
} from '../src/network/shared-status.js';

const snapshot = {
  kind: 'yes-pusher-shared-world',
  protocolVersion: 4,
  authoritative: true,
  revision: 10,
  serverInstanceId: 'server-a',
  boundaryId: 'boundary-7',
  syncMode: 'boundary',
  coins: [['coin-1', 0, 0, 0, 0, 0, 0, 1, 1, 0]],
  toys: [{ id: 'duck-1' }],
  coinEncoding: 'packed-v3',
  queue: [],
  turn: { state: 'ready' },
};

function status(overrides = {}) {
  return {
    kind: 'yes-pusher-shared-status',
    authoritative: true,
    revision: 11,
    serverInstanceId: 'server-a',
    boundaryId: 'boundary-7',
    syncMode: 'preparing',
    queue: [{ id: 'wallet:1' }],
    turn: { state: 'preparing' },
    ...overrides,
  };
}

test('lightweight status preserves the loaded boundary objects', () => {
  const merged = mergeSharedStatus(snapshot, status());
  assert.equal(merged.kind, 'yes-pusher-shared-world');
  assert.equal(merged.syncMode, 'preparing');
  assert.equal(merged.coins, snapshot.coins);
  assert.equal(merged.toys, snapshot.toys);
  assert.equal(merged.coinEncoding, snapshot.coinEncoding);
  assert.equal(merged.queue.length, 1);
});

test('boundary change requires one full world reload', () => {
  assert.equal(sharedStatusNeedsBoundary(snapshot, status({ boundaryId: 'boundary-8' })), true);
  assert.equal(mergeSharedStatus(snapshot, status({ boundaryId: 'boundary-8' })), null);
});

test('server restart requires one full world reload even when boundary numbers repeat', () => {
  assert.equal(sharedStatusNeedsBoundary(snapshot, status({ serverInstanceId: 'server-b' })), true);
});

test('replay status on the same boundary does not request another full coin field', () => {
  const replayStatus = status({
    syncMode: 'recorded-replay',
    replay: { turnId: 'turn-1', packageUrl: '/api/replays/turn-1' },
  });
  assert.equal(sharedStatusNeedsBoundary(snapshot, replayStatus), false);
  const merged = mergeSharedStatus(snapshot, replayStatus);
  assert.equal(merged.replay.turnId, 'turn-1');
  assert.equal(merged.coins, snapshot.coins);
});
