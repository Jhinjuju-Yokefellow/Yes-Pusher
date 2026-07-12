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


test('initial snapshot failure keeps recovery polling alive until Railway responds', async (t) => {
  const originalFetch = globalThis.fetch;
  let worldRequests = 0;
  let streamRequests = 0;
  const revisions = [];
  const credentialModes = [];

  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    credentialModes.push(options.credentials);
    if (value.startsWith('/events?')) {
      streamRequests += 1;
      return new Response(JSON.stringify({ error: 'stream waking' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (value.startsWith('/api/world?')) {
      worldRequests += 1;
      if (worldRequests < 3) throw new Error('temporary Railway wake-up');
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
  });
  t.after(() => client.close());

  await assert.rejects(() => client.connect({ retries: 1, timeoutMs: 100 }));
  await new Promise((resolve) => setTimeout(resolve, 90));

  assert.ok(worldRequests >= 3);
  assert.ok(streamRequests >= 1);
  assert.equal(client.connected, true);
  assert.equal(client.connectionMode, 'polling');
  assert.ok(revisions.length >= 1);
  assert.ok(credentialModes.every((mode) => mode === 'omit'));
});
