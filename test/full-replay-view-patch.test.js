import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/config/machine-config.js';
import { MACHINE_REVISION } from '../src/game/world-snapshot.js';
import { SharedWorldView } from '../src/network/shared-world-view.js';
import '../src/full-replay-view-patch.js';

function packedCoin(id, x, y, z) {
  return [id, x, y, z, 0, 0, 0, 1, 1, 0];
}

function replayPackage() {
  const restY = CONFIG.board.y + 0.42 / 2 + CONFIG.coin.thickness / 2 + 0.004;
  return {
    kind: 'yes-pusher-recorded-replay',
    version: 1,
    machineRevision: MACHINE_REVISION,
    id: 'full-turn-1',
    createdAt: 1,
    frameRate: 2,
    frameIntervalSeconds: 0.5,
    physicsRate: 45,
    durationSeconds: 2,
    turn: {
      id: 'full-turn-1',
      playerId: 'player-a',
      playerLabel: 'PLAYER A',
      number: 1,
      coinsDropped: 1,
      slotPlan: [3],
      seed: 7,
      startedAt: 1,
    },
    startWorld: {
      pusherZ: CONFIG.pusher.rearZ,
      coins: [packedCoin('coin-1', 0, restY, -2)],
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
        coins: [packedCoin('coin-1', 0, restY, -2)],
      },
      {
        t: 1,
        pusherZ: CONFIG.pusher.frontZ,
        activeSlotIndex: -1,
        state: 3,
        activeSecondsRemaining: 29,
        coinsWon: 0,
        coinsLost: 0,
        coins: [packedCoin('coin-1', 0.5, restY, 0)],
      },
      {
        t: 2,
        pusherZ: CONFIG.pusher.rearZ,
        activeSlotIndex: -1,
        state: 5,
        activeSecondsRemaining: 0,
        coinsWon: 0,
        coinsLost: 0,
        coins: [packedCoin('coin-1', 1, restY, 2)],
      },
    ],
    events: [],
    result: { id: 'full-turn-1', playerId: 'player-a', coinsDropped: 1, coinsWon: 0, coinsLost: 0, slotPlan: [3] },
    finalWorld: { kind: 'yes-pusher-confirmed-world', machineRevision: MACHINE_REVISION },
  };
}

function makeView() {
  const pkg = replayPackage();
  const scene = new THREE.Scene();
  const geometry = new THREE.CylinderGeometry(0.34, 0.34, 0.105, 12);
  const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  const pusher = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const view = new SharedWorldView({
    scene,
    coinGeometry: geometry,
    coinMaterials: materials,
    pusherMesh: pusher,
    fetchReplayPackage: async () => pkg,
  });
  return { view, pkg };
}

test('a delayed first snapshot still begins the recorded turn at frame zero', async () => {
  const { view, pkg } = makeView();
  view.applySnapshot({
    syncMode: 'recorded-replay',
    boundaryId: 'boundary-1',
    pusherZ: CONFIG.pusher.rearZ,
    turn: { state: 'active', currentTurn: pkg.turn },
    replay: {
      turnId: pkg.id,
      packageUrl: `/api/replays/${pkg.id}`,
      elapsedSeconds: 1.25,
      durationSeconds: pkg.durationSeconds,
      frameRate: pkg.frameRate,
    },
    coins: pkg.startWorld.coins,
  });
  await view.replayLoadPromise;

  assert.equal(view.fullReplayStarted, true);
  assert.equal(view.replayElapsed, 0);
  assert.equal(view.currentReplayElapsed() < 0.1, true);
  assert.equal(view.coins.get('coin-1').position.z, -2);
});

test('the final boundary waits until the local viewer has seen the complete replay', async () => {
  const { view, pkg } = makeView();
  view.applySnapshot({
    syncMode: 'recorded-replay',
    boundaryId: 'boundary-1',
    pusherZ: CONFIG.pusher.rearZ,
    turn: { state: 'active', currentTurn: pkg.turn },
    replay: {
      turnId: pkg.id,
      packageUrl: `/api/replays/${pkg.id}`,
      elapsedSeconds: 1.4,
      durationSeconds: pkg.durationSeconds,
      frameRate: pkg.frameRate,
    },
    coins: pkg.startWorld.coins,
  });
  await view.replayLoadPromise;

  const finalBoundary = {
    syncMode: 'boundary',
    boundaryId: 'boundary-2',
    pusherZ: CONFIG.pusher.rearZ,
    turn: { state: 'ready', nextTurnNumber: 2 },
    coins: [packedCoin('final-coin', 0, 0.816, 2.4)],
  };
  view.applySnapshot(finalBoundary);
  assert.equal(view.activeReplayId, pkg.id);
  assert.equal(view.pendingBoundarySnapshot, finalBoundary);

  view.replayAnchorElapsed = pkg.durationSeconds;
  view.replayAnchorLocalMs = globalThis.performance?.now?.() ?? Date.now();
  view.update();

  assert.equal(view.activeReplayId, null);
  assert.equal(view.boundaryId, 'boundary-2');
  assert.equal(view.coins.has('final-coin'), true);
});
