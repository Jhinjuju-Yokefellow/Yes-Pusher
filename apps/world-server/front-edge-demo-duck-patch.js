import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../../src/config/machine-config.js';
import { WorldEngine } from '../../src/game/world-engine.js';
import {
  RUBBER_DUCK_SKIN_ID,
  RUBBER_DUCK_TOY_KEY,
} from './rubber-duck-toy-patch.js';

export const FRONT_EDGE_DEMO_DUCK_ID = 'toy-rubber-duck-front-edge-demo-v3';
export const FRONT_EDGE_DEMO_MARKER = 'front-edge-demo-duck-v3.done';
const TEST_EDGE_DUCK_PREFIX = 'toy-test-edge-';
const OLD_DEMO_PREFIX = 'toy-rubber-duck-front-edge-demo-';

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

function stabilizeOperatorTestDuck(toy) {
  if (!toy?.body) return toy;
  toy.body.velocity.set(0, 0, 0);
  toy.body.angularVelocity.set(0, 0, 0);
  toy.body.aabbNeedsUpdate = true;
  toy.body.sleep();
  return toy;
}

function removeOldDemoToys(engine) {
  engine.ensureToyState?.();
  for (const toy of [...(engine.toys ?? [])]) {
    const id = String(toy?.id ?? '');
    if (id === FRONT_EDGE_DEMO_DUCK_ID) continue;
    if (id.startsWith(TEST_EDGE_DUCK_PREFIX) || id.startsWith(OLD_DEMO_PREFIX)) {
      engine.removeToy?.(toy);
    }
  }
}

export function seedFrontEdgeDemoDuck(engine) {
  if (!enabled() || demoAlreadyCompleted()) return null;
  engine.ensureToyState?.();
  removeOldDemoToys(engine);
  const existing = engine.toyById?.get(FRONT_EDGE_DEMO_DUCK_ID);
  if (existing) return stabilizeOperatorTestDuck(existing);

  const boardTopY = CONFIG.board.y + 0.42 / 2;
  const toy = engine.createRubberDuckToy?.({
    id: FRONT_EDGE_DEMO_DUCK_ID,
    sourceTurnId: 'front-edge-vacuum-demo-v3',
    sourcePlayerId: null,
    spawnedBySkinId: RUBBER_DUCK_SKIN_ID,
    x: 0,
    y: boardTopY + 0.72,
    z: CONFIG.board.front - 0.18,
    rotationY: Math.PI * 0.12,
    velocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    emitSpawn: false,
  }) ?? null;
  return stabilizeOperatorTestDuck(toy);
}

function installFrontEdgeDemoDuckPatch() {
  const prototype = WorldEngine.prototype;
  if (prototype.frontEdgeDemoDuckPatchInstalled) return;

  const createRubberDuckToy = prototype.createRubberDuckToy;
  prototype.createRubberDuckToy = function createRubberDuckToyWithSingleTestEdge(options = {}) {
    const id = String(options?.id ?? '');
    if (!id.startsWith(TEST_EDGE_DUCK_PREFIX)) return createRubberDuckToy.call(this, options);

    const indexMatch = /-(\d+)$/.exec(id);
    const index = indexMatch ? Number(indexMatch[1]) : 1;
    if (index > 1) return null;

    removeOldDemoToys(this);
    const boardTopY = CONFIG.board.y + 0.42 / 2;
    const toy = createRubberDuckToy.call(this, {
      ...options,
      x: 0,
      y: boardTopY + 0.72,
      z: CONFIG.board.front - 0.18,
      rotationY: Math.PI * 0.12,
      velocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      emitSpawn: false,
    });
    return stabilizeOperatorTestDuck(toy);
  };

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
  removeOldDemoToys,
  stabilizeOperatorTestDuck,
};
