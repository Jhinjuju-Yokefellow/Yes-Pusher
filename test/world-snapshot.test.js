import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MACHINE_REVISION,
  WORLD_SNAPSHOT_VERSION,
  createConfirmedWorldSnapshot,
  normalizeWorldSnapshot,
} from '../src/game/world-snapshot.js';

function coin(overrides = {}) {
  return {
    id: 'coin-1',
    tower: false,
    phase: 'board',
    scored: false,
    hasReachedPusher: true,
    pegAngle: 0,
    pegNudgeDirection: 1,
    pegStallSeconds: 0,
    slotIndex: null,
    position: [1, 2, 3],
    quaternion: [0, 0, 0, 1],
    velocity: [0.1, 0, 0.2],
    angularVelocity: [0, 0.3, 0],
    sleeping: false,
    transfer: null,
    ...overrides,
  };
}

test('confirmed snapshot preserves machine, progress, and coin body state', () => {
  const snapshot = createConfirmedWorldSnapshot({
    pusherTime: 18.2,
    pusherZ: -3.1,
    selectedCount: 7,
    nextCoinId: 42,
    turnProgress: {
      lifetime: 125,
      pendingMilestones: 1,
      resolvedMilestones: 2,
      turnNumber: 9,
    },
    coins: [coin()],
    savedAt: 1234,
  });

  assert.equal(snapshot.version, WORLD_SNAPSHOT_VERSION);
  assert.equal(snapshot.machineRevision, MACHINE_REVISION);
  assert.equal(snapshot.pusherTime, 18.2);
  assert.equal(snapshot.selectedCount, 7);
  assert.equal(snapshot.turnProgress.lifetime, 125);
  assert.deepEqual(snapshot.coins[0].position, [1, 2, 3]);

  const restored = normalizeWorldSnapshot(snapshot);
  assert.deepEqual(restored, snapshot);
});

test('snapshot rejects another machine revision instead of loading incompatible geometry', () => {
  const snapshot = createConfirmedWorldSnapshot({ coins: [coin()] });
  snapshot.machineRevision = 'different-machine';
  assert.equal(normalizeWorldSnapshot(snapshot), null);
});

test('snapshot drops malformed coin records and rejects an empty world', () => {
  const snapshot = createConfirmedWorldSnapshot({
    coins: [coin({ position: [1, 2] })],
  });
  assert.equal(normalizeWorldSnapshot(snapshot), null);
});
