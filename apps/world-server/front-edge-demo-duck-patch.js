import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../../src/config/machine-config.js';
import { WorldEngine } from '../../src/game/world-engine.js';
import {
  RUBBER_DUCK_SKIN_ID,
  RUBBER_DUCK_TOY_KEY,
} from './rubber-duck-toy-patch.js';

export const FRONT_EDGE_DEMO_DUCK_ID = 'toy-rubber-duck-front-edge-demo-v2';
export const FRONT_EDGE_DEMO_MARKER = 'front-edge-demo-duck-v2.done';

function enabled(value = process.env.YES_PUSHER_FRONT_EDGE_DEMO_DUCK) {
  const normalized = String(value ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(normalized);
}

function markerPath() {
  const dataDir = String(process.env.YES_PUSHER_DATA_DIR || '.world-data').trim() || '.world-data';
  return path.join(dataDir, FRONT_EDGE_DEMO_MARKER);
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

export function seedFrontEdgeDemoDuck(engine) {
  if (!enabled() || demoAlreadyCompleted()) return null;
  engine.ensureToyState?.();
  const existing = engine.toyById?.get(FRONT_EDGE_DEMO_DUCK_ID);
  if (existing) return existing;

  // This is a one-time operator demonstration, not a normal player toy spawn.
  // It must still appear even when the persistent machine has reached its toy cap.
  const boardTopY = CONFIG.board.y + 0.42 / 2;
  return engine.createRubberDuckToy?.({
    id: FRONT_EDGE_DEMO_DUCK_ID,
    sourceTurnId: 'front-edge-vacuum-demo',
    sourcePlayerId: null,
    spawnedBySkinId: RUBBER_DUCK_SKIN_ID,
    x: 0.35,
    y: boardTopY + 0.48,
    z: CONFIG.board.front - 0.24,
    rotationY: Math.PI * 0.18,
    velocity: [0, 0, 0.24],
    angularVelocity: [0.04, 0.14, -0.03],
    emitSpawn: false,
  }) ?? null;
}

function installFrontEdgeDemoDuckPatch() {
  const prototype = WorldEngine.prototype;
  if (prototype.frontEdgeDemoDuckPatchInstalled) return;

  const initializeEmptyMachine = prototype.initializeEmptyMachine;
  prototype.initializeEmptyMachine = function initializeEmptyMachineWithDemoDuck(...args) {
    const result = initializeEmptyMachine.apply(this, args);
    seedFrontEdgeDemoDuck(this);
    return result;
  };

  const resetMachine = prototype.resetMachine;
  prototype.resetMachine = function resetMachineWithDemoDuck(...args) {
    const result = resetMachine.apply(this, args);
    seedFrontEdgeDemoDuck(this);
    return result;
  };

  const restoreConfirmedWorld = prototype.restoreConfirmedWorld;
  prototype.restoreConfirmedWorld = function restoreConfirmedWorldWithDemoDuck(...args) {
    const result = restoreConfirmedWorld.apply(this, args);
    seedFrontEdgeDemoDuck(this);
    return result;
  };

  const checkToyExits = prototype.checkToyExits;
  prototype.checkToyExits = function checkToyExitsWithDemoCompletion(...args) {
    const demoBefore = this.toyById?.get(FRONT_EDGE_DEMO_DUCK_ID) ?? null;
    const result = checkToyExits.apply(this, args);
    const demoAfter = this.toyById?.get(FRONT_EDGE_DEMO_DUCK_ID) ?? null;
    if (demoBefore && (demoBefore.scored || !demoAfter)) markDemoCompleted();
    return result;
  };

  Object.defineProperty(prototype, 'frontEdgeDemoDuckPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installFrontEdgeDemoDuckPatch();

export {
  demoAlreadyCompleted,
  enabled as frontEdgeDemoDuckEnabled,
  installFrontEdgeDemoDuckPatch,
  markDemoCompleted,
  markerPath as frontEdgeDemoDuckMarkerPath,
};
