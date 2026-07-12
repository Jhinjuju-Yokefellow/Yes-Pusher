import * as THREE from 'three';
import { CONFIG } from '../config/machine-config.js';

export class SharedWorldView {
  constructor({ scene, coinGeometry, coinMaterials, pusherMesh }) {
    this.scene = scene;
    this.coinGeometry = coinGeometry;
    this.coinMaterials = coinMaterials;
    this.pusherMesh = pusherMesh;
    this.coins = new Map();
    this.pusherTargetZ = CONFIG.pusher.rearZ;
  }

  applySnapshot(snapshot) {
    this.pusherTargetZ = Number.isFinite(snapshot.pusherZ)
      ? snapshot.pusherZ
      : CONFIG.pusher.rearZ;

    const present = new Set();
    for (const state of snapshot.coins ?? []) {
      if (!state?.id || !Array.isArray(state.position) || !Array.isArray(state.quaternion)) continue;
      present.add(state.id);
      let item = this.coins.get(state.id);
      if (!item) {
        const mesh = new THREE.Mesh(this.coinGeometry, this.coinMaterials);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.position.set(...state.position);
        mesh.quaternion.set(...state.quaternion);
        this.scene.add(mesh);
        item = {
          mesh,
          targetPosition: new THREE.Vector3(...state.position),
          targetQuaternion: new THREE.Quaternion(...state.quaternion),
          initialized: false,
        };
        this.coins.set(state.id, item);
      }
      item.targetPosition.set(...state.position);
      item.targetQuaternion.set(...state.quaternion);
      if (!item.initialized) {
        item.mesh.position.copy(item.targetPosition);
        item.mesh.quaternion.copy(item.targetQuaternion);
        item.initialized = true;
      }
    }

    for (const [id, item] of this.coins) {
      if (present.has(id)) continue;
      this.scene.remove(item.mesh);
      this.coins.delete(id);
    }
  }

  update(dt) {
    const blend = 1 - Math.exp(-Math.max(0, dt) * 18);
    for (const item of this.coins.values()) {
      item.mesh.position.lerp(item.targetPosition, blend);
      item.mesh.quaternion.slerp(item.targetQuaternion, blend);
    }
    if (this.pusherMesh) {
      this.pusherMesh.position.z += (this.pusherTargetZ - this.pusherMesh.position.z) * blend;
    }
  }

  clear() {
    for (const item of this.coins.values()) this.scene.remove(item.mesh);
    this.coins.clear();
  }
}
