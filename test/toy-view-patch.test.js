import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SharedWorldView } from '../src/network/shared-world-view.js';
import '../src/toy-view-patch.js';

function duck(id, x, y = 1.2, z = 0.4) {
  return {
    id,
    kind: 'toy',
    toyKey: 'rubber_duck',
    sourceTurnId: 'turn-duck-1',
    sourcePlayerId: 'wallet:0x1111111111111111111111111111111111111111',
    spawnedBySkinId: 'yes_drop.rubber_duck',
    scored: false,
    frontExit: false,
    position: [x, y, z],
    quaternion: [0, 0, 0, 1],
  };
}

function makeView() {
  const scene = new THREE.Scene();
  const geometry = new THREE.CylinderGeometry(0.34, 0.34, 0.105, 12);
  const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  const pusher = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const view = new SharedWorldView({
    scene,
    coinGeometry: geometry,
    coinMaterials: materials,
    pusherMesh: pusher,
    fetchReplayPackage: async () => null,
  });
  return { scene, view };
}

test('shared boundary renders a Rubber Duck toy as a separate persistent object', () => {
  const { scene, view } = makeView();
  view.applySnapshot({
    revision: 1,
    syncMode: 'boundary',
    boundaryId: 'boundary-toy-1',
    pusherZ: -4.98,
    activeSlotIndex: -1,
    turn: { state: 'ready', nextTurnNumber: 1 },
    coins: [],
    toys: [duck('toy-duck-1', 0.5)],
  });

  const state = view.toyRenderStates.get('toy-duck-1');
  assert.ok(state);
  assert.equal(state.toyKey, 'rubber_duck');
  assert.equal(state.mesh.name, 'shared-world-rubber-duck-toy');
  assert.equal(state.position.x, 0.5);
  assert.equal(scene.children.includes(state.mesh), true);
});

test('browser interpolates Rubber Duck toy transforms from the authoritative replay', () => {
  const { view } = makeView();
  view.replayPackage = {
    durationSeconds: 1,
    frames: [
      { t: 0, pusherZ: -4.98, activeSlotIndex: -1, coins: [], toys: [duck('toy-duck-2', 0)] },
      { t: 1, pusherZ: -4.98, activeSlotIndex: -1, coins: [], toys: [duck('toy-duck-2', 2)] },
    ],
    events: [],
  };

  assert.equal(view.seekReplay(0.5, { emitEvents: false }), true);
  const state = view.toyRenderStates.get('toy-duck-2');
  assert.ok(state);
  assert.equal(state.position.x, 1);
  assert.equal(state.mesh.position.x, 1);
});

test('authoritative boundary handoff removes a duck that left the machine', () => {
  const { view } = makeView();
  view.applySnapshot({
    revision: 1,
    syncMode: 'boundary',
    boundaryId: 'boundary-toy-2',
    pusherZ: -4.98,
    activeSlotIndex: -1,
    turn: { state: 'ready', nextTurnNumber: 1 },
    coins: [],
    toys: [duck('toy-duck-3', 0)],
  });
  assert.equal(view.toyRenderStates.has('toy-duck-3'), true);

  view.applySnapshot({
    revision: 2,
    syncMode: 'boundary',
    boundaryId: 'boundary-toy-3',
    pusherZ: -4.98,
    activeSlotIndex: -1,
    turn: { state: 'ready', nextTurnNumber: 2 },
    coins: [],
    toys: [],
  });
  assert.equal(view.toyRenderStates.has('toy-duck-3'), false);
});
