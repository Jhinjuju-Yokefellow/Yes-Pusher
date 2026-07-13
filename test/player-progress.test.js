import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerProgressStore } from '../apps/world-server/player-progress.js';

test('skin milestones stay assigned until Yokefellow confirms them', () => {
  const store = new PlayerProgressStore();
  store.finalizeTurn({ id: 'a-1', playerId: 'a', coinsWon: 40, coinsDropped: 5, slotPlan: [] });
  const jackpot = store.finalizeTurn({ id: 'a-2', playerId: 'a', coinsWon: 125, coinsDropped: 10, slotPlan: [] });

  assert.equal(jackpot.lifetimeCoinsWon, 165);
  assert.equal(jackpot.crossedMilestones, 3);
  assert.equal(jackpot.skinDropEarned, 1);
  assert.equal(jackpot.assignedSkinMilestoneNumber, 1);
  assert.equal(store.view('a').assignedSkinMilestones, 1);
  assert.equal(store.view('a').queuedSkinMilestones, 2);
  assert.equal(store.view('a').pendingSkinMilestones, 3);

  const nextWhileUnconfirmed = store.finalizeTurn({ id: 'a-3', playerId: 'a', coinsWon: 0, coinsDropped: 1, slotPlan: [] });
  assert.equal(nextWhileUnconfirmed.skinDropEarned, 0);
  assert.equal(store.view('a').pendingSkinMilestones, 3);

  assert.equal(store.confirmSkinMilestone('a', 1, 'a-2'), true);
  assert.equal(store.view('a').confirmedSkinMilestones, 1);
  assert.equal(store.view('a').pendingSkinMilestones, 2);

  const nextAfterConfirmation = store.finalizeTurn({ id: 'a-4', playerId: 'a', coinsWon: 0, coinsDropped: 1, slotPlan: [] });
  assert.equal(nextAfterConfirmation.skinDropEarned, 1);
  assert.equal(nextAfterConfirmation.assignedSkinMilestoneNumber, 2);
  assert.equal(store.view('a').queuedSkinMilestones, 1);
});

test('version one progress recovers prematurely resolved milestones as unconfirmed', () => {
  const store = new PlayerProgressStore({
    kind: 'yes-pusher-player-progress',
    version: 1,
    milestoneEvery: 50,
    players: {
      a: {
        lifetime: 100,
        pendingMilestones: 0,
        resolvedMilestones: 2,
        lastResult: { id: 'turn-100', playerId: 'a', coinsWon: 3, coinsDropped: 10, slotPlan: [] },
      },
    },
  });

  assert.equal(store.view('a').confirmedSkinMilestones, 0);
  assert.equal(store.view('a').pendingSkinMilestones, 2);
  assert.equal(store.serialize().version, 2);
});
