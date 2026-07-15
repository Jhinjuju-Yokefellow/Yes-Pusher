import assert from 'node:assert/strict';
import { MachineCore } from '../src/rebuild/core/machine-core.js';

const requestedPlays = Math.max(1, Math.floor(Number(process.argv[2]) || 100));
const core = new MachineCore({ seed: 20260715, seedMachine: false });

for (let index = 0; index < requestedPlays; index += 1) {
  core.enqueueDrop({
    id: `stress-play-${index + 1}`,
    playerId: `stress-player-${(index % 10) + 1}`,
    coins: 1,
    visualKey: index % 2 === 0 ? 'yes_drop.rubber_duck' : 'yes_drop.cucumber_slice',
  });
}

const maximumSimulatedSeconds = requestedPlays * 50;
let simulatedSeconds = 0;
while (core.completedPlays < requestedPlays && simulatedSeconds < maximumSimulatedSeconds) {
  core.tick(1);
  simulatedSeconds += 1;
}

assert.equal(core.completedPlays, requestedPlays, `Only ${core.completedPlays} of ${requestedPlays} plays completed`);
assert.equal(core.isIdle(), true, 'Machine did not return to an idle scoring boundary');

const events = core.drainEvents();
const failed = events.filter((event) => event.type === 'play-failed');
assert.equal(failed.length, 0, `${failed.length} play sessions failed`);

const final = core.snapshot();
console.log(JSON.stringify({
  ok: true,
  requestedPlays,
  completedPlays: core.completedPlays,
  simulatedSeconds,
  remainingObjects: final.objects.length,
  spawnedObjects: events.filter((event) => event.type === 'object-spawned').length,
  payoutEvents: events.filter((event) => event.type === 'coin-payout').length,
  lossEvents: events.filter((event) => event.type === 'coin-loss').length,
}, null, 2));
