import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerProgressStore } from '../apps/world-server/player-progress.js';

test('anonymous player progress stays separate and resolves at most one skin milestone per turn', () => {
  const store = new PlayerProgressStore();
  store.finalizeTurn({ id: 'a-1', playerId: 'a', coinsWon: 40, coinsDropped: 5, slotPlan: [] });
  const jackpot = store.finalizeTurn({ id: 'a-2', playerId: 'a', coinsWon: 125, coinsDropped: 10, slotPlan: [] });

  assert.equal(jackpot.lifetimeCoinsWon, 165);
  assert.equal(jackpot.crossedMilestones, 3);
  assert.equal(jackpot.skinDropEarned, 1);
  assert.equal(jackpot.pendingSkinMilestones, 2);
  assert.equal(store.view('b').lifetimeCoinsWon, 0);

  const next = store.finalizeTurn({ id: 'a-3', playerId: 'a', coinsWon: 0, coinsDropped: 1, slotPlan: [] });
  assert.equal(next.skinDropEarned, 1);
  assert.equal(next.pendingSkinMilestones, 1);

  const decoratedA = store.decorateTurnSnapshot({ currentTurn: { playerId: 'a', coinsWon: 7 } }, 'a');
  const decoratedB = store.decorateTurnSnapshot({ currentTurn: { playerId: 'a', coinsWon: 7 } }, 'b');
  assert.equal(decoratedA.displayedLifetimeCoinsWon, 172);
  assert.equal(decoratedB.displayedLifetimeCoinsWon, 0);

  const restored = new PlayerProgressStore(store.serialize());
  assert.equal(restored.view('a').lifetimeCoinsWon, 165);
  assert.equal(restored.view('a').pendingSkinMilestones, 1);
});
