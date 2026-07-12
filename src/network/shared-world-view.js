import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config/machine-config.js';
import { WorldEngine } from '../game/world-engine.js';

const INITIAL_CAPACITY = 256;

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
    const hasPhase = raw.length >= 10 && Number.isInteger(raw[9]) && raw[9] >= 0 && raw[9] <= 2;
    const phase = phaseFromCode(hasPhase ? raw[9] : null, position);
    const velocityStart = hasPhase ? 10 : 9;

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

function shouldUsePlanarBoard(engine, state) {
  return state.phase !== 'peg'
    && state.phase !== 'transfer'
    && state.position[1] <= engine.coinRestY + 0.05
    && state.position[2] < CONFIG.board.front - 0.06;
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
    this.boundaryId = null;
    this.activeReplayId = null;
    this.replayElapsed = 0;
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
    mesh.name = 'shared-world-coins-turn-replay';
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
    const requestedPhase = state.phase === 'peg' ? 'peg' : state.phase === 'transfer' ? 'transfer' : 'board';
    const coin = this.engine.createCoin({
      x: state.position[0],
      y: state.position[1],
      z: state.position[2],
      flat: requestedPhase !== 'peg',
      rotationY: 0,
      phase: requestedPhase === 'transfer' ? 'board' : requestedPhase,
      id: state.id,
      startAsleep: false,
      planar: requestedPhase === 'board' && shouldUsePlanarBoard(this.engine, state),
    });
    const body = coin.body;
    coin.phase = requestedPhase;
    coin.transfer = null;
    body.position.set(...state.position);
    body.quaternion.set(...state.quaternion);
    body.velocity.set(...state.velocity);
    body.angularVelocity.set(...state.angularVelocity);

    if (requestedPhase === 'peg') {
      body.allowSleep = false;
      body.linearFactor.set(1, 1, 0);
      body.angularFactor.set(0, 0, 1);
    } else if (shouldUsePlanarBoard(this.engine, state)) {
      this.engine.configurePlanarBoardCoin(coin, { preserveSleep: true });
    } else {
      this.engine.configureFreeBoardCoin(coin, {
        falling: requestedPhase === 'transfer' || state.position[2] >= CONFIG.board.front - 0.06,
      });
    }

    body.aabbNeedsUpdate = true;
    if (state.sleeping && requestedPhase === 'board') body.sleep();
    else body.wakeUp();
    return coin;
  }

  loadBoundary(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.coins)) return false;
    this.engine.initializeEmptyMachine();
    for (const raw of snapshot.coins) {
      const state = unpackCoinState(raw);
      if (!state) continue;
      if (state.position[1] < -2.8 || state.position[2] > CONFIG.board.front + 3.0) continue;
      this.createCoinFromState(state);
    }

    const pusherTime = Number(snapshot.pusherTime);
    this.engine.pusherTime = Number.isFinite(pusherTime) ? pusherTime : 0;
    this.engine.pusher.z = Number.isFinite(Number(snapshot.pusherZ))
      ? Number(snapshot.pusherZ)
      : CONFIG.pusher.rearZ;
    this.engine.pusher.lastZ = this.engine.pusher.z;
    this.engine.pusher.velocity = 0;
    this.engine.pusher.pushing = false;
    this.engine.pusher.body.position.set(0, CONFIG.pusher.y, this.engine.pusher.z);
    this.engine.pusher.body.velocity.set(0, 0, 0);
    this.engine.pusher.body.aabbNeedsUpdate = true;

    this.rebuildOrder();
    this.hasSnapshot = true;
    this.activeReplayId = null;
    this.replayElapsed = 0;
    this.turnState = 'ready';
    return true;
  }

  beginTurnReplay(snapshot) {
    const replay = snapshot?.replay;
    if (!replay?.turnId || !Array.isArray(snapshot?.coins)) return false;
    if (this.activeReplayId === replay.turnId) return true;

    this.loadBoundary({
      coins: snapshot.coins,
      pusherTime: snapshot.pusherTime,
      pusherZ: snapshot.pusherZ,
    });

    this.engine.startTurn({
      playerId: replay.playerId ?? null,
      coinsDropped: replay.coinsDropped,
      slotPlan: replay.slotPlan,
      id: replay.turnId,
      seed: replay.seed,
      startedAt: replay.startedAt,
    });

    const elapsedSeconds = clamp(
      Number(replay.elapsedSeconds)
        || Math.max(0, (Number(snapshot.serverTime) - Number(replay.startedAt)) / 1000)
        || 0,
      0,
      38,
    );
    if (elapsedSeconds > 0.001) this.engine.fastForward(elapsedSeconds);

    this.activeReplayId = replay.turnId;
    this.replayElapsed = elapsedSeconds;
    this.turnState = snapshot.turn?.state ?? 'active';
    this.rebuildOrder();
    return true;
  }

  applySnapshot(snapshot) {
    if (!snapshot) return;
    this.lastRevision = Number(snapshot.revision) || this.lastRevision;
    this.turnState = snapshot.turn?.state ?? this.turnState;

    if (snapshot.syncMode === 'turn-replay' && snapshot.replay?.turnId) {
      if (this.activeReplayId !== snapshot.replay.turnId) {
        this.beginTurnReplay(snapshot);
      } else {
        const targetElapsed = clamp(Number(snapshot.replay.elapsedSeconds) || 0, 0, 38);
        const missingTime = targetElapsed - this.replayElapsed;
        // Normal foreground rendering stays completely local. Only a tab that
        // was throttled or suspended fast-forwards through the missing physics.
        if (missingTime > 0.75) {
          this.engine.fastForward(missingTime);
          this.replayElapsed = targetElapsed;
        }
      }
      return;
    }

    const boundaryId = snapshot.boundaryId ?? `boundary-${snapshot.turn?.nextTurnNumber ?? 0}`;
    if (!this.hasSnapshot || this.boundaryId !== boundaryId || this.activeReplayId) {
      this.loadBoundary(snapshot);
      this.boundaryId = boundaryId;
    }
  }

  update(dt) {
    if (!this.hasSnapshot) return;
    const safeDt = clamp(Number(dt) || 0, 0, 0.05);
    this.engine.advance(safeDt);
    if (this.activeReplayId) this.replayElapsed += safeDt;

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

  activeSlotIndex() {
    return Number.isInteger(this.engine.activeSlotIndex) ? this.engine.activeSlotIndex : -1;
  }

  clear() {
    this.engine.clearCoins();
    this.coins.clear();
    this.order = [];
    this.instanceMesh.count = 0;
    this.instanceMesh.instanceMatrix.needsUpdate = true;
    this.hasSnapshot = false;
    this.boundaryId = null;
    this.activeReplayId = null;
    this.replayElapsed = 0;
  }
}
