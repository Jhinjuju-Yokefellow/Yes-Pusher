import * as THREE from 'three';
import { replayFramesAt } from './game/replay-package.js';
import { SharedWorldView } from './network/shared-world-view.js';

const RUBBER_DUCK_TOY_KEY = 'rubber_duck';

const duckGeometry = Object.freeze({
  body: new THREE.SphereGeometry(0.46, 24, 18),
  head: new THREE.SphereGeometry(0.35, 24, 18),
  wing: new THREE.SphereGeometry(0.18, 18, 14),
  tail: new THREE.SphereGeometry(0.15, 18, 14),
  beak: new THREE.SphereGeometry(0.24, 20, 14),
  eye: new THREE.SphereGeometry(0.058, 14, 10),
  highlight: new THREE.SphereGeometry(0.018, 10, 8),
});

const duckMaterials = Object.freeze({
  yellow: new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.34, metalness: 0.02 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xff7315, roughness: 0.28, metalness: 0.01 }),
  black: new THREE.MeshStandardMaterial({ color: 0x05070b, roughness: 0.12, metalness: 0.02 }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0 }),
});

function clean(value) {
  return String(value ?? '').trim();
}

function finiteVector(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function toyState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = clean(raw.id);
  const toyKey = clean(raw.toyKey);
  if (!id || !toyKey || !finiteVector(raw.position, 3) || !finiteVector(raw.quaternion, 4)) return null;
  return {
    id,
    toyKey,
    position: [...raw.position],
    quaternion: [...raw.quaternion],
  };
}

function mesh(geometry, material, position, scale = null) {
  const value = new THREE.Mesh(geometry, material);
  value.position.set(...position);
  if (scale) value.scale.set(...scale);
  value.castShadow = false;
  value.receiveShadow = false;
  value.frustumCulled = false;
  return value;
}

function createRubberDuckMesh() {
  const group = new THREE.Group();
  group.name = 'shared-world-rubber-duck-toy';

  group.add(mesh(duckGeometry.body, duckMaterials.yellow, [0, 0, 0], [1.03, 0.90, 1.10]));
  group.add(mesh(duckGeometry.head, duckMaterials.yellow, [0, 0.47, 0.10]));
  group.add(mesh(duckGeometry.wing, duckMaterials.yellow, [-0.39, 0.02, -0.02], [0.78, 1.18, 1.25]));
  group.add(mesh(duckGeometry.wing, duckMaterials.yellow, [0.39, 0.02, -0.02], [0.78, 1.18, 1.25]));
  group.add(mesh(duckGeometry.tail, duckMaterials.yellow, [0, 0.10, -0.48], [0.82, 0.78, 1.18]));

  const upperBeak = mesh(duckGeometry.beak, duckMaterials.orange, [0, 0.42, 0.42], [1.05, 0.42, 0.78]);
  upperBeak.rotation.x = -0.08;
  group.add(upperBeak);
  const lowerBeak = mesh(duckGeometry.beak, duckMaterials.orange, [0, 0.35, 0.42], [0.92, 0.28, 0.70]);
  lowerBeak.rotation.x = 0.10;
  group.add(lowerBeak);

  for (const side of [-1, 1]) {
    group.add(mesh(duckGeometry.eye, duckMaterials.black, [side * 0.135, 0.56, 0.408], [0.84, 1, 0.58]));
    group.add(mesh(duckGeometry.highlight, duckMaterials.white, [side * 0.116, 0.585, 0.448]));
  }

  return group;
}

function createToyMesh(key) {
  if (key === RUBBER_DUCK_TOY_KEY) return createRubberDuckMesh();
  const fallback = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xffd35a, roughness: 0.45 }),
  );
  fallback.castShadow = false;
  fallback.receiveShadow = false;
  fallback.frustumCulled = false;
  fallback.name = `shared-world-toy-${key || 'unknown'}`;
  return fallback;
}

function installToyViewPatch() {
  const prototype = SharedWorldView.prototype;
  if (prototype.toyViewPatchInstalled) return;

  const loadBoundary = prototype.loadBoundary;
  const seekReplay = prototype.seekReplay;
  const renderMatrices = prototype.renderMatrices;
  const clear = prototype.clear;

  prototype.ensureToyRendering = function ensureToyRendering() {
    if (!(this.toyRenderStates instanceof Map)) this.toyRenderStates = new Map();
    if (!(this.toyFrameCache instanceof WeakMap)) this.toyFrameCache = new WeakMap();
  };

  prototype.createToyRenderState = function createToyRenderState(state) {
    this.ensureToyRendering();
    const toyMesh = createToyMesh(state.toyKey);
    toyMesh.userData.toyId = state.id;
    toyMesh.userData.toyKey = state.toyKey;
    this.scene.add(toyMesh);
    const renderState = {
      id: state.id,
      toyKey: state.toyKey,
      position: new THREE.Vector3(...state.position),
      quaternion: new THREE.Quaternion(...state.quaternion),
      mesh: toyMesh,
    };
    this.toyRenderStates.set(renderState.id, renderState);
    return renderState;
  };

  prototype.removeToyRenderState = function removeToyRenderState(id) {
    this.ensureToyRendering();
    const state = this.toyRenderStates.get(id);
    if (!state) return;
    this.scene.remove(state.mesh);
    this.toyRenderStates.delete(id);
  };

  prototype.toysFromFrame = function toysFromFrame(frame) {
    this.ensureToyRendering();
    if (!frame) return new Map();
    const cached = this.toyFrameCache.get(frame);
    if (cached) return cached;
    const states = new Map();
    for (const raw of frame.toys ?? []) {
      const state = toyState(raw);
      if (state) states.set(state.id, state);
    }
    this.toyFrameCache.set(frame, states);
    return states;
  };

  prototype.syncToyBoundary = function syncToyBoundary(rawToys = []) {
    this.ensureToyRendering();
    const next = new Map();
    for (const raw of rawToys) {
      const state = toyState(raw);
      if (state) next.set(state.id, state);
    }
    for (const id of this.toyRenderStates.keys()) {
      if (!next.has(id)) this.removeToyRenderState(id);
    }
    for (const state of next.values()) {
      const current = this.toyRenderStates.get(state.id) ?? this.createToyRenderState(state);
      current.toyKey = state.toyKey;
      current.position.set(...state.position);
      current.quaternion.set(...state.quaternion).normalize();
    }
  };

  prototype.seekToyReplay = function seekToyReplay(elapsedSeconds) {
    this.ensureToyRendering();
    if (!this.replayPackage) return false;
    const { previous, next, alpha } = replayFramesAt(this.replayPackage, elapsedSeconds);
    const aStates = this.toysFromFrame(previous);
    const bStates = this.toysFromFrame(next ?? previous);
    const ids = new Set([...aStates.keys(), ...bStates.keys()]);
    const visible = new Set();
    const nextPosition = new THREE.Vector3();
    const nextQuaternion = new THREE.Quaternion();

    for (const id of ids) {
      const a = aStates.get(id);
      const b = bStates.get(id);
      if (!a && !b) continue;
      if (!a && alpha < 0.999) continue;
      if (!b && alpha >= 0.999) continue;
      const seed = a ?? b;
      const current = this.toyRenderStates.get(id) ?? this.createToyRenderState(seed);
      current.toyKey = (alpha < 0.5 ? a?.toyKey : b?.toyKey) ?? seed.toyKey;
      if (a && b) {
        current.position.set(...a.position);
        nextPosition.set(...b.position);
        current.position.lerp(nextPosition, alpha);
        current.quaternion.set(...a.quaternion);
        nextQuaternion.set(...b.quaternion);
        current.quaternion.slerp(nextQuaternion, alpha).normalize();
      } else {
        current.position.set(...seed.position);
        current.quaternion.set(...seed.quaternion).normalize();
      }
      visible.add(id);
    }

    for (const id of this.toyRenderStates.keys()) {
      if (!visible.has(id)) this.removeToyRenderState(id);
    }
    return true;
  };

  prototype.renderToys = function renderToys() {
    this.ensureToyRendering();
    for (const state of this.toyRenderStates.values()) {
      state.mesh.position.copy(state.position);
      state.mesh.quaternion.copy(state.quaternion);
      state.mesh.visible = true;
    }
  };

  prototype.loadBoundary = function loadBoundaryWithToys(snapshot) {
    const loaded = loadBoundary.call(this, snapshot);
    if (!loaded) return loaded;
    if (Array.isArray(snapshot?.toys)) this.syncToyBoundary(snapshot.toys);
    this.renderToys();
    return loaded;
  };

  prototype.seekReplay = function seekReplayWithToys(elapsedSeconds, options = {}) {
    const sought = seekReplay.call(this, elapsedSeconds, options);
    if (!sought) return sought;
    this.seekToyReplay(elapsedSeconds);
    this.renderToys();
    return sought;
  };

  prototype.renderMatrices = function renderWorldWithToys(...args) {
    const result = renderMatrices.apply(this, args);
    this.renderToys();
    return result;
  };

  prototype.clear = function clearWorldWithToys(...args) {
    const result = clear.apply(this, args);
    this.ensureToyRendering();
    for (const id of [...this.toyRenderStates.keys()]) this.removeToyRenderState(id);
    this.toyFrameCache = new WeakMap();
    return result;
  };

  Object.defineProperty(prototype, 'toyViewPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installToyViewPatch();

export { createRubberDuckMesh, installToyViewPatch, toyState };
