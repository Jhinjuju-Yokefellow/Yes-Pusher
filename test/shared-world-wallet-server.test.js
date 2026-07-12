import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { createWorldServer } from '../apps/world-server/server.js';

const PRIVATE_KEY = '0x8b3a350cf5c34c9194ca3a545d596a9c3a60bb48b0c48e32bb8b81dd61a1c04b';

async function jsonRequest(base, pathname, {
  method = 'GET',
  body = null,
  cookie = '',
  bearer = '',
  origin = '',
} = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json(),
    setCookie: response.headers.get('set-cookie'),
  };
}

test('wallet-required server rejects unsigned control and accepts a verified wallet session', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yes-pusher-wallet-world-'));
  const instance = await createWorldServer({ port: 0, host: '127.0.0.1', dataDir, requireWallet: true });
  t.after(async () => {
    await instance.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${instance.address().port}`;
  const denied = await jsonRequest(base, '/api/queue/join', {
    method: 'POST',
    body: { playerId: 'unsigned-player', label: 'UNSIGNED' },
  });
  assert.equal(denied.status, 401);

  const account = privateKeyToAccount(PRIVATE_KEY);
  const challenge = await jsonRequest(base, '/api/auth/challenge', {
    method: 'POST',
    body: { wallet: account.address, chainId: 8453 },
  });
  assert.equal(challenge.status, 200);
  const signature = await account.signMessage({ message: challenge.body.message });
  const verified = await jsonRequest(base, '/api/auth/verify', {
    method: 'POST',
    body: {
      challengeId: challenge.body.challengeId,
      wallet: account.address,
      signature,
    },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.authenticated, true);
  const cookie = verified.setCookie.split(';', 1)[0];

  const world = await jsonRequest(base, '/api/world?playerId=wallet%3A0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { cookie });
  assert.equal(world.body.self.authenticated, true);
  assert.equal(world.body.self.wallet, account.address.toLowerCase());
  assert.equal(world.body.self.id, `wallet:${account.address.toLowerCase()}`);

  const joined = await jsonRequest(base, '/api/queue/join', {
    method: 'POST',
    cookie,
    body: {},
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.snapshot.self.isActive, true);

  const started = await jsonRequest(base, '/api/turn/start', {
    method: 'POST',
    cookie,
    body: { coins: 2 },
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.turn.playerId, `wallet:${account.address.toLowerCase()}`);
});

test('unsigned wallet-prefixed query id is downgraded to a guest identity', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yes-pusher-guest-world-'));
  const instance = await createWorldServer({ port: 0, host: '127.0.0.1', dataDir, requireWallet: false });
  t.after(async () => {
    await instance.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${instance.address().port}`;
  const world = await jsonRequest(base, '/api/world?playerId=wallet%3A0x1111111111111111111111111111111111111111');
  assert.equal(world.body.self.authenticated, false);
  assert.match(world.body.self.id, /^guest:/);
  assert.equal(world.body.self.wallet, null);
});


test('hosted frontend can authenticate with a bearer session and disallowed origins are rejected', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yes-pusher-hosted-world-'));
  const allowedOrigin = 'https://yes-pusher-test.vercel.app';
  const instance = await createWorldServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    requireWallet: true,
    allowedOrigins: new Set([allowedOrigin]),
  });
  t.after(async () => {
    await instance.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${instance.address().port}`;
  const blocked = await jsonRequest(base, '/api/health', { origin: 'https://evil.example' });
  assert.equal(blocked.status, 403);

  const account = privateKeyToAccount(PRIVATE_KEY);
  const challenge = await jsonRequest(base, '/api/auth/challenge', {
    method: 'POST',
    origin: allowedOrigin,
    body: { wallet: account.address, chainId: 8453 },
  });
  assert.equal(challenge.status, 200);
  assert.match(challenge.body.message, /yes-pusher-test\.vercel\.app/);
  const signature = await account.signMessage({ message: challenge.body.message });
  const verified = await jsonRequest(base, '/api/auth/verify', {
    method: 'POST',
    origin: allowedOrigin,
    body: {
      challengeId: challenge.body.challengeId,
      wallet: account.address,
      signature,
    },
  });
  assert.equal(verified.status, 200);
  assert.ok(verified.body.sessionToken);
  assert.match(verified.setCookie, /SameSite=None/);

  const session = await jsonRequest(base, '/api/auth/session', {
    origin: allowedOrigin,
    bearer: verified.body.sessionToken,
  });
  assert.equal(session.status, 200);
  assert.equal(session.body.authenticated, true);

  const joined = await jsonRequest(base, '/api/queue/join', {
    method: 'POST',
    origin: allowedOrigin,
    bearer: verified.body.sessionToken,
    body: {},
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.snapshot.self.authenticated, true);
});
