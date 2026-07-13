import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerProgressStore } from '../apps/world-server/player-progress.js';
import { SettlementOutbox } from '../apps/world-server/settlement-outbox.js';
import { bridge, handleSettlementRetry } from '../apps/world-server/settlement-recovery-patch.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('authenticated manual skin retry confirms the same milestone once', async () => {
  const playerId = 'wallet:0x1111111111111111111111111111111111111111';
  const progress = new PlayerProgressStore();
  const result = progress.finalizeTurn({
    id: 'turn-50',
    playerId,
    number: 50,
    coinsDropped: 5,
    coinsWon: 50,
    coinsLost: 0,
    slotPlan: [],
  });
  let fail = true;
  const keys = [];
  const settlement = new SettlementOutbox(null, {
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
    fetchImpl: async (_url, init) => {
      keys.push(init.headers['x-idempotency-key']);
      if (fail) return jsonResponse({ ok: false, error: { message: 'offering trigger mismatch' } }, 422);
      return jsonResponse({
        ok: true,
        results: [{ matched: true, offeringId: 'offer-1', selectedOutputId: 'output-1', classId: 'class-1', resultType: 'mint_queued' }],
      });
    },
  });
  settlement.enqueue(result);
  await settlement.process();
  assert.equal(settlement.get('turn-50').skinDropStatus, 'failed');

  bridge.progressStore = progress;
  bridge.settlementStore = settlement;
  bridge.authStore = { readRequest: () => ({ playerId }) };
  fail = false;

  let status = 0;
  let body = '';
  const response = {
    setHeader() {},
    writeHead(value) { status = value; },
    end(value) { body = String(value ?? ''); },
  };
  const handled = await handleSettlementRetry({
    method: 'POST',
    url: '/api/settlements/skin/retry',
    headers: { host: 'localhost' },
  }, response);

  assert.equal(handled, true);
  assert.equal(status, 200);
  assert.equal(JSON.parse(body).settlement.last.skinDropStatus, 'submitted');
  assert.equal(progress.view(playerId).confirmedSkinMilestones, 1);
  assert.equal(settlement.get('turn-50').skinProgressConfirmed, true);
  const idempotencyKeys = keys.filter(Boolean);
  assert.deepEqual(idempotencyKeys, [idempotencyKeys[0], idempotencyKeys[0]]);
});
