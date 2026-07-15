import * as THREE from 'three';
import { SharedWorldView } from './shared-world-view.js';

const PATCH_KEY = Symbol.for('yes-pusher:live-stream-view-patch');

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function isLiveStreamSnapshot(snapshot) {
  return Boolean(
    snapshot
    && snapshot.kind === 'yes-pusher-shared-world'
    && snapshot.syncMode === 'live-stream'
    && Array.isArray(snapshot.coins)
  );
}

function installLiveStreamViewPatch() {
  const prototype = SharedWorldView.prototype;
  if (prototype[PATCH_KEY]) return;

  const applySnapshot = prototype.applySnapshot;
  const update = prototype.update;
  const clear = prototype.clear;

  prototype.renderLiveStreamFrame = function renderLiveStreamFrame(at = nowMs()) {
    if (!this.liveStreamActive) return false;
    const duration = Math.max(1, Number(this.liveStreamDurationMs) || 90);
    const alpha = clamp((at - Number(this.liveStreamStartedAt || at)) / duration, 0, 1);

    for (const coin of this.order) {
      if (!coin.liveFromPosition || !coin.liveToPosition) continue;
      coin.position.copy(coin.liveFromPosition).lerp(coin.liveToPosition, alpha);
      coin.quaternion.copy(coin.liveFromQuaternion).slerp(coin.liveToQuaternion, alpha).normalize();
    }

    if (this.pusherMesh && Number.isFinite(this.livePusherFrom) && Number.isFinite(this.livePusherTo)) {
      this.pusherMesh.position.z = THREE.MathUtils.lerp(this.livePusherFrom, this.livePusherTo, alpha);
    }

    this.renderMatrices();
    return true;
  };

  prototype.applyLiveStreamSnapshot = function applyLiveStreamSnapshot(snapshot) {
    const receivedAt = nowMs();
    this.renderLiveStreamFrame(receivedAt);

    if (!this.liveStreamActive || !this.hasSnapshot) {
      const loaded = this.loadBoundary(snapshot);
      if (!loaded) return false;
      for (const coin of this.order) {
        coin.liveFromPosition = coin.position.clone();
        coin.liveToPosition = coin.position.clone();
        coin.liveFromQuaternion = coin.quaternion.clone();
        coin.liveToQuaternion = coin.quaternion.clone();
      }
      this.livePusherFrom = Number(snapshot.pusherZ);
      this.livePusherTo = Number(snapshot.pusherZ);
      this.liveStreamDurationMs = 1000 / Math.max(1, Number(snapshot.streamRate) || 12);
      this.liveStreamStartedAt = receivedAt;
      this.liveStreamLastReceivedAt = receivedAt;
      this.liveStreamActive = true;
      this.activeReplayId = null;
      this.replayPackage = null;
      this.boundaryId = snapshot.boundaryId ?? this.boundaryId;
      this.lastRevision = Number(snapshot.revision) || this.lastRevision;
      this.turnState = snapshot.turn?.state ?? this.turnState;
      this.currentSlotIndex = Number.isInteger(snapshot.activeSlotIndex) ? snapshot.activeSlotIndex : -1;
      this.syncToyBoundary?.(snapshot.toys ?? []);
      this.renderMatrices();
      return true;
    }

    const previousReceivedAt = Number(this.liveStreamLastReceivedAt) || receivedAt;
    const measuredInterval = receivedAt - previousReceivedAt;
    const nominalInterval = 1000 / Math.max(1, Number(snapshot.streamRate) || 12);
    this.liveStreamDurationMs = clamp(
      Number.isFinite(measuredInterval) && measuredInterval > 0 ? measuredInterval : nominalInterval,
      40,
      250,
    );
    this.liveStreamStartedAt = receivedAt;
    this.liveStreamLastReceivedAt = receivedAt;

    const states = this.decodedFrame({ coins: snapshot.coins });
    const ids = [];
    const nextCoins = new Map();

    for (const raw of snapshot.coins) {
      const id = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw?.id ?? '');
      if (!id) continue;
      const target = states.get(id);
      if (!target) continue;
      const coin = this.coins.get(id) ?? {
        id,
        phase: target.phase,
        position: new THREE.Vector3(...target.position),
        quaternion: new THREE.Quaternion(...target.quaternion),
      };

      coin.phase = target.phase;
      coin.skinId = target.skinId ?? coin.skinId ?? null;
      coin.skinImageUrl = target.skinImageUrl ?? coin.skinImageUrl ?? null;
      coin.liveFromPosition = coin.position.clone();
      coin.liveToPosition = new THREE.Vector3(...target.position);
      coin.liveFromQuaternion = coin.quaternion.clone();
      coin.liveToQuaternion = new THREE.Quaternion(...target.quaternion).normalize();
      nextCoins.set(id, coin);
      ids.push(id);
    }

    this.coins = nextCoins;
    this.rebuildOrder(ids);
    this.livePusherFrom = Number.isFinite(Number(this.pusherMesh?.position?.z))
      ? Number(this.pusherMesh.position.z)
      : Number(snapshot.pusherZ) || 0;
    this.livePusherTo = Number.isFinite(Number(snapshot.pusherZ))
      ? Number(snapshot.pusherZ)
      : this.livePusherFrom;
    this.currentSlotIndex = Number.isInteger(snapshot.activeSlotIndex) ? snapshot.activeSlotIndex : -1;
    this.turnState = snapshot.turn?.state ?? this.turnState;
    this.boundaryId = snapshot.boundaryId ?? this.boundaryId;
    this.lastRevision = Number(snapshot.revision) || this.lastRevision;
    this.hasSnapshot = true;
    this.activeReplayId = null;
    this.replayPackage = null;
    this.syncToyBoundary?.(snapshot.toys ?? []);
    this.renderLiveStreamFrame(receivedAt);
    return true;
  };

  prototype.applySnapshot = function applySnapshotWithLiveStream(snapshot) {
    if (isLiveStreamSnapshot(snapshot)) return this.applyLiveStreamSnapshot(snapshot);
    this.liveStreamActive = false;
    return applySnapshot.call(this, snapshot);
  };

  prototype.update = function updateLiveStream(...args) {
    if (this.liveStreamActive) {
      this.renderLiveStreamFrame();
      return;
    }
    return update.apply(this, args);
  };

  prototype.clear = function clearLiveStream(...args) {
    this.liveStreamActive = false;
    this.liveStreamStartedAt = 0;
    this.liveStreamLastReceivedAt = 0;
    this.liveStreamDurationMs = 0;
    this.livePusherFrom = null;
    this.livePusherTo = null;
    return clear.apply(this, args);
  };

  Object.defineProperty(prototype, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installLiveStreamViewPatch();

export { installLiveStreamViewPatch, isLiveStreamSnapshot };
