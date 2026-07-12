import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/config/machine-config.js';
import { SharedWorldView, unpackCoinState } from '../src/network/shared-world-view.js';

function makeView() {
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
  return { scene, view, pusher };
}

function packedCoin(id, x, y, z, { sleeping = true, phase = 0, velocity = [0, 0, 0], angularVelocity = [0, 0, 0] } = {}) {
  const base = [id, x, y, z, 0, 0, 0, 1, sleeping ? 1 : 0, phase];
  return sleeping ? base : [...base, ...velocity, ...angularVelocity];
}

test('shared world view renders packed coins through one instanced mesh', () => {
  const { scene, view } = makeView();
  const coins = Array.from({ length: 135 }, (_, index) => packedCoin(
    `coin-${index}`,
    (index % 15) * 0.65 - 4.5,
    0.816,
    Math.floor(index / 15) * 0.65 - 2.5,
  ));

  view.applySnapshot({ pusherTime: 0, turn: { state: 'ready' }, coins });
  view.update(1 / 60);

  assert.equal(view.instanceMesh.isInstancedMesh, true);
  assert.equal(view.instanceMesh.count, 135);
  assert.equal(scene.children.filter((child) => child.isInstancedMesh).length, 1);
  assert.equal(scene.children.filter((child) => child.isMesh && !child.isInstancedMesh).length, 0);
});

test('packed v3 coin state preserves phase and velocity without prediction', () => {
  const state = unpackCoinState(packedCoin('drop-1', 1, 8, CONFIG.peg.z, {
    sleeping: false,
    phase: 1,
    velocity: [0.2, -1.1, 0],
    angularVelocity: [0, 0, 1.4],
  }));

  assert.equal(state.phase, 'peg');
  assert.deepEqual(state.velocity, [0.2, -1.1, 0]);
  assert.deepEqual(state.angularVelocity, [0, 0, 1.4]);
});

test('shared world view remains compatible with object-form snapshots', () => {
  const { view } = makeView();

  view.applySnapshot({
    turn: { state: 'ready' },
    coins: [{
      id: 'legacy-coin',
      position: [1, 0.816, 3],
      quaternion: [0, 0, 0, 1],
      sleeping: true,
      phase: 'board',
    }],
  });
  view.update(1 / 60);

  assert.equal(view.instanceMesh.count, 1);
  assert.equal(view.coins.has('legacy-coin'), true);
});

test('active server updates steer local physics instead of teleporting coins', () => {
  const { view } = makeView();
  view.applySnapshot({
    revision: 1,
    pusherTime: 0,
    turn: { state: 'active' },
    coins: [packedCoin('coin-1', 0, 0.816, 1, { sleeping: false, velocity: [0, 0, 0] })],
  });

  const coin = view.coins.get('coin-1');
  const before = coin.body.position.x;
  view.applySnapshot({
    revision: 2,
    pusherTime: 0.5,
    turn: { state: 'active' },
    coins: [packedCoin('coin-1', 1, 0.816, 1, { sleeping: false, velocity: [0, 0, 0] })],
  });

  assert.equal(coin.body.position.x, before);
  assert.ok(coin.body.velocity.x > 0);
});

test('airborne peg coins are never steered or snapped by later checkpoints', () => {
  const { view } = makeView();
  view.applySnapshot({
    revision: 1,
    pusherTime: 0,
    turn: { state: 'active' },
    coins: [packedCoin('drop-1', 0, 8.0, CONFIG.peg.z, {
      sleeping: false,
      phase: 1,
      velocity: [0.12, -0.8, 0],
      angularVelocity: [0, 0, 0.7],
    })],
  });

  const coin = view.coins.get('drop-1');
  const beforePosition = coin.body.position.clone();
  const beforeVelocity = coin.body.velocity.clone();
  view.applySnapshot({
    revision: 2,
    pusherTime: 0.5,
    turn: { state: 'active' },
    coins: [packedCoin('drop-1', 2.2, 6.5, CONFIG.peg.z, {
      sleeping: false,
      phase: 1,
      velocity: [-0.5, -1.4, 0],
      angularVelocity: [0, 0, -1.2],
    })],
  });

  assert.equal(coin.body.position.x, beforePosition.x);
  assert.equal(coin.body.position.y, beforePosition.y);
  assert.equal(coin.body.velocity.x, beforeVelocity.x);
  assert.equal(coin.body.velocity.y, beforeVelocity.y);
});

test('local visual physics lets the flat pusher move a board coin', () => {
  const { view } = makeView();
  const restY = CONFIG.board.y + 0.42 / 2 + CONFIG.coin.thickness / 2 + 0.004;
  view.applySnapshot({
    revision: 1,
    pusherTime: 0,
    turn: { state: 'active' },
    coins: [packedCoin('coin-1', 0, restY, -3.0, { sleeping: false, velocity: [0, 0, 0] })],
  });

  const startZ = view.coins.get('coin-1').body.position.z;
  for (let frame = 0; frame < 180; frame += 1) view.update(1 / 60);
  const endZ = view.coins.get('coin-1')?.body.position.z ?? startZ;

  assert.ok(endZ > startZ + 0.15, `expected pusher movement, start=${startZ}, end=${endZ}`);
});
