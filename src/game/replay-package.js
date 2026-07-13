import { WorldEngine } from './world-engine.js';
import { TURN_STATES } from './turn-controller.js';
import { MACHINE_REVISION } from './world-snapshot.js';

export const REPLAY_PACKAGE_VERSION = 1;
export const DEFAULT_REPLAY_FRAME_RATE = 15;
export const DEFAULT_REPLAY_MAX_SECONDS = 46;

const STATE_CODES = Object.freeze({
  [TURN_STATES.READY]: 0,
  [TURN_STATES.DROPPING]: 1,
  [TURN_STATES.WAITING]: 2,
  [TURN_STATES.ACTIVE]: 3,
  [TURN_STATES.FINISHING]: 4,
  [TURN_STATES.SETTLING]: 5,
});

const CODE_STATES = Object.freeze(Object.fromEntries(
  Object.entries(STATE_CODES).map(([state, code]) => [code, state]),
));

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function rounded(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function immediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

export function encodeReplayFrame(engine) {
  const network = engine.getNetworkSnapshot({ packed: true });
  const turn = network.turn;
  return {
    t: rounded(engine.simulationSeconds, 4),
    pusherZ: rounded(network.pusherZ, 4),
    activeSlotIndex: Number.isInteger(network.activeSlotIndex) ? network.activeSlotIndex : -1,
    state: STATE_CODES[turn.state] ?? 0,
    activeSecondsRemaining: rounded(turn.activeSecondsRemaining, 3),
    coinsWon: Math.max(0, Math.floor(turn.currentTurn?.coinsWon ?? turn.lastResult?.coinsWon ?? 0)),
    coinsLost: Math.max(0, Math.floor(turn.currentTurn?.coinsLost ?? turn.lastResult?.coinsLost ?? 0)),
    coins: network.coins,
    toys: Array.isArray(network.toys) ? network.toys : [],
  };
}

export function decodeReplayState(code) {
  return CODE_STATES[Number(code)] ?? TURN_STATES.READY;
}

export function replayFrameIndexAt(replayPackage, elapsedSeconds) {
  const frames = Array.isArray(replayPackage?.frames) ? replayPackage.frames : [];
  if (!frames.length) return -1;
  const elapsed = Math.max(0, finite(elapsedSeconds));
  const frameRate = Math.max(1, finite(replayPackage.frameRate, DEFAULT_REPLAY_FRAME_RATE));
  const approximate = Math.min(frames.length - 1, Math.floor(elapsed * frameRate));
  if (finite(frames[approximate]?.t, 0) <= elapsed) {
    let index = approximate;
    while (index + 1 < frames.length && finite(frames[index + 1]?.t, Infinity) <= elapsed) index += 1;
    return index;
  }
  let index = approximate;
  while (index > 0 && finite(frames[index]?.t, 0) > elapsed) index -= 1;
  return index;
}

export function replayFramesAt(replayPackage, elapsedSeconds) {
  const frames = Array.isArray(replayPackage?.frames) ? replayPackage.frames : [];
  if (!frames.length) return { previous: null, next: null, alpha: 0, index: -1 };
  const index = replayFrameIndexAt(replayPackage, elapsedSeconds);
  const previous = frames[Math.max(0, index)] ?? frames[0];
  const next = frames[Math.min(frames.length - 1, index + 1)] ?? previous;
  const start = finite(previous?.t);
  const end = finite(next?.t, start);
  const alpha = end > start
    ? Math.max(0, Math.min(1, (finite(elapsedSeconds) - start) / (end - start)))
    : 0;
  return { previous, next, alpha, index };
}

export function publicTurnSnapshotFromReplay(replayPackage, elapsedSeconds, fallbackTurn = null) {
  const { previous } = replayFramesAt(replayPackage, elapsedSeconds);
  const turn = replayPackage?.turn ?? {};
  const state = previous ? decodeReplayState(previous.state) : TURN_STATES.DROPPING;
  const currentTurn = state === TURN_STATES.READY ? null : {
    id: turn.id ?? replayPackage?.id ?? null,
    playerId: turn.playerId ?? null,
    number: Math.max(1, Math.floor(turn.number ?? fallbackTurn?.nextTurnNumber ?? 1)),
    coinsDropped: Math.max(1, Math.floor(turn.coinsDropped ?? 1)),
    coinsWon: Math.max(0, Math.floor(previous?.coinsWon ?? 0)),
    coinsLost: Math.max(0, Math.floor(previous?.coinsLost ?? 0)),
    slotPlan: Array.isArray(turn.slotPlan) ? [...turn.slotPlan] : [],
    seed: Number.isInteger(turn.seed) ? turn.seed >>> 0 : null,
    startedAt: turn.startedAt ?? replayPackage?.createdAt ?? null,
    activeStartedAt: turn.startedAt ?? replayPackage?.createdAt ?? null,
    completedAt: null,
  };

  return {
    ...(fallbackTurn ?? {}),
    state,
    nextTurnNumber: Math.max(1, Math.floor(turn.number ?? fallbackTurn?.nextTurnNumber ?? 1)),
    currentTurn,
    lastResult: null,
    activeSecondsRemaining: Math.max(0, finite(previous?.activeSecondsRemaining)),
    finishAtPusherTime: null,
    settleQuietRemaining: 0,
    settleMaximumRemaining: 0,
    ownsScoringWindow: Boolean(currentTurn),
  };
}

export async function simulateRecordedTurn({
  initialWorld,
  startBoundary,
  playerId,
  playerLabel = '',
  coinsDropped,
  seed,
  turnId = null,
  frameRate = DEFAULT_REPLAY_FRAME_RATE,
  maximumSeconds = DEFAULT_REPLAY_MAX_SECONDS,
  yieldEverySteps = 135,
  onProgress = () => {},
} = {}) {
  if (!initialWorld) throw new Error('A confirmed starting world is required');
  const normalizedFrameRate = Math.max(5, Math.min(30, Math.floor(frameRate)));
  const normalizedMaximum = Math.max(10, Math.min(90, finite(maximumSeconds, DEFAULT_REPLAY_MAX_SECONDS)));
  const events = [];
  const engine = new WorldEngine({
    initialSnapshot: initialWorld,
    seedMachine: false,
    onEvent: (event) => {
      const coinEvent = event?.type === 'coin-payout' || event?.type === 'coin-loss';
      const toyEvent = event?.type === 'toy-spawn' || event?.type === 'toy-payout' || event?.type === 'toy-loss';
      if (!coinEvent && !toyEvent) return;
      if (coinEvent) {
        events.push({
          id: `${event.turnId ?? turnId}:${event.type}:${event.coinId}:${events.length + 1}`,
          type: event.type === 'coin-payout' ? 'payout' : 'loss',
          turnId: event.turnId ?? turnId,
          playerId: event.playerId ?? playerId ?? null,
          coinId: event.coinId,
          at: rounded(event.elapsedSeconds, 4),
          value: 1,
          position: Array.isArray(event.coin?.position) ? event.coin.position.map((value) => rounded(value, 4)) : null,
          quaternion: Array.isArray(event.coin?.quaternion) ? event.coin.quaternion.map((value) => rounded(value, 5)) : null,
        });
        return;
      }
      events.push({
        id: `${event.turnId ?? turnId}:${event.type}:${event.toyId}:${events.length + 1}`,
        type: event.type,
        turnId: event.turnId ?? turnId,
        playerId: event.playerId ?? playerId ?? null,
        toyId: event.toyId,
        toyKey: event.toyKey,
        sourceTurnId: event.sourceTurnId ?? event.toy?.sourceTurnId ?? null,
        sourcePlayerId: event.sourcePlayerId ?? event.toy?.sourcePlayerId ?? null,
        at: rounded(event.elapsedSeconds, 4),
        position: Array.isArray(event.toy?.position) ? event.toy.position.map((value) => rounded(value, 4)) : null,
        quaternion: Array.isArray(event.toy?.quaternion) ? event.toy.quaternion.map((value) => rounded(value, 5)) : null,
      });
    },
  });

  const turn = engine.startTurn({
    playerId,
    coinsDropped,
    seed,
    id: turnId,
    startedAt: Date.now(),
  });
  const fixedStep = 1 / engine.physicsRate;
  const sampleEverySteps = Math.max(1, Math.round(engine.physicsRate / normalizedFrameRate));
  const maximumSteps = Math.ceil(normalizedMaximum * engine.physicsRate);
  const frames = [encodeReplayFrame(engine)];
  let lastProgressSecond = -1;

  for (let step = 1; step <= maximumSteps; step += 1) {
    engine.fixedStep(fixedStep);
    const snapshot = engine.turnController.getSnapshot();
    const finalized = snapshot.state === TURN_STATES.READY && snapshot.lastResult?.id === turn.id;
    if (step % sampleEverySteps === 0 || finalized) frames.push(encodeReplayFrame(engine));

    const wholeSecond = Math.floor(engine.simulationSeconds);
    if (wholeSecond !== lastProgressSecond) {
      lastProgressSecond = wholeSecond;
      onProgress({
        elapsedSeconds: engine.simulationSeconds,
        maximumSeconds: normalizedMaximum,
        frameCount: frames.length,
        coinCount: engine.coins.length,
      });
    }

    if (finalized) break;
    if (yieldEverySteps > 0 && step % yieldEverySteps === 0) await immediate();
  }

  const finalTurn = engine.turnController.getSnapshot();
  if (finalTurn.state !== TURN_STATES.READY || !finalTurn.lastResult || finalTurn.lastResult.id !== turn.id) {
    throw new Error(`Authoritative turn simulation exceeded ${normalizedMaximum} seconds without finalizing`);
  }

  const durationSeconds = rounded(engine.simulationSeconds, 4);
  const lastFrame = frames.at(-1);
  if (!lastFrame || Math.abs(finite(lastFrame.t) - durationSeconds) > 0.0001) frames.push(encodeReplayFrame(engine));

  return {
    kind: 'yes-pusher-recorded-replay',
    version: REPLAY_PACKAGE_VERSION,
    machineRevision: MACHINE_REVISION,
    id: turn.id,
    createdAt: Date.now(),
    frameRate: normalizedFrameRate,
    frameIntervalSeconds: rounded(sampleEverySteps * fixedStep, 6),
    physicsRate: engine.physicsRate,
    durationSeconds,
    turn: {
      id: turn.id,
      playerId: turn.playerId,
      playerLabel: String(playerLabel ?? ''),
      number: turn.number,
      coinsDropped: turn.coinsDropped,
      slotPlan: [...turn.slotPlan],
      seed: turn.seed,
      startedAt: turn.startedAt,
    },
    startWorld: startBoundary,
    frames,
    events,
    result: { ...finalTurn.lastResult, slotPlan: [...finalTurn.lastResult.slotPlan] },
    finalWorld: engine.exportConfirmedWorld(),
  };
}

export function isReplayPackage(value) {
  return Boolean(
    value
    && value.kind === 'yes-pusher-recorded-replay'
    && value.version === REPLAY_PACKAGE_VERSION
    && value.machineRevision === MACHINE_REVISION
    && typeof value.id === 'string'
    && Array.isArray(value.frames)
    && value.frames.length > 1
    && value.finalWorld
  );
}
