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

async function waitForWorld(base, predicate, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const world = await fetch(`${base}/api/world?playerId=one`).then((response) => response.json());
    if (predicate(world)) return world;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for shared-world state');
}

test('server prepares one authoritative simulation and publishes a stored replay package', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yes-pusher-world-'));
  const instance = await createWorldServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    requireWallet: false,
    replayFrameRate: 8,
  });
  t.after(async () => {
    await instance.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const address = instance.address();
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.network.clientVisualMode, 'recorded-authoritative-replay-with-interpolation');
  assert.equal(health.network.visibleCoinPhysicsRunsInBrowser, false);
  assert.equal(health.network.replayPackageDownload, true);

  const idleBefore = await fetch(`${base}/api/world`).then((response) => response.json());
  await new Promise((resolve) => setTimeout(resolve, 90));
  const idleAfter = await fetch(`${base}/api/world`).then((response) => response.json());
  assert.equal(idleAfter.pusherTime, idleBefore.pusherTime);
  assert.equal(idleAfter.syncMode, 'boundary');

  const firstDrop = await post(base, '/api/queue/join', {
    playerId: 'one',
    label: 'PLAYER ONE',
    coins: 4,
  });
  assert.equal(firstDrop.status, 200);
  assert.equal(firstDrop.body.turn.playerId, 'one');
  assert.equal(firstDrop.body.turn.coinsDropped, 4);
  assert.equal(firstDrop.body.snapshot.syncMode, 'preparing');
  assert.equal(firstDrop.body.snapshot.turn.state, 'preparing');
  assert.equal(firstDrop.body.snapshot.prepare.turnId, firstDrop.body.turn.id);

  const secondDrop = await post(base, '/api/queue/join', {
    playerId: 'two',
    label: 'PLAYER TWO',
    coins: 7,
  });
  assert.equal(secondDrop.status, 200);

  const denied = await post(base, '/api/turn/start', { playerId: 'two', coins: 4 });
  assert.equal(denied.status, 403);

  const replayWorld = await waitForWorld(base, (world) => world.syncMode === 'recorded-replay');
  assert.equal(replayWorld.activePlayerId, 'one');
  assert.equal(replayWorld.replay.turnId, firstDrop.body.turn.id);
  assert.equal(replayWorld.replay.durationSeconds > 30, true);
  assert.deepEqual(replayWorld.queue.map((entry) => [entry.id, entry.requestedCoins]), [
    ['one', 4],
    ['two', 7],
  ]);
  assert.deepEqual(replayWorld.coins[0], idleBefore.coins[0]);

  const packageResponse = await fetch(`${base}${replayWorld.replay.packageUrl}`);
  assert.equal(packageResponse.status, 200);
  const replayPackage = await packageResponse.json();
  assert.equal(replayPackage.kind, 'yes-pusher-recorded-replay');
  assert.equal(replayPackage.id, replayWorld.replay.turnId);
  assert.equal(replayPackage.turn.playerId, 'one');
  assert.equal(replayPackage.turn.coinsDropped, 4);
  assert.equal(replayPackage.frames.length > 100, true);
  assert.equal(Array.isArray(replayPackage.events), true);
  assert.equal(replayPackage.events.every((event) => typeof event.coinId === 'string'), true);
  assert.equal(replayPackage.finalWorld.kind, 'yes-pusher-confirmed-world');
});

test('active replay survives restart and its recorded final world becomes the next boundary', async (t) => {
  const { readFile, writeFile } = await import('node:fs/promises');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yes-pusher-restart-'));
  const first = await createWorldServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    requireWallet: false,
    replayFrameRate: 5,
  });
  const firstBase = `http://127.0.0.1:${first.address().port}`;
  const joined = await post(firstBase, '/api/queue/join', {
    playerId: 'one',
    label: 'PLAYER ONE',
    coins: 1,
  });
  const active = await waitForWorld(firstBase, (world) => world.syncMode === 'recorded-replay');
  const replayPackage = await fetch(`${firstBase}${active.replay.packageUrl}`).then((response) => response.json());
  await first.close();

  const activeReplayPath = path.join(dataDir, 'active-replay.json');
  const activePointer = JSON.parse(await readFile(activeReplayPath, 'utf8'));
  activePointer.startedAt = Date.now() - Math.ceil((replayPackage.durationSeconds + 1) * 1000);
  await writeFile(activeReplayPath, `${JSON.stringify(activePointer)}\n`, 'utf8');

  const second = await createWorldServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    requireWallet: false,
    replayFrameRate: 5,
  });
  t.after(async () => {
    await second.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const secondBase = `http://127.0.0.1:${second.address().port}`;
  const committed = await fetch(`${secondBase}/api/world?playerId=one`).then((response) => response.json());

  assert.equal(committed.syncMode, 'boundary');
  assert.equal(committed.queue.length, 0);
  assert.equal(committed.turn.lastResult.id, joined.body.turn.id);
  assert.equal(committed.turn.lastResult.coinsWon, replayPackage.result.coinsWon);
  assert.equal(committed.coinCount, replayPackage.finalWorld.coins.length);
  assert.equal(committed.boundaryId, 'boundary-2');
});
