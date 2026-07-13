import { CONFIG } from '../../src/config/machine-config.js';
import { WorldEngine } from '../../src/game/world-engine.js';

export const SQUEAK_BOOST_RADIUS = 4.1;
export const SQUEAK_BOOST_FORWARD_SPEED = 5.4;
export const SQUEAK_BOOST_LATERAL_SPEED = 3.0;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function applySqueakBoost(engine, dt) {
  const waves = Array.isArray(engine?.activeSqueakWaves) ? engine.activeSqueakWaves : [];
  if (!waves.length) return 0;

  const step = clamp(finite(dt), 0, 1 / 15);
  let affected = 0;

  for (const wave of waves) {
    const originX = finite(wave?.origin?.x);
    for (const coinId of wave?.coinIds ?? []) {
      const coin = engine.coinById?.get(coinId);
      if (!coin?.body?.world || coin.scored || coin.phase !== 'board') continue;

      const body = coin.body;
      const edgeDistance = Math.max(0, CONFIG.board.front - body.position.z);
      const lateralDistance = originX - body.position.x;
      if (edgeDistance > 3.35 || Math.abs(lateralDistance) > SQUEAK_BOOST_RADIUS) continue;

      const edgeStrength = clamp(1 - edgeDistance / 3.35, 0.22, 1);
      const targetXVelocity = clamp(
        lateralDistance * (1.9 + edgeStrength * 1.25),
        -SQUEAK_BOOST_LATERAL_SPEED,
        SQUEAK_BOOST_LATERAL_SPEED,
      );
      const targetForwardVelocity = 3.25 + edgeStrength * (SQUEAK_BOOST_FORWARD_SPEED - 3.25);
      const lateralBlend = clamp(step * 12, 0.18, 0.58);
      const forwardBlend = clamp(step * 17, 0.24, 0.72);

      body.velocity.x += (targetXVelocity - body.velocity.x) * lateralBlend;
      body.velocity.z += (targetForwardVelocity - body.velocity.z) * forwardBlend;
      body.velocity.y += step * (2.1 + edgeStrength * 1.8);
      body.angularVelocity.x += step * (1.8 + edgeStrength * 2.2);
      body.angularVelocity.y += Math.sign(lateralDistance || 1) * step * 3.2;
      body.wakeUp();
      affected += 1;
    }
  }

  return affected;
}

function installSqueakWaveBoostPatch() {
  const prototype = WorldEngine.prototype;
  if (prototype.squeakWaveBoostPatchInstalled) return;

  const fixedStep = prototype.fixedStep;
  prototype.fixedStep = function fixedStepWithStrongSqueakPull(dt) {
    const result = fixedStep.call(this, dt);
    applySqueakBoost(this, dt);
    return result;
  };

  Object.defineProperty(prototype, 'squeakWaveBoostPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installSqueakWaveBoostPatch();

export { installSqueakWaveBoostPatch };
