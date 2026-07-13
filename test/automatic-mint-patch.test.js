import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementOutbox } from '../apps/world-server/settlement-outbox.js';
import '../apps/world-server/automatic-mint-patch.js';

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

function submittedRecord() {
  return {
    id: 'turn-1',
    skinDropExternalRef: 'yes-pusher:skin:1',
    skinDropStatus: 'submitted',
    skinDropEarned: 1,
    creditStatus: 'no_payout',
    nextAttemptAtMs: 0,
    skinDropSelection: {
      mintJobId: 'job-1',
      mintId: null,
    },
    updatedAt: new Date(0).toISOString(),
  };
}

test('queued earned NFT is automatically minted and replaces its queue marker', async () => {
  const requests = [];
  const outbox = new SettlementOutbox(null, {
    config: config(),
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        ok: true,
        results: [{ jobId: 'job-1', attempted: true, minted: true, status: 'completed', tokenId: '77', txHash: '0xabc' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    now: () => 1000,
  });
  const record = submittedRecord();
  outbox.records.set(record.id, record);

  assert.equal(await outbox.process(), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://yf.test/api/sdk/v1/queues/mint');
  assert.equal(requests[0].body.jobId, 'job-1');
  assert.equal(record.skinDropSelection.mintJobId, null);
  assert.equal(record.skinDropSelection.mintId, '77');
  assert.equal(record.skinDropSelection.mintStatus, 'completed');
  assert.equal(record.skinDropSelection.mintTxHash, '0xabc');
});

test('automatic mint failure preserves the operator queue fallback without repeated attempts', async () => {
  let calls = 0;
  const outbox = new SettlementOutbox(null, {
    config: config(),
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        ok: true,
        results: [{ jobId: 'job-1', attempted: true, minted: false, status: 'queued', error: 'issuer not approved' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    now: () => 1000,
  });
  const record = submittedRecord();
  outbox.records.set(record.id, record);

  assert.equal(await outbox.process(), true);
  assert.equal(await outbox.process(), false);
  assert.equal(calls, 1);
  assert.equal(record.skinDropSelection.mintJobId, 'job-1');
  assert.equal(record.skinDropSelection.mintId, null);
  assert.equal(record.skinDropSelection.automaticMintError, 'issuer not approved');
});
