import * as CANNON from 'cannon-es';
import { WorldEngine } from '../../game/world-engine.js';
import { TURN_STATES } from '../../game/turn-controller.js';
import { PlaySessionQueue, normalizeVisualKey } from './play-session-queue.js';

const CORE_KIND = 'yes-pusher-machine-core';
const CORE_VERSION = 1;
const MAX_TICK_SECONDS = 0.05;

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value) {
  return Math.round(finite(value) * 10_000) / 10_000;
}

function cloneResult(result) {
  if (!result || typeof result !== 'object') return null;
  return {
    ...result,
    slotPlan: Array.isArray(result.slotPlan) ? [...result.slotPlan] : [],
  };
}

export class MachineCore {
  constructor({
    seed = 1,
    seedMachine = true,
    initialState = null,
    now = () => Date.now(),
  } = {}) {
    this.now = now;
    this.events = [];
    this.sessions = new PlaySessionQueue({ now });
    this.activeSession = null;
    this.pendingFinalizedResult = null;
    this.knownCoinIds = new Set();
    this.visualKeys = new Map();
    this.completedPlays = 0;

    const world = initialState?.kind === CORE_KIND && initialState.version === CORE_VERSION
      ? initialState.world
      : null;
    const savedVisualKeys = initialState?.kind === CORE_KIND && initialState.version === CORE_VERSION
      ? initialState.visualKeys
      : null;

    this.engine = new WorldEngine({
      seed,
      seedMachine,
      initialSnapshot: world,
      onEvent: (event) => this.handleEngineEvent(event),
    });

    // The physical machine is continuous. READY means no player owns scoring;
    // it does not mean the pusher or physics loop stops.
    this.engine.setVisualReplayActive(true);

    for (const coin of this.engine.coins) {
      this.knownCoinIds.add(coin.id);
      const saved = savedVisualKeys && typeof savedVisualKeys === 'object'
        ? savedVisualKeys[coin.id]
        : null;
      this.visualKeys.set(coin.id, normalizeVisualKey(saved));
    }
  }

  emit(type, detail = {}) {
    const event = {
      type,
      sequence: this.events.length + 1,
      at: this.now(),
      ...detail,
    };
    this.events.push(event);
    return event;
  }

  handleEngineEvent(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'turn' && event.reason === 'turn-finalized') {
      this.pendingFinalizedResult = cloneResult(event.snapshot?.lastResult);
      return;
    }
    if (event.type === 'coin-payout' || event.type === 'coin-loss') {
      this.emit(event.type, {
        playId: event.turnId ?? this.activeSession?.id ?? null,
        playerId: event.playerId ?? this.activeSession?.playerId ?? null,
        objectId: event.coinId ?? null,
        visualKey: normalizeVisualKey(this.visualKeys.get(event.coinId)),
        elapsedSeconds: finite(event.elapsedSeconds),
      });
    }
  }

  enqueueDrop(request = {}) {
    const session = this.sessions.enqueue(request);
    this.emit('play-queued', {
      playId: session.id,
      playerId: session.playerId,
      coins: session.coins,
      visualKey: session.visualKey,
    });
    return session;
  }

  startNextIfReady() {
    if (this.activeSession) return false;
    if (this.engine.turnController.getSnapshot().state !== TURN_STATES.READY) return false;
    const session = this.sessions.startNext();
    if (!session) return false;

    this.activeSession = session;
    this.pendingFinalizedResult = null;
    try {
      const turn = this.engine.startTurn({
        id: session.id,
        playerId: session.playerId,
        coinsDropped: session.coins,
        seed: session.seed ?? ((Math.imul(session.sequence, 0x9e3779b1) ^ 0x85ebca6b) >>> 0),
        startedAt: session.startedAt,
      });
      this.captureNewCoins();
      this.emit('play-started', {
        playId: session.id,
        playerId: session.playerId,
        coins: session.coins,
        visualKey: session.visualKey,
        turn: cloneResult(turn),
      });
      return true;
    } catch (error) {
      const failed = this.sessions.failActive(error);
      this.emit('play-failed', {
        playId: session.id,
        playerId: session.playerId,
        error: failed?.result?.error ?? String(error),
      });
      this.activeSession = null;
      return false;
    }
  }

  captureNewCoins() {
    const visualKey = normalizeVisualKey(this.activeSession?.visualKey);
    for (const coin of this.engine.coins) {
      if (this.knownCoinIds.has(coin.id)) continue;
      this.knownCoinIds.add(coin.id);
      this.visualKeys.set(coin.id, visualKey);
      this.emit('object-spawned', {
        playId: this.activeSession?.id ?? null,
        playerId: this.activeSession?.playerId ?? null,
        objectId: coin.id,
        objectType: 'coin',
        visualKey,
      });
    }
  }

  pruneRemovedCoins() {
    const current = new Set(this.engine.coins.map((coin) => coin.id));
    for (const id of this.knownCoinIds) {
      if (current.has(id)) continue;
      this.knownCoinIds.delete(id);
      this.visualKeys.delete(id);
      this.emit('object-removed', { objectId: id, objectType: 'coin' });
    }
  }

  completeFinalizedPlay() {
    const result = this.pendingFinalizedResult;
    if (!result || !this.activeSession) return false;
    const session = this.sessions.completeActive(result);
    this.completedPlays += 1;
    this.emit('play-completed', {
      playId: session.id,
      playerId: session.playerId,
      coinsDropped: result.coinsDropped ?? session.coins,
      coinsWon: result.coinsWon ?? 0,
      coinsLost: result.coinsLost ?? 0,
      result,
    });
    this.activeSession = null;
    this.pendingFinalizedResult = null;
    return true;
  }

  tick(seconds = 0) {
    let remaining = Math.max(0, finite(seconds));
    this.startNextIfReady();

    while (remaining > 0.000001) {
      const step = Math.min(MAX_TICK_SECONDS, remaining);
      this.engine.advance(step);
      this.captureNewCoins();
      this.completeFinalizedPlay();
      this.pruneRemovedCoins();
      this.startNextIfReady();
      remaining -= step;
    }

    return this.snapshot();
  }

  setObjectVisualKey(objectId, visualKey) {
    const id = String(objectId ?? '').trim();
    if (!id || !this.engine.coinById.has(id)) return false;
    this.visualKeys.set(id, normalizeVisualKey(visualKey));
    return true;
  }

  snapshot() {
    const turn = this.engine.turnController.getSnapshot();
    return {
      kind: CORE_KIND,
      version: CORE_VERSION,
      generatedAt: this.now(),
      pusherZ: round(this.engine.pusher.z),
      activePlay: this.activeSession ? {
        id: this.activeSession.id,
        playerId: this.activeSession.playerId,
        coins: this.activeSession.coins,
        visualKey: this.activeSession.visualKey,
        startedAt: this.activeSession.startedAt,
      } : null,
      queue: this.sessions.snapshot(),
      completedPlays: this.completedPlays,
      scoringState: turn.state,
      objects: this.engine.coins.map((coin) => {
        const body = coin.body;
        return {
          id: coin.id,
          type: 'coin',
          visualKey: normalizeVisualKey(this.visualKeys.get(coin.id)),
          position: [round(body.position.x), round(body.position.y), round(body.position.z)],
          quaternion: [
            round(body.quaternion.x),
            round(body.quaternion.y),
            round(body.quaternion.z),
            round(body.quaternion.w),
          ],
          sleeping: body.sleepState === CANNON.Body.SLEEPING,
        };
      }),
    };
  }

  exportState() {
    if (this.activeSession || this.sessions.pending.length) {
      throw new Error('MachineCore state may only be exported at an idle play boundary');
    }
    const visualKeys = {};
    for (const coin of this.engine.coins) {
      visualKeys[coin.id] = normalizeVisualKey(this.visualKeys.get(coin.id));
    }
    return {
      kind: CORE_KIND,
      version: CORE_VERSION,
      savedAt: this.now(),
      world: this.engine.exportConfirmedWorld(),
      visualKeys,
    };
  }

  drainEvents() {
    const events = this.events.map((event) => ({ ...event }));
    this.events.length = 0;
    return events;
  }

  isIdle() {
    return Boolean(
      !this.activeSession
      && this.sessions.pending.length === 0
      && this.engine.turnController.getSnapshot().state === TURN_STATES.READY
    );
  }
}

export { CORE_KIND, CORE_VERSION };
