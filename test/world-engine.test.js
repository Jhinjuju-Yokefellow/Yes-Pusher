import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldEngine } from '../src/game/world-engine.js';
import { TURN_STATES } from '../src/game/turn-controller.js';

test('authoritative engine owns pusher motion, random drop plan, and confirmed world restoration', () => {
  const engine = new WorldEngine({ seed: 12345 });
  const initialCount = engine.coins.length;
  assert.ok(initialCount >= 130);

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

test('front-bank pressure pays one coin once without lifting it', () => {
  const engine = new WorldEngine({ seed: 77 });
  engine.clearCoins();
  const payoutCoin = engine.createCoin({
    x: 4.3,
    y: engine.coinRestY,
    z: 5.43,
    flat: true,
    startAsleep: false,
  });
  engine.startTurn({ playerId: 'player-edge', coinsDropped: 1 });

  let maximumY = payoutCoin.body.position.y;
  for (let step = 0; step < 60 * 8; step += 1) {
    engine.advance(1 / 60);
    if (payoutCoin.body.world) maximumY = Math.max(maximumY, payoutCoin.body.position.y);
  }

  const turn = engine.turnController.getSnapshot();
  assert.equal(payoutCoin.scored, true);
  assert.equal(turn.currentTurn.coinsWon, 1);
  assert.ok(maximumY < engine.boardTopY + 0.30);
});

test('transport snapshot packs and rounds coin transforms', () => {
  const engine = new WorldEngine({ seed: 46 });
  const rich = engine.getNetworkSnapshot();
  const packed = engine.getNetworkSnapshot({ packed: true });

  assert.equal(packed.coinEncoding, 'id-position-quaternion-v1');
  assert.equal(packed.coins.length, rich.coins.length);
  assert.equal(packed.coins[0].length, 8);
  assert.equal(packed.coins[0][0], rich.coins[0].id);
  assert.ok(
    Buffer.byteLength(JSON.stringify(packed)) < Buffer.byteLength(JSON.stringify(rich)) * 0.45,
    'packed snapshots should be less than 45% of the previous payload',
  );
});
