import * as THREE from 'three';
import { getCoinSkin } from './config/skin-catalog.js';
import { replayFramesAt } from './game/replay-package.js';
import { SharedWorldView } from './network/shared-world-view.js';

const PATCH_KEY = Symbol.for('yes-pusher:skin-image-view-patch');

function clean(value) {
  return String(value ?? '').trim();
}

function usableImageUrl(value, fallback = '') {
  const candidate = clean(value);
  if (/^(https?:\/\/|\/|data:image\/|blob:)/i.test(candidate)) return candidate;
  const backup = clean(fallback);
  return /^(https?:\/\/|\/|data:image\/|blob:)/i.test(backup) ? backup : '';
}

function skinMetadataFromRaw(raw) {
  if (Array.isArray(raw)) {
    const sleeping = raw.length >= 9 && raw[8] === 1;
    const skinIndex = sleeping ? 10 : 16;
    const skin = getCoinSkin(raw[skinIndex]);
    if (!skin) return { skinId: null, skinImageUrl: null };
    return {
      skinId: skin.id,
      skinImageUrl: usableImageUrl(raw[skinIndex + 1], skin.imageUrl) || null,
    };
  }

  const skin = getCoinSkin(raw?.skinId);
  if (!skin) return { skinId: null, skinImageUrl: null };
  return {
    skinId: skin.id,
    skinImageUrl: usableImageUrl(raw?.skinImageUrl, skin.imageUrl) || null,
  };
}

function skinMetadataFromDeltaValues(values) {
  if (!Array.isArray(values)) return { skinId: null, skinImageUrl: null };
  const sleeping = values[7] === 1;
  const skinIndex = sleeping ? 9 : 15;
  const skin = getCoinSkin(values[skinIndex]);
  if (!skin) return { skinId: null, skinImageUrl: null };
  return {
    skinId: skin.id,
    skinImageUrl: usableImageUrl(values[skinIndex + 1], skin.imageUrl) || null,
  };
}

function rawId(raw) {
  return Array.isArray(raw) ? clean(raw[0]) : clean(raw?.id);
}

function cloneMaterials(materials) {
  const source = Array.isArray(materials) ? materials : [materials];
  return source.map((material) => material.clone());
}

function installSkinImageViewPatch() {
  const prototype = SharedWorldView.prototype;
  if (prototype[PATCH_KEY]) return;

  const loadBoundary = prototype.loadBoundary;
  const decodedFrame = prototype.decodedFrame;
  const seekReplay = prototype.seekReplay;

  prototype.loadSkinTexture = function loadSkinTexture(state, requestedUrl, allowFallback = true) {
    const fallback = usableImageUrl(state?.skin?.imageUrl);
    const imageUrl = usableImageUrl(requestedUrl, fallback);
    if (!state || !this.skinTextureLoader || !imageUrl) return state;
    if (state.imageUrl === imageUrl && (state.texture || state.loading)) return state;

    const requestId = (Number(state.textureRequestId) || 0) + 1;
    state.textureRequestId = requestId;
    state.imageUrl = imageUrl;
    state.loading = true;
    this.skinTextureLoader.load(
      imageUrl,
      (texture) => {
        if (state.textureRequestId !== requestId) {
          texture.dispose?.();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        state.texture?.dispose?.();
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
        if (state.textureRequestId !== requestId) return;
        state.loading = false;
        if (allowFallback && fallback && fallback !== imageUrl) this.loadSkinTexture(state, fallback, false);
      },
    );
    return state;
  };

  prototype.createSkinMeshState = function createSkinMeshStateWithImage(skinId, capacity = 64, imageUrl = null) {
    this.ensureSkinRendering?.();
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
      imageUrl: null,
      textureRequestId: 0,
    };
    this.skinMeshes.set(skin.id, state);
    this.loadSkinTexture(state, imageUrl || skin.imageUrl);
    return state;
  };

  prototype.renderMatrices = function renderMatricesWithHoldingImages() {
    this.ensureSkinRendering?.();
    const starter = [];
    const groups = new Map();

    for (const coin of this.order) {
      const skin = getCoinSkin(coin?.skinId);
      if (!skin) {
        starter.push(coin);
        continue;
      }
      let group = groups.get(skin.id);
      if (!group) {
        group = { skin, imageUrl: usableImageUrl(coin?.skinImageUrl, skin.imageUrl), coins: [] };
        groups.set(skin.id, group);
      } else if (!group.imageUrl) {
        group.imageUrl = usableImageUrl(coin?.skinImageUrl, skin.imageUrl);
      }
      group.coins.push(coin);
    }

    for (const state of this.skinMeshes?.values?.() ?? []) state.mesh.count = 0;

    this.ensureCapacity(starter.length);
    for (let index = 0; index < starter.length; index += 1) {
      this.writeSkinMatrix?.(this.instanceMesh, index, starter[index]);
    }
    this.instanceMesh.count = starter.length;
    this.instanceMesh.instanceMatrix.needsUpdate = true;

    for (const { skin, imageUrl, coins } of groups.values()) {
      let state = this.skinMeshes.get(skin.id) ?? this.createSkinMeshState(skin.id, Math.max(64, coins.length), imageUrl);
      if (!state) continue;
      state = this.ensureSkinCapacity?.(state, coins.length) ?? state;
      this.loadSkinTexture(state, imageUrl || skin.imageUrl);
      for (let index = 0; index < coins.length; index += 1) {
        this.writeSkinMatrix?.(state.mesh, index, coins[index]);
      }
      state.mesh.count = coins.length;
      state.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  prototype.loadBoundary = function loadBoundaryWithSkinImages(snapshot) {
    const result = loadBoundary.call(this, snapshot);
    if (!result) return result;
    for (const raw of snapshot?.coins ?? []) {
      const id = rawId(raw);
      const coin = id ? this.coins.get(id) : null;
      if (!coin) continue;
      const metadata = skinMetadataFromRaw(raw);
      coin.skinId = metadata.skinId;
      coin.skinImageUrl = metadata.skinImageUrl;
    }
    this.renderMatrices();
    return result;
  };

  prototype.decodedFrame = function decodedFrameWithSkinImages(frame) {
    const states = decodedFrame.call(this, frame);
    for (const raw of frame?.coins ?? []) {
      const id = rawId(raw);
      const state = id ? states.get(id) : null;
      if (!state) continue;
      const metadata = skinMetadataFromRaw(raw);
      state.skinId = metadata.skinId;
      state.skinImageUrl = metadata.skinImageUrl;
    }
    return states;
  };

  prototype.seekReplay = function seekReplayWithSkinImages(elapsedSeconds, options = {}) {
    const result = seekReplay.call(this, elapsedSeconds, options);
    if (!result || !this.replayPackage) return result;

    if (this.deltaReplayState instanceof Map && Array.isArray(this.replayPackage.coinIds)) {
      for (const [index, values] of this.deltaReplayState) {
        const id = this.replayPackage.coinIds[index];
        const coin = id ? this.coins.get(id) : null;
        if (!coin) continue;
        const metadata = skinMetadataFromDeltaValues(values);
        coin.skinId = metadata.skinId;
        coin.skinImageUrl = metadata.skinImageUrl;
      }
    } else {
      const { previous, next, alpha } = replayFramesAt(this.replayPackage, elapsedSeconds);
      const previousStates = this.decodedFrame(previous);
      const nextStates = this.decodedFrame(next ?? previous);
      for (const [id, coin] of this.coins) {
        const a = previousStates.get(id);
        const b = nextStates.get(id);
        const selected = alpha < 0.5 ? (a ?? b) : (b ?? a);
        coin.skinId = selected?.skinId ?? null;
        coin.skinImageUrl = selected?.skinImageUrl ?? null;
      }
    }

    this.order = [...this.coins.values()];
    this.renderMatrices();
    return result;
  };

  Object.defineProperty(prototype, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installSkinImageViewPatch();

export {
  installSkinImageViewPatch,
  skinMetadataFromDeltaValues,
  skinMetadataFromRaw,
  usableImageUrl,
};
