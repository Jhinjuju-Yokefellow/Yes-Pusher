import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as CANNON from 'cannon-es';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-pusher-demo-duck-'));
process.env.YES_PUSHER_DATA_DIR = dataDir;
process.env.YES_PUSHER_FRONT_EDGE_DEMO_DUCK = 'true';

const {
  FRONT_EDGE_DEMO_DUCK_ID,
  demoAlreadyCompleted,
  frontEdgeDemoDuckMarkerPath,
} = await import('../apps/world-server/front-edge-demo-duck-patch.js');
const { WorldEngine } = await import('../src/game/world-engine.js');
const { CONFIG } = await import('../src/config/machine-config.js');

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('seeds one visible rubber duck immediately behind the payout trigger', () => {
  const engine = new WorldEngine({ seedMachine: false });
  engine.initializeEmptyMachine();

  const duck = engine.toyById.get(FRONT_EDGE_DEMO_DUCK_ID);
  assert.ok(duck);
  assert.equal(duck.toyKey, 'rubber_duck');
  assert.equal(engine.toys.filter((toy) => toy.id === FRONT_EDGE_DEMO_DUCK_ID).length, 1);
  assert.ok(duck.body.position.z < CONFIG.board.front - 0.16);
  assert.ok(duck.body.position.z > CONFIG.board.front - 0.35);
  assert.ok(duck.body.velocity.z >= 0.24);
  assert.equal(demoAlreadyCompleted(), false);
});

test('operator test reset ducks remain three visible sleeping bodies until contacted', () => {
  const engine = new WorldEngine({ seedMachine: false });
  engine.initializeEmptyMachine();
  engine.clearToys();

  const ducks = [1, 2, 3].map((index) => engine.createRubberDuckToy({
    id: `toy-test-edge-test-${index}`,
    sourceTurnId: 'operator-test-reset',
    emitSpawn: false,
  }));

  assert.equal(ducks.filter(Boolean).length, 3);
  assert.deepEqual(ducks.map((duck) => Number(duck.body.position.x.toFixed(2))), [-2.15, 0, 2.15]);
  assert.equal(ducks.every((duck) => duck.body.position.z <= CONFIG.board.front - 0.82), true);
  assert.equal(ducks.every((duck) => duck.body.position.z > CONFIG.board.front - 1.0), true);
  assert.equal(ducks.every((duck) => duck.body.sleepState === CANNON.Body.SLEEPING), true);
  assert.equal(ducks.every((duck) => duck.body.velocity.lengthSquared() === 0), true);
});

test('marks the demo complete after the duck scores so it does not respawn', () => {
  const engine = new WorldEngine({ seedMachine: false });
  engine.initializeEmptyMachine();
  const duck = engine.toyById.get(FRONT_EDGE_DEMO_DUCK_ID);
  assert.ok(duck);

  duck.scored = true;
  engine.checkToyExits();

  assert.equal(fs.existsSync(frontEdgeDemoDuckMarkerPath()), true);
  assert.equal(demoAlreadyCompleted(), true);

  const nextEngine = new WorldEngine({ seedMachine: false });
  nextEngine.initializeEmptyMachine();
  assert.equal(nextEngine.toyById.has(FRONT_EDGE_DEMO_DUCK_ID), false);
});
