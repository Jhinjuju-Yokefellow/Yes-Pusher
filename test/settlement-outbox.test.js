import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementOutbox, settlementConfigFromEnv } from '../apps/world-server/settlement-outbox.js';

function result(overrides = {}) {
  return {
    id: 'turn-10',
    playerId: 'wallet:0x1111111111111111111111111111111111111111',
    number: 10,
    coinsDropped: 5,
    coinsWon: 3,
    coinsLost: 2,
    lifetimeCoinsWon: 63,
    skinDropEarned: 0,
    pendingSkinMilestones: 0,
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    apiBaseUrl: '',
    appKey: '',
    bucketId: '',
    creditGrantUrl: '',
    yesPerCoinRaw: '1000000000000000000',
    appSlug: 'yes-pusher',
    eventSubmissionEnabled: false,
    creditSubmissionEnabled: false,
    ...overrides,
  };
}


test('settlement configuration defaults to one YES per coin when the environment value is missing or blank', () => {
  assert.equal(settlementConfigFromEnv({}).yesPerCoinRaw, '1000000000000000000');
  assert.equal(settlementConfigFromEnv({ YES_PUSHER_YES_PER_COIN_RAW: '' }).yesPerCoinRaw, '1000000000000000000');
});

test('settlement outbox records an idempotent owed balance without claiming it was credited', () => {
  const outbox = new SettlementOutbox(null, { config: config(), fetchImpl: null });
  const first = outbox.enqueue(result());
  const duplicate = outbox.enqueue(result({ coinsWon: 99 }));

  assert.equal(first.creditStatus, 'recorded');
  assert.equal(first.amountYesRaw, '3000000000000000000');
  assert.equal(duplicate.amountYesRaw, first.amountYesRaw);
  assert.equal(outbox.serialize().records.length, 1);
  assert.equal(outbox.viewForPlayer(first.playerId).recordedOwedYesRaw, first.amountYesRaw);
  assert.equal(outbox.integrationStatus().payoutMode, 'record-only');
});


test('record-only settlements become pending when the credit integration is configured later', () => {
  const recorded = new SettlementOutbox(null, { config: config(), fetchImpl: null });
  recorded.enqueue(result());
  const restored = new SettlementOutbox(recorded.serialize(), {
    config: config({
      appKey: 'app-secret',
      bucketId: 'bucket-1',
      creditGrantUrl: 'https://yf.example/credit',
      creditSubmissionEnabled: true,
    }),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    now: () => 5_000,
  });
  const value = restored.get('turn-10');
  assert.equal(value.creditStatus, 'pending');
  assert.equal(value.bucketId, 'bucket-1');
  assert.equal(value.nextAttemptAtMs, 5_000);
});

test('configured outbox submits the turn event and YES credit with separate idempotency keys', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, receiptId: `receipt-${calls.length}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const outbox = new SettlementOutbox(null, {
    config: config({
      apiBaseUrl: 'https://yf.example/api/sdk/v1',
      appKey: 'app-secret',
      bucketId: 'bucket-1',
      creditGrantUrl: 'https://yf.example/api/sdk/v1/bucket-credit/grant',
      eventSubmissionEnabled: true,
      creditSubmissionEnabled: true,
    }),
    fetchImpl,
  });
  outbox.enqueue(result());
  assert.equal(await outbox.process(), true);

  const record = outbox.get('turn-10');
  assert.equal(record.eventStatus, 'submitted');
  assert.equal(record.creditStatus, 'confirmed');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /offering-events$/);
  assert.equal(calls[0].init.headers['x-idempotency-key'], 'yes-pusher:turn:turn-10:event');
  assert.equal(calls[1].init.headers['x-idempotency-key'], 'yes-pusher:turn:turn-10');
  assert.equal(calls[1].body.amountYesRaw, '3000000000000000000');
});

test('failed settlement honors exponential backoff before becoming retryable', async () => {
  let now = 1_000;
  let fail = true;
  const fetchImpl = async () => {
    if (fail) return new Response(JSON.stringify({ ok: false, error: 'temporary failure' }), { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const outbox = new SettlementOutbox(null, {
    config: config({
      creditGrantUrl: 'https://yf.example/credit',
      appKey: 'app-secret',
      bucketId: 'bucket-1',
      creditSubmissionEnabled: true,
    }),
    fetchImpl,
    now: () => now,
  });
  outbox.enqueue(result());
  await outbox.process();
  const failed = outbox.get('turn-10');
  assert.equal(failed.creditStatus, 'failed');
  assert.ok(failed.nextAttemptAtMs > now);
  assert.equal(outbox.retryFailed(), false);

  now = failed.nextAttemptAtMs;
  assert.equal(outbox.retryFailed(), true);
  fail = false;
  await outbox.process();
  assert.equal(outbox.get('turn-10').creditStatus, 'confirmed');
});

test('earned milestone submits the exact random skin trigger and lets Yokefellow choose the output', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (init.method === 'GET') {
      calls.push({ url, init, body: null });
      return new Response(JSON.stringify({
        ok: true,
        offerings: [{
          title: 'Random Coin Skin Drop',
          outputs: [{
            id: 'output-1',
            itemClassId: 'class-1',
            label: 'Rubber Duck',
            imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783627385/Rubber_Duck_ze5wif.png',
          }],
        }],
        classes: [{ id: 'class-1', slug: 'yes_drop.rubber_duck', name: 'Rubber Duck' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    if (body.eventType === 'coin_pusher.random_skin_drop') {
      return new Response(JSON.stringify({
        ok: true,
        results: [{
          offeringId: 'offering-random-skin',
          matched: true,
          requestId: 'request-1',
          resultType: 'mint_queued',
          selectionMode: 'random',
          fulfillmentMode: 'auto_mint',
          selectedOutputId: 'output-1',
          selectedClassId: 'class-1',
          mintJobId: 'mint-job-1',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const outbox = new SettlementOutbox(null, {
    config: config({
      apiBaseUrl: 'https://yf.example/api/sdk/v1',
      appKey: 'app-secret',
      bucketId: 'bucket-1',
      skinDropTriggerKey: 'coin_pusher.random_skin_drop',
      skinDropOfferingName: 'Random Coin Skin Drop',
      eventSubmissionEnabled: true,
    }),
    fetchImpl,
  });

  const queued = outbox.enqueue(result({
    lifetimeCoinsWon: 50,
    skinDropEarned: 1,
    resolvedSkinMilestones: 1,
  }));
  assert.equal(queued.skinDropStatus, 'pending');
  assert.equal(await outbox.process(), true);

  const triggerCall = calls.find((call) => call.body.eventType === 'coin_pusher.random_skin_drop');
  assert.ok(triggerCall);
  assert.equal(triggerCall.init.headers['x-idempotency-key'], 'yes-pusher:skin-drop:turn-10:milestone:1:event');
  assert.equal(triggerCall.body.wallet, '0x1111111111111111111111111111111111111111');
  assert.equal(triggerCall.body.metrics.skinDropEarned, 1);
  assert.equal(triggerCall.body.metrics.milestoneNumber, 1);
  assert.equal(triggerCall.body.metrics.lifetimeCoinsWon, 50);
  assert.equal(triggerCall.body.meta.triggerKey, 'coin_pusher.random_skin_drop');
  assert.equal(triggerCall.body.meta.offeringName, 'Random Coin Skin Drop');
  assert.equal('selectedOutputId' in triggerCall.body.meta, false);
  assert.equal('selectedOutputId' in triggerCall.body, false);

  const record = outbox.get('turn-10');
  assert.equal(record.eventStatus, 'submitted');
  assert.equal(record.skinDropStatus, 'submitted');
  assert.equal(record.skinDropSelection.selectedOutputId, 'output-1');
  assert.equal(record.skinDropSelection.outputKey, 'yes_drop.rubber_duck');
  assert.equal(record.skinDropSelection.displayName, 'Rubber Duck');
  assert.equal(record.skinDropSelection.mintJobId, 'mint-job-1');
});

test('skin trigger remains retryable when the Random Coin Skin Drop offering does not match', async () => {
  let now = 1_000;
  const outbox = new SettlementOutbox(null, {
    config: config({
      apiBaseUrl: 'https://yf.example/api/sdk/v1',
      appKey: 'app-secret',
      bucketId: 'bucket-1',
      eventSubmissionEnabled: true,
    }),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        ok: true,
        results: body.eventType === 'coin_pusher.random_skin_drop'
          ? [{ offeringId: 'offering-random-skin', matched: false, resultType: 'no_match', reason: 'event_type_mismatch' }]
          : [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    now: () => now,
  });
  outbox.enqueue(result({ skinDropEarned: 1, resolvedSkinMilestones: 1 }));
  await outbox.process();
  const failed = outbox.get('turn-10');
  assert.equal(failed.skinDropStatus, 'failed');
  assert.equal(failed.eventStatus, 'submitted');
  assert.match(failed.lastError, /did not match trigger coin_pusher\.random_skin_drop/);
  now = failed.nextAttemptAtMs;
  assert.equal(outbox.retryFailed(), true);
  assert.equal(outbox.get('turn-10').skinDropStatus, 'pending');
});

test('legacy earned records gain a durable skin-drop channel when restored', () => {
  const raw = {
    kind: 'yes-pusher-settlement-outbox',
    version: 1,
    records: [{
      ...result({ skinDropEarned: 1, resolvedSkinMilestones: 2 }),
      externalRef: 'yes-pusher:turn:turn-10',
      wallet: '0x1111111111111111111111111111111111111111',
      amountYesRaw: '3000000000000000000',
      creditStatus: 'recorded',
      eventStatus: 'submitted',
      attempts: 0,
      nextAttemptAtMs: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }],
  };
  const restored = new SettlementOutbox(raw, {
    config: config({
      apiBaseUrl: 'https://yf.example/api/sdk/v1',
      appKey: 'app-secret',
      bucketId: 'bucket-1',
      eventSubmissionEnabled: true,
    }),
    fetchImpl: null,
    now: () => 5_000,
  });
  const record = restored.get('turn-10');
  assert.equal(record.skinDropStatus, 'pending');
  assert.equal(record.skinDropExternalRef, 'yes-pusher:skin-drop:turn-10:milestone:2');
  assert.equal(restored.serialize().version, 2);
});
