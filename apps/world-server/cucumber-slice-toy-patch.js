import * as CANNON from 'cannon-es';
import { CONFIG } from '../../src/config/machine-config.js';
import { WorldEngine } from '../../src/game/world-engine.js';

export const CUCUMBER_SLICE_TOY_KEY = 'cucumber_slice';
export const CUCUMBER_REWARD_MIN = 6;
export const CUCUMBER_REWARD_MAX = 10;

const GROUP_COIN = 1;
const GROUP_PUSHER = 2;
const GROUP_BOARD = 4;
const GROUP_WALL = 8;
const TOY_COLLISION_MASK = GROUP_COIN | GROUP_PUSHER | GROUP_BOARD | GROUP_WALL;

function clean(value) {
  return String(value ?? '').trim();
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function vector(value, length, fallback) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite)
    ? [...value]
    : [...fallback];
}

function cucumberReward(engine) {
  const random = typeof engine.randomDuringTurn === 'function' ? engine.randomDuringTurn() : 0.5;
  const span = CUCUMBER_REWARD_MAX - CUCUMBER_REWARD_MIN + 1;
  return CUCUMBER_REWARD_MIN + Math.min(span - 1, Math.floor(Math.max(0, Math.min(0.999999, random)) * span));
}

function cucumberCrossedFront(toy) {
  if (!toy?.body || toy.scored) return false;
  const boardTopY = CONFIG.board.y + 0.42 / 2;
  const frontSpan = CONFIG.board.width / 2 + 0.34;
  const position = toy.body.position;
  return Boolean(
    toy.frontExit || (
      Math.abs(position.x) <= frontSpan
      && position.z >= CONFIG.board.front - 0.16
      && position.y <= boardTopY + 0.82
    )
  );
}

function installCucumberSliceToyPatch() {
  const prototype = WorldEngine.prototype;
  if (prototype.cucumberSliceToyPatchInstalled) return;
  if (typeof prototype.ensureToyState !== 'function' || typeof prototype.removeToy !== 'function') {
    throw new Error('Cucumber Slice toy requires the shared toy system to load first');
  }

  prototype.createCucumberSliceToy = function createCucumberSliceToy({
    id,
    sourceTurnId = null,
    sourcePlayerId = null,
    x = 0,
    y = 2.58,
    z = 0.12,
    rotationY = 0,
    velocity = [0, 0, 0],
    angularVelocity = [0, 0, 0],
    scored = false,
    frontExit = false,
    spawnedAtSimulationSeconds = this.simulationSeconds,
    emitSpawn = true,
  } = {}) {
    this.ensureToyState();
    const toyId = clean(id);
    if (!toyId) throw new Error('Cucumber Slice toy requires a permanent ID');
    const existing = this.toyById.get(toyId);
    if (existing) return existing;

    const body = new CANNON.Body({
      mass: 0.34,
      material: this.materials.coin,
      linearDamping: 0.16,
      angularDamping: 0.24,
      allowSleep: true,
      sleepSpeedLimit: 0.05,
      sleepTimeLimit: 0.75,
      collisionFilterGroup: GROUP_COIN,
      collisionFilterMask: TOY_COLLISION_MASK,
    });

    const longAxis = new CANNON.Quaternion();
    longAxis.setFromEuler(0, 0, Math.PI / 2);
    body.addShape(new CANNON.Cylinder(0.29, 0.31, 1.30, 14), new CANNON.Vec3(0, 0, 0), longAxis);
    body.addShape(new CANNON.Sphere(0.29), new CANNON.Vec3(-0.64, 0, 0));
    body.addShape(new CANNON.Sphere(0.31), new CANNON.Vec3(0.64, 0, 0));

    body.position.set(finite(x), finite(y, 2.58), finite(z, 0.12));
    body.quaternion.setFromEuler(0, finite(rotationY), 0);
    body.velocity.set(...vector(velocity, 3, [0, 0, 0]));
    body.angularVelocity.set(...vector(angularVelocity, 3, [0, 0, 0]));
    this.world.addBody(body);

    const toy = {
      id: toyId,
      toyKey: CUCUMBER_SLICE_TOY_KEY,
      sourceTurnId: clean(sourceTurnId) || null,
      sourcePlayerId: clean(sourcePlayerId) || null,
      spawnedBySkinId: null,
      spawnedAtSimulationSeconds: finite(spawnedAtSimulationSeconds),
      scored: Boolean(scored),
      frontExit: Boolean(frontExit),
      body,
    };
    this.toys.push(toy);
    this.toyById.set(toy.id, toy);

    if (emitSpawn) {
      this.onEvent({
        type: 'toy-spawn',
        reason: 'cucumber-slice-toy',
        turnId: toy.sourceTurnId,
        playerId: toy.sourcePlayerId,
        toyId: toy.id,
        toyKey: toy.toyKey,
        elapsedSeconds: this.simulationSeconds,
        toy: this.serializeToy(toy, { compact: true }),
      });
    }
    return toy;
  };

  const restoreToy = prototype.restoreToy;
  prototype.restoreToy = function restoreToyWithCucumber(saved) {
    const restored = restoreToy.call(this, saved);
    if (restored || saved?.kind !== 'toy' || saved?.toyKey !== CUCUMBER_SLICE_TOY_KEY) return restored;

    const toy = this.createCucumberSliceToy({
      id: saved.id,
      sourceTurnId: saved.sourceTurnId,
      sourcePlayerId: saved.sourcePlayerId,
      x: saved.position?.[0],
      y: saved.position?.[1],
      z: saved.position?.[2],
      scored: saved.scored,
      frontExit: saved.frontExit,
      spawnedAtSimulationSeconds: saved.spawnedAtSimulationSeconds,
      emitSpawn: false,
    });
    if (!toy) return null;

    const position = vector(saved.position, 3, [0, 2.58, 0.12]);
    const quaternion = vector(saved.quaternion, 4, [0, 0, 0, 1]);
    const velocity = vector(saved.velocity, 3, [0, 0, 0]);
    const angularVelocity = vector(saved.angularVelocity, 3, [0, 0, 0]);
    toy.body.position.set(...position);
    toy.body.quaternion.set(...quaternion);
    toy.body.velocity.set(...velocity);
    toy.body.angularVelocity.set(...angularVelocity);
    toy.body.aabbNeedsUpdate = true;
    if (saved.sleeping) toy.body.sleep();
    else toy.body.wakeUp();
    return toy;
  };

  const checkToyExits = prototype.checkToyExits;
  prototype.checkToyExits = function checkToyExitsWithCucumberReward(elapsedSeconds = this.simulationSeconds) {
    this.ensureToyState();
    const turn = this.turnController.getSnapshot().currentTurn;

    for (const toy of [...this.toys]) {
      if (toy.toyKey !== CUCUMBER_SLICE_TOY_KEY || !cucumberCrossedFront(toy)) continue;
      const rewardCoins = cucumberReward(this);
      if (!this.turnController.recordPayout(rewardCoins)) continue;

      toy.frontExit = true;
      toy.scored = true;
      toy.rewardCoins = rewardCoins;
      this.onEvent({
        type: 'toy-payout',
        reason: 'cucumber-chop',
        turnId: turn?.id ?? null,
        playerId: turn?.playerId ?? null,
        toyId: toy.id,
        toyKey: toy.toyKey,
        sourceTurnId: toy.sourceTurnId,
        sourcePlayerId: toy.sourcePlayerId,
        rewardCoins,
        elapsedSeconds,
        toy: this.serializeToy(toy, { compact: true }),
      });
    }

    return checkToyExits.call(this, elapsedSeconds);
  };

  Object.defineProperty(prototype, 'cucumberSliceToyPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installCucumberSliceToyPatch();

export {
  cucumberCrossedFront,
  cucumberReward,
  installCucumberSliceToyPatch,
};
