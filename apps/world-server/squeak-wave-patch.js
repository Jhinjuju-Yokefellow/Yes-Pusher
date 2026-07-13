import { CONFIG } from '../../src/config/machine-config.js';
import { WorldEngine } from '../../src/game/world-engine.js';
import {
  RUBBER_DUCK_SKIN_ID,
  RUBBER_DUCK_TOY_KEY,
} from './rubber-duck-toy-patch.js';

export const DEFAULT_MAX_TOYS = 8;
export const SQUEAK_RADIUS = 3.4;
export const SQUEAK_MAX_COINS = 6;
export const SQUEAK_DURATION_SECONDS = 1.18;
export const SQUEAK_PULSE_TIMES = Object.freeze([0, 0.22, 0.44, 0.66, 0.88]);

function clean(value) {
  return String(value ?? '').trim();
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function integerFromEnv(value, fallback, minimum = 1, maximum = 50) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function maxToyCount() {
  return integerFromEnv(process.env.YES_PUSHER_MAX_TOYS, DEFAULT_MAX_TOYS);
}

function safeToyId(turnId) {
  const suffix = clean(turnId)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return `toy-rubber-duck-${suffix || 'turn'}`;
}

function activeToyCount(engine) {
  return Array.isArray(engine.toys)
    ? engine.toys.filter((toy) => toy?.body?.world && !toy.scored).length
    : 0;
}

function ensureSqueakState(engine) {
  if (!Array.isArray(engine.activeSqueakWaves)) engine.activeSqueakWaves = [];
  if (!Array.isArray(engine.pendingSqueakPowers)) engine.pendingSqueakPowers = [];
  if (!engine.__squeakTurnControllerPatched && engine.turnController?.update) {
    const originalUpdate = engine.turnController.update.bind(engine.turnController);
    engine.turnController.update = (dt, context) => {
      const state = engine.turnController.getSnapshot().state;
      if (
        state === 'settling'
        && (engine.activeSqueakWaves.length || engine.pendingSqueakPowers.length)
      ) {
        return originalUpdate(0, context);
      }
      return originalUpdate(dt, context);
    };
    engine.__squeakTurnControllerPatched = true;
  }
  return engine.activeSqueakWaves;
}

function qualifyingCoins(engine, origin) {
  const frontZoneStart = CONFIG.board.front - 2.8;
  return engine.coins
    .filter((coin) => {
      if (!coin?.body?.world || coin.scored || coin.phase !== 'board') return false;
      const position = coin.body.position;
      if (position.z < frontZoneStart) return false;
      return Math.abs(position.x - origin.x) <= SQUEAK_RADIUS;
    })
    .sort((a, b) => {
      const aEdge = Math.max(0, CONFIG.board.front - a.body.position.z);
      const bEdge = Math.max(0, CONFIG.board.front - b.body.position.z);
      const aLateral = Math.abs(a.body.position.x - origin.x);
      const bLateral = Math.abs(b.body.position.x - origin.x);
      return aEdge - bEdge || aLateral - bLateral || String(a.id).localeCompare(String(b.id));
    })
    .slice(0, SQUEAK_MAX_COINS);
}

function applyPulse(engine, wave, pulseIndex) {
  const progress = SQUEAK_PULSE_TIMES.length > 1
    ? pulseIndex / (SQUEAK_PULSE_TIMES.length - 1)
    : 1;
  const affected = [];

  for (const coinId of wave.coinIds) {
    const coin = engine.coinById?.get(coinId);
    if (!coin?.body?.world || coin.scored || coin.phase !== 'board') continue;
    const body = coin.body;
    const dxToDuck = wave.origin.x - body.position.x;
    const edgeDistance = Math.max(0, CONFIG.board.front - body.position.z);
    if (edgeDistance > 3.1 || Math.abs(dxToDuck) > SQUEAK_RADIUS + 0.35) continue;

    const edgeStrength = clamp(1 - edgeDistance / 3.1, 0.18, 1);
    const inwardPull = clamp(dxToDuck * (0.72 + progress * 0.30), -0.72, 0.72);
    const forwardTarget = 0.95 + edgeStrength * 0.52 + progress * 0.48;

    body.velocity.x += inwardPull;
    body.velocity.z = Math.max(body.velocity.z, forwardTarget);
    body.velocity.y += 0.055 + edgeStrength * 0.045;
    body.angularVelocity.y += Math.sign(dxToDuck || 1) * (0.24 + 0.34 * progress);
    body.wakeUp();
    affected.push(coin.id);
  }

  engine.onEvent({
    type: 'squeak-wave-pulse',
    reason: 'rubber-duck-vacuum',
    turnId: wave.turnId,
    playerId: wave.playerId,
    toyId: wave.toyId,
    toyKey: RUBBER_DUCK_TOY_KEY,
    elapsedSeconds: engine.simulationSeconds,
    pulseIndex,
    affectedCoinIds: affected,
    origin: [wave.origin.x, wave.origin.y, wave.origin.z],
  });
}

function createWave(engine, source, elapsedSeconds) {
  const waves = ensureSqueakState(engine);
  const turn = engine.turnController.getSnapshot().currentTurn;
  const boardTopY = CONFIG.board.y + 0.42 / 2;
  const origin = {
    x: clamp(finite(source?.x ?? source?.body?.position?.x), -CONFIG.board.width / 2 + 0.5, CONFIG.board.width / 2 - 0.5),
    y: boardTopY + 0.58,
    z: CONFIG.board.front - 0.08,
  };
  const coins = qualifyingCoins(engine, origin);
  const wave = {
    toyId: clean(source?.toyId ?? source?.id) || null,
    turnId: clean(source?.turnId ?? turn?.id) || null,
    playerId: clean(source?.playerId ?? turn?.playerId) || null,
    origin,
    coinIds: coins.map((coin) => coin.id),
    elapsed: 0,
    nextPulseIndex: 0,
  };
  waves.push(wave);

  engine.onEvent({
    type: 'squeak-wave-start',
    reason: 'rubber-duck-vacuum',
    turnId: wave.turnId,
    playerId: wave.playerId,
    toyId: wave.toyId,
    toyKey: RUBBER_DUCK_TOY_KEY,
    elapsedSeconds,
    affectedCoinIds: [...wave.coinIds],
    origin: [origin.x, origin.y, origin.z],
  });

  applyPulse(engine, wave, 0);
  wave.nextPulseIndex = 1;
  return wave;
}

function activateWave(engine, toy, elapsedSeconds) {
  if (!toy || toy.__squeakWaveActivated) return null;
  toy.__squeakWaveActivated = true;
  return createWave(engine, {
    id: toy.id,
    x: toy.body?.position?.x,
  }, elapsedSeconds);
}

function queueDuckPower(engine, toy, elapsedSeconds) {
  ensureSqueakState(engine);
  if (!toy || toy.__squeakPowerQueued) return null;
  toy.__squeakPowerQueued = true;
  const turn = engine.turnController.getSnapshot().currentTurn;
  const queued = {
    toyId: toy.id,
    turnId: turn?.id ?? null,
    playerId: turn?.playerId ?? null,
    x: finite(toy.body?.position?.x),
    queuedAt: finite(elapsedSeconds, engine.simulationSeconds),
  };
  engine.pendingSqueakPowers.push(queued);
  return queued;
}

function activatePendingWave(engine) {
  ensureSqueakState(engine);
  if (engine.activeSqueakWaves.length || !engine.pendingSqueakPowers.length) return null;
  const pending = engine.pendingSqueakPowers.shift();
  return createWave(engine, pending, engine.simulationSeconds);
}

function updateWaves(engine, dt) {
  const waves = ensureSqueakState(engine);
  const survivors = [];
  for (const wave of waves) {
    wave.elapsed += Math.max(0, finite(dt));
    while (
      wave.nextPulseIndex < SQUEAK_PULSE_TIMES.length
      && wave.elapsed + 1e-9 >= SQUEAK_PULSE_TIMES[wave.nextPulseIndex]
    ) {
      applyPulse(engine, wave, wave.nextPulseIndex);
      wave.nextPulseIndex += 1;
    }
    if (wave.elapsed < SQUEAK_DURATION_SECONDS) {
      survivors.push(wave);
      continue;
    }
    engine.onEvent({
      type: 'squeak-wave-end',
      reason: 'rubber-duck-vacuum',
      turnId: wave.turnId,
      playerId: wave.playerId,
      toyId: wave.toyId,
      toyKey: RUBBER_DUCK_TOY_KEY,
      elapsedSeconds: engine.simulationSeconds,
      affectedCoinIds: [...wave.coinIds],
      origin: [wave.origin.x, wave.origin.y, wave.origin.z],
    });
  }
  engine.activeSqueakWaves = survivors;
}

function installSqueakWavePatch() {
  const prototype = WorldEngine.prototype;
  if (prototype.squeakWavePatchInstalled) return;

  prototype.spawnRubberDuckForTurn = function spawnVisibleRubberDuckForTurn(turn) {
    this.ensureToyState?.();
    if (!turn?.id) return null;
    const id = safeToyId(turn.id);
    if (this.toyById?.has(id)) return this.toyById.get(id);

    const maximum = maxToyCount();
    if (activeToyCount(this) >= maximum) {
      this.onEvent({
        type: 'toy-spawn-skipped',
        reason: 'machine-toy-cap',
        turnId: turn.id,
        playerId: turn.playerId,
        toyId: id,
        toyKey: RUBBER_DUCK_TOY_KEY,
        elapsedSeconds: this.simulationSeconds,
        maximum,
      });
      return null;
    }

    const x = (this.randomDuringTurn() - 0.5) * 4.6;
    const yaw = this.randomDuringTurn() * Math.PI * 2;
    const drift = (this.randomDuringTurn() - 0.5) * 0.16;
    return this.createRubberDuckToy({
      id,
      sourceTurnId: turn.id,
      sourcePlayerId: turn.playerId,
      spawnedBySkinId: RUBBER_DUCK_SKIN_ID,
      x,
      y: 10.65,
      z: -1.55,
      rotationY: yaw,
      velocity: [drift, -0.18, 0.045],
      angularVelocity: [
        0.18 * (this.randomDuringTurn() - 0.5),
        0.65 * (this.randomDuringTurn() - 0.5),
        0.18 * (this.randomDuringTurn() - 0.5),
      ],
    });
  };

  const checkToyExits = prototype.checkToyExits;
  prototype.checkToyExits = function checkToyExitsWithDeferredSqueak(elapsedSeconds = this.simulationSeconds) {
    ensureSqueakState(this);
    const boardTopY = CONFIG.board.y + 0.42 / 2;
    const frontSpan = CONFIG.board.width / 2 + 0.34;
    const candidates = (this.toys ?? []).filter((toy) => {
      const position = toy?.body?.position;
      return toy?.toyKey === RUBBER_DUCK_TOY_KEY
        && !toy.scored
        && position
        && Math.abs(position.x) <= frontSpan
        && position.z >= CONFIG.board.front - 0.16
        && position.y <= boardTopY + 0.82;
    });

    const result = checkToyExits.call(this, elapsedSeconds);
    for (const toy of candidates) {
      if (toy.scored) queueDuckPower(this, toy, elapsedSeconds);
    }
    return result;
  };

  const fixedStep = prototype.fixedStep;
  prototype.fixedStep = function fixedStepWithSettlementDuckPull(dt) {
    ensureSqueakState(this);
    if (
      this.turnController.getSnapshot().state === 'settling'
      && this.pendingSqueakPowers.length
      && !this.activeSqueakWaves.length
    ) activatePendingWave(this);

    const result = fixedStep.call(this, dt);

    if (
      this.turnController.getSnapshot().state === 'settling'
      && this.pendingSqueakPowers.length
      && !this.activeSqueakWaves.length
    ) activatePendingWave(this);

    updateWaves(this, dt);
    return result;
  };

  const getNetworkSnapshot = prototype.getNetworkSnapshot;
  prototype.getNetworkSnapshot = function getNetworkSnapshotWithToyLimit(options = {}) {
    const snapshot = getNetworkSnapshot.call(this, options);
    const maximum = maxToyCount();
    const active = activeToyCount(this);
    return {
      ...snapshot,
      maxToyCount: maximum,
      toySlotsRemaining: Math.max(0, maximum - active),
    };
  };

  Object.defineProperty(prototype, 'squeakWavePatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installSqueakWavePatch();

export {
  activatePendingWave,
  activateWave,
  activeToyCount,
  installSqueakWavePatch,
  maxToyCount,
  queueDuckPower,
  updateWaves,
};
