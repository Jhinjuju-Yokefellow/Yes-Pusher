import test from 'node:test';
import assert from 'node:assert/strict';
import '../apps/world-server/direct-offering-resolution-patch.js';
import { SettlementOutbox } from '../apps/world-server/settlement-outbox.js';

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('skin drop resolves the exact catalog offering and submits its offering id', async () => {
  const calls = [];
  const outbox = new SettlementOutbox(null, {
    config: {
      apiBaseUrl: 'https://yf.example/api/sdk/v1',
      appKey: 'secret',
      bucketId: 'bucket-1',
      creditGrantUrl: '',
      yesPerCoinRaw: '1',
      appSlug: 'yes-pusher',
      eventType: 'coin_drop_completed',
      skinDropTriggerKey: 'coin_pusher.random_skin_drop',
      skinDropOfferingName: 'Random Coin Skin Drop',
      eventSubmissionEnabled: true,
      creditSubmissionEnabled: false,
    },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (init.method === 'GET') {
        return response({
          ok: true,
          offerings: [{
            id: 'offering-1',
            title: 'Random Coin Skin Drop',
            status: 'live',
            active: true,
            mode: 'earned',
            meta: { appBindingKey: 'coin_pusher.random_skin_drop' },
            outputs: [{ id: 'output-1', itemClassId: 'class-1' }],
          }],
          classes: [{ id: 'class-1', name: 'Rubber Duck', slug: 'yes_drop.rubber_duck' }],
        });
      }
      const body = JSON.parse(init.body);
      assert.equal(body.offeringId, 'offering-1');
      return response({
        ok: true,
        results: [{
          matched: true,
          offeringId: 'offering-1',
          selectedOutputId: 'output-1',
          classId: 'class-1',
          resultType: 'mint_queued',
          mintJobId: 'job-1',
        }],
      });
    },
  });

  outbox.enqueue({
    id: 'turn-50',
    playerId: 'wallet:0x1111111111111111111111111111111111111111',
    number: 50,
    coinsDropped: 5,
    coinsWon: 0,
    coinsLost: 0,
    lifetimeCoinsWon: 50,
    skinDropEarned: 1,
    assignedSkinMilestoneNumber: 1,
  });

  await outbox.process();
  const record = outbox.get('turn-50');
  assert.equal(record.skinDropStatus, 'submitted');
  assert.equal(record.skinDropSelection.offeringId, 'offering-1');
  const post = calls.find((call) => call.init.method === 'POST');
  assert.equal(JSON.parse(post.init.body).meta.resolvedOfferingId, 'offering-1');
});

test('skin drop reports the exact offering configuration problem before submitting', async () => {
  const outbox = new SettlementOutbox(null, {
    config: {
      apiBaseUrl: 'https://yf.example/api/sdk/v1',
      appKey: 'secret',
      bucketId: 'bucket-1',
      creditGrantUrl: '',
      yesPerCoinRaw: '1',
      appSlug: 'yes-pusher',
      eventType: 'coin_drop_completed',
      skinDropTriggerKey: 'coin_pusher.random_skin_drop',
      skinDropOfferingName: 'Random Coin Skin Drop',
      eventSubmissionEnabled: true,
      creditSubmissionEnabled: false,
    },
    fetchImpl: async () => response({
      ok: true,
      offerings: [{ id: 'offering-1', title: 'Random Coin Skin Drop', status: 'draft', active: false, mode: 'earned', meta: {} }],
      classes: [],
    }),
  });

  outbox.enqueue({
    id: 'turn-50',
    playerId: 'wallet:0x1111111111111111111111111111111111111111',
    number: 50,
    coinsDropped: 5,
    coinsWon: 0,
    coinsLost: 0,
    lifetimeCoinsWon: 50,
    skinDropEarned: 1,
    assignedSkinMilestoneNumber: 1,
  });

  await outbox.process();
  const record = outbox.get('turn-50');
  assert.equal(record.skinDropStatus, 'failed');
  assert.equal(record.skinDropError, 'Random Coin Skin Drop is not live.');
});
