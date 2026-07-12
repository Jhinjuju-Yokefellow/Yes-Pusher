import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import {
  WALLET_SESSION_COOKIE,
  WalletAuthStore,
  parseCookies,
  sessionCookie,
  walletPlayerId,
} from '../apps/world-server/wallet-auth.js';

const PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

test('wallet challenge verifies once and creates an expiring player session', async () => {
  let now = Date.UTC(2026, 6, 11, 12, 0, 0);
  const account = privateKeyToAccount(PRIVATE_KEY);
  const store = new WalletAuthStore({
    now: () => now,
    challengeTtlMs: 5_000,
    sessionTtlMs: 10_000,
  });
  const origin = 'https://pusher.example';
  const challenge = store.createChallenge({
    wallet: account.address,
    origin,
    chainId: 8453,
  });

  assert.match(challenge.message, /does not spend YES or submit a transaction/i);
  const signature = await account.signMessage({ message: challenge.message });
  const session = await store.verifyChallenge({
    challengeId: challenge.challengeId,
    wallet: account.address,
    signature,
    origin,
  });

  assert.equal(session.wallet, account.address.toLowerCase());
  assert.equal(session.playerId, walletPlayerId(account.address));
  assert.equal(store.readSessionToken(session.token)?.playerId, session.playerId);
  await assert.rejects(
    store.verifyChallenge({
      challengeId: challenge.challengeId,
      wallet: account.address,
      signature,
      origin,
    }),
    /missing or already used/i,
  );

  const cookie = sessionCookie(session.token);
  assert.equal(parseCookies(cookie)[WALLET_SESSION_COOKIE], session.token);
  now += 10_001;
  assert.equal(store.readSessionToken(session.token), null);
});

test('wallet challenge rejects another origin and expires before signing', async () => {
  let now = 1_000;
  const account = privateKeyToAccount(PRIVATE_KEY);
  const store = new WalletAuthStore({ now: () => now, challengeTtlMs: 50 });
  const challenge = store.createChallenge({ wallet: account.address, origin: 'https://one.example' });
  const signature = await account.signMessage({ message: challenge.message });

  await assert.rejects(
    store.verifyChallenge({
      challengeId: challenge.challengeId,
      wallet: account.address,
      signature,
      origin: 'https://two.example',
    }),
    /origin does not match/i,
  );

  now += 51;
  await assert.rejects(
    store.verifyChallenge({
      challengeId: challenge.challengeId,
      wallet: account.address,
      signature,
      origin: 'https://one.example',
    }),
    /expired|missing/i,
  );
});
