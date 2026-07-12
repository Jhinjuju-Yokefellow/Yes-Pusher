import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerQueue } from '../apps/world-server/player-queue.js';

test('queue selects one active player and rotates connected players after a turn', () => {
  let now = 1_000;
  const queue = new PlayerQueue({ now: () => now });
  queue.connect('a', 'ALPHA');
  queue.connect('b', 'BRAVO');
  queue.join('a');
  queue.join('b');

  assert.equal(queue.activeId(), 'a');
  assert.equal(queue.positionOf('b'), 2);

  queue.rotateAfterTurn();
  assert.equal(queue.activeId(), 'b');
  assert.deepEqual(queue.publicQueue().map((player) => player.id), ['b', 'a']);

  queue.leave('b', { turnRunning: true });
  assert.equal(queue.getPlayer('b').leaveAfterTurn, true);
  queue.rotateAfterTurn();
  assert.equal(queue.activeId(), 'a');
  assert.equal(queue.isQueued('b'), false);

  now += 25_000;
  queue.disconnect('a');
  now += 25_000;
  queue.prune({ preserveActive: false });
  assert.equal(queue.isQueued('a'), false);
});


test('polling keeps a queued player connected when the live stream drops', () => {
  let now = 1_000;
  const queue = new PlayerQueue({ disconnectGraceMs: 20_000, now: () => now });
  queue.connect('a', 'ALPHA');
  queue.join('a');
  queue.disconnect('a');
  assert.equal(queue.getPlayer('a').connected, false);

  now += 5_000;
  queue.touch('a', 'ALPHA');
  queue.prune({ preserveActive: false });
  assert.equal(queue.getPlayer('a').connected, true);
  assert.equal(queue.isQueued('a'), true);

  now += 21_000;
  queue.prune({ preserveActive: false });
  assert.equal(queue.isQueued('a'), false);
});
