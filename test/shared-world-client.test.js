import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedWorldClient } from '../src/network/shared-world-client.js';

function snapshot(revision) {
  return {
    kind: 'yes-pusher-shared-world',
    authoritative: true,
    revision,
    coins: [],
    coinCount: 0,
    pusherZ: 0,
    turn: { state: 'ready' },
  };
}

test('client falls back to world polling when the live stream fails', async (t) => {
  const originalFetch = globalThis.fetch;
  let worldRequests = 0;
  const connectionModes = [];
  const revisions = [];

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.startsWith('/events?')) {
      return new Response(JSON.stringify({ error: 'stream unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (value.startsWith('/api/world?')) {
      worldRequests += 1;
      return new Response(JSON.stringify(snapshot(worldRequests)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected request: ${value}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new SharedWorldClient({
    pollIntervalMs: 10,
    hiddenPollIntervalMs: 10,
    onSnapshot: (value) => revisions.push(value.revision),
    onConnection: (state) => {
      if (state.connected) connectionModes.push(state.mode);
    },
  });
  t.after(() => client.close());

  await client.connect({ retries: 1, timeoutMs: 100 });
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.ok(worldRequests >= 2);
  assert.ok(revisions.some((revision) => revision >= 2));
  assert.equal(client.connected, true);
  assert.equal(client.connectionMode, 'polling');
  assert.ok(connectionModes.includes('polling'));
});
