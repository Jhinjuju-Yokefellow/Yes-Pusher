import * as THREE from 'three';
import { CONFIG } from '../config/machine-config.js';

const INITIAL_CAPACITY = 512;
const DEFAULT_SNAPSHOT_SECONDS = 1 / 6;
const MIN_INTERPOLATION_SECONDS = 0.07;
const MAX_INTERPOLATION_SECONDS = 0.24;
const POSITION_EPSILON_SQ = 0.0000005;
const QUATERNION_EPSILON = 0.00002;

function nextCapacity(required) {
  let capacity = INITIAL_CAPACITY;
  while (capacity < required) capacity *= 2;
  return capacity;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function unpackCoinState(raw) {
  if (Array.isArray(raw)) {
    if (
      raw.length < 8
      || typeof raw[0] !== 'string'
      || !raw.slice(1, 8).every(Number.isFinite)
    ) return null;
    return {
      id: raw[0],
      position: raw.slice(1, 4),
      quaternion: raw.slice(4, 8),
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
  };
}

export class SharedWorldView {
  constructor({ scene, coinGeometry, coinMaterials, pusherMesh }) {
    this.scene = scene;
    this.coinGeometry = coinGeometry;
    this.coinMaterials = coinMaterials;
    this.pusherMesh = pusherMesh;
    this.coins = new Map();
    this.order = [];
    this.capacity = INITIAL_CAPACITY;
    this.lastServerTime = null;
    this.hasSnapshot = false;
    this.interpolationSeconds = DEFAULT_SNAPSHOT_SECONDS;
    this.pusherStartZ = pusherMesh?.position.z ?? CONFIG.pusher.rearZ;
    this.pusherTargetZ = CONFIG.pusher.rearZ;
    this.pusherElapsed = 0;
    this.pusherDuration = DEFAULT_SNAPSHOT_SECONDS;
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
    mesh.name = 'shared-world-coins';
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

  calculateInterpolationSeconds(snapshot) {
    const serverTime = Number(snapshot?.serverTime);
    let interval = DEFAULT_SNAPSHOT_SECONDS;
    if (Number.isFinite(serverTime) && Number.isFinite(this.lastServerTime)) {
      const measured = (serverTime - this.lastServerTime) / 1000;
      if (measured > 0 && measured < 2) interval = measured;
    }
    if (Number.isFinite(serverTime)) this.lastServerTime = serverTime;
    this.interpolationSeconds = clamp(
      interval * 1.04,
      MIN_INTERPOLATION_SECONDS,
      MAX_INTERPOLATION_SECONDS,
    );
    return this.interpolationSeconds;
  }

  writeMatrix(index, item) {
    const matrixObject = this.matrixObject;
    matrixObject.position.copy(item.position);
    matrixObject.quaternion.copy(item.quaternion);
    matrixObject.scale.set(1, 1, 1);
    matrixObject.updateMatrix();
    this.instanceMesh.setMatrixAt(index, matrixObject.matrix);
  }

  rebuildMatrices() {
    for (let index = 0; index < this.order.length; index += 1) {
      this.writeMatrix(index, this.order[index]);
    }
    this.instanceMesh.count = this.order.length;
    this.instanceMesh.instanceMatrix.needsUpdate = true;
  }

  applySnapshot(snapshot) {
    const duration = this.calculateInterpolationSeconds(snapshot);
    const nextPusherZ = Number.isFinite(snapshot.pusherZ)
      ? snapshot.pusherZ
      : CONFIG.pusher.rearZ;
    if (!this.hasSnapshot && this.pusherMesh) this.pusherMesh.position.z = nextPusherZ;
    this.pusherStartZ = this.pusherMesh?.position.z ?? nextPusherZ;
    this.pusherTargetZ = nextPusherZ;
    this.pusherElapsed = this.hasSnapshot ? 0 : duration;
    this.pusherDuration = duration;

    const present = new Set();
    let membershipChanged = false;

    for (const raw of snapshot.coins ?? []) {
      const state = unpackCoinState(raw);
      if (!state) continue;
      present.add(state.id);

      let item = this.coins.get(state.id);
      if (!item) {
        const position = new THREE.Vector3(...state.position);
        const quaternion = new THREE.Quaternion(...state.quaternion);
        item = {
          id: state.id,
          position,
          quaternion,
          startPosition: position.clone(),
          startQuaternion: quaternion.clone(),
          targetPosition: position.clone(),
          targetQuaternion: quaternion.clone(),
          elapsed: duration,
          duration,
          moving: false,
        };
        this.coins.set(state.id, item);
        membershipChanged = true;
      } else {
        item.startPosition.copy(item.position);
        item.startQuaternion.copy(item.quaternion);
        item.targetPosition.set(...state.position);
        item.targetQuaternion.set(...state.quaternion);
        item.elapsed = 0;
        item.duration = duration;
        const positionChanged = item.startPosition.distanceToSquared(item.targetPosition) > POSITION_EPSILON_SQ;
        const quaternionChanged = 1 - Math.abs(item.startQuaternion.dot(item.targetQuaternion)) > QUATERNION_EPSILON;
        item.moving = positionChanged || quaternionChanged;
        if (!item.moving) {
          item.position.copy(item.targetPosition);
          item.quaternion.copy(item.targetQuaternion);
        }
      }
    }

    for (const id of [...this.coins.keys()]) {
      if (present.has(id)) continue;
      this.coins.delete(id);
      membershipChanged = true;
    }

    if (membershipChanged) {
      this.order = [...this.coins.values()];
      this.ensureCapacity(this.order.length);
      this.rebuildMatrices();
    }
    this.hasSnapshot = true;
  }

  update(dt) {
    const safeDt = Math.max(0, Math.min(Number(dt) || 0, 0.1));
    let matrixDirty = false;

    for (let index = 0; index < this.order.length; index += 1) {
      const item = this.order[index];
      if (!item.moving) continue;
      item.elapsed = Math.min(item.duration, item.elapsed + safeDt);
      const alpha = item.duration > 0 ? item.elapsed / item.duration : 1;
      item.position.lerpVectors(item.startPosition, item.targetPosition, alpha);
      item.quaternion.slerpQuaternions(item.startQuaternion, item.targetQuaternion, alpha);
      this.writeMatrix(index, item);
      matrixDirty = true;
      if (alpha >= 1) item.moving = false;
    }

    if (matrixDirty) this.instanceMesh.instanceMatrix.needsUpdate = true;

    if (this.pusherMesh) {
      this.pusherElapsed = Math.min(this.pusherDuration, this.pusherElapsed + safeDt);
      const alpha = this.pusherDuration > 0 ? this.pusherElapsed / this.pusherDuration : 1;
      this.pusherMesh.position.z = THREE.MathUtils.lerp(this.pusherStartZ, this.pusherTargetZ, alpha);
    }
  }

  clear() {
    this.coins.clear();
    this.order = [];
    this.instanceMesh.count = 0;
    this.instanceMesh.instanceMatrix.needsUpdate = true;
  }
}
