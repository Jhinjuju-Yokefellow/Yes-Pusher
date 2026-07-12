import * as CANNON from 'cannon-es';
import {
  CONFIG,
  TOWER_LAYOUT,
  TOWER_STACK_OFFSETS,
} from '../config/machine-config.js';
import { createStartingBedPlan } from './initial-layout.js';
import { makeRandomSlotPlan } from './drop-plan.js';
import { createTurnController, TURN_STATES } from './turn-controller.js';
import { createConfirmedWorldSnapshot, normalizeWorldSnapshot } from './world-snapshot.js';

const PHYSICS_RATE = 30;
const FIXED_STEP = 1 / PHYSICS_RATE;
const MAX_STEP = 0.05;

function createSeededRandom(seed = Date.now()) {
  let state = Number(seed) >>> 0 || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function transportNumber(value) {
  return Math.round(Number(value) * 1_000) / 1_000;
}

export class WorldEngine {
  constructor({
    seed = Date.now(),
    onEvent = () => {},
    initialSnapshot = null,
  } = {}) {
    this.random = createSeededRandom(seed);
    this.onEvent = onEvent;
    this.world = null;
    this.materials = null;
    this.pusher = null;
    this.pusherTime = 0;
    this.coins = [];
    this.coinById = new Map();
    this.nextCoinId = 1;
    this.dropSequence = null;
    this.activeSlotIndex = -1;
    this.lastFinalizedResult = null;
    this.accumulator = 0;
    this.physicsRate = PHYSICS_RATE;

    this.boardTopY = CONFIG.board.y + 0.42 / 2;
    this.coinRestY = this.boardTopY + CONFIG.coin.thickness / 2 + 0.004;
    this.pusherTopY = CONFIG.pusher.y + CONFIG.pusher.shelfThickness / 2;
    this.pusherCoinRestY = this.pusherTopY + CONFIG.coin.thickness / 2 + 0.004;

    this.turnController = createTurnController({
      activeDurationSeconds: 30,
      settleQuietSeconds: 1.25,
      settleMaximumSeconds: 3.5,
      milestoneEvery: 50,
      onChange: (snapshot, reason) => {
        if (reason === 'turn-finalized') {
          this.lastFinalizedResult = snapshot.lastResult;
        }
        this.onEvent({ type: 'turn', reason, snapshot });
      },
    });

    this.createPhysicsWorld();
    this.createStaticMachine();

    const normalized = normalizeWorldSnapshot(initialSnapshot);
    if (normalized) this.restoreConfirmedWorld(normalized);
    else this.resetMachine();
  }

  createPhysicsWorld() {
    const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
      allowSleep: true,
    });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = 4;
    world.broadphase.axisIndex = 2;
    world.solver.tolerance = 0.002;
    world.defaultContactMaterial.friction = 0.25;
    world.defaultContactMaterial.restitution = 0.02;

    const materials = {
      coin: new CANNON.Material('coin'),
      board: new CANNON.Material('board'),
      peg: new CANNON.Material('peg'),
      pusher: new CANNON.Material('pusher'),
    };
    world.addContactMaterial(new CANNON.ContactMaterial(materials.coin, materials.coin, {
      friction: 0.28,
      restitution: 0.002,
    }));
    world.addContactMaterial(new CANNON.ContactMaterial(materials.coin, materials.board, {
      friction: 0.38,
      restitution: 0.002,
    }));
    world.addContactMaterial(new CANNON.ContactMaterial(materials.coin, materials.pusher, {
      friction: 0.52,
      restitution: 0,
    }));
    world.addContactMaterial(new CANNON.ContactMaterial(materials.coin, materials.peg, {
      friction: 0.015,
      restitution: 0.28,
    }));

    this.world = world;
    this.materials = materials;
  }

  addStaticBox({
    size,
    position,
    rotation = null,
    material = this.materials.board,
    collisionGroup = 4,
    collisionMask = 1,
  }) {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material,
      collisionFilterGroup: collisionGroup,
      collisionFilterMask: collisionMask,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
    body.position.set(...position);
    if (rotation) body.quaternion.setFromEuler(...rotation);
    this.world.addBody(body);
    return body;
  }

  createStaticMachine() {
    this.addStaticBox({
      size: [CONFIG.board.width, 0.42, CONFIG.board.depth],
      position: [0, CONFIG.board.y, CONFIG.board.z],
    });

    for (const side of [-1, 1]) {
      this.addStaticBox({
        size: [0.34, 2.0, 10.1],
        position: [side * 5.75, 1.55, 0.7],
      });

      const bayLength = CONFIG.funnel.bayFrontZ - CONFIG.funnel.bayRearZ;
      this.addStaticBox({
        size: [0.20, CONFIG.funnel.wallHeight, bayLength],
        position: [
          side * CONFIG.funnel.bayHalfWidth,
          this.boardTopY + CONFIG.funnel.wallHeight / 2,
          CONFIG.funnel.bayRearZ + bayLength / 2,
        ],
      });

      const startX = side * CONFIG.funnel.bayHalfWidth;
      const startZ = CONFIG.funnel.bayFrontZ;
      const endX = side * CONFIG.funnel.frontHalfWidth;
      const endZ = CONFIG.funnel.frontZ;
      const dx = endX - startX;
      const dz = endZ - startZ;
      const length = Math.hypot(dx, dz);
      this.addStaticBox({
        size: [0.20, CONFIG.funnel.wallHeight, length],
        position: [
          (startX + endX) / 2,
          this.boardTopY + CONFIG.funnel.wallHeight / 2,
          (startZ + endZ) / 2,
        ],
        rotation: [0, Math.atan2(dx, dz), 0],
      });
    }

    this.addStaticBox({
      size: [11.0, 8.45, 0.12],
      position: [0, 6.0, -2.64],
    });
    this.addStaticBox({
      size: [11.0, 8.45, 0.12],
      position: [0, 6.0, -3.60],
    });

    for (const side of [-1, 1]) {
      const straightHeight = CONFIG.peg.sideWallTopY - CONFIG.peg.sideWallBottomY;
      this.addStaticBox({
        size: [0.16, straightHeight, 1.04],
        position: [
          side * CONFIG.peg.sideWallX,
          CONFIG.peg.sideWallBottomY + straightHeight / 2,
          CONFIG.peg.z,
        ],
      });

      const lowerX = side * CONFIG.peg.funnelBottomX;
      const lowerY = CONFIG.peg.funnelBottomY;
      const upperX = side * CONFIG.peg.funnelTopX;
      const upperY = CONFIG.peg.funnelTopY;
      const dx = upperX - lowerX;
      const dy = upperY - lowerY;
      const length = Math.hypot(dx, dy);
      this.addStaticBox({
        size: [0.16, length, 1.04],
        position: [(lowerX + upperX) / 2, (lowerY + upperY) / 2, CONFIG.peg.z],
        rotation: [0, 0, -Math.atan2(dx, dy)],
      });
    }

    for (let row = 0; row < CONFIG.peg.rows; row += 1) {
      const y = CONFIG.peg.startY - row * CONFIG.peg.spacingY;
      const columns = row < 4 ? (row % 2 ? 7 : 8) : (row === 4 ? 6 : (row === 5 ? 7 : 6));
      for (let column = 0; column < columns; column += 1) {
        const x = (column - (columns - 1) / 2) * CONFIG.peg.spacingX;
        const body = new CANNON.Body({
          mass: 0,
          type: CANNON.Body.STATIC,
          material: this.materials.peg,
          collisionFilterGroup: 4,
          collisionFilterMask: 1,
        });
        body.addShape(new CANNON.Cylinder(CONFIG.peg.radius, CONFIG.peg.radius, 0.8, 16));
        body.position.set(x, y, CONFIG.peg.z);
        body.quaternion.setFromEuler(Math.PI / 2, 0, 0);
        this.world.addBody(body);
      }
    }

    const wallBottomY = this.pusherTopY + 0.014;
    this.addStaticBox({
      size: [CONFIG.pusher.width + 0.46, 4.0, 0.30],
      position: [0, wallBottomY + 2.0, CONFIG.pusher.wallZ],
      collisionGroup: 4,
      collisionMask: 1,
    });

    const pusherBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      material: this.materials.pusher,
      collisionFilterGroup: 2,
      collisionFilterMask: 1,
    });
    pusherBody.addShape(new CANNON.Box(new CANNON.Vec3(
      CONFIG.pusher.width / 2,
      CONFIG.pusher.shelfThickness / 2,
      CONFIG.pusher.depth / 2,
    )));
    pusherBody.position.set(0, CONFIG.pusher.y, CONFIG.pusher.rearZ);
    this.world.addBody(pusherBody);
    this.pusher = {
      body: pusherBody,
      z: CONFIG.pusher.rearZ,
      lastZ: CONFIG.pusher.rearZ,
      velocity: 0,
      pushing: false,
    };
  }

  setPegCoinOrientation(body, angle) {
    const base = new CANNON.Quaternion();
    base.setFromEuler(Math.PI / 2, 0, 0);
    const spin = new CANNON.Quaternion();
    spin.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), angle);
    spin.mult(base, body.quaternion);
  }

  createCoin({
    x = 0,
    y = 5,
    z = 0,
    flat = true,
    rotationY = 0,
    tower = false,
    startAsleep = false,
    phase = 'board',
    id = null,
  } = {}) {
    const inPegField = phase === 'peg';
    const body = new CANNON.Body({
      mass: CONFIG.coin.mass,
      material: this.materials.coin,
      linearDamping: inPegField ? 0.018 : 0.12,
      angularDamping: inPegField ? 0.035 : 0.26,
      allowSleep: !inPegField,
      sleepSpeedLimit: 0.07,
      sleepTimeLimit: 0.55,
      collisionFilterGroup: 1,
      collisionFilterMask: 2 | 4 | 1,
    });
    body.addShape(new CANNON.Cylinder(
      CONFIG.coin.radius,
      CONFIG.coin.radius,
      CONFIG.coin.thickness,
      8,
    ));
    body.position.set(x, y, z);
    if (flat) body.quaternion.setFromEuler(0, rotationY, 0);
    else this.setPegCoinOrientation(body, rotationY);

    if (phase === 'peg') {
      body.linearFactor.set(1, 1, 0);
      body.angularFactor.set(0, 0, 1);
    } else {
      body.angularFactor.set(0.22, 1, 0.22);
    }

    this.world.addBody(body);
    if (startAsleep) body.sleep();

    const coin = {
      id: id ?? `coin-${this.nextCoinId++}`,
      body,
      tower,
      phase,
      pegAngle: rotationY,
      hasReachedPusher: false,
      pegStallSeconds: 0,
      pegNudgeDirection: this.random() < 0.5 ? -1 : 1,
      transfer: null,
      scored: false,
      slotIndex: null,
    };
    this.coins.push(coin);
    this.coinById.set(coin.id, coin);
    return coin;
  }

  removeCoin(coin) {
    if (!coin?.body?.world) return;
    this.world.removeBody(coin.body);
    this.coinById.delete(coin.id);
    const index = this.coins.indexOf(coin);
    if (index >= 0) this.coins.splice(index, 1);
  }

  clearCoins() {
    for (const coin of [...this.coins]) this.removeCoin(coin);
    this.coins.length = 0;
    this.coinById.clear();
  }

  seedCoinBed() {
    const verticalStep = CONFIG.coin.thickness + 0.006;
    for (const seed of createStartingBedPlan(this.random)) {
      this.createCoin({
        x: seed.x,
        y: this.coinRestY + seed.layer * verticalStep,
        z: seed.z,
        flat: true,
        rotationY: seed.rotationY,
        startAsleep: true,
      });
    }
  }

  createCoinStack(x, z, height) {
    const step = CONFIG.coin.thickness + 0.006;
    for (let layer = 0; layer < height; layer += 1) {
      this.createCoin({
        x,
        y: this.coinRestY + layer * step,
        z,
        flat: true,
        rotationY: (layer % 2) * Math.PI / 6,
        tower: true,
        startAsleep: true,
      });
    }
  }

  createTower(cx, cz, height = 18) {
    const spacing = CONFIG.coin.radius * 2 + 0.045;
    const heights = [height, height - 4, height - 5, 8, 7, 5, 5, 4, 4];
    TOWER_STACK_OFFSETS.forEach(([sx, sz], index) => {
      this.createCoinStack(
        cx + sx * spacing,
        cz + sz * spacing,
        Math.max(3, heights[index]),
      );
    });
  }

  resetMachine() {
    this.clearCoins();
    this.pusherTime = 0;
    this.nextCoinId = 1;
    this.dropSequence = null;
    this.activeSlotIndex = -1;
    this.lastFinalizedResult = null;
    this.turnController.reset();

    this.pusher.z = CONFIG.pusher.rearZ;
    this.pusher.lastZ = CONFIG.pusher.rearZ;
    this.pusher.velocity = 0;
    this.pusher.pushing = false;
    this.pusher.body.velocity.set(0, 0, 0);
    this.pusher.body.position.set(0, CONFIG.pusher.y, CONFIG.pusher.rearZ);
    this.pusher.body.aabbNeedsUpdate = true;

    this.seedCoinBed();
    TOWER_LAYOUT.forEach((tower) => this.createTower(tower.x, tower.z, tower.height));
    this.onEvent({ type: 'machine-reset' });
  }

  startTurn({ playerId, coinsDropped }) {
    const turn = this.turnController.getSnapshot();
    if (turn.state !== TURN_STATES.READY) throw new Error('The machine is already resolving a turn');
    const count = Math.max(1, Math.min(10, Math.floor(Number(coinsDropped) || 1)));
    const slotPlan = makeRandomSlotPlan(CONFIG.slots.length, count, this.random);
    const turnId = `shared-turn-${turn.nextTurnNumber}-${Date.now().toString(36)}`;
    this.turnController.startTurn({
      coinsDropped: count,
      slotPlan,
      id: turnId,
      playerId,
    });
    this.dropSequence = {
      turnId,
      playerId,
      slotPlan,
      index: 0,
      elapsed: 0,
      nextDropAt: 0,
      lastDroppedCoinId: null,
      batchFinished: false,
    };
    this.spawnScheduledCoins();
    this.onEvent({ type: 'turn-started', turnId, playerId, slotPlan });
    return this.turnController.getSnapshot().currentTurn;
  }

  spawnScheduledCoins() {
    const sequence = this.dropSequence;
    if (!sequence || sequence.batchFinished) return;

    while (sequence.index < sequence.slotPlan.length && sequence.elapsed + 1e-9 >= sequence.nextDropAt) {
      const slotIndex = sequence.slotPlan[sequence.index];
      const x = CONFIG.slots[slotIndex];
      const direction = this.random() < 0.5 ? -1 : 1;
      const coin = this.createCoin({
        x: x + (this.random() - 0.5) * 0.10,
        y: 10.72,
        z: CONFIG.peg.z,
        flat: false,
        rotationY: this.random() * Math.PI * 2,
        phase: 'peg',
      });
      coin.slotIndex = slotIndex;
      coin.body.velocity.set(direction * (0.08 + this.random() * 0.10), -0.20, 0);
      coin.body.angularVelocity.set(0, 0, direction * (1.15 + this.random() * 0.45));
      sequence.lastDroppedCoinId = coin.id;
      this.activeSlotIndex = slotIndex;
      sequence.index += 1;
      sequence.nextDropAt += CONFIG.dropIntervalMs / 1000;

      if (sequence.index >= sequence.slotPlan.length) {
        sequence.batchFinished = true;
        this.activeSlotIndex = -1;
        this.turnController.markBatchFinished();
        if (coin.hasReachedPusher) this.turnController.markFinalCoinReached();
        break;
      }
    }
  }

  markCoinReachedPusher(coin) {
    if (coin.hasReachedPusher) return;
    coin.hasReachedPusher = true;
    const sequence = this.dropSequence;
    if (
      sequence?.batchFinished &&
      coin.id === sequence.lastDroppedCoinId
    ) {
      this.turnController.markFinalCoinReached();
    }
  }

  beginReceivingTransfer(coin) {
    if (coin.phase !== 'peg') return;
    const body = coin.body;
    coin.phase = 'transfer';
    coin.transfer = {
      elapsed: 0,
      duration: 0.48,
      fromX: body.position.x,
      fromY: body.position.y,
      fromZ: body.position.z,
      targetX: body.position.x,
      targetY: this.pusherCoinRestY + 0.14,
      targetZ: CONFIG.pusher.wallZ + 0.78,
      yaw: this.random() * Math.PI * 2,
    };
    body.allowSleep = false;
    body.wakeUp();
    body.collisionResponse = false;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
  }

  updateDropSequence(dt) {
    if (!this.dropSequence || this.dropSequence.batchFinished) return;
    this.dropSequence.elapsed += dt;
    this.spawnScheduledCoins();
  }

  updatePegCoins(dt) {
    for (const coin of this.coins) {
      const body = coin.body;
      if (coin.phase === 'peg') {
        body.position.z = CONFIG.peg.z;
        body.velocity.z = 0;
        body.angularVelocity.x = 0;
        body.angularVelocity.y = 0;
        coin.pegAngle += body.angularVelocity.z * dt;
        this.setPegCoinOrientation(body, coin.pegAngle);

        const speed = Math.hypot(body.velocity.x, body.velocity.y);
        if (speed < 0.12 && body.position.y > CONFIG.peg.exitY) {
          coin.pegStallSeconds += dt;
          if (coin.pegStallSeconds > 0.24) {
            body.velocity.x += coin.pegNudgeDirection * (0.26 + this.random() * 0.08);
            body.velocity.y -= 0.085;
            body.angularVelocity.z += coin.pegNudgeDirection * 0.35;
            coin.pegNudgeDirection *= -1;
            coin.pegStallSeconds = 0;
          }
        } else {
          coin.pegStallSeconds = 0;
        }

        if (body.position.y < CONFIG.peg.exitY) {
          const halfWidth = CONFIG.pusher.width / 2 - CONFIG.coin.radius - 0.12;
          if (Math.abs(body.position.x) <= halfWidth) {
            this.beginReceivingTransfer(coin);
          } else {
            body.velocity.x += -Math.sign(body.position.x) * 1.15 * dt;
            body.velocity.y = Math.min(body.velocity.y, -0.18);
            body.wakeUp();
          }
        }
      }

      if (coin.phase === 'transfer' && coin.transfer) {
        const transfer = coin.transfer;
        transfer.elapsed = Math.min(transfer.duration, transfer.elapsed + dt);
        const raw = transfer.elapsed / transfer.duration;
        const eased = raw * raw * (3 - 2 * raw);
        const arc = Math.sin(raw * Math.PI) * 0.12;
        body.position.set(
          lerp(transfer.fromX, transfer.targetX, eased),
          lerp(transfer.fromY, transfer.targetY, eased) - arc,
          lerp(transfer.fromZ, transfer.targetZ, eased),
        );
        body.quaternion.setFromEuler((1 - eased) * Math.PI / 2, transfer.yaw * eased, 0);
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);

        if (raw >= 1) {
          coin.transfer = null;
          coin.phase = 'board';
          body.collisionResponse = true;
          body.allowSleep = true;
          body.linearDamping = 0.11;
          body.angularDamping = 0.25;
          body.linearFactor.set(1, 1, 1);
          body.angularFactor.set(0.22, 1, 0.22);
          body.position.set(transfer.targetX, transfer.targetY, transfer.targetZ);
          body.quaternion.setFromEuler(0, transfer.yaw, 0);
          body.velocity.set(0, -0.10, Math.max(0.06, this.pusher.velocity));
          body.angularVelocity.set(0, (this.random() - 0.5) * 0.18, 0);
          body.wakeUp();
          this.markCoinReachedPusher(coin);
        }
      }
    }
  }

  updatePusher(dt) {
    let nextTime = this.pusherTime + dt;
    nextTime = this.turnController.limitPusherTime(nextTime);
    this.pusherTime = nextTime;
    const t = (this.pusherTime % CONFIG.pusher.period) / CONFIG.pusher.period;

    let progress;
    if (t < 0.43) progress = t / 0.43;
    else if (t < 0.52) progress = 1;
    else if (t < 0.92) {
      const u = (t - 0.52) / 0.40;
      progress = 1 - u * u * (3 - 2 * u);
    } else progress = 0;

    const z = lerp(CONFIG.pusher.rearZ, CONFIG.pusher.frontZ, progress);
    this.pusher.velocity = (z - this.pusher.z) / Math.max(dt, 0.0001);
    this.pusher.lastZ = this.pusher.z;
    this.pusher.z = z;
    this.pusher.pushing = this.pusher.velocity > 0.002 || (progress > 0.998 && t < 0.52);

    const body = this.pusher.body;
    body.collisionResponse = true;
    body.collisionFilterMask = 1;
    body.velocity.set(0, 0, this.pusher.velocity);
    body.position.set(0, CONFIG.pusher.y, z);
    body.aabbNeedsUpdate = true;
    body.wakeUp();

    const rearEdge = z - CONFIG.pusher.depth / 2;
    const frontEdge = z + CONFIG.pusher.depth / 2;
    for (const coin of this.coins) {
      if (coin.phase !== 'board' || !coin.body.world) continue;
      const coinBody = coin.body;
      if (
        Math.abs(coinBody.position.x) < CONFIG.pusher.width / 2 + CONFIG.coin.radius &&
        coinBody.position.z > rearEdge - 0.20 &&
        coinBody.position.z < frontEdge + 1.05
      ) coinBody.wakeUp();
    }

    this.turnController.notifyPusherTime(this.pusherTime);
  }

  assistForwardPressure(dt) {
    if (this.pusher.velocity <= 0.05) return;
    const frontEdge = this.pusher.z + CONFIG.pusher.depth / 2;
    for (const coin of this.coins) {
      if (coin.phase !== 'board' || !coin.body.world) continue;
      const body = coin.body;

      // The loaded payout banks need to transmit a little more of each forward
      // stroke than simplified cylinder friction provides. Move only the low,
      // loose front-bank coins; towers and stacked coins remain fully physical.
      if (
        !coin.tower &&
        Math.abs(body.position.x) > 3.55 &&
        body.position.y < this.boardTopY + 0.20 &&
        body.position.y > this.boardTopY - 0.12 &&
        body.position.z > CONFIG.board.front - 1.15 &&
        body.position.z < CONFIG.board.front + CONFIG.coin.radius
      ) {
        const edgeDepth = Math.max(0, Math.min(1,
          (body.position.z - (CONFIG.board.front - 1.15)) / 1.15,
        ));
        body.position.z += (0.00031 + edgeDepth * 0.00019) * (dt / FIXED_STEP);
        body.aabbNeedsUpdate = true;
        if (body.position.z > CONFIG.board.front - 0.08) body.wakeUp();
      }

      if (
        Math.abs(body.position.x) >= CONFIG.pusher.width / 2 + CONFIG.coin.radius ||
        body.position.y >= this.boardTopY + 0.34 ||
        body.position.y <= this.boardTopY - 0.12 ||
        body.position.z <= frontEdge - CONFIG.coin.radius * 0.85 ||
        body.position.z >= frontEdge + 1.05
      ) continue;

      const distance = Math.max(0, body.position.z - frontEdge);
      const pressure = Math.max(0.20, 1 - distance / 1.05);
      const targetForwardSpeed = Math.min(0.44, 0.20 + this.pusher.velocity * 0.24);
      if (body.velocity.z < targetForwardSpeed) {
        body.velocity.z = Math.min(
          targetForwardSpeed,
          body.velocity.z + 0.95 * pressure * dt,
        );
        body.wakeUp();
      }
    }
  }

  stabilizeBoardCoins(dt) {
    const damping = Math.exp(-5.2 * dt);
    for (const coin of this.coins) {
      if (coin.phase !== 'board') continue;
      const body = coin.body;
      if (body.position.y < this.boardTopY + 0.70 && body.position.y > this.boardTopY - 0.18) {
        if (body.velocity.y > 0.42) body.velocity.y = 0.42;
        body.angularVelocity.x *= damping;
        body.angularVelocity.z *= damping;
      }
    }
  }

  checkScoring() {
    const frontDropStartZ = CONFIG.board.front - CONFIG.coin.radius * 0.55;
    const frontDropY = this.coinRestY - 0.035;
    const frontSpan = CONFIG.board.width / 2 - 0.18;

    for (const coin of [...this.coins]) {
      const position = coin.body.position;
      if (
        !coin.scored &&
        coin.phase === 'board' &&
        Math.abs(position.x) < frontSpan &&
        position.z > frontDropStartZ &&
        position.y < frontDropY
      ) {
        coin.scored = true;
        this.turnController.recordPayout(1);
        coin.body.linearDamping = 0.035;
        coin.body.angularDamping = 0.10;
        coin.body.wakeUp();
      }

      if (coin.scored) {
        if (position.y < -2.7 || position.z > CONFIG.board.front + 3.0) this.removeCoin(coin);
        continue;
      }

      if ((Math.abs(position.x) > 6.2 || position.y < -3 || position.z < -9) && position.y < 0.2) {
        this.turnController.recordLoss(1);
        this.removeCoin(coin);
      }
    }
  }

  fixedStep(dt = FIXED_STEP) {
    this.updateDropSequence(dt);
    this.updatePusher(dt);
    this.world.step(FIXED_STEP, dt, 2);
    this.assistForwardPressure(dt);
    this.updatePegCoins(dt);
    this.stabilizeBoardCoins(dt);
    this.turnController.update(dt, {
      pusherTime: this.pusherTime,
      pusherPeriod: CONFIG.pusher.period,
    });
    this.checkScoring();
  }

  advance(seconds) {
    const safeSeconds = Math.max(0, Math.min(Number(seconds) || 0, MAX_STEP));
    this.accumulator += safeSeconds;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < 6) {
      this.fixedStep(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (steps >= 6) this.accumulator = 0;
  }

  serializeCoin(coin, { compact = false, packed = false } = {}) {
    const body = coin.body;
    if (packed) {
      const sleeping = body.sleepState === CANNON.Body.SLEEPING;
      const base = [
        coin.id,
        transportNumber(body.position.x),
        transportNumber(body.position.y),
        transportNumber(body.position.z),
        transportNumber(body.quaternion.x),
        transportNumber(body.quaternion.y),
        transportNumber(body.quaternion.z),
        transportNumber(body.quaternion.w),
        sleeping ? 1 : 0,
      ];
      if (sleeping) return base;
      return [
        ...base,
        transportNumber(body.velocity.x),
        transportNumber(body.velocity.y),
        transportNumber(body.velocity.z),
        transportNumber(body.angularVelocity.x),
        transportNumber(body.angularVelocity.y),
        transportNumber(body.angularVelocity.z),
      ];
    }
    const base = {
      id: coin.id,
      tower: coin.tower,
      phase: coin.phase,
      scored: coin.scored,
      position: [body.position.x, body.position.y, body.position.z],
      quaternion: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
    };
    if (compact) return base;
    return {
      ...base,
      hasReachedPusher: coin.hasReachedPusher,
      pegAngle: coin.pegAngle,
      pegNudgeDirection: coin.pegNudgeDirection,
      pegStallSeconds: coin.pegStallSeconds,
      slotIndex: Number.isInteger(coin.slotIndex) ? coin.slotIndex : null,
      velocity: [body.velocity.x, body.velocity.y, body.velocity.z],
      angularVelocity: [body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z],
      sleeping: body.sleepState === CANNON.Body.SLEEPING,
      transfer: coin.transfer ? { ...coin.transfer } : null,
    };
  }

  getNetworkSnapshot({ packed = false } = {}) {
    return {
      pusherTime: packed ? transportNumber(this.pusherTime) : this.pusherTime,
      pusherZ: packed ? transportNumber(this.pusher.z) : this.pusher.z,
      activeSlotIndex: this.activeSlotIndex,
      coinCount: this.coins.length,
      coinEncoding: packed ? 'id-position-quaternion-velocity-v2' : 'object-v1',
      coins: this.coins.map((coin) => this.serializeCoin(coin, packed
        ? { packed: true }
        : { compact: true })),
      turn: this.turnController.getSnapshot(),
    };
  }

  exportConfirmedWorld() {
    const turn = this.turnController.getSnapshot();
    return createConfirmedWorldSnapshot({
      pusherTime: this.pusherTime,
      pusherZ: this.pusher.z,
      selectedCount: 5,
      nextCoinId: this.nextCoinId,
      turnProgress: {
        lifetime: turn.lifetimeCoinsWon,
        pendingMilestones: turn.pendingSkinMilestones,
        resolvedMilestones: turn.resolvedSkinMilestones,
        turnNumber: turn.nextTurnNumber,
      },
      coins: this.coins.filter((coin) => coin.body.world).map((coin) => this.serializeCoin(coin)),
    });
  }

  restoreCoin(saved) {
    const coin = this.createCoin({
      x: saved.position[0],
      y: saved.position[1],
      z: saved.position[2],
      flat: saved.phase !== 'peg',
      rotationY: saved.pegAngle,
      tower: saved.tower,
      startAsleep: false,
      phase: saved.phase,
      id: saved.id,
    });
    const body = coin.body;
    coin.scored = saved.scored;
    coin.hasReachedPusher = saved.hasReachedPusher;
    coin.pegAngle = saved.pegAngle;
    coin.pegNudgeDirection = saved.pegNudgeDirection;
    coin.pegStallSeconds = saved.pegStallSeconds;
    coin.slotIndex = saved.slotIndex;
    coin.transfer = saved.transfer ? { ...saved.transfer } : null;

    body.position.set(...saved.position);
    body.quaternion.set(...saved.quaternion);
    body.velocity.set(...saved.velocity);
    body.angularVelocity.set(...saved.angularVelocity);

    if (saved.phase === 'peg') {
      body.allowSleep = false;
      body.collisionResponse = true;
      body.linearFactor.set(1, 1, 0);
      body.angularFactor.set(0, 0, 1);
    } else if (saved.phase === 'transfer') {
      body.allowSleep = false;
      body.collisionResponse = false;
      body.linearFactor.set(1, 1, 1);
      body.angularFactor.set(0.22, 1, 0.22);
    } else {
      body.allowSleep = true;
      body.collisionResponse = true;
      body.linearFactor.set(1, 1, 1);
      body.angularFactor.set(0.22, 1, 0.22);
    }

    body.aabbNeedsUpdate = true;
    if (saved.sleeping && saved.phase === 'board') body.sleep();
    else body.wakeUp();
  }

  restoreConfirmedWorld(rawSnapshot) {
    const snapshot = normalizeWorldSnapshot(rawSnapshot);
    if (!snapshot) throw new Error('World snapshot is incompatible with this machine');
    this.clearCoins();
    this.dropSequence = null;
    this.activeSlotIndex = -1;
    this.lastFinalizedResult = null;
    this.nextCoinId = 1;
    snapshot.coins.forEach((coin) => this.restoreCoin(coin));
    this.nextCoinId = Math.max(snapshot.nextCoinId, this.nextCoinId);

    this.pusherTime = snapshot.pusherTime;
    const z = Number.isFinite(snapshot.pusherZ) ? snapshot.pusherZ : CONFIG.pusher.rearZ;
    this.pusher.z = z;
    this.pusher.lastZ = z;
    this.pusher.velocity = 0;
    this.pusher.pushing = false;
    this.pusher.body.velocity.set(0, 0, 0);
    this.pusher.body.position.set(0, CONFIG.pusher.y, z);
    this.pusher.body.aabbNeedsUpdate = true;

    this.turnController.reset();
    this.turnController.restoreProgress(snapshot.turnProgress);
    this.onEvent({ type: 'world-restored' });
  }
}

export { FIXED_STEP };
