import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAuthoritativeRebuildServer } from '../src/rebuild/server/authoritative-server.js';

async function readFirstNamedEvent(response, eventName) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + 2_000;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      for (const block of text.split('\n\n')) {
        if (!block.includes(`event: ${eventName}`)) continue;
        const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
        if (dataLine) return JSON.parse(dataLine.slice(6));
      }
    }
  } finally {
    await reader.cancel().catch(() => null);
  }
  throw new Error(`SSE event ${eventName} was not received`);
}

test('one Railway process serves the rebuild client and accepts DROP immediately', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yes-pusher-rebuild-'));
  const staticDir = path.join(root, 'dist');
  const dataDir = path.join(root, 'data');
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, 'rebuild.html'), '<!doctype html><title>rebuild-marker</title>', 'utf8');

  const instance = await createAuthoritativeRebuildServer({
    host: '127.0.0.1',
    port: 0,
    staticDir,
    dataDir,
    seedMachine: false,
    persistenceSeconds: 60,
  });
  const address = instance.address();
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /rebuild-marker/);

    const startedAt = performance.now();
    const drop = await fetch(`${origin}/api/rebuild/drop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'server-play-1',
        playerId: 'browser-player-1',
        coins: 3,
        visualKey: 'yes_drop.cucumber_slice',
      }),
    });
    const elapsedMs = performance.now() - startedAt;
    const accepted = await drop.json();

    assert.equal(drop.status, 202);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.play.id, 'server-play-1');
    assert.equal(accepted.activePlay.id, 'server-play-1');
    assert.ok(elapsedMs < 500, `DROP acknowledgement took ${elapsedMs.toFixed(1)} ms`);

    const state = await fetch(`${origin}/api/rebuild/state`).then((response) => response.json());
    assert.equal(state.protocol, 1);
    assert.equal(state.activePlay.id, 'server-play-1');
    assert.equal(state.objects[0].visualKey, 'yes_drop.cucumber_slice');
    assert.equal(JSON.stringify(state).includes('imageUrl'), false);

    const stream = await fetch(`${origin}/api/rebuild/events`);
    assert.equal(stream.status, 200);
    const boundary = await readFirstNamedEvent(stream, 'boundary');
    assert.equal(boundary.protocol, 1);
    assert.equal(boundary.activePlay.id, 'server-play-1');
  } finally {
    await instance.close();
  }
});
