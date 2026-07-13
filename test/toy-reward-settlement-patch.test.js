import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementOutbox } from '../apps/world-server/settlement-outbox.js';
import '../apps/world-server/toy-reward-settlement-patch.js';

function config() {
  return {
    apiBaseUrl: 'https://yf.test/api/sdk/v1',
    appKey: 'app-key',
    bucketId: 'bucket-1',
    creditGrantUrl: '',
    yesPerCoinRaw: '1000000000000000000',
    appSlug: 'yes-pusher',
    eventType: 'coin_drop_completed',
    skinDropTriggerKey: 'coin_pusher.random_skin_drop',
    skinDropOfferingName: 'Random Coin Skin Drop',
    eventSubmissionEnabled: true,
    creditSubmissionEnabled: false,
  };
}

test('Rubber Duck payout selects the exact toy output and automatically mints it', async () => {
  const requests = [];
  const outbox = new SettlementOutbox(null, {
    config: config(),
    now: () => 1000,
    fetchImpl: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url, method: options.method, body });
      if (url.endsWith('/catalog')) {
        return new Response(JSON.stringify({
          ok: true,
          classes: [{
            id: 'class-duck-small',
            slug: 'yes_pusher.toy.rubber_duck.small',
            name: 'Rubber Duck Toy — Small',
            metadataTemplate: { classKey: 'yes_pusher.toy.rubber_duck.small' },
          }],
          offerings: [{
            id: 'offering-toys',
            title: 'YES Pusher Toy Rewards',
            status: 'live',
            active: true,
            mode: 'earned',
            meta: { appBindingKey: 'coin_pusher.toy_knocked_off' },
            outputs: [{ id: 'output-duck-small', itemClassId: 'class-duck-small' }],
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/offering-events')) {
        return new Response(JSON.stringify({
          ok: true,
          results: [{
            matched: true,
            offeringId: 'offering-toys',
            selectedOutputId: 'output-duck-small',
            classId: 'class-duck-small',
            resultType: 'mint_queued',
            mintJobId: 'job-duck-1',
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/queues/mint')) {
        return new Response(JSON.stringify({
          ok: true,
          results: [{
            jobId: 'job-duck-1',
            attempted: true,
            minted: true,
            status: 'completed',
            tokenId: '301',
            txHash: '0xduck',
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  const record = outbox.enqueue({
    id: 'turn-duck-win',
    playerId: 'wallet:0x50e2b2f2be3c8c444c89263275e5a8d26c473357',
    number: 9,
    coinsDropped: 10,
    coinsWon: 0,
    coinsLost: 0,
    lifetimeCoinsWon: 181,
    toyPayouts: [{
      toyId: 'toy-rubber-duck-demo',
      toyKey: 'rubber_duck',
      turnId: 'turn-duck-win',
      playerId: 'wallet:0x50e2b2f2be3c8c444c89263275e5a8d26c473357',
      at: 34.2,
      position: [0.25, 1.2, 4.1],
    }],
  });

  assert.equal(record.toyRewards.length, 1);
  assert.equal(record.toyRewards[0].status, 'pending');
  assert.equal(await outbox.process(), true);

  const saved = outbox.get('turn-duck-win');
  const reward = saved.toyRewards[0];
  assert.equal(reward.status, 'issued');
  assert.equal(reward.selection.selectedOutputId, 'output-duck-small');
  assert.equal(reward.selection.selectedClassId, 'class-duck-small');
  assert.equal(reward.selection.mintId, '301');
  assert.equal(reward.selection.mintTxHash, '0xduck');

  const eventRequest = requests.find((request) => request.url.endsWith('/offering-events'));
  assert.equal(eventRequest.body.offeringId, 'offering-toys');
  assert.equal(eventRequest.body.selectedOutputId, 'output-duck-small');
  assert.equal(eventRequest.body.meta.resultKey, 'yes_pusher.toy.rubber_duck.small');
});
