import * as THREE from 'three';
import { getCoinSkin } from './config/skin-catalog.js';
import { replayFramesAt } from './game/replay-package.js';
import { SharedWorldView } from './network/shared-world-view.js';

const INITIAL_CAPACITY = 64;

function clean(value) {
  return String(value ?? '').trim();
}

function skinIdFromRaw(raw) {
  if (Array.isArray(raw)) {
    const sleeping = raw.length >= 9 && raw[8] === 1;
    const index = sleeping ? 10 : 16;
    return getCoinSkin(raw[index])?.id ?? null;
  }
  return getCoinSkin(raw?.skinId)?.id ?? null;
}

function rawId(raw) {
  return Array.isArray(raw) ? clean(raw[0]) : clean(raw?.id);
}

function nextCapacity(required) {
  let capacity = INITIAL_CAPACITY;
  while (capacity < required) capacity *= 2;
  return capacity;
}

function cloneMaterials(materials) {
  const source = Array.isArray(materials) ? materials : [materials];
  return source.map((material) => material.clone());
}

function installSkinViewPatch() {
  const prototype = SharedWorldView.prototype;
  if (prototype.skinViewPatchInstalled) return;

  const loadBoundary = prototype.loadBoundary;
  const decodedFrame = prototype.decodedFrame;
  const seekReplay = prototype.seekReplay;
  const clear = prototype.clear;

  prototype.ensureSkinRendering = function ensureSkinRendering() {
    if (this.skinMeshes) return;
    this.skinMeshes = new Map();
    this.skinTextureLoader = typeof document !== 'undefined' ? new THREE.TextureLoader() : null;
  };

  prototype.createSkinMeshState = function createSkinMeshState(skinId, capacity = INITIAL_CAPACITY) {
    this.ensureSkinRendering();
    const skin = getCoinSkin(skinId);
    if (!skin) return null;
    const materials = cloneMaterials(this.coinMaterials);
    const mesh = new THREE.InstancedMesh(this.coinGeometry, materials, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.name = `shared-world-coins-skin-${skin.id}`;
    this.scene.add(mesh);

    const state = {
      skin,
      mesh,
      materials,
      capacity,
      texture: null,
      loading: false,
    };
    this.skinMeshes.set(skin.id, state);

    if (this.skinTextureLoader && skin.imageUrl) {
      state.loading = true;
      this.skinTextureLoader.load(
        skin.imageUrl,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          state.texture = texture;
          state.loading = false;
          for (const index of [1, 2]) {
            const material = state.materials[index];
            if (!material) continue;
            material.map = texture;
            material.needsUpdate = true;
          }
        },
        undefined,
        () => {
          state.loading = false;
        },
      );
    }
    return state;
  };

  prototype.ensureSkinCapacity = function ensureSkinCapacity(state, required) {
    if (!state || required <= state.capacity) return state;
    const capacity = nextCapacity(required);
    const replacement = new THREE.InstancedMesh(this.coinGeometry, state.materials, capacity);
    replacement.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    replacement.castShadow = false;
    replacement.receiveShadow = false;
    replacement.frustumCulled = false;
    replacement.count = 0;
    replacement.name = state.mesh.name;
    this.scene.remove(state.mesh);
    state.mesh.dispose?.();
    state.mesh = replacement;
    state.capacity = capacity;
    this.scene.add(replacement);
    return state;
  };

  prototype.writeSkinMatrix = function writeSkinMatrix(mesh, index, coin) {
    this.matrixObject.position.copy(coin.position);
    this.matrixObject.quaternion.copy(coin.quaternion);
    this.matrixObject.scale.set(1, 1, 1);
    this.matrixObject.updateMatrix();
    mesh.setMatrixAt(index, this.matrixObject.matrix);
  };

  prototype.renderMatrices = function renderSkinnedMatrices() {
    this.ensureSkinRendering();
    const grouped = new Map([['', []]]);
    for (const state of this.skinMeshes.values()) {
      state.mesh.count = 0;
      grouped.set(state.skin.id, []);
    }

    for (const coin of this.order) {
      const skinId = getCoinSkin(coin?.skinId)?.id ?? '';
      if (skinId && !grouped.has(skinId)) grouped.set(skinId, []);
      grouped.get(skinId).push(coin);
    }

    const starter = grouped.get('') ?? [];
    this.ensureCapacity(starter.length);
    for (let index = 0; index < starter.length; index += 1) {
      this.writeSkinMatrix(this.instanceMesh, index, starter[index]);
    }
    this.instanceMesh.count = starter.length;
    this.instanceMesh.instanceMatrix.needsUpdate = true;

    for (const [skinId, coins] of grouped) {
      if (!skinId) continue;
      let state = this.skinMeshes.get(skinId) ?? this.createSkinMeshState(skinId, nextCapacity(coins.length));
      if (!state) continue;
      state = this.ensureSkinCapacity(state, coins.length);
      for (let index = 0; index < coins.length; index += 1) {
        this.writeSkinMatrix(state.mesh, index, coins[index]);
      }
      state.mesh.count = coins.length;
      state.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  prototype.loadBoundary = function loadSkinnedBoundary(snapshot) {
    const loaded = loadBoundary.call(this, snapshot);
    if (!loaded) return loaded;
    for (const raw of snapshot?.coins ?? []) {
      const id = rawId(raw);
      const coin = id ? this.coins.get(id) : null;
      if (coin) coin.skinId = skinIdFromRaw(raw);
    }
    this.renderMatrices();
    return loaded;
  };

  prototype.decodedFrame = function decodedSkinnedFrame(frame) {
    const states = decodedFrame.call(this, frame);
    for (const raw of frame?.coins ?? []) {
      const id = rawId(raw);
      const state = id ? states.get(id) : null;
      if (state) state.skinId = skinIdFromRaw(raw);
    }
    return states;
  };

  prototype.seekReplay = function seekSkinnedReplay(elapsedSeconds, options = {}) {
    const sought = seekReplay.call(this, elapsedSeconds, options);
    if (!sought || !this.replayPackage) return sought;
    const { previous, next, alpha } = replayFramesAt(this.replayPackage, elapsedSeconds);
    const previousStates = this.decodedFrame(previous);
    const nextStates = this.decodedFrame(next ?? previous);
    for (const [id, coin] of this.coins) {
      const a = previousStates.get(id);
      const b = nextStates.get(id);
      coin.skinId = (alpha < 0.5 ? a?.skinId : b?.skinId) ?? a?.skinId ?? b?.skinId ?? null;
    }
    this.renderMatrices();
    return sought;
  };

  prototype.clear = function clearSkinnedView() {
    const result = clear.call(this);
    for (const state of this.skinMeshes?.values?.() ?? []) {
      state.mesh.count = 0;
      state.mesh.instanceMatrix.needsUpdate = true;
    }
    return result;
  };

  Object.defineProperty(prototype, 'skinViewPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installSkinViewPatch();

export { installSkinViewPatch, skinIdFromRaw };
