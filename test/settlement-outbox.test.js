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
    assignedSkinMilestoneNumber: null,
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
    eventType: 'coin_drop_completed',
    skinDropTriggerKey: 'coin_pusher.random_skin_drop',
    skinDropOfferingName: 'Random Coin Skin Drop',
    eventSubmissionEnabled: false,
    creditSubmissionEnabled: false,
    ...overrides,
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('settlement configuration derives the real bucket-credit route from the SDK base URL', () => {
  const value = settlementConfigFromEnv({
    YF_API_BASE_URL: 'https://yf.example/api/sdk/v1',
    YF_APP_KEY: 'secret',
    YF_BUCKET_ID: 'bucket-1',
  });
  assert.equal(value.creditGrantUrl, 'https://yf.example/api/sdk/v1/buckets/bucket-1/credit-grants');
  assert.equal(value.creditSubmissionEnabled, true);
  assert.equal(value.eventType, 'coin_drop_completed');
});

test('record-only settlement does not claim YES was credited', () => {
  const outbox = new SettlementOutbox(null, { config: config(), fetchImpl: null });
  const record = outbox.enqueue(result());
  assert.equal(record.creditStatus, 'recorded');
  assert.equal(outbox.viewForPlayer(record.playerId).recordedOwedYesRaw, '3000000000000000000');
});

test('configured outbox sends bucket credit to the derived SDK route with a stable idempotency key', async () => {
  const calls = [];
  const outbox = new SettlementOutbox(null, {
    config: config({
      apiBaseUrl: 'https://yf.example/api/sdk/v1',
      appKey: 'secret',
      bucketId: 'bucket-1',
      creditGrantUrl: 'https://yf.example/api/sdk/v1/buckets/bucket-1/credit-grants',
      creditSubmissionEnabled: true,
      eventSubmissionEnabled: true,
    }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return response({ ok: true, grantId: 'grant-1' });
    },
  });
  outbox.enqueue(result());
  assert.equal(await outbox.process(), true);
  const record = outbox.get('turn-10');
  assert.equal(record.creditStatus, 'confirmed');
  assert.equal(record.eventStatus, 'not_required');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://yf.example/api/sdk/v1/buckets/bucket-1/credit-grants');
  assert.equal(calls[0].init.headers['x-idempotency-key'], 'yes-pusher:turn:turn-10');
  assert.equal(calls[0].body.amountYesRaw, '3000000000000000000');
});

test('skin milestone uses the authorized coin_drop_completed event while preserving the exact offering trigger in metadata', async () => {
  const calls = [];
  const outbox = new SettlementOutbox(null, {
    config: config({
      apiBaseUrl: 'https://yf.example/api/sdk/v1',
      appKey: 'secret',
      bucketId: 'bucket-1',
      eventSubmissionEnabled: true,
    }),
    fetchImpl: async (url, init) => {
      if (init.method === 'GET') return response({
        ok: true,
        offerings: [{ title: 'Random Coin Skin Drop', outputs: [{ id: 'output-1', itemClassId: 'class-1', label: 'Rubber Duck' }] }],
        classes: [{ id: 'class-1', slug: 'yes_drop.rubber_duck', name: 'Rubber Duck' }],
      });
      const body = JSON.parse(init.body);
      calls.push({ url, init, body });
      return response({
        ok: true,
        results: [{ matched: true, offeringId: 'offer-1', resultType: 'mint_queued', selectedOutputId: 'output-1', classId: 'class-1', mintJobId: 'job-1' }],
      });
    },
  });

  outbox.enqueue(result({
    lifetimeCoinsWon: 50,
    skinDropEarned: 1,
    assignedSkinMilestoneNumber: 1,
    coinsWon: 0,
  }));
  await outbox.process();
  const call = calls[0];
  assert.equal(call.body.eventType, 'coin_drop_completed');
  assert.equal(call.body.meta.triggerKey, 'coin_pusher.random_skin_drop');
  assert.equal(call.init.headers['x-idempotency-key'], 'yes-pusher:skin-drop:0x1111111111111111111111111111111111111111:milestone:1:event');
  const record = outbox.get('turn-10');
  assert.equal(record.skinDropStatus, 'submitted');
  assert.equal(record.skinDropSelection.selectedClassId, 'class-1');
  assert.equal(record.skinDropSelection.outputKey, 'yes_drop.rubber_duck');
  assert.equal(record.skinProgressConfirmed, false);
});

test('failed skin drop exposes the exact Yokefellow error and only retries explicitly with the same key', async () => {
  const calls = [];
  let fail = true;
  const outbox = new SettlementOutbox(null, {
    config: config({
      apiBaseUrl: 'https://yf.example/api/sdk/v1',
      appKey: 'secret',
      bucketId: 'bucket-1',
      eventSubmissionEnabled: true,
    }),
    fetchImpl: async (_url, init) => {
      calls.push(init.headers['x-idempotency-key']);
      if (fail) return response({ ok: false, error: { message: 'This app connection is not allowed to submit that event type.' } }, 403);
      return response({ ok: true, results: [{ matched: true, offeringId: 'offer-1', resultType: 'mint_queued', selectedOutputId: 'output-1', classId: 'class-1', mintJobId: 'job-1' }] });
    },
  });

  outbox.enqueue(result({ skinDropEarned: 1, assignedSkinMilestoneNumber: 1, coinsWon: 0 }));
  await outbox.process();
  const failed = outbox.get('turn-10');
  assert.equal(failed.skinDropStatus, 'failed');
  assert.equal(failed.skinDropError, 'This app connection is not allowed to submit that event type.');
  assert.equal(outbox.retryFailed(), false);
  assert.equal(outbox.get('turn-10').skinDropStatus, 'failed');

  fail = false;
  assert.equal(outbox.retryFailedSkinDropsForPlayer(failed.playerId), true);
  await outbox.process();
  assert.equal(outbox.get('turn-10').skinDropStatus, 'submitted');
  const idempotencyKeys = calls.filter(Boolean);
  assert.deepEqual(idempotencyKeys, [idempotencyKeys[0], idempotencyKeys[0]]);
});

test('successful skin records are confirmed exactly once by the progress reconciliation handoff', async () => {
  const outbox = new SettlementOutbox(null, {
    config: config({ apiBaseUrl: 'https://yf.example/api/sdk/v1', appKey: 'secret', bucketId: 'bucket-1', eventSubmissionEnabled: true }),
    fetchImpl: async () => response({ ok: true, results: [{ matched: true, offeringId: 'offer-1', resultType: 'mint_queued', selectedOutputId: 'output-1', classId: 'class-1' }] }),
  });
  outbox.enqueue(result({ skinDropEarned: 1, assignedSkinMilestoneNumber: 1, coinsWon: 0 }));
  await outbox.process();
  assert.equal(outbox.recordsAwaitingSkinProgressConfirmation().length, 1);
  assert.equal(outbox.markSkinProgressConfirmed('turn-10'), true);
  assert.equal(outbox.markSkinProgressConfirmed('turn-10'), false);
  assert.equal(outbox.recordsAwaitingSkinProgressConfirmation().length, 0);
  assert.equal(outbox.serialize().version, 3);
});
