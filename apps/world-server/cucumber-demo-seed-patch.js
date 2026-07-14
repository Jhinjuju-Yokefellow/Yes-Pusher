import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../../src/config/machine-config.js';
import { WorldEngine } from '../../src/game/world-engine.js';
import { CUCUMBER_SLICE_TOY_KEY } from './cucumber-slice-toy-patch.js';

export const CUCUMBER_DEMO_ID = 'toy-cucumber-slice-demo-v1';
export const CUCUMBER_DEMO_MARKER = 'cucumber-slice-demo-v1.done';

function enabled(value = process.env.YES_PUSHER_CUCUMBER_DEMO) {
  const normalized = String(value ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(normalized);
}

function markerPath() {
  const dataDir = String(process.env.YES_PUSHER_DATA_DIR || '.world-data').trim() || '.world-data';
  return path.join(dataDir, CUCUMBER_DEMO_MARKER);
}

function demoAlreadyCompleted() {
  try {
    return fs.existsSync(markerPath());
  } catch {
    return false;
  }
}

function markDemoCompleted() {
  try {
    const filePath = markerPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${new Date().toISOString()}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function stabilizeCucumber(toy) {
  if (!toy?.body) return toy;
  toy.body.velocity.set(0, 0, 0);
  toy.body.angularVelocity.set(0, 0, 0);
  toy.body.aabbNeedsUpdate = true;
  toy.body.sleep();
  return toy;
}

export function seedCucumberDemo(engine) {
  if (!enabled() || demoAlreadyCompleted()) return null;
  engine.ensureToyState?.();
  const existing = engine.toyById?.get(CUCUMBER_DEMO_ID);
  if (existing) return stabilizeCucumber(existing);

  const boardTopY = CONFIG.board.y + 0.42 / 2;
  const toy = engine.createCucumberSliceToy?.({
    id: CUCUMBER_DEMO_ID,
    sourceTurnId: 'cucumber-slice-demo-v1',
    sourcePlayerId: null,
    x: 1.15,
    y: boardTopY + 0.34,
    z: CONFIG.board.front - 0.82,
    rotationY: Math.PI * 0.08,
    velocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    emitSpawn: false,
  }) ?? null;
  return stabilizeCucumber(toy);
}

function installCucumberDemoSeedPatch() {
  const prototype = WorldEngine.prototype;
  if (prototype.cucumberDemoSeedPatchInstalled) return;
  if (typeof prototype.createCucumberSliceToy !== 'function') {
    throw new Error('Cucumber demo requires cucumber toy mechanics to load first');
  }

  const initializeEmptyMachine = prototype.initializeEmptyMachine;
  prototype.initializeEmptyMachine = function initializeEmptyMachineWithCucumberDemo(...args) {
    const result = initializeEmptyMachine.apply(this, args);
    seedCucumberDemo(this);
    return result;
  };

  const resetMachine = prototype.resetMachine;
  prototype.resetMachine = function resetMachineWithCucumberDemo(...args) {
    const result = resetMachine.apply(this, args);
    seedCucumberDemo(this);
    return result;
  };

  const restoreConfirmedWorld = prototype.restoreConfirmedWorld;
  prototype.restoreConfirmedWorld = function restoreConfirmedWorldWithCucumberDemo(...args) {
    const result = restoreConfirmedWorld.apply(this, args);
    seedCucumberDemo(this);
    return result;
  };

  const checkToyExits = prototype.checkToyExits;
  prototype.checkToyExits = function checkToyExitsWithCucumberDemoCompletion(...args) {
    const demoBefore = this.toyById?.get(CUCUMBER_DEMO_ID) ?? null;
    const result = checkToyExits.apply(this, args);
    const demoAfter = this.toyById?.get(CUCUMBER_DEMO_ID) ?? null;
    if (demoBefore?.toyKey === CUCUMBER_SLICE_TOY_KEY && demoBefore.scored && (!demoAfter || demoAfter.scored)) {
      markDemoCompleted();
    }
    return result;
  };

  Object.defineProperty(prototype, 'cucumberDemoSeedPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installCucumberDemoSeedPatch();

export {
  demoAlreadyCompleted,
  enabled as cucumberDemoEnabled,
  installCucumberDemoSeedPatch,
  markDemoCompleted,
  markerPath as cucumberDemoMarkerPath,
  stabilizeCucumber,
};
