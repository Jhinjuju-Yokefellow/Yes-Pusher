import fs from 'node:fs';
import path from 'node:path';

export const MACHINE_RESET_MARKER = 'machine-reset-for-squeak-demo-v1.done';
export const MACHINE_RESET_TARGETS = Object.freeze([
  'confirmed-world.json',
  'active-replay.json',
  'front-edge-demo-duck-v1.done',
]);

function enabled(value = process.env.YES_PUSHER_ONE_TIME_MACHINE_RESET) {
  const normalized = String(value ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(normalized);
}

function configuredDataDir() {
  return String(process.env.YES_PUSHER_DATA_DIR || '.world-data').trim() || '.world-data';
}

export function applyOneTimeMachineReset({
  dataDir = configuredDataDir(),
  enabledValue = process.env.YES_PUSHER_ONE_TIME_MACHINE_RESET,
} = {}) {
  const resolvedDataDir = path.resolve(dataDir);
  const markerPath = path.join(resolvedDataDir, MACHINE_RESET_MARKER);

  if (!enabled(enabledValue)) {
    return { applied: false, reason: 'disabled', dataDir: resolvedDataDir, markerPath, removed: [] };
  }

  if (fs.existsSync(markerPath)) {
    return { applied: false, reason: 'already_applied', dataDir: resolvedDataDir, markerPath, removed: [] };
  }

  fs.mkdirSync(resolvedDataDir, { recursive: true });
  const removed = [];
  for (const filename of MACHINE_RESET_TARGETS) {
    const targetPath = path.join(resolvedDataDir, filename);
    if (!fs.existsSync(targetPath)) continue;
    fs.rmSync(targetPath, { force: true });
    removed.push(filename);
  }

  fs.writeFileSync(markerPath, `${new Date().toISOString()}\n`, 'utf8');
  return { applied: true, reason: 'reset', dataDir: resolvedDataDir, markerPath, removed };
}

const startupReset = applyOneTimeMachineReset();
if (startupReset.applied) {
  console.log(`[yes-pusher] reset shared machine for Squeak Wave demo; removed: ${startupReset.removed.join(', ') || 'no prior world files'}`);
}

export { configuredDataDir, enabled as oneTimeMachineResetEnabled, startupReset };
