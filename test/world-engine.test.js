import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldEngine } from '../src/game/world-engine.js';
import { TURN_STATES } from '../src/game/turn-controller.js';

test('authoritative engine owns pusher motion, random drop plan, and confirmed world restoration', () => {
  const engine = new WorldEngine({ seed: 12345 });
  const initialCount = engine.coins.length;
  assert.ok(initialCount > 200);

  const turn = engine.startTurn({ playerId: 'player-a', coinsDropped: 3 });
  assert.equal(turn.playerId, 'player-a');
  assert.equal(turn.coinsDropped, 3);
  assert.equal(turn.slotPlan.length, 3);
  assert.equal(engine.turnController.getSnapshot().state, TURN_STATES.DROPPING);
  assert.equal(engine.turnController.getSnapshot().activeSecondsRemaining, 30);

  for (let step = 0; step < 130; step += 1) engine.advance(1 / 60);
  assert.ok(engine.coins.length >= initialCount + 2);
  assert.ok(engine.turnController.getSnapshot().activeSecondsRemaining < 30);
  assert.notEqual(engine.pusher.z, -4.98);

  const confirmed = engine.exportConfirmedWorld();
  const restored = new WorldEngine({ seed: 999, initialSnapshot: confirmed });
  assert.equal(restored.coins.length, confirmed.coins.length);
  assert.equal(restored.turnController.getSnapshot().state, TURN_STATES.READY);
  assert.equal(restored.turnController.getSnapshot().nextTurnNumber, confirmed.turnProgress.turnNumber);
  assert.equal(restored.pusherTime, confirmed.pusherTime);
});
