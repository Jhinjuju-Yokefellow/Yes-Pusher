import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerQueue } from '../apps/world-server/player-queue.js';
import {
  QUEUE_JOIN_RESPONSE_GRACE_MS,
  TURN_RESULT_HOLD_MS,
} from '../apps/world-server/turn-flow-stability-patch.js';

test('queue join does not start authoritative preparation inside the POST response', () => {
  let now = 1_000;
  const queue = new PlayerQueue({ now: () => now });
  queue.touch('wallet:player', 'PLAYER');
  assert.equal(queue.join('wallet:player', 'PLAYER', 5), 1);
  assert.equal(queue.activeRequest(), null);

  now += QUEUE_JOIN_RESPONSE_GRACE_MS;
  assert.equal(queue.activeRequest()?.id, 'wallet:player');
});

test('completed turn stays visible before the next queued player starts', () => {
  let now = 2_000;
  const queue = new PlayerQueue({ now: () => now });
  queue.touch('wallet:first', 'FIRST');
  queue.touch('wallet:second', 'SECOND');
  queue.join('wallet:first', 'FIRST', 5);
  now += QUEUE_JOIN_RESPONSE_GRACE_MS;
  queue.join('wallet:second', 'SECOND', 5);
  now += QUEUE_JOIN_RESPONSE_GRACE_MS;

  assert.equal(queue.activeRequest()?.id, 'wallet:first');
  assert.equal(queue.completeTurn(), 'wallet:first');
  assert.equal(queue.activeRequest(), null);

  now += TURN_RESULT_HOLD_MS - 1;
  assert.equal(queue.activeRequest(), null);
  now += 1;
  assert.equal(queue.activeRequest()?.id, 'wallet:second');
});
