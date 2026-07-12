import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorldServer } from '../apps/world-server/server.js';

test('world server writes and restores the confirmed machine from disk', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yes-pusher-persist-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const first = await createWorldServer({ port: 0, host: '127.0.0.1', dataDir });
  const before = first.publicSnapshot();
  await first.close();

  const stored = JSON.parse(await readFile(path.join(dataDir, 'confirmed-world.json'), 'utf8'));
  assert.equal(stored.kind, 'yes-pusher-confirmed-world');
  assert.equal(stored.coins.length, before.coinCount);

  const second = await createWorldServer({ port: 0, host: '127.0.0.1', dataDir });
  const after = second.publicSnapshot();
  await second.close();

  assert.equal(after.coinCount, before.coinCount);
  assert.ok(Math.abs(after.pusherTime - stored.pusherTime) < 0.25);
  assert.deepEqual(after.coins[0].position, before.coins[0].position);
});
