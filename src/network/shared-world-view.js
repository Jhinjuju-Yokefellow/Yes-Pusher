import * as THREE from 'three';
import { CONFIG } from '../config/machine-config.js';
import { isReplayPackage, replayFramesAt } from '../game/replay-package.js';
import { worldServerUrl } from './world-server-url.js';

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

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
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

function createRenderCoin(state) {
  return {
    id: state.id,
    phase: state.phase,
    position: new THREE.Vector3(...state.position),
    quaternion: new THREE.Quaternion(...state.quaternion),
  };
}

async function defaultReplayLoader(packageUrl) {
  const url = worldServerUrl(packageUrl);
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
    headers: { accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !isReplayPackage(payload)) {
    throw new Error(payload?.error || `Recorded replay could not be loaded (${response.status})`);
  }
  return payload;
}

export class SharedWorldView {
  constructor({
    scene,
    coinGeometry,
    coinMaterials,
    pusherMesh,
    fetchReplayPackage = defaultReplayLoader,
    onReplayEvent = () => {},
    onReplayError = () => {},
  }) {
    this.scene = scene;
    this.coinGeometry = coinGeometry;
    this.coinMaterials = coinMaterials;
    this.pusherMesh = pusherMesh;
    this.fetchReplayPackage = fetchReplayPackage;
    this.onReplayEvent = onReplayEvent;
    this.onReplayError = onReplayError;
    this.coins = new Map();
    this.order = [];
    this.capacity = INITIAL_CAPACITY;
    this.hasSnapshot = false;
    this.lastRevision = 0;
    this.boundaryId = null;
    this.activeReplayId = null;
    this.replayPackage = null;
    this.replayLoadPromise = null;
    this.replayLoadId = null;
    this.replayAnchorElapsed = 0;
    this.replayAnchorLocalMs = nowMs();
    this.replayDurationSeconds = 0;
    this.replayInitialElapsed = 0;
    this.replayElapsed = 0;
    this.turnState = 'ready';
    this.currentSlotIndex = -1;
    this.emittedReplayEvents = new Set();
    this.frameCache = new WeakMap();
    this.matrixObject = new THREE.Object3D();
    this.interpolationPosition = new THREE.Vector3();
    this.interpolationQuaternion = new THREE.Quaternion();
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
    mesh.name = 'shared-world-coins-recorded-replay';
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
    this.matrixObject.position.copy(coin.position);
    this.matrixObject.quaternion.copy(coin.quaternion);
    this.matrixObject.scale.set(1, 1, 1);
    this.matrixObject.updateMatrix();
    this.instanceMesh.setMatrixAt(index, this.matrixObject.matrix);
  }

  rebuildOrder(ids = null) {
    const orderedIds = ids ?? [...this.coins.keys()];
    this.order = orderedIds.map((id) => this.coins.get(id)).filter(Boolean);
    this.ensureCapacity(this.order.length);
    this.instanceMesh.count = this.order.length;
  }

  loadBoundary(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.coins)) return false;
    this.coins.clear();
    const ids = [];
    for (const raw of snapshot.coins) {
      const state = unpackCoinState(raw);
      if (!state) continue;
      if (state.position[1] < -2.8 || state.position[2] > CONFIG.board.front + 3.0) continue;
      this.coins.set(state.id, createRenderCoin(state));
      ids.push(state.id);
    }

    this.rebuildOrder(ids);
    this.hasSnapshot = true;
    this.activeReplayId = null;
    this.replayPackage = null;
    this.replayLoadId = null;
    this.replayAnchorElapsed = 0;
    this.replayElapsed = 0;
    this.replayDurationSeconds = 0;
    this.replayInitialElapsed = 0;
    this.turnState = 'ready';
    this.currentSlotIndex = Number.isInteger(snapshot.activeSlotIndex) ? snapshot.activeSlotIndex : -1;
    this.emittedReplayEvents.clear();
    if (this.pusherMesh) {
      this.pusherMesh.position.z = Number.isFinite(Number(snapshot.pusherZ))
        ? Number(snapshot.pusherZ)
        : CONFIG.pusher.rearZ;
    }
    this.renderMatrices();
    return true;
  }

  decodedFrame(frame) {
    if (!frame) return new Map();
    const cached = this.frameCache.get(frame);
    if (cached) return cached;
    const states = new Map();
    for (const raw of frame.coins ?? []) {
      const state = unpackCoinState(raw);
      if (state) states.set(state.id, state);
    }
    this.frameCache.set(frame, states);
    return states;
  }

  async loadRecordedReplay(descriptor) {
    const turnId = descriptor?.turnId;
    const packageUrl = descriptor?.packageUrl;
    if (!turnId || !packageUrl) return null;
    if (this.replayPackage?.id === turnId) return this.replayPackage;
    if (this.replayLoadPromise && this.replayLoadId === turnId) return this.replayLoadPromise;

    this.replayLoadId = turnId;
    this.replayLoadPromise = Promise.resolve(this.fetchReplayPackage(packageUrl, descriptor))
      .then((replayPackage) => {
        if (!isReplayPackage(replayPackage)) throw new Error('Recorded replay package is invalid');
        if (this.activeReplayId !== turnId) return null;
        this.replayPackage = replayPackage;
        this.replayDurationSeconds = Number(replayPackage.durationSeconds) || 0;
        const elapsed = this.currentReplayElapsed();
        for (const event of replayPackage.events ?? []) {
          if (Number(event.at) <= this.replayInitialElapsed) this.emittedReplayEvents.add(event.id);
        }
        this.seekReplay(elapsed, { emitEvents: true });
        return replayPackage;
      })
      .catch((error) => {
        if (this.activeReplayId === turnId) this.onReplayError(error);
        return null;
      })
      .finally(() => {
        if (this.replayLoadId === turnId) {
          this.replayLoadPromise = null;
          this.replayLoadId = null;
        }
      });
    return this.replayLoadPromise;
  }

  beginRecordedReplay(snapshot) {
    const replay = snapshot?.replay;
    if (!replay?.turnId || !replay?.packageUrl) return false;

    if (this.activeReplayId !== replay.turnId) {
      if (Array.isArray(snapshot.coins)) {
        this.loadBoundary({
          coins: snapshot.coins,
          pusherZ: snapshot.pusherZ,
          activeSlotIndex: snapshot.activeSlotIndex,
        });
      }
      this.activeReplayId = replay.turnId;
      this.replayPackage = null;
      this.replayDurationSeconds = Number(replay.durationSeconds) || 0;
      this.replayInitialElapsed = clamp(Number(replay.elapsedSeconds) || 0, 0, Number(replay.durationSeconds) || 90);
      this.emittedReplayEvents.clear();
    }

    this.replayAnchorElapsed = clamp(Number(replay.elapsedSeconds) || 0, 0, Number(replay.durationSeconds) || 90);
    this.replayAnchorLocalMs = nowMs();
    this.replayElapsed = this.replayAnchorElapsed;
    this.turnState = snapshot.turn?.state ?? 'active';
    void this.loadRecordedReplay(replay);
    return true;
  }

  applySnapshot(snapshot) {
    if (!snapshot) return;
    this.lastRevision = Number(snapshot.revision) || this.lastRevision;
    this.turnState = snapshot.turn?.state ?? this.turnState;

    if (snapshot.syncMode === 'recorded-replay' && snapshot.replay?.turnId) {
      this.beginRecordedReplay(snapshot);
      return;
    }

    if (snapshot.syncMode === 'preparing') {
      const boundaryId = snapshot.boundaryId ?? this.boundaryId;
      if (!this.hasSnapshot || this.boundaryId !== boundaryId || this.activeReplayId) {
        this.loadBoundary(snapshot);
        this.boundaryId = boundaryId;
      }
      this.turnState = 'preparing';
      return;
    }

    const boundaryId = snapshot.boundaryId ?? `boundary-${snapshot.turn?.nextTurnNumber ?? 0}`;
    if (!this.hasSnapshot || this.boundaryId !== boundaryId || this.activeReplayId) {
      this.loadBoundary(snapshot);
      this.boundaryId = boundaryId;
    }
  }

  currentReplayElapsed() {
    if (!this.activeReplayId) return 0;
    const elapsed = this.replayAnchorElapsed + Math.max(0, nowMs() - this.replayAnchorLocalMs) / 1000;
    const maximum = this.replayDurationSeconds || Number(this.replayPackage?.durationSeconds) || 90;
    return clamp(elapsed, 0, maximum);
  }

  emitReplayEventsThrough(elapsedSeconds) {
    for (const event of this.replayPackage?.events ?? []) {
      if (Number(event.at) > elapsedSeconds || this.emittedReplayEvents.has(event.id)) continue;
      this.emittedReplayEvents.add(event.id);
      this.onReplayEvent(event, this.replayPackage);
    }
  }

  seekReplay(elapsedSeconds, { emitEvents = true } = {}) {
    if (!this.replayPackage) return false;
    const elapsed = clamp(Number(elapsedSeconds) || 0, 0, Number(this.replayPackage.durationSeconds) || 0);
    const { previous, next, alpha } = replayFramesAt(this.replayPackage, elapsed);
    if (!previous) return false;

    const previousStates = this.decodedFrame(previous);
    const nextStates = this.decodedFrame(next ?? previous);
    const ids = [...previousStates.keys()];
    for (const id of nextStates.keys()) if (!previousStates.has(id)) ids.push(id);

    const nextCoins = new Map();
    for (const id of ids) {
      const a = previousStates.get(id);
      const b = nextStates.get(id);
      if (!a && !b) continue;
      if (!a) {
        if (alpha >= 0.999) nextCoins.set(id, createRenderCoin(b));
        continue;
      }
      if (!b) {
        if (alpha < 0.999) nextCoins.set(id, createRenderCoin(a));
        continue;
      }

      const coin = this.coins.get(id) ?? createRenderCoin(a);
      coin.phase = alpha < 0.5 ? a.phase : b.phase;
      this.interpolationPosition.set(...b.position);
      this.interpolationQuaternion.set(...b.quaternion);
      coin.position.set(...a.position).lerp(this.interpolationPosition, alpha);
      coin.quaternion.set(...a.quaternion).slerp(this.interpolationQuaternion, alpha).normalize();
      nextCoins.set(id, coin);
    }

    this.coins = nextCoins;
    this.rebuildOrder(ids.filter((id) => nextCoins.has(id)));
    this.currentSlotIndex = alpha < 0.5
      ? (Number.isInteger(previous.activeSlotIndex) ? previous.activeSlotIndex : -1)
      : (Number.isInteger(next?.activeSlotIndex) ? next.activeSlotIndex : -1);
    if (this.pusherMesh) {
      const previousZ = Number(previous.pusherZ) || CONFIG.pusher.rearZ;
      const nextZ = Number(next?.pusherZ);
      this.pusherMesh.position.z = THREE.MathUtils.lerp(
        previousZ,
        Number.isFinite(nextZ) ? nextZ : previousZ,
        alpha,
      );
    }
    this.replayElapsed = elapsed;
    if (emitEvents) this.emitReplayEventsThrough(elapsed);
    this.renderMatrices();
    return true;
  }

  renderMatrices() {
    for (let index = 0; index < this.order.length; index += 1) this.writeMatrix(index, this.order[index]);
    this.instanceMesh.count = this.order.length;
    this.instanceMesh.instanceMatrix.needsUpdate = true;
  }

  update() {
    if (!this.hasSnapshot) return;
    if (this.activeReplayId && this.replayPackage) {
      this.seekReplay(this.currentReplayElapsed());
      return;
    }
    this.renderMatrices();
  }

  activeSlotIndex() {
    return Number.isInteger(this.currentSlotIndex) ? this.currentSlotIndex : -1;
  }

  clear() {
    this.coins.clear();
    this.order = [];
    this.instanceMesh.count = 0;
    this.instanceMesh.instanceMatrix.needsUpdate = true;
    this.hasSnapshot = false;
    this.boundaryId = null;
    this.activeReplayId = null;
    this.replayPackage = null;
    this.replayLoadPromise = null;
    this.replayLoadId = null;
    this.replayAnchorElapsed = 0;
    this.replayElapsed = 0;
    this.replayDurationSeconds = 0;
    this.replayInitialElapsed = 0;
    this.currentSlotIndex = -1;
    this.emittedReplayEvents.clear();
  }
}
