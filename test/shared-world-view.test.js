import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SharedWorldView } from '../src/network/shared-world-view.js';

test('shared world view renders packed coins through one instanced mesh', () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.CylinderGeometry(0.34, 0.34, 0.105, 12);
  const materials = [
    new THREE.MeshBasicMaterial(),
    new THREE.MeshBasicMaterial(),
    new THREE.MeshBasicMaterial(),
  ];
  const pusher = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const view = new SharedWorldView({
    scene,
    coinGeometry: geometry,
    coinMaterials: materials,
    pusherMesh: pusher,
  });

  const coins = Array.from({ length: 253 }, (_, index) => [
    `coin-${index}`,
    index % 20,
    1,
    Math.floor(index / 20),
    0,
    0,
    0,
    1,
  ]);

  view.applySnapshot({ pusherZ: -2.4, coins });
  view.update(1 / 60);

  assert.equal(view.instanceMesh.isInstancedMesh, true);
  assert.equal(view.instanceMesh.count, 253);
  assert.equal(scene.children.filter((child) => child.isInstancedMesh).length, 1);
  assert.equal(scene.children.filter((child) => child.isMesh && !child.isInstancedMesh).length, 0);
});

test('shared world view remains compatible with object-form snapshots', () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.CylinderGeometry(0.34, 0.34, 0.105, 12);
  const material = new THREE.MeshBasicMaterial();
  const view = new SharedWorldView({
    scene,
    coinGeometry: geometry,
    coinMaterials: material,
    pusherMesh: null,
  });

  view.applySnapshot({
    coins: [{
      id: 'legacy-coin',
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
    }],
  });
  view.update(1 / 60);

  assert.equal(view.instanceMesh.count, 1);
  assert.equal(view.coins.has('legacy-coin'), true);
});

test('shared world view linearly interpolates between server snapshots', () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.CylinderGeometry(0.34, 0.34, 0.105, 10);
  const material = new THREE.MeshBasicMaterial();
  const pusher = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const view = new SharedWorldView({
    scene,
    coinGeometry: geometry,
    coinMaterials: material,
    pusherMesh: pusher,
  });

  view.applySnapshot({
    serverTime: 1_000,
    pusherZ: -4,
    coins: [['coin-1', 0, 1, 0, 0, 0, 0, 1]],
  });
  view.applySnapshot({
    serverTime: 1_200,
    pusherZ: -2,
    coins: [['coin-1', 2, 1, 0, 0, 0, 0, 1]],
  });
  view.update(0.104);

  const coin = view.coins.get('coin-1');
  assert.ok(coin.position.x > 0.9 && coin.position.x < 1.1);
  assert.ok(pusher.position.z > -3.1 && pusher.position.z < -2.9);
});
