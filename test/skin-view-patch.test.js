import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import '../src/skin-view-patch.js';
import { SharedWorldView } from '../src/network/shared-world-view.js';

function packedCoin(id, skinId = null) {
  const value = [id, 0, 0.816, -2, 0, 0, 0, 1, 1, 0];
  return skinId ? [...value, skinId] : value;
}

test('shared replay view separates authoritative skinned coins from starter coins', () => {
  const scene = new THREE.Scene();
  const view = new SharedWorldView({
    scene,
    coinGeometry: new THREE.CylinderGeometry(0.34, 0.34, 0.105, 12),
    coinMaterials: [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ],
    pusherMesh: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()),
  });

  view.applySnapshot({
    revision: 1,
    syncMode: 'boundary',
    boundaryId: 'boundary-skins',
    pusherZ: -3,
    turn: { state: 'ready', nextTurnNumber: 1 },
    coins: [
      packedCoin('starter'),
      packedCoin('duck', 'yes_drop.rubber_duck'),
    ],
  });

  assert.equal(view.coins.get('starter').skinId, null);
  assert.equal(view.coins.get('duck').skinId, 'yes_drop.rubber_duck');
  assert.equal(view.instanceMesh.count, 1);
  assert.equal(view.skinMeshes.get('yes_drop.rubber_duck').mesh.count, 1);
});
