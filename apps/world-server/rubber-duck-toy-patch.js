import * as CANNON from 'cannon-es';
import { CONFIG } from '../../src/config/machine-config.js';
import { WorldEngine } from '../../src/game/world-engine.js';
import { normalizeWorldSnapshot } from '../../src/game/world-snapshot.js';

export const RUBBER_DUCK_SKIN_ID = 'yes_drop.rubber_duck';
export const RUBBER_DUCK_TOY_KEY = 'rubber_duck';

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

function ensureToyState(engine) {
  if (!Array.isArray(engine.toys)) engine.toys = [];
  if (!(engine.toyById instanceof Map)) engine.toyById = new Map();
  return engine;
}

function safeToyId(turnId) {
  const suffix = clean(turnId)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return `toy-rubber-duck-${suffix || 'turn'}`;
}

function serializeToy(toy, { compact = false } = {}) {
  const body = toy.body;
  const base = {
    id: toy.id,
    kind: 'toy',
    toyKey: toy.toyKey,
    sourceTurnId: toy.sourceTurnId,
    sourcePlayerId: toy.sourcePlayerId,
    spawnedBySkinId: toy.spawnedBySkinId,
    scored: Boolean(toy.scored),
    frontExit: Boolean(toy.frontExit),
    position: [body.position.x, body.position.y, body.position.z],
    quaternion: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
  };
  if (compact) return base;
  return {
    ...base,
    velocity: [body.velocity.x, body.velocity.y, body.velocity.z],
    angularVelocity: [body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z],
    sleeping: body.sleepState === CANNON.Body.SLEEPING,
    spawnedAtSimulationSeconds: finite(toy.spawnedAtSimulationSeconds),
  };
}

function installRubberDuckToyPatch() {
  const prototype = WorldEngine.prototype;
  if (prototype.rubberDuckToyPatchInstalled) return;

  prototype.ensureToyState = function ensureWorldToyState() {
    return ensureToyState(this);
  };

  prototype.removeToy = function removeToy(toy) {
    ensureToyState(this);
    if (!toy) return;
    if (toy.body?.world) this.world.removeBody(toy.body);
    this.toyById.delete(toy.id);
    const index = this.toys.indexOf(toy);
    if (index >= 0) this.toys.splice(index, 1);
  };

  prototype.clearToys = function clearToys() {
    ensureToyState(this);
    for (const toy of [...this.toys]) this.removeToy(toy);
    this.toys.length = 0;
    this.toyById.clear();
  };

  prototype.serializeToy = function serializeWorldToy(toy, options = {}) {
    return serializeToy(toy, options);
  };

  prototype.createRubberDuckToy = function createRubberDuckToy({
    id,
    sourceTurnId = null,
    sourcePlayerId = null,
    spawnedBySkinId = RUBBER_DUCK_SKIN_ID,
    x = 0,
    y = 2.75,
    z = 0.30,
    rotationY = 0,
    velocity = [0, -0.18, 0.03],
    angularVelocity = [0, 0.25, 0],
    scored = false,
    frontExit = false,
    spawnedAtSimulationSeconds = this.simulationSeconds,
    emitSpawn = true,
  } = {}) {
    ensureToyState(this);
    const toyId = clean(id);
    if (!toyId) throw new Error('Rubber Duck toy requires a permanent ID');
    const existing = this.toyById.get(toyId);
    if (existing) return existing;

    const body = new CANNON.Body({
      mass: 0.30,
      material: this.materials.coin,
      linearDamping: 0.18,
      angularDamping: 0.34,
      allowSleep: true,
      sleepSpeedLimit: 0.055,
      sleepTimeLimit: 0.8,
      collisionFilterGroup: GROUP_COIN,
      collisionFilterMask: TOY_COLLISION_MASK,
    });

    body.addShape(new CANNON.Sphere(0.46), new CANNON.Vec3(0, 0, 0));
    body.addShape(new CANNON.Sphere(0.35), new CANNON.Vec3(0, 0.47, 0.10));
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.24, 0.105, 0.20)), new CANNON.Vec3(0, 0.41, 0.41));
    body.addShape(new CANNON.Sphere(0.18), new CANNON.Vec3(-0.39, 0.02, -0.02));
    body.addShape(new CANNON.Sphere(0.18), new CANNON.Vec3(0.39, 0.02, -0.02));
    body.addShape(new CANNON.Sphere(0.15), new CANNON.Vec3(0, 0.10, -0.48));

    body.position.set(finite(x), finite(y, 2.75), finite(z, 0.30));
    body.quaternion.setFromEuler(0, finite(rotationY), 0);
    body.velocity.set(...vector(velocity, 3, [0, -0.18, 0.03]));
    body.angularVelocity.set(...vector(angularVelocity, 3, [0, 0.25, 0]));
    this.world.addBody(body);

    const toy = {
      id: toyId,
      toyKey: RUBBER_DUCK_TOY_KEY,
      sourceTurnId: clean(sourceTurnId) || null,
      sourcePlayerId: clean(sourcePlayerId) || null,
      spawnedBySkinId: clean(spawnedBySkinId) || RUBBER_DUCK_SKIN_ID,
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
        reason: 'rubber-duck-skin',
        turnId: toy.sourceTurnId,
        playerId: toy.sourcePlayerId,
        toyId: toy.id,
        toyKey: toy.toyKey,
        elapsedSeconds: this.simulationSeconds,
        toy: serializeToy(toy, { compact: true }),
      });
    }
    return toy;
  };

  prototype.restoreToy = function restoreToy(saved) {
    if (!saved || saved.kind !== 'toy' || saved.toyKey !== RUBBER_DUCK_TOY_KEY) return null;
    const toy = this.createRubberDuckToy({
      id: saved.id,
      sourceTurnId: saved.sourceTurnId,
      sourcePlayerId: saved.sourcePlayerId,
      spawnedBySkinId: saved.spawnedBySkinId,
      x: saved.position?.[0],
      y: saved.position?.[1],
      z: saved.position?.[2],
      scored: saved.scored,
      frontExit: saved.frontExit,
      spawnedAtSimulationSeconds: saved.spawnedAtSimulationSeconds,
      emitSpawn: false,
    });
    if (!toy) return null;

    const body = toy.body;
    const position = vector(saved.position, 3, [0, 2.75, 0.30]);
    const quaternion = vector(saved.quaternion, 4, [0, 0, 0, 1]);
    const velocity = vector(saved.velocity, 3, [0, 0, 0]);
    const angularVelocity = vector(saved.angularVelocity, 3, [0, 0, 0]);
    body.position.set(...position);
    body.quaternion.set(...quaternion);
    body.velocity.set(...velocity);
    body.angularVelocity.set(...angularVelocity);
    body.aabbNeedsUpdate = true;
    if (saved.sleeping) body.sleep();
    else body.wakeUp();
    return toy;
  };

  prototype.spawnRubberDuckForTurn = function spawnRubberDuckForTurn(turn) {
    if (!turn?.id) return null;
    const id = safeToyId(turn.id);
    if (this.toyById?.has(id)) return this.toyById.get(id);
    const x = (this.randomDuringTurn() - 0.5) * 4.2;
    const z = 0.18 + this.randomDuringTurn() * 0.34;
    const yaw = this.randomDuringTurn() * Math.PI * 2;
    const drift = (this.randomDuringTurn() - 0.5) * 0.12;
    return this.createRubberDuckToy({
      id,
      sourceTurnId: turn.id,
      sourcePlayerId: turn.playerId,
      x,
      y: 2.85,
      z,
      rotationY: yaw,
      velocity: [drift, -0.20, 0.035],
      angularVelocity: [0.08 * (this.randomDuringTurn() - 0.5), 0.45 * (this.randomDuringTurn() - 0.5), 0.08 * (this.randomDuringTurn() - 0.5)],
    });
  };

  prototype.checkToyExits = function checkToyExits(elapsedSeconds = this.simulationSeconds) {
    ensureToyState(this);
    const boardTopY = CONFIG.board.y + 0.42 / 2;
    const frontSpan = CONFIG.board.width / 2 + 0.34;
    const turn = this.turnController.getSnapshot().currentTurn;

    for (const toy of [...this.toys]) {
      const position = toy.body.position;
      const crossedFront = toy.frontExit || (
        !toy.scored
        && Math.abs(position.x) <= frontSpan
        && position.z >= CONFIG.board.front - 0.16
        && position.y <= boardTopY + 0.82
      );

      if (!toy.scored && crossedFront) {
        toy.frontExit = true;
        toy.scored = true;
        this.onEvent({
          type: 'toy-payout',
          reason: 'front-payout',
          turnId: turn?.id ?? null,
          playerId: turn?.playerId ?? null,
          toyId: toy.id,
          toyKey: toy.toyKey,
          sourceTurnId: toy.sourceTurnId,
          sourcePlayerId: toy.sourcePlayerId,
          elapsedSeconds,
          toy: serializeToy(toy, { compact: true }),
        });
      }

      if (toy.scored) {
        if (position.y < -3.2 || position.z > CONFIG.board.front + 3.2) this.removeToy(toy);
        continue;
      }

      const lost = (
        Math.abs(position.x) > 6.55
        || position.y < -3.2
        || position.z < -9.0
      );
      if (!lost) continue;
      this.onEvent({
        type: 'toy-loss',
        reason: 'side-or-rear-loss',
        turnId: turn?.id ?? null,
        playerId: turn?.playerId ?? null,
        toyId: toy.id,
        toyKey: toy.toyKey,
        sourceTurnId: toy.sourceTurnId,
        sourcePlayerId: toy.sourcePlayerId,
        elapsedSeconds,
        toy: serializeToy(toy, { compact: true }),
      });
      this.removeToy(toy);
    }
  };

  const initializeEmptyMachine = prototype.initializeEmptyMachine;
  prototype.initializeEmptyMachine = function initializeEmptyMachineWithToys(...args) {
    ensureToyState(this);
    this.clearToys();
    return initializeEmptyMachine.apply(this, args);
  };

  const resetMachine = prototype.resetMachine;
  prototype.resetMachine = function resetMachineWithToys(...args) {
    ensureToyState(this);
    this.clearToys();
    return resetMachine.apply(this, args);
  };

  const restoreConfirmedWorld = prototype.restoreConfirmedWorld;
  prototype.restoreConfirmedWorld = function restoreConfirmedWorldWithToys(rawSnapshot) {
    const snapshot = normalizeWorldSnapshot(rawSnapshot);
    ensureToyState(this);
    this.clearToys();
    const result = restoreConfirmedWorld.call(this, rawSnapshot);
    for (const saved of snapshot?.toys ?? []) this.restoreToy(saved);
    return result;
  };

  const startTurn = prototype.startTurn;
  prototype.startTurn = function startTurnWithRubberDuck(request = {}) {
    const turn = startTurn.call(this, request);
    const skinId = clean(turn?.skinId || this.activeTurnSkinId);
    if (skinId === RUBBER_DUCK_SKIN_ID) this.spawnRubberDuckForTurn(turn);
    return turn;
  };

  const fixedStep = prototype.fixedStep;
  prototype.fixedStep = function fixedStepWithToys(dt) {
    const result = fixedStep.call(this, dt);
    this.checkToyExits(this.simulationSeconds);
    return result;
  };

  const getNetworkSnapshot = prototype.getNetworkSnapshot;
  prototype.getNetworkSnapshot = function getNetworkSnapshotWithToys(options = {}) {
    const snapshot = getNetworkSnapshot.call(this, options);
    ensureToyState(this);
    return {
      ...snapshot,
      toyCount: this.toys.length,
      toys: this.toys
        .filter((toy) => toy.body?.world)
        .map((toy) => serializeToy(toy, { compact: true })),
    };
  };

  const exportConfirmedWorld = prototype.exportConfirmedWorld;
  prototype.exportConfirmedWorld = function exportConfirmedWorldWithToys(...args) {
    const snapshot = exportConfirmedWorld.apply(this, args);
    ensureToyState(this);
    return {
      ...snapshot,
      toys: this.toys
        .filter((toy) => toy.body?.world)
        .map((toy) => serializeToy(toy)),
    };
  };

  Object.defineProperty(prototype, 'rubberDuckToyPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installRubberDuckToyPatch();

export { installRubberDuckToyPatch, serializeToy };
