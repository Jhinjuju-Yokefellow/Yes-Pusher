import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config/machine-config.js';
import { WorldEngine } from '../game/world-engine.js';

const INITIAL_CAPACITY = 256;
const EXTREME_DRIFT_DISTANCE_SQ = 3.2 * 3.2;
const ACTIVE_STEER_DISTANCE_SQ = 0.55 * 0.55;
const READY_SNAP_DISTANCE_SQ = 0.12 * 0.12;
const MISSING_SNAPSHOT_GRACE = 4;
const MAX_STEER_SPEED = 0.16;

function nextCapacity(required) {
  let capacity = INITIAL_CAPACITY;
  while (capacity < required) capacity *= 2;
  return capacity;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function phaseFromCode(code, position = null) {
  if (code === 1 || code === 'peg') return 'peg';
  if (code === 2 || code === 'transfer') return 'transfer';
  if (code === 0 || code === 'board') return 'board';
  if (position && position[1] > CONFIG.peg.exitY - 0.2 && Math.abs(position[2] - CONFIG.peg.z) < 0.85) return 'peg';
  return 'board';
}

export function unpackCoinState(raw) {
  if (Array.isArray(raw)) {
    if (
      raw.length < 8
      || typeof raw[0] !== 'string'
      || !raw.slice(1, 8).every(Number.isFinite)
    ) return null;

    const position = raw.slice(1, 4);
    const sleeping = raw.length >= 9 && raw[8] === 1;
    const hasV3Phase = raw.length >= 10 && Number.isInteger(raw[9]) && raw[9] >= 0 && raw[9] <= 2;
    const phase = phaseFromCode(hasV3Phase ? raw[9] : null, position);
    const velocityStart = hasV3Phase ? 10 : 9;

    return {
      id: raw[0],
      position,
      quaternion: raw.slice(4, 8),
      sleeping,
      phase,
      velocity: !sleeping && raw.length >= velocityStart + 3 && raw.slice(velocityStart, velocityStart + 3).every(Number.isFinite)
        ? raw.slice(velocityStart, velocityStart + 3)
        : [0, 0, 0],
      angularVelocity: !sleeping && raw.length >= velocityStart + 6 && raw.slice(velocityStart + 3, velocityStart + 6).every(Number.isFinite)
        ? raw.slice(velocityStart + 3, velocityStart + 6)
        : [0, 0, 0],
    };
  }

  if (
    !raw?.id
    || !Array.isArray(raw.position)
    || raw.position.length !== 3
    || !raw.position.every(Number.isFinite)
    || !Array.isArray(raw.quaternion)
    || raw.quaternion.length !== 4
    || !raw.quaternion.every(Number.isFinite)
  ) return null;

  return {
    id: raw.id,
    position: raw.position,
    quaternion: raw.quaternion,
    sleeping: Boolean(raw.sleeping),
    phase: phaseFromCode(raw.phase, raw.position),
    velocity: Array.isArray(raw.velocity) && raw.velocity.length === 3 && raw.velocity.every(Number.isFinite)
      ? raw.velocity
      : [0, 0, 0],
    angularVelocity: Array.isArray(raw.angularVelocity) && raw.angularVelocity.length === 3 && raw.angularVelocity.every(Number.isFinite)
      ? raw.angularVelocity
      : [0, 0, 0],
  };
}

function wrappedTimeDifference(target, current, period) {
  if (!Number.isFinite(target) || !Number.isFinite(current) || !Number.isFinite(period) || period <= 0) return 0;
  let difference = (target - current) % period;
  if (difference > period / 2) difference -= period;
  if (difference < -period / 2) difference += period;
  return difference;
}

function configureCoinPhase(coin, requestedPhase) {
  const phase = requestedPhase === 'peg' ? 'peg' : 'board';
  const body = coin.body;
  coin.phase = phase;
  coin.transfer = null;

  if (phase === 'peg') {
    body.allowSleep = false;
    body.collisionResponse = true;
    body.linearDamping = 0.018;
    body.angularDamping = 0.035;
    body.linearFactor.set(1, 1, 0);
    body.angularFactor.set(0, 0, 1);
  } else {
    body.allowSleep = true;
    body.collisionResponse = true;
    body.linearDamping = 0.12;
    body.angularDamping = 0.26;
    body.linearFactor.set(1, 1, 1);
    body.angularFactor.set(0.22, 1, 0.22);
  }
}

export class SharedWorldView {
  constructor({ scene, coinGeometry, coinMaterials, pusherMesh }) {
    this.scene = scene;
    this.coinGeometry = coinGeometry;
    this.coinMaterials = coinMaterials;
    this.pusherMesh = pusherMesh;
    this.engine = new WorldEngine({
      seed: 0x59455350,
      seedMachine: false,
      onEvent: () => {},
    });
    this.coins = new Map();
    this.order = [];
    this.capacity = INITIAL_CAPACITY;
    this.hasSnapshot = false;
    this.lastRevision = 0;
    this.turnState = 'ready';
    this.matrixObject = new THREE.Object3D();
    this.instanceMesh = this.createInstanceMesh(this.capacity);
    this.scene.add(this.instanceMesh);
  }

  createInstanceMesh(capacity) {
    const mesh = new THREE.InstancedMesh(this.coinGeometry, this.coinMaterials, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.name = 'shared-world-coins-local-physics';
    return mesh;
  }

  ensureCapacity(required) {
    if (required <= this.capacity) return;
    const replacementCapacity = nextCapacity(required);
    const replacement = this.createInstanceMesh(replacementCapacity);
    this.scene.remove(this.instanceMesh);
    this.instanceMesh.dispose?.();
    this.instanceMesh = replacement;
    this.capacity = replacementCapacity;
    this.scene.add(replacement);
  }

  writeMatrix(index, coin) {
    const body = coin.body;
    this.matrixObject.position.set(body.position.x, body.position.y, body.position.z);
    this.matrixObject.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    this.matrixObject.scale.set(1, 1, 1);
    this.matrixObject.updateMatrix();
    this.instanceMesh.setMatrixAt(index, this.matrixObject.matrix);
  }

  rebuildOrder() {
    this.order = this.engine.coins.filter((coin) => coin.body.world);
    this.coins = new Map(this.order.map((coin) => [coin.id, coin]));
    this.ensureCapacity(this.order.length);
    this.instanceMesh.count = this.order.length;
  }

  createCoinFromState(state) {
    const requestedPhase = state.phase === 'peg' ? 'peg' : 'board';
    const coin = this.engine.createCoin({
      x: state.position[0],
      y: state.position[1],
      z: state.position[2],
      flat: requestedPhase !== 'peg',
      rotationY: 0,
      phase: requestedPhase,
      id: state.id,
      startAsleep: false,
    });
    configureCoinPhase(coin, requestedPhase);
    this.applyStateDirectly(coin, state);
    coin.missingSnapshots = 0;
    return coin;
  }

  applyStateDirectly(coin, state) {
    const body = coin.body;
    const requestedPhase = state.phase === 'peg' ? 'peg' : 'board';
    if (coin.phase !== requestedPhase) configureCoinPhase(coin, requestedPhase);
    body.position.set(...state.position);
    body.quaternion.set(...state.quaternion);
    body.velocity.set(...state.velocity);
    body.angularVelocity.set(...state.angularVelocity);
    body.aabbNeedsUpdate = true;
    if (state.sleeping && requestedPhase === 'board') body.sleep();
    else body.wakeUp();
  }

  softlySteerCoin(coin, state) {
    const body = coin.body;
    const dx = state.position[0] - body.position.x;
    const dy = state.position[1] - body.position.y;
    const dz = state.position[2] - body.position.z;
    body.velocity.x += clamp(dx * 0.10, -MAX_STEER_SPEED, MAX_STEER_SPEED);
    body.velocity.z += clamp(dz * 0.10, -MAX_STEER_SPEED, MAX_STEER_SPEED);
    body.velocity.y += clamp(dy * 0.04, -0.05, 0.05);
    body.wakeUp();
  }

  reconcileCoin(coin, state, { initial = false, ready = false } = {}) {
    const body = coin.body;
    const requestedPhase = state.phase === 'peg' ? 'peg' : 'board';
    const dx = state.position[0] - body.position.x;
    const dy = state.position[1] - body.position.y;
    const dz = state.position[2] - body.position.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;

    if (initial) {
      this.applyStateDirectly(coin, state);
      return;
    }

    if (requestedPhase === 'peg' && coin.phase !== 'peg') {
      this.applyStateDirectly(coin, state);
      return;
    }

    if (ready && state.sleeping && distanceSq > READY_SNAP_DISTANCE_SQ) {
      this.applyStateDirectly(coin, state);
      return;
    }

    if (ready && distanceSq > 0.65 * 0.65) {
      this.applyStateDirectly(coin, state);
      return;
    }

    if (distanceSq > EXTREME_DRIFT_DISTANCE_SQ) {
      // A reconnect or a locally retired payout can leave a body several machine
      // widths away. Correct only those impossible divergences; normal motion is
      // never position-extrapolated or snapped between network frames.
      this.applyStateDirectly(coin, state);
      return;
    }

    if (!ready && distanceSq > ACTIVE_STEER_DISTANCE_SQ) this.softlySteerCoin(coin, state);
  }

  syncPusher(snapshot, initial = false) {
    const serverTime = Number(snapshot?.serverTime);
    const snapshotAge = Number.isFinite(serverTime)
      ? clamp((Date.now() - serverTime) / 1000, 0, 0.5)
      : 0;
    const targetTime = Number.isFinite(snapshot?.pusherTime)
      ? Number(snapshot.pusherTime) + snapshotAge
      : null;

    if (targetTime === null) return;
    if (initial) {
      this.engine.pusherTime = targetTime;
      this.engine.updatePusher(0.0001);
      return;
    }

    const difference = wrappedTimeDifference(targetTime, this.engine.pusherTime, CONFIG.pusher.period);
    if (Math.abs(difference) > 1.15) this.engine.pusherTime += difference;
    else this.engine.pusherTime += difference * 0.16;
  }

  applySnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.coins)) return;
    const initial = !this.hasSnapshot;
    const ready = (snapshot.turn?.state ?? 'ready') === 'ready';
    this.turnState = snapshot.turn?.state ?? this.turnState;
    this.lastRevision = Number(snapshot.revision) || this.lastRevision;
    this.syncPusher(snapshot, initial);

    const present = new Set();
    let membershipChanged = false;

    for (const raw of snapshot.coins) {
      const state = unpackCoinState(raw);
      if (!state) continue;
      present.add(state.id);

      let coin = this.coins.get(state.id) ?? this.engine.coinById.get(state.id);
      if (!coin) {
        // Do not resurrect a payout that the server is already showing below the
        // collection area while two snapshots cross in flight.
        if (state.position[1] < -2.8 || state.position[2] > CONFIG.board.front + 3.0) continue;
        coin = this.createCoinFromState(state);
        membershipChanged = true;
      } else {
        coin.missingSnapshots = 0;
        this.reconcileCoin(coin, state, { initial, ready });
      }
    }

    for (const coin of [...this.engine.coins]) {
      if (present.has(coin.id)) continue;
      coin.missingSnapshots = (coin.missingSnapshots ?? 0) + 1;
      if (ready || coin.missingSnapshots >= MISSING_SNAPSHOT_GRACE || !coin.body.world) {
        this.engine.removeCoin(coin);
        membershipChanged = true;
      }
    }

    if (membershipChanged || initial) this.rebuildOrder();
    this.hasSnapshot = true;
  }

  update(dt) {
    if (!this.hasSnapshot) return;
    const safeDt = clamp(Number(dt) || 0, 0, 0.05);
    this.engine.advance(safeDt);

    let membershipChanged = false;
    for (const coin of [...this.order]) {
      if (coin.body.world) continue;
      this.coins.delete(coin.id);
      membershipChanged = true;
    }
    if (membershipChanged) this.rebuildOrder();

    for (let index = 0; index < this.order.length; index += 1) this.writeMatrix(index, this.order[index]);
    this.instanceMesh.count = this.order.length;
    this.instanceMesh.instanceMatrix.needsUpdate = true;

    if (this.pusherMesh) this.pusherMesh.position.z = this.engine.pusher.z;
  }

  clear() {
    this.engine.clearCoins();
    this.coins.clear();
    this.order = [];
    this.instanceMesh.count = 0;
    this.instanceMesh.instanceMatrix.needsUpdate = true;
    this.hasSnapshot = false;
  }
}
