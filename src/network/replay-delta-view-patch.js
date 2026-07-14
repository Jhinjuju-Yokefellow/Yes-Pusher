import * as THREE from 'three';
import { CONFIG } from '../config/machine-config.js';
import { replayFramesAt } from '../game/replay-package.js';
import {
  applyCoinDeltaFrame,
  initialCoinDeltaState,
  isCoinDeltaReplay,
} from '../game/replay-coin-delta.js';
import { SharedWorldView, unpackCoinState } from './shared-world-view.js';

const PATCH_KEY = Symbol.for('yes-pusher:replay-delta-view-patch');

function skinIdFromValues(values) {
  const sleeping = values?.[7] === 1;
  const index = sleeping ? 9 : 15;
  return typeof values?.[index] === 'string' && values[index] ? values[index] : null;
}

function renderState(coinIds, index, values) {
  const id = coinIds?.[index];
  if (typeof id !== 'string' || !Array.isArray(values)) return null;
  const unpacked = unpackCoinState([id, ...values]);
  if (!unpacked) return null;
  return { ...unpacked, skinId: skinIdFromValues(values) };
}

function setCoinState(coin, state) {
  coin.phase = state.phase;
  coin.skinId = state.skinId ?? null;
  coin.position.set(...state.position);
  coin.quaternion.set(...state.quaternion).normalize();
}

function createCoinState(state) {
  return {
    id: state.id,
    phase: state.phase,
    skinId: state.skinId ?? null,
    position: new THREE.Vector3(...state.position),
    quaternion: new THREE.Quaternion(...state.quaternion).normalize(),
  };
}

function writeCoinMatrix(view, mesh, index, coin) {
  view.matrixObject.position.copy(coin.position);
  view.matrixObject.quaternion.copy(coin.quaternion);
  view.matrixObject.scale.set(1, 1, 1);
  view.matrixObject.updateMatrix();
  mesh.setMatrixAt(index, view.matrixObject.matrix);
  mesh.instanceMatrix.addUpdateRange?.(index * 16, 16);
  mesh.instanceMatrix.needsUpdate = true;
}

function skinMeshState(view, skinId, required) {
  if (!skinId || typeof view.createSkinMeshState !== 'function') return null;
  view.ensureSkinRendering?.();
  let state = view.skinMeshes?.get(skinId) ?? view.createSkinMeshState(skinId, Math.max(64, required));
  if (!state) return null;
  if (typeof view.ensureSkinCapacity === 'function') state = view.ensureSkinCapacity(state, required);
  return state;
}

function rebuildReplayLayout(view) {
  view.ensureSkinRendering?.();
  const starter = [];
  const requestedSkins = new Map();
  const resolvedSkins = [];

  for (const coin of view.coins.values()) {
    const skinId = coin.skinId ?? '';
    if (!skinId) {
      starter.push(coin);
      continue;
    }
    const list = requestedSkins.get(skinId) ?? [];
    list.push(coin);
    requestedSkins.set(skinId, list);
  }

  for (const [skinId, coins] of requestedSkins) {
    const state = skinMeshState(view, skinId, coins.length);
    if (state) resolvedSkins.push({ skinId, coins, state });
    else starter.push(...coins);
  }

  for (const state of view.skinMeshes?.values?.() ?? []) {
    state.mesh.count = 0;
    state.mesh.instanceMatrix.clearUpdateRanges?.();
  }
  view.ensureCapacity(starter.length);
  view.instanceMesh.instanceMatrix.clearUpdateRanges?.();
  view.deltaReplaySlots = new Map();

  for (let index = 0; index < starter.length; index += 1) {
    const coin = starter[index];
    view.deltaReplaySlots.set(coin.id, {
      mesh: view.instanceMesh,
      index,
      skinId: coin.skinId ?? '',
    });
    writeCoinMatrix(view, view.instanceMesh, index, coin);
  }
  view.instanceMesh.count = starter.length;
  view.instanceMesh.instanceMatrix.needsUpdate = true;

  for (const { skinId, coins, state } of resolvedSkins) {
    state.mesh.instanceMatrix.clearUpdateRanges?.();
    for (let index = 0; index < coins.length; index += 1) {
      const coin = coins[index];
      view.deltaReplaySlots.set(coin.id, { mesh: state.mesh, index, skinId });
      writeCoinMatrix(view, state.mesh, index, coin);
    }
    state.mesh.count = coins.length;
    state.mesh.instanceMatrix.needsUpdate = true;
  }

  view.order = [...view.coins.values()];
  view.renderToys?.();
}

function writeChangedCoin(view, coin) {
  const slot = view.deltaReplaySlots?.get(coin.id);
  if (!slot || slot.skinId !== (coin.skinId ?? '')) {
    rebuildReplayLayout(view);
    return;
  }
  writeCoinMatrix(view, slot.mesh, slot.index, coin);
}

function resetDeltaReplay(view, replayPackage) {
  view.deltaReplayPackage = replayPackage;
  view.deltaReplayFrameIndex = -1;
  view.deltaReplayState = initialCoinDeltaState(replayPackage);
  view.deltaReplaySlots = new Map();

  const liveIds = new Set();
  for (const [index, values] of view.deltaReplayState) {
    const state = renderState(replayPackage.coinIds, index, values);
    if (!state) continue;
    liveIds.add(state.id);
    const coin = view.coins.get(state.id) ?? createCoinState(state);
    setCoinState(coin, state);
    view.coins.set(state.id, coin);
  }
  for (const id of [...view.coins.keys()]) {
    if (!liveIds.has(id)) view.coins.delete(id);
  }
  rebuildReplayLayout(view);
}

function advanceDeltaReplay(view, targetIndex) {
  const replayPackage = view.replayPackage;
  if (view.deltaReplayPackage !== replayPackage || targetIndex < view.deltaReplayFrameIndex) {
    resetDeltaReplay(view, replayPackage);
  }

  const changed = new Set();
  const removed = new Set();
  let structureChanged = false;
  for (let frameIndex = view.deltaReplayFrameIndex + 1; frameIndex <= targetIndex; frameIndex += 1) {
    const result = applyCoinDeltaFrame(view.deltaReplayState, replayPackage.frames[frameIndex]);
    for (const index of result.changed) changed.add(index);
    for (const index of result.added) structureChanged = true;
    for (const index of result.removed) {
      removed.add(index);
      structureChanged = true;
    }
  }

  for (const index of removed) {
    const id = replayPackage.coinIds[index];
    if (id) view.coins.delete(id);
  }

  for (const index of changed) {
    const values = view.deltaReplayState.get(index);
    if (!values) continue;
    const state = renderState(replayPackage.coinIds, index, values);
    if (!state) continue;
    let coin = view.coins.get(state.id);
    if (!coin) {
      coin = createCoinState(state);
      view.coins.set(state.id, coin);
      structureChanged = true;
    } else if ((coin.skinId ?? '') !== (state.skinId ?? '')) {
      structureChanged = true;
    }
    setCoinState(coin, state);
  }

  view.deltaReplayFrameIndex = targetIndex;
  if (structureChanged) rebuildReplayLayout(view);
  else {
    for (const index of changed) {
      const id = replayPackage.coinIds[index];
      const coin = id ? view.coins.get(id) : null;
      if (coin) writeChangedCoin(view, coin);
    }
  }
}

function seekDeltaReplay(view, elapsedSeconds, { emitEvents = true } = {}) {
  const replayPackage = view.replayPackage;
  const elapsed = Math.max(0, Math.min(Number(elapsedSeconds) || 0, Number(replayPackage.durationSeconds) || 0));
  const { previous, next, alpha, index } = replayFramesAt(replayPackage, elapsed);
  if (!previous || index < 0) return false;

  advanceDeltaReplay(view, index);

  for (const encoded of next?.coinDelta?.changes ?? []) {
    if (!Array.isArray(encoded) || !Number.isInteger(encoded[0])) continue;
    const coinIndex = encoded[0];
    const sourceValues = view.deltaReplayState.get(coinIndex);
    if (!sourceValues) continue;
    const source = renderState(replayPackage.coinIds, coinIndex, sourceValues);
    const target = renderState(replayPackage.coinIds, coinIndex, encoded.slice(1));
    if (!source || !target) continue;
    const coin = view.coins.get(source.id);
    if (!coin) continue;

    coin.phase = alpha < 0.5 ? source.phase : target.phase;
    coin.position.set(...source.position);
    view.interpolationPosition.set(...target.position);
    coin.position.lerp(view.interpolationPosition, alpha);
    coin.quaternion.set(...source.quaternion);
    view.interpolationQuaternion.set(...target.quaternion);
    coin.quaternion.slerp(view.interpolationQuaternion, alpha).normalize();
    writeChangedCoin(view, coin);
  }

  view.currentSlotIndex = alpha < 0.5
    ? (Number.isInteger(previous.activeSlotIndex) ? previous.activeSlotIndex : -1)
    : (Number.isInteger(next?.activeSlotIndex) ? next.activeSlotIndex : -1);
  if (view.pusherMesh) {
    const previousZ = Number.isFinite(Number(previous.pusherZ)) ? Number(previous.pusherZ) : CONFIG.pusher.rearZ;
    const nextZ = Number(next?.pusherZ);
    view.pusherMesh.position.z = THREE.MathUtils.lerp(
      previousZ,
      Number.isFinite(nextZ) ? nextZ : previousZ,
      alpha,
    );
  }

  view.replayElapsed = elapsed;
  if (emitEvents) view.emitReplayEventsThrough(elapsed);
  view.seekToyReplay?.(elapsed);
  view.renderToys?.();
  return true;
}

function installReplayDeltaViewPatch() {
  const prototype = SharedWorldView.prototype;
  if (prototype[PATCH_KEY]) return;

  const seekReplay = prototype.seekReplay;
  const loadBoundary = prototype.loadBoundary;
  const update = prototype.update;
  const clear = prototype.clear;

  prototype.seekReplay = function seekReplayWithCoinDeltas(elapsedSeconds, options = {}) {
    if (!isCoinDeltaReplay(this.replayPackage)) return seekReplay.call(this, elapsedSeconds, options);
    return seekDeltaReplay(this, elapsedSeconds, options);
  };

  prototype.loadBoundary = function loadBoundaryWithDeltaReset(snapshot) {
    const result = loadBoundary.call(this, snapshot);
    this.deltaReplayPackage = null;
    this.deltaReplayFrameIndex = -1;
    this.deltaReplayState = null;
    this.deltaReplaySlots = null;
    return result;
  };

  prototype.update = function updateWithoutIdleMatrixUploads(...args) {
    if (!this.activeReplayId && !this.pendingBoundarySnapshot) {
      this.updateSqueakWaveVisuals?.();
      return undefined;
    }
    if (this.activeReplayId && !this.replayPackage) {
      this.updateSqueakWaveVisuals?.();
      return undefined;
    }
    return update.apply(this, args);
  };

  prototype.clear = function clearReplayDeltaView(...args) {
    const result = clear.apply(this, args);
    this.deltaReplayPackage = null;
    this.deltaReplayFrameIndex = -1;
    this.deltaReplayState = null;
    this.deltaReplaySlots = null;
    return result;
  };

  Object.defineProperty(prototype, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installReplayDeltaViewPatch();

export {
  installReplayDeltaViewPatch,
  rebuildReplayLayout,
  renderState,
  seekDeltaReplay,
};
