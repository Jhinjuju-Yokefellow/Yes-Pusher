import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnController, TURN_STATES } from '../src/game/turn-controller.js';

function finishTurn(controller, score = 0, { pusherTime = 0, pusherPeriod = 6.8 } = {}) {
  controller.startTurn({ coinsDropped: 1, slotPlan: [0] });
  for (let index = 0; index < score; index += 1) controller.recordPayout();
  controller.markBatchFinished();
  controller.update(30, { pusherTime, pusherPeriod });
  const finishing = controller.getSnapshot();
  controller.notifyPusherTime(finishing.finishAtPusherTime);
  return controller.update(10, { pusherTime: finishing.finishAtPusherTime, pusherPeriod });
}

test('turn clock starts immediately and continues through coin insertion', () => {
  const controller = createTurnController();
  controller.startTurn({ coinsDropped: 5, slotPlan: [0, 2, 4, 1, 3] });

  const started = controller.getSnapshot();
  assert.equal(started.state, TURN_STATES.DROPPING);
  assert.equal(started.activeSecondsRemaining, 30);
  assert.ok(Number.isFinite(started.currentTurn.activeStartedAt));

  controller.update(6.5, { pusherTime: 2.1, pusherPeriod: 6.8 });
  assert.equal(controller.getSnapshot().activeSecondsRemaining, 23.5);

  controller.recordPayout(2);
  controller.markBatchFinished();
  assert.equal(controller.getSnapshot().state, TURN_STATES.ACTIVE);
  assert.equal(controller.markFinalCoinReached(), false);

  controller.update(23.5, { pusherTime: 2.1, pusherPeriod: 6.8 });
  const finishing = controller.getSnapshot();
  assert.equal(finishing.state, TURN_STATES.FINISHING);
  assert.equal(finishing.finishAtPusherTime, 6.8);

  controller.notifyPusherTime(6.8);
  assert.equal(controller.getSnapshot().state, TURN_STATES.SETTLING);
  controller.recordPayout(1);

  const result = controller.update(4, { pusherTime: 6.8, pusherPeriod: 6.8 });
  assert.equal(result.coinsDropped, 5);
  assert.equal(result.coinsWon, 3);
  assert.equal(result.lifetimeCoinsWon, 3);
  assert.equal(controller.getSnapshot().state, TURN_STATES.READY);
});

test('timer cannot finish the turn before a delayed batch has spawned', () => {
  const controller = createTurnController({ activeDurationSeconds: 1 });
  controller.startTurn({ coinsDropped: 10, slotPlan: Array(10).fill(0) });
  controller.update(2, { pusherTime: 1.2, pusherPeriod: 6.8 });

  const duringDrop = controller.getSnapshot();
  assert.equal(duringDrop.state, TURN_STATES.DROPPING);
  assert.equal(duringDrop.activeSecondsRemaining, 0);

  controller.markBatchFinished();
  controller.update(0, { pusherTime: 1.2, pusherPeriod: 6.8 });
  assert.equal(controller.getSnapshot().state, TURN_STATES.FINISHING);
});

test('payouts are ignored when no turn owns the scoring window', () => {
  const controller = createTurnController();
  assert.equal(controller.recordPayout(), false);
  assert.equal(controller.getSnapshot().displayedLifetimeCoinsWon, 0);
});

test('only one skin milestone resolves per turn and extras remain pending', () => {
  const controller = createTurnController();
  const first = finishTurn(controller, 40);
  assert.equal(first.skinDropEarned, 0);

  const jackpot = finishTurn(controller, 125, { pusherTime: 1.2 });
  assert.equal(jackpot.lifetimeCoinsWon, 165);
  assert.equal(jackpot.crossedMilestones, 3);
  assert.equal(jackpot.skinDropEarned, 1);
  assert.equal(jackpot.pendingSkinMilestones, 2);

  const next = finishTurn(controller, 0, { pusherTime: 2.4 });
  assert.equal(next.skinDropEarned, 1);
  assert.equal(next.pendingSkinMilestones, 1);
});
