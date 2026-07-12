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

function boundarySnapshot({ boundaryId = 'boundary-1', coins = [] } = {}) {
  return {
    revision: 1,
    syncMode: 'boundary',
    boundaryId,
    pusherTime: 0,
    pusherZ: CONFIG.pusher.rearZ,
    turn: { state: 'ready', nextTurnNumber: 1 },
    coins,
  };
}

function replaySnapshot({
  boundaryId = 'boundary-1',
  turnId = 'turn-1',
  elapsedSeconds = 0,
  coins = [],
} = {}) {
  return {
    revision: 2,
    syncMode: 'turn-replay',
    boundaryId,
    serverTime: 1_000,
    pusherTime: 0,
    pusherZ: CONFIG.pusher.rearZ,
    turn: {
      state: 'dropping',
      currentTurn: {
        id: turnId,
        playerId: 'player-a',
        number: 1,
        coinsDropped: 2,
        coinsWon: 0,
        slotPlan: [1, 4],
        startedAt: 1_000,
      },
    },
    replay: {
      turnId,
      playerId: 'player-a',
      coinsDropped: 2,
      slotPlan: [1, 4],
      seed: 12345,
      startedAt: 1_000,
      elapsedSeconds,
    },
    coins,
  };
}

test('shared world view renders a boundary through one instanced mesh', () => {
  const { scene, view } = makeView();
  const coins = Array.from({ length: 121 }, (_, index) => packedCoin(
    `coin-${index}`,
    (index % 11) * 0.72 - 3.6,
    0.816,
    Math.floor(index / 11) * 0.62 - 2.5,
  ));

  view.applySnapshot(boundarySnapshot({ coins }));
  view.update(1 / 60);

  assert.equal(view.instanceMesh.isInstancedMesh, true);
  assert.equal(view.instanceMesh.count, 121);
  assert.equal(scene.children.filter((child) => child.isInstancedMesh).length, 1);
});

test('packed v3 coin state preserves phase and velocity', () => {
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

test('shared world view remains compatible with object-form boundary snapshots', () => {
  const { view } = makeView();

  view.applySnapshot(boundarySnapshot({
    coins: [{
      id: 'legacy-coin',
      position: [1, 0.816, 3],
      quaternion: [0, 0, 0, 1],
      sleeping: true,
      phase: 'board',
    }],
  }));
  view.update(1 / 60);

  assert.equal(view.instanceMesh.count, 1);
  assert.equal(view.coins.has('legacy-coin'), true);
});

test('active turn replay starts once and ignores later server coin transforms', () => {
  const { view } = makeView();
  const startCoins = [packedCoin('coin-1', 0, 0.816, 1)];
  view.applySnapshot(boundarySnapshot({ coins: startCoins }));
  view.applySnapshot(replaySnapshot({ coins: startCoins, elapsedSeconds: 0 }));

  const coin = view.coins.get('coin-1');
  const before = coin.body.position.clone();
  const replayCount = view.engine.turnController.getSnapshot().currentTurn?.id;

  view.applySnapshot({
    ...replaySnapshot({ coins: [packedCoin('coin-1', 4, 3, 5)], elapsedSeconds: 0.1 }),
    revision: 3,
  });

  assert.equal(view.engine.turnController.getSnapshot().currentTurn?.id, replayCount);
  assert.equal(coin.body.position.x, before.x);
  assert.equal(coin.body.position.y, before.y);
  assert.equal(coin.body.position.z, before.z);
});

test('turn replay generates falling coins locally without checkpoint steering', () => {
  const { view } = makeView();
  const restY = CONFIG.board.y + 0.42 / 2 + CONFIG.coin.thickness / 2 + 0.004;
  const startCoins = [packedCoin('coin-1', 0, restY, -2.5)];
  view.applySnapshot(replaySnapshot({ coins: startCoins, elapsedSeconds: 2.2 }));

  const localDrops = view.engine.coins.filter((coin) => coin.id !== 'coin-1');
  assert.ok(localDrops.length >= 2);
  assert.equal(view.activeReplayId, 'turn-1');
  assert.ok(view.engine.pusher.z > CONFIG.pusher.rearZ);
});

test('ready boundary replaces local replay only after the turn ends', () => {
  const { view } = makeView();
  const startCoins = [packedCoin('coin-1', 0, 0.816, 1)];
  view.applySnapshot(replaySnapshot({ coins: startCoins, elapsedSeconds: 1.5 }));
  assert.equal(view.activeReplayId, 'turn-1');

  const finalCoins = [packedCoin('coin-1', 0.4, 0.816, 2.2)];
  view.applySnapshot(boundarySnapshot({ boundaryId: 'boundary-2', coins: finalCoins }));

  assert.equal(view.activeReplayId, null);
  assert.equal(view.boundaryId, 'boundary-2');
  assert.equal(view.coins.get('coin-1').body.position.x, 0.4);
  assert.equal(view.coins.get('coin-1').body.position.z, 2.2);
});

test('turn replay renders every scheduled coin, not only the first drop', () => {
  const { view } = makeView();
  const restY = CONFIG.board.y + 0.42 / 2 + CONFIG.coin.thickness / 2 + 0.004;
  const startCoins = [packedCoin('bed-coin', 0, restY, -2.5)];

  view.applySnapshot({
    ...replaySnapshot({ coins: startCoins, elapsedSeconds: 0 }),
    turn: {
      state: 'dropping',
      currentTurn: {
        id: 'turn-1',
        playerId: 'player-a',
        number: 1,
        coinsDropped: 5,
        coinsWon: 0,
        slotPlan: [0, 1, 2, 3, 4],
        startedAt: 1_000,
      },
    },
    replay: {
      turnId: 'turn-1',
      playerId: 'player-a',
      coinsDropped: 5,
      slotPlan: [0, 1, 2, 3, 4],
      seed: 12345,
      startedAt: 1_000,
      elapsedSeconds: 0,
    },
  });

  // First coin is spawned immediately; the next four are scheduled every 2s.
  for (let frame = 0; frame < 510; frame += 1) view.update(1 / 60);

  const visibleDropCount = view.order.filter((coin) => coin.id !== 'bed-coin').length;
  assert.equal(visibleDropCount, 5);
  assert.equal(view.instanceMesh.count, 6);
});


test('visual replay keeps the pusher cycling until Railway sends the final boundary', () => {
  const { view, pusher } = makeView();
  const restY = CONFIG.board.y + 0.42 / 2 + CONFIG.coin.thickness / 2 + 0.004;
  const startCoins = [packedCoin('bed-coin', 0, restY, -2.5)];

  view.applySnapshot(replaySnapshot({
    coins: startCoins,
    elapsedSeconds: 37.5,
  }));

  // The local visual controller may already have finalized by this point, but
  // Railway still owns the active replay until it sends a boundary snapshot.
  assert.equal(view.activeReplayId, 'turn-1');
  const startTime = view.engine.pusherTime;
  const startZ = pusher.position.z;

  for (let frame = 0; frame < 90; frame += 1) view.update(1 / 60);

  assert.ok(view.engine.pusherTime > startTime + 1.4);
  assert.notEqual(pusher.position.z, startZ);

  view.applySnapshot(boundarySnapshot({
    boundaryId: 'boundary-2',
    coins: startCoins,
  }));
  assert.equal(view.activeReplayId, null);
  assert.equal(view.engine.visualReplayActive, false);
});
