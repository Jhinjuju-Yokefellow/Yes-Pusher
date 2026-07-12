import * as THREE from 'three';
import { CONFIG } from '../config/machine-config.js';

const INITIAL_CAPACITY = 512;

function nextCapacity(required) {
  let capacity = INITIAL_CAPACITY;
  while (capacity < required) capacity *= 2;
  return capacity;
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
    this.pusherTargetZ = CONFIG.pusher.rearZ;
    this.matrixObject = new THREE.Object3D();
    this.instanceMesh = this.createInstanceMesh(this.capacity);
    this.scene.add(this.instanceMesh);
  }

  createInstanceMesh(capacity) {
    const mesh = new THREE.InstancedMesh(this.coinGeometry, this.coinMaterials, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
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
    this.instanceMesh = replacement;
    this.capacity = replacementCapacity;
    this.scene.add(replacement);
  }

  applySnapshot(snapshot) {
    this.pusherTargetZ = Number.isFinite(snapshot.pusherZ)
      ? snapshot.pusherZ
      : CONFIG.pusher.rearZ;

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
          targetPosition: position.clone(),
          targetQuaternion: quaternion.clone(),
        };
        this.coins.set(state.id, item);
        membershipChanged = true;
      } else {
        item.targetPosition.set(...state.position);
        item.targetQuaternion.set(...state.quaternion);
      }
    }

    for (const id of this.coins.keys()) {
      if (present.has(id)) continue;
      this.coins.delete(id);
      membershipChanged = true;
    }

    if (membershipChanged) {
      this.order = [...this.coins.values()];
      this.ensureCapacity(this.order.length);
      this.instanceMesh.count = this.order.length;
    }
  }

  update(dt) {
    const blend = 1 - Math.exp(-Math.max(0, dt) * 20);
    const matrixObject = this.matrixObject;

    for (let index = 0; index < this.order.length; index += 1) {
      const item = this.order[index];
      item.position.lerp(item.targetPosition, blend);
      item.quaternion.slerp(item.targetQuaternion, blend);
      matrixObject.position.copy(item.position);
      matrixObject.quaternion.copy(item.quaternion);
      matrixObject.scale.set(1, 1, 1);
      matrixObject.updateMatrix();
      this.instanceMesh.setMatrixAt(index, matrixObject.matrix);
    }

    if (this.order.length) this.instanceMesh.instanceMatrix.needsUpdate = true;

    if (this.pusherMesh) {
      this.pusherMesh.position.z += (this.pusherTargetZ - this.pusherMesh.position.z) * blend;
    }
  }

  clear() {
    this.coins.clear();
    this.order = [];
    this.instanceMesh.count = 0;
    this.instanceMesh.instanceMatrix.needsUpdate = true;
  }
}
