import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.YES_PUSHER_ONE_TIME_MACHINE_RESET = 'false';

const {
  MACHINE_RESET_MARKER,
  applyOneTimeMachineReset,
} = await import('../apps/world-server/one-time-machine-reset-patch.js');

function write(dataDir, filename, value = filename) {
  fs.writeFileSync(path.join(dataDir, filename), value, 'utf8');
}

test('resets only shared machine files once and preserves player state', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-pusher-machine-reset-'));
  try {
    write(dataDir, 'confirmed-world.json', '{}');
    write(dataDir, 'active-replay.json', '{}');
    write(dataDir, 'front-edge-demo-duck-v1.done', 'old-demo');
    write(dataDir, 'player-progress.json', '{"coins":153}');
    write(dataDir, 'settlements.json', '{"records":[]}');
    write(dataDir, 'skin-loadouts.json', '{"wallet":"rubber-duck"}');

    const first = applyOneTimeMachineReset({ dataDir, enabledValue: 'true' });
    assert.equal(first.applied, true);
    assert.deepEqual(first.removed.sort(), [
      'active-replay.json',
      'confirmed-world.json',
      'front-edge-demo-duck-v1.done',
    ]);
    assert.equal(fs.existsSync(path.join(dataDir, 'confirmed-world.json')), false);
    assert.equal(fs.existsSync(path.join(dataDir, 'active-replay.json')), false);
    assert.equal(fs.existsSync(path.join(dataDir, 'front-edge-demo-duck-v1.done')), false);
    assert.equal(fs.existsSync(path.join(dataDir, MACHINE_RESET_MARKER)), true);

    assert.equal(fs.readFileSync(path.join(dataDir, 'player-progress.json'), 'utf8'), '{"coins":153}');
    assert.equal(fs.readFileSync(path.join(dataDir, 'settlements.json'), 'utf8'), '{"records":[]}');
    assert.equal(fs.readFileSync(path.join(dataDir, 'skin-loadouts.json'), 'utf8'), '{"wallet":"rubber-duck"}');

    write(dataDir, 'confirmed-world.json', '{"new":true}');
    const second = applyOneTimeMachineReset({ dataDir, enabledValue: 'true' });
    assert.equal(second.applied, false);
    assert.equal(second.reason, 'already_applied');
    assert.equal(fs.existsSync(path.join(dataDir, 'confirmed-world.json')), true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
