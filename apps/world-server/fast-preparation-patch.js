import { WorldEngine } from '../../src/game/world-engine.js';

export const MAX_PREPARATION_REPLAY_FRAME_RATE = 5;
export const PREPARATION_SOLVER_ITERATIONS = 2;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function cappedPreparationReplayFrameRate(value) {
  return Math.max(5, Math.min(
    MAX_PREPARATION_REPLAY_FRAME_RATE,
    Math.floor(finiteNumber(value, MAX_PREPARATION_REPLAY_FRAME_RATE)),
  ));
}

function installFastPreparationPatch() {
  const prototype = WorldEngine.prototype;
  if (prototype.fastPreparationPatchInstalled) return;

  const createPhysicsWorld = prototype.createPhysicsWorld;
  prototype.createPhysicsWorld = function createFasterPhysicsWorld(...args) {
    const result = createPhysicsWorld.apply(this, args);
    if (this.world?.solver) {
      this.world.solver.iterations = Math.min(
        this.world.solver.iterations,
        PREPARATION_SOLVER_ITERATIONS,
      );
    }
    return result;
  };

  Object.defineProperty(prototype, 'fastPreparationPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

// Railway prepares the authoritative turn before playback. Five recorded frames
// per second are enough for browser interpolation while sharply reducing frame
// packing and solver work during preparation.
process.env.YES_PUSHER_REPLAY_FRAME_RATE = String(cappedPreparationReplayFrameRate(
  process.env.YES_PUSHER_REPLAY_FRAME_RATE,
));

installFastPreparationPatch();

export { installFastPreparationPatch };
