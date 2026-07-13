import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldEngine } from '../src/game/world-engine.js';
import {
  cappedPreparationReplayFrameRate,
  MAX_PREPARATION_REPLAY_FRAME_RATE,
  PREPARATION_SOLVER_ITERATIONS,
} from '../apps/world-server/fast-preparation-patch.js';

test('authoritative preparation caps replay recording at ten frames per second', () => {
  assert.equal(cappedPreparationReplayFrameRate(30), MAX_PREPARATION_REPLAY_FRAME_RATE);
  assert.equal(cappedPreparationReplayFrameRate(15), MAX_PREPARATION_REPLAY_FRAME_RATE);
  assert.equal(cappedPreparationReplayFrameRate(8), 8);
  assert.equal(cappedPreparationReplayFrameRate(2), 5);
});

test('authoritative preparation uses the lighter solver without changing simulation ownership', () => {
  const engine = new WorldEngine({ seedMachine: false });
  assert.equal(engine.world.solver.iterations, PREPARATION_SOLVER_ITERATIONS);
  assert.equal(engine.physicsRate, 45);
});
