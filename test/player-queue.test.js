import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerQueue } from '../apps/world-server/player-queue.js';

test('each drop request creates one queued turn and preserves its selected coin count', () => {
  let now = 1_000;
  const queue = new PlayerQueue({ now: () => now });
  queue.connect('a', 'ALPHA');
  queue.connect('b', 'BRAVO');
  queue.join('a', 'ALPHA', 3);
  queue.join('b', 'BRAVO', 9);

  assert.equal(queue.activeId(), 'a');
  assert.equal(queue.positionOf('b'), 2);
  assert.deepEqual(queue.activeRequest(), {
    id: 'a',
    label: 'ALPHA',
    requestedCoins: 3,
  });
  assert.deepEqual(queue.publicQueue().map((player) => ({ id: player.id, coins: player.requestedCoins })), [
    { id: 'a', coins: 3 },
    { id: 'b', coins: 9 },
  ]);

  queue.completeTurn();
  assert.equal(queue.activeId(), 'b');
  assert.equal(queue.isQueued('a'), false);
  assert.equal(queue.activeRequest().requestedCoins, 9);

  queue.completeTurn();
  assert.equal(queue.activeId(), null);
  assert.equal(queue.isQueued('b'), false);

  now += 25_000;
  queue.disconnect('a');
  now += 25_000;
  queue.prune({ preserveActive: false });
  assert.equal(queue.getPlayer('a'), null);
});

test('polling keeps a queued player connected when the live stream drops', () => {
  let now = 1_000;
  const queue = new PlayerQueue({ disconnectGraceMs: 20_000, now: () => now });
  queue.connect('a', 'ALPHA');
  queue.join('a', 'ALPHA', 5);
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
