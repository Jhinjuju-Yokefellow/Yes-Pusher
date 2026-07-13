import test from 'node:test';
import assert from 'node:assert/strict';
import '../apps/world-server/personal-result-patch.js';
import { PlayerProgressStore } from '../apps/world-server/player-progress.js';
import { SettlementOutbox } from '../apps/world-server/settlement-outbox.js';

test('server only decorates the completed turn for the player who earned it', () => {
  const store = new PlayerProgressStore();
  store.finalizeTurn({
    id: 'turn-a',
    playerId: 'player-a',
    coinsDropped: 10,
    coinsWon: 3,
    coinsLost: 0,
    slotPlan: [],
  });

  assert.equal(store.decorateTurnSnapshot({ state: 'ready' }, 'player-a').lastResult.id, 'turn-a');
  assert.equal(store.decorateTurnSnapshot({ state: 'ready' }, 'player-b').lastResult, null);
  assert.equal(store.decorateTurnSnapshot({ state: 'ready' }, null).lastResult, null);
});

test('settlement view cannot expose another player record', () => {
  const outbox = new SettlementOutbox(null, {
    config: {
      apiBaseUrl: '',
      appKey: '',
      bucketId: '',
      creditGrantUrl: '',
      yesPerCoinRaw: '1',
      appSlug: 'yes-pusher',
      eventType: 'coin_drop_completed',
      skinDropTriggerKey: 'coin_pusher.random_skin_drop',
      skinDropOfferingName: 'Random Coin Skin Drop',
      eventSubmissionEnabled: false,
      creditSubmissionEnabled: false,
    },
    fetchImpl: null,
  });
  outbox.enqueue({
    id: 'turn-a',
    playerId: 'player-a',
    coinsDropped: 10,
    coinsWon: 3,
    coinsLost: 0,
    lifetimeCoinsWon: 3,
    skinDropEarned: 0,
  });

  assert.equal(outbox.viewForPlayer('player-a').last.id, 'turn-a');
  assert.equal(outbox.viewForPlayer('player-b').last, null);
});
