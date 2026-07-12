import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorldServer } from '../apps/world-server/server.js';

async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('server exposes one world and allows only the active queued player to start', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yes-pusher-world-'));
  const instance = await createWorldServer({ port: 0, host: '127.0.0.1', dataDir, requireWallet: false });
  t.after(async () => {
    await instance.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const address = instance.address();
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.authoritative, true);
  assert.equal(health.coinCount, 121);

  const idleBefore = await fetch(`${base}/api/world`).then((response) => response.json());
  await new Promise((resolve) => setTimeout(resolve, 90));
  const idleAfter = await fetch(`${base}/api/world`).then((response) => response.json());
  assert.ok(idleAfter.pusherTime > idleBefore.pusherTime);

  const firstDrop = await post(base, '/api/queue/join', {
    playerId: 'one',
    label: 'PLAYER ONE',
    coins: 4,
  });
  assert.equal(firstDrop.status, 200);
  assert.equal(firstDrop.body.turn.playerId, 'one');
  assert.equal(firstDrop.body.turn.coinsDropped, 4);
  assert.equal(firstDrop.body.snapshot.turn.activeSecondsRemaining, 30);

  const secondDrop = await post(base, '/api/queue/join', {
    playerId: 'two',
    label: 'PLAYER TWO',
    coins: 7,
  });
  assert.equal(secondDrop.status, 200);
  const world = await fetch(`${base}/api/world?playerId=one`).then((response) => response.json());
  assert.equal(world.activePlayerId, 'one');
  assert.deepEqual(world.queue.map((entry) => [entry.id, entry.requestedCoins]), [
    ['one', 4],
    ['two', 7],
  ]);

  const denied = await post(base, '/api/turn/start', { playerId: 'two', coins: 4 });
  assert.equal(denied.status, 403);

  const runningBefore = firstDrop.body.snapshot.pusherTime;
  await new Promise((resolve) => setTimeout(resolve, 90));
  const runningAfter = await fetch(`${base}/api/world`).then((response) => response.json());
  assert.ok(runningAfter.pusherTime > runningBefore);
  assert.ok(runningAfter.turn.activeSecondsRemaining < 30);
  assert.equal(runningAfter.turn.state, 'dropping');
});
