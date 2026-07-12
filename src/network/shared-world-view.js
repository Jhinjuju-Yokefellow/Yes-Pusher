import * as THREE from 'three';
import { CONFIG } from '../config/machine-config.js';

const INITIAL_CAPACITY = 256;
const DEFAULT_SNAPSHOT_SECONDS = 1 / 6;
const MIN_INTERPOLATION_SECONDS = 0.055;
const MAX_INTERPOLATION_SECONDS = 0.18;
const MAX_PREDICTION_SECONDS = 0.22;
const POSITION_EPSILON_SQ = 0.000025;
const QUATERNION_EPSILON = 0.00035;
const VELOCITY_EPSILON_SQ = 0.0004;

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
    const v2 = raw.length >= 9 && (raw[8] === 0 || raw[8] === 1);
    const sleeping = v2 ? raw[8] === 1 : false;
    return {
      id: raw[0],
      position: raw.slice(1, 4),
      quaternion: raw.slice(4, 8),
      sleeping,
      velocity: !sleeping && raw.length >= 12 && raw.slice(9, 12).every(Number.isFinite)
        ? raw.slice(9, 12)
        : [0, 0, 0],
      angularVelocity: !sleeping && raw.length >= 15 && raw.slice(12, 15).every(Number.isFinite)
        ? raw.slice(12, 15)
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
    velocity: Array.isArray(raw.velocity) && raw.velocity.length === 3
      ? raw.velocity
      : [0, 0, 0],
    angularVelocity: Array.isArray(raw.angularVelocity) && raw.angularVelocity.length === 3
      ? raw.angularVelocity
      : [0, 0, 0],
  };
}

function pusherZAtTime(timeSeconds) {
  const t = ((timeSeconds % CONFIG.pusher.period) + CONFIG.pusher.period) % CONFIG.pusher.period
    / CONFIG.pusher.period;
  let progress;
  if (t < 0.43) progress = t / 0.43;
  else if (t < 0.52) progress = 1;
  else if (t < 0.92) {
    const u = (t - 0.52) / 0.40;
    progress = 1 - u * u * (3 - 2 * u);
  } else progress = 0;
  return THREE.MathUtils.lerp(CONFIG.pusher.rearZ, CONFIG.pusher.frontZ, progress);
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
    this.pusherTimeBase = null;
    this.pusherReceivedAt = 0;
    this.matrixObject = new THREE.Object3D();
    this.rotationAxis = new THREE.Vector3();
    this.rotationDelta = new THREE.Quaternion();
    this.instanceMesh = this.createInstanceMesh(this.capacity);
    this.scene.add(this.instanceMesh);
  }

  createInstanceMesh(capacity) {
    const mesh = new THREE.InstancedMesh(this.coinGeometry, this.coinMaterials, capacity);
    mesh.instanceMatrix.setUsage(THREE.StreamDrawUsage);
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
    this.interpolationSeconds = clamp(interval * 0.82, MIN_INTERPOLATION_SECONDS, MAX_INTERPOLATION_SECONDS);
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
    for (let index = 0; index < this.order.length; index += 1) this.writeMatrix(index, this.order[index]);
    this.instanceMesh.count = this.order.length;
    this.instanceMesh.instanceMatrix.needsUpdate = true;
  }

  applySnapshot(snapshot) {
    const duration = this.calculateInterpolationSeconds(snapshot);
    const serverTime = Number(snapshot?.serverTime);
    const ageSeconds = Number.isFinite(serverTime)
      ? clamp((Date.now() - serverTime) / 1000, 0, MAX_PREDICTION_SECONDS)
      : 0;

    if (Number.isFinite(snapshot?.pusherTime)) {
      this.pusherTimeBase = Number(snapshot.pusherTime) + ageSeconds;
      this.pusherReceivedAt = performance.now();
      if (!this.hasSnapshot && this.pusherMesh) this.pusherMesh.position.z = pusherZAtTime(this.pusherTimeBase);
    } else {
      const nextPusherZ = Number.isFinite(snapshot?.pusherZ) ? snapshot.pusherZ : CONFIG.pusher.rearZ;
      if (!this.hasSnapshot && this.pusherMesh) this.pusherMesh.position.z = nextPusherZ;
      this.pusherStartZ = this.pusherMesh?.position.z ?? nextPusherZ;
      this.pusherTargetZ = nextPusherZ;
      this.pusherElapsed = this.hasSnapshot ? 0 : duration;
      this.pusherDuration = duration;
    }

    const present = new Set();
    let membershipChanged = false;

    for (const raw of snapshot.coins ?? []) {
      const state = unpackCoinState(raw);
      if (!state) continue;
      present.add(state.id);

      let item = this.coins.get(state.id);
      const serverPosition = new THREE.Vector3(...state.position);
      const serverQuaternion = new THREE.Quaternion(...state.quaternion);
      const velocity = new THREE.Vector3(...state.velocity);
      const angularVelocity = new THREE.Vector3(...state.angularVelocity);
      if (!state.sleeping && ageSeconds > 0) serverPosition.addScaledVector(velocity, ageSeconds);

      if (!item) {
        item = {
          id: state.id,
          position: serverPosition.clone(),
          quaternion: serverQuaternion.clone(),
          startPosition: serverPosition.clone(),
          startQuaternion: serverQuaternion.clone(),
          targetPosition: serverPosition.clone(),
          targetQuaternion: serverQuaternion.clone(),
          velocity,
          angularVelocity,
          sleeping: state.sleeping,
          elapsed: duration,
          duration,
          correcting: false,
        };
        this.coins.set(state.id, item);
        membershipChanged = true;
      } else {
        item.startPosition.copy(item.position);
        item.startQuaternion.copy(item.quaternion);
        item.targetPosition.copy(serverPosition);
        item.targetQuaternion.copy(serverQuaternion);
        item.velocity.copy(velocity);
        item.angularVelocity.copy(angularVelocity);
        item.sleeping = state.sleeping;
        item.elapsed = 0;
        item.duration = duration;
        const positionChanged = item.startPosition.distanceToSquared(item.targetPosition) > POSITION_EPSILON_SQ;
        const quaternionChanged = 1 - Math.abs(item.startQuaternion.dot(item.targetQuaternion)) > QUATERNION_EPSILON;
        item.correcting = positionChanged || quaternionChanged;
        if (!item.correcting) {
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

  integrateRotation(item, dt) {
    const speed = item.angularVelocity.length();
    if (speed < 0.0001) return;
    this.rotationAxis.copy(item.angularVelocity).multiplyScalar(1 / speed);
    this.rotationDelta.setFromAxisAngle(this.rotationAxis, Math.min(speed * dt, 0.35));
    item.quaternion.multiply(this.rotationDelta).normalize();
  }

  update(dt) {
    const safeDt = Math.max(0, Math.min(Number(dt) || 0, 0.08));
    let matrixDirty = false;

    for (let index = 0; index < this.order.length; index += 1) {
      const item = this.order[index];
      let changed = false;
      if (item.correcting) {
        item.elapsed = Math.min(item.duration, item.elapsed + safeDt);
        const raw = item.duration > 0 ? item.elapsed / item.duration : 1;
        const alpha = raw * raw * (3 - 2 * raw);
        item.position.lerpVectors(item.startPosition, item.targetPosition, alpha);
        item.quaternion.slerpQuaternions(item.startQuaternion, item.targetQuaternion, alpha);
        item.correcting = raw < 1;
        changed = true;
      } else if (!item.sleeping && item.velocity.lengthSq() > VELOCITY_EPSILON_SQ) {
        item.position.addScaledVector(item.velocity, safeDt);
        this.integrateRotation(item, safeDt);
        changed = true;
      }
      if (!changed) continue;
      this.writeMatrix(index, item);
      matrixDirty = true;
    }

    if (matrixDirty) this.instanceMesh.instanceMatrix.needsUpdate = true;

    if (this.pusherMesh) {
      if (Number.isFinite(this.pusherTimeBase)) {
        const elapsed = Math.min((performance.now() - this.pusherReceivedAt) / 1000, 0.45);
        this.pusherMesh.position.z = pusherZAtTime(this.pusherTimeBase + elapsed);
      } else {
        this.pusherElapsed = Math.min(this.pusherDuration, this.pusherElapsed + safeDt);
        const alpha = this.pusherDuration > 0 ? this.pusherElapsed / this.pusherDuration : 1;
        this.pusherMesh.position.z = THREE.MathUtils.lerp(this.pusherStartZ, this.pusherTargetZ, alpha);
      }
    }
  }

  clear() {
    this.coins.clear();
    this.order = [];
    this.instanceMesh.count = 0;
    this.instanceMesh.instanceMatrix.needsUpdate = true;
  }
}
