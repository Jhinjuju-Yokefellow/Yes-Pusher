import test from 'node:test';
import assert from 'node:assert/strict';
import { MachineCore } from '../src/rebuild/core/machine-core.js';

function advanceUntil(core, predicate, maximumSeconds = 140) {
  for (let second = 0; second < maximumSeconds; second += 1) {
    core.tick(1);
    if (predicate()) return second + 1;
  }
  throw new Error(`Condition was not reached within ${maximumSeconds} simulated seconds`);
}

test('the physical pusher keeps running while no player owns scoring', () => {
  const core = new MachineCore({ seed: 11, seedMachine: false });
  const initialTime = core.engine.pusherTime;
  core.tick(1);
  assert.ok(core.engine.pusherTime > initialTime);
  assert.equal(core.isIdle(), true);
});

test('DROP starts locally without wallet, HTTP, inventory, settlement, or replay work', () => {
  const core = new MachineCore({ seed: 22, seedMachine: false });
  core.enqueueDrop({
    id: 'play-cucumber',
    playerId: 'player-1',
    coins: 3,
    visualKey: 'yes_drop.cucumber_slice',
  });

  const snapshot = core.tick(0);
  assert.equal(snapshot.activePlay?.id, 'play-cucumber');
  assert.equal(snapshot.activePlay?.playerId, 'player-1');
  assert.equal(snapshot.objects.length, 1);
  assert.equal(snapshot.objects[0].visualKey, 'yes_drop.cucumber_slice');
  assert.equal(JSON.stringify(snapshot).includes('imageUrl'), false);
  assert.equal(JSON.stringify(snapshot).includes('cloudinary'), false);
});

test('queued plays execute sequentially without stopping the machine between players', () => {
  const core = new MachineCore({ seed: 33, seedMachine: false });
  core.enqueueDrop({ id: 'play-1', playerId: 'player-1', coins: 1, visualKey: 'starter' });
  core.enqueueDrop({ id: 'play-2', playerId: 'player-2', coins: 1, visualKey: 'yes_drop.rubber_duck' });
  core.enqueueDrop({ id: 'play-3', playerId: 'player-3', coins: 1, visualKey: 'yes_drop.cucumber_slice' });

  advanceUntil(core, () => core.completedPlays === 3, 150);
  assert.equal(core.completedPlays, 3);
  assert.equal(core.isIdle(), true);

  const completed = core.drainEvents().filter((event) => event.type === 'play-completed');
  assert.deepEqual(completed.map((event) => event.playId), ['play-1', 'play-2', 'play-3']);
});

test('boundary persistence keeps object identity and browser visual keys separate from physics', () => {
  const core = new MachineCore({ seed: 44, seedMachine: true });
  const firstObject = core.snapshot().objects[0];
  assert.ok(firstObject?.id);
  assert.equal(core.setObjectVisualKey(firstObject.id, 'yes_drop.rubber_duck'), true);

  const saved = core.exportState();
  const restored = new MachineCore({ seed: 99, seedMachine: false, initialState: saved });
  const restoredObject = restored.snapshot().objects.find((object) => object.id === firstObject.id);

  assert.ok(restoredObject);
  assert.equal(restoredObject.visualKey, 'yes_drop.rubber_duck');
  assert.equal(saved.world.coins.some((coin) => Object.hasOwn(coin, 'imageUrl')), false);
  assert.equal(saved.world.coins.some((coin) => Object.hasOwn(coin, 'visualKey')), false);
});
