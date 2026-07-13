import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config/machine-config.js';
import { WorldEngine } from '../src/game/world-engine.js';
import { simulateRecordedTurn } from '../src/game/replay-package.js';
import {
  optimizeRecordedReplayPhysics,
  REPLAY_FREE_COIN_SEGMENTS,
  REPLAY_SETTLED_COIN_SEGMENTS,
} from '../src/game/replay-physics.js';

test('authoritative replay records exact payout coin IDs and a final handoff world', async () => {
  const source = new WorldEngine({ seedMachine: false });
  source.initializeEmptyMachine();
  const winningCoin = source.createCoin({
    x: 0,
    y: source.coinRestY - 0.05,
    z: CONFIG.board.front - 0.01,
    flat: true,
    phase: 'board',
    planar: false,
    startAsleep: false,
  });
  source.configureFreeBoardCoin(winningCoin, { falling: true });
  winningCoin.frontExit = true;

  const initialWorld = source.exportConfirmedWorld();
  const startBoundary = source.getNetworkSnapshot({ packed: true });
  const replay = await simulateRecordedTurn({
    initialWorld,
    startBoundary,
    playerId: 'player-a',
    playerLabel: 'PLAYER A',
    coinsDropped: 1,
    seed: 12345,
    turnId: 'recorded-turn-1',
    frameRate: 8,
  });

  assert.equal(replay.id, 'recorded-turn-1');
  assert.equal(replay.result.coinsWon >= 1, true);
  assert.equal(replay.events[0].type, 'payout');
  assert.equal(replay.events[0].coinId, winningCoin.id);
  assert.equal(replay.events.filter((event) => event.coinId === winningCoin.id && event.type === 'payout').length, 1);
  assert.equal(replay.frames.length > 100, true);
  assert.equal(replay.finalWorld.kind, 'yes-pusher-confirmed-world');
  assert.equal(replay.finalWorld.turnProgress.turnNumber, 2);
});


test('recorded replay uses lightweight settled collisions without changing free coins', () => {
  const rawEngine = new WorldEngine({ seed: 1234 });
  const free = rawEngine.createCoin({ phase: 'peg', flat: false, y: 8 });
  const engine = optimizeRecordedReplayPhysics(rawEngine);
  const settled = engine.coins.find((coin) => coin.planar);
  assert.ok(settled);
  assert.ok(free);
  assert.equal(settled.replayCollisionSegments, REPLAY_SETTLED_COIN_SEGMENTS);
  assert.equal(free.replayCollisionSegments, REPLAY_FREE_COIN_SEGMENTS);

  engine.configureFreeBoardCoin(settled, { falling: true });
  assert.equal(settled.replayCollisionSegments, REPLAY_FREE_COIN_SEGMENTS);
  engine.configurePlanarBoardCoin(settled);
  assert.equal(settled.replayCollisionSegments, REPLAY_SETTLED_COIN_SEGMENTS);
});
