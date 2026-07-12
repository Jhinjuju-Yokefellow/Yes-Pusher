import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldEngine } from '../src/game/world-engine.js';
import { TURN_STATES } from '../src/game/turn-controller.js';
import { CONFIG } from '../src/config/machine-config.js';

test('authoritative engine owns pusher motion, random drop plan, and confirmed world restoration', () => {
  const engine = new WorldEngine({ seed: 12345 });
  const initialCount = engine.coins.length;
  assert.ok(initialCount >= 115);

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

test('loaded guided bed advances under the pusher without skating or pile growth', () => {
  const engine = new WorldEngine({ seed: 0x59455350 });
  const initial = new Map(engine.coins.map((coin) => [coin.id, {
    z: coin.body.position.z,
    y: coin.body.position.y,
  }]));
  engine.startTurn({ playerId: 'pressure-test', coinsDropped: 5 });

  let maximumBoardRise = 0;
  for (let step = 0; step < 45 * 20; step += 1) {
    engine.advance(1 / 45);
    for (const coin of engine.coins) {
      const start = initial.get(coin.id);
      if (!start || !coin.planar) continue;
      maximumBoardRise = Math.max(maximumBoardRise, coin.body.position.y - start.y);
    }
  }

  const moved = engine.coins
    .filter((coin) => initial.has(coin.id))
    .map((coin) => coin.body.position.z - initial.get(coin.id).z)
    .filter((distance) => distance > 0.20);
  assert.ok(moved.length >= 18, `expected a visible pressure wave, only ${moved.length} coins advanced`);
  assert.ok(maximumBoardRise < 0.075, `guided bed rose by ${maximumBoardRise}`);
});

test('guided board friction slows a loose coin instead of letting it skate', () => {
  const engine = new WorldEngine({ seed: 52 });
  engine.clearCoins();
  const coin = engine.createCoin({
    x: 0,
    y: engine.coinRestY,
    z: 2.4,
    flat: true,
    startAsleep: false,
    planar: true,
  });
  coin.body.velocity.x = 0.9;
  const initialSpeed = Math.abs(coin.body.velocity.x);

  for (let step = 0; step < 45; step += 1) engine.advance(1 / 45);

  assert.ok(Math.abs(coin.body.velocity.x) < initialSpeed * 0.58);
  assert.ok(coin.body.position.y <= engine.coinRestY + 0.065);
});

test('a physical front-edge exit pays one coin once without an edge boost', () => {
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

test('a coin crossing the front edge on the final settle frame is still counted', () => {
  const engine = new WorldEngine({ seed: 5301 });
  engine.clearCoins();
  const coin = engine.createCoin({
    x: 5.54,
    y: engine.coinRestY,
    z: CONFIG.board.front - 0.03,
    flat: true,
    startAsleep: false,
    planar: true,
  });

  engine.startTurn({ playerId: 'last-frame', coinsDropped: 1 });
  engine.turnController.update(30, {
    pusherTime: engine.pusherTime,
    pusherPeriod: CONFIG.pusher.period,
  });
  const finishing = engine.turnController.getSnapshot();
  engine.turnController.notifyPusherTime(finishing.finishAtPusherTime);
  engine.turnController.update(1.24, {
    pusherTime: finishing.finishAtPusherTime,
    pusherPeriod: CONFIG.pusher.period,
  });

  coin.body.position.z = CONFIG.board.front - 0.02;
  coin.body.velocity.z = 0.14;
  coin.body.wakeUp();
  engine.fixedStep(1 / 45);

  const turn = engine.turnController.getSnapshot();
  assert.equal(coin.scored, true);
  assert.equal(turn.currentTurn?.coinsWon, 1);
  assert.equal(turn.state, TURN_STATES.SETTLING);
});

test('transport snapshot packs and rounds coin transforms', () => {
  const engine = new WorldEngine({ seed: 46 });
  const rich = engine.getNetworkSnapshot();
  const packed = engine.getNetworkSnapshot({ packed: true });

  assert.equal(packed.coinEncoding, 'id-position-quaternion-sleep-phase-velocity-v3');
  assert.equal(packed.coins.length, rich.coins.length);
  assert.ok(packed.coins[0].length >= 10);
  assert.equal(packed.coins[0][0], rich.coins[0].id);
  assert.ok(
    Buffer.byteLength(JSON.stringify(packed)) < Buffer.byteLength(JSON.stringify(rich)) * 0.45,
    'packed snapshots should be less than 45% of the previous payload',
  );
});
