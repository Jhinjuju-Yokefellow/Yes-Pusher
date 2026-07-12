import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/config/machine-config.js';
import { MACHINE_REVISION } from '../src/game/world-snapshot.js';
import { SharedWorldView, unpackCoinState } from '../src/network/shared-world-view.js';

function packedCoin(id, x, y, z, { sleeping = true, phase = 0 } = {}) {
  return [id, x, y, z, 0, 0, 0, 1, sleeping ? 1 : 0, phase];
}

function replayPackage() {
  const restY = CONFIG.board.y + 0.42 / 2 + CONFIG.coin.thickness / 2 + 0.004;
  return {
    kind: 'yes-pusher-recorded-replay',
    version: 1,
    machineRevision: MACHINE_REVISION,
    id: 'turn-1',
    createdAt: 1_000,
    frameRate: 2,
    frameIntervalSeconds: 0.5,
    physicsRate: 45,
    durationSeconds: 2,
    turn: {
      id: 'turn-1',
      playerId: 'player-a',
      playerLabel: 'PLAYER A',
      number: 1,
      coinsDropped: 1,
      slotPlan: [3],
      seed: 123,
      startedAt: 1_000,
    },
    startWorld: {
      pusherZ: CONFIG.pusher.rearZ,
      coinCount: 1,
      coins: [packedCoin('bed-1', 0, restY, -2)],
    },
    frames: [
      {
        t: 0,
        pusherZ: CONFIG.pusher.rearZ,
        activeSlotIndex: 3,
        state: 1,
        activeSecondsRemaining: 30,
        coinsWon: 0,
        coinsLost: 0,
        coins: [packedCoin('bed-1', 0, restY, -2)],
      },
      {
        t: 1,
        pusherZ: CONFIG.pusher.frontZ,
        activeSlotIndex: -1,
        state: 3,
        activeSecondsRemaining: 29,
        coinsWon: 1,
        coinsLost: 0,
        coins: [
          packedCoin('bed-1', 2, restY, 1),
          packedCoin('drop-1', 1, 8, CONFIG.peg.z, { sleeping: false, phase: 1 }),
        ],
      },
      {
        t: 2,
        pusherZ: CONFIG.pusher.rearZ,
        activeSlotIndex: -1,
        state: 5,
        activeSecondsRemaining: 0,
        coinsWon: 1,
        coinsLost: 0,
        coins: [packedCoin('drop-1', 0.5, restY, -1)],
      },
    ],
    events: [
      { id: 'event-payout-1', type: 'payout', turnId: 'turn-1', playerId: 'player-a', coinId: 'bed-1', at: 0.75, value: 1 },
      { id: 'event-loss-1', type: 'loss', turnId: 'turn-1', playerId: 'player-a', coinId: 'drop-1', at: 1.75, value: 1 },
    ],
    result: { id: 'turn-1', playerId: 'player-a', coinsDropped: 1, coinsWon: 1, coinsLost: 0, slotPlan: [3] },
    finalWorld: { kind: 'yes-pusher-confirmed-world' },
  };
}

function makeView({ packageValue = replayPackage(), events = [] } = {}) {
  const scene = new THREE.Scene();
  const geometry = new THREE.CylinderGeometry(0.34, 0.34, 0.105, 12);
  const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  const pusher = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const view = new SharedWorldView({
    scene,
    coinGeometry: geometry,
    coinMaterials: materials,
    pusherMesh: pusher,
    fetchReplayPackage: async () => packageValue,
    onReplayEvent: (event) => events.push(event),
  });
  return { scene, view, pusher, events };
}

function boundarySnapshot({ boundaryId = 'boundary-1', coins = [] } = {}) {
  return {
    revision: 1,
    syncMode: 'boundary',
    boundaryId,
    pusherZ: CONFIG.pusher.rearZ,
    turn: { state: 'ready', nextTurnNumber: 1 },
    coins,
  };
}

function recordedSnapshot({ elapsedSeconds = 0, coins = null } = {}) {
  const pkg = replayPackage();
  return {
    revision: 2,
    syncMode: 'recorded-replay',
    boundaryId: 'boundary-1',
    serverTime: 1_000,
    pusherZ: CONFIG.pusher.rearZ,
    turn: { state: 'dropping', currentTurn: pkg.turn },
    replay: {
      turnId: pkg.id,
      packageUrl: `/api/replays/${pkg.id}`,
      startedAt: 1_000,
      elapsedSeconds,
      durationSeconds: pkg.durationSeconds,
      frameRate: pkg.frameRate,
    },
    coins: coins ?? pkg.startWorld.coins,
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
  view.update();

  assert.equal(view.instanceMesh.isInstancedMesh, true);
  assert.equal(view.instanceMesh.count, 121);
  assert.equal(scene.children.filter((child) => child.isInstancedMesh).length, 1);
});

test('packed v3 coin state preserves phase', () => {
  const state = unpackCoinState(packedCoin('drop-1', 1, 8, CONFIG.peg.z, { sleeping: false, phase: 1 }));
  assert.equal(state.phase, 'peg');
  assert.deepEqual(state.position, [1, 8, CONFIG.peg.z]);
});

test('browser interpolates the downloaded authoritative replay instead of simulating physics', async () => {
  const { view, pusher } = makeView();
  view.applySnapshot(recordedSnapshot({ elapsedSeconds: 0 }));
  await view.replayLoadPromise;

  assert.equal(view.activeReplayId, 'turn-1');
  assert.equal(view.replayPackage.id, 'turn-1');
  assert.equal('engine' in view, false);

  view.seekReplay(0.5, { emitEvents: false });
  assert.equal(view.coins.get('bed-1').position.x, 1);
  assert.equal(view.coins.get('bed-1').position.z, -0.5);
  assert.equal(pusher.position.z, (CONFIG.pusher.rearZ + CONFIG.pusher.frontZ) / 2);
});

test('later world snapshots cannot steer recorded coin transforms', async () => {
  const { view } = makeView();
  view.applySnapshot(recordedSnapshot({ elapsedSeconds: 0 }));
  await view.replayLoadPromise;
  view.seekReplay(0.5, { emitEvents: false });
  const before = view.coins.get('bed-1').position.clone();

  view.applySnapshot(recordedSnapshot({
    elapsedSeconds: 0.5,
    coins: [packedCoin('bed-1', 99, 99, 99)],
  }));
  view.seekReplay(0.5, { emitEvents: false });

  assert.deepEqual(view.coins.get('bed-1').position.toArray(), before.toArray());
});

test('mid-turn join seeks immediately and only emits future exact coin-ID events', async () => {
  const observed = [];
  const { view } = makeView({ events: observed });
  view.applySnapshot(recordedSnapshot({ elapsedSeconds: 1.25 }));
  await view.replayLoadPromise;

  assert.equal(view.replayElapsed >= 1.25, true);
  assert.equal(observed.length, 0);
  assert.equal(view.coins.has('drop-1'), true);

  view.seekReplay(1.8);
  assert.deepEqual(observed.map((event) => [event.type, event.coinId]), [['loss', 'drop-1']]);
});

test('future payout event carries the permanent winning coin ID exactly once', async () => {
  const observed = [];
  const { view } = makeView({ events: observed });
  view.applySnapshot(recordedSnapshot({ elapsedSeconds: 0 }));
  await view.replayLoadPromise;

  view.seekReplay(0.8);
  view.seekReplay(1.2);

  assert.deepEqual(observed.map((event) => event.coinId), ['bed-1']);
  assert.equal(observed[0].type, 'payout');
});

test('final boundary replaces the replay with the authoritative handoff state', async () => {
  const { view } = makeView();
  view.applySnapshot(recordedSnapshot({ elapsedSeconds: 1 }));
  await view.replayLoadPromise;
  assert.equal(view.activeReplayId, 'turn-1');

  view.applySnapshot(boundarySnapshot({
    boundaryId: 'boundary-2',
    coins: [packedCoin('final-coin', 0.4, 0.816, 2.2)],
  }));

  assert.equal(view.activeReplayId, null);
  assert.equal(view.boundaryId, 'boundary-2');
  assert.deepEqual(view.coins.get('final-coin').position.toArray(), [0.4, 0.816, 2.2]);
});
