export const COIN_DELTA_REPLAY_ENCODING = 'coin-delta-v1';

function finiteVector(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function phaseCode(value) {
  if (value === 1 || value === 'peg') return 1;
  if (value === 2 || value === 'transfer') return 2;
  return 0;
}

export function normalizePackedReplayCoin(raw) {
  if (Array.isArray(raw)) {
    if (typeof raw[0] !== 'string' || raw.length < 10) return null;
    return [...raw];
  }
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  if (!finiteVector(raw.position, 3) || !finiteVector(raw.quaternion, 4)) return null;
  const sleeping = Boolean(raw.sleeping);
  const packed = [
    raw.id,
    ...raw.position,
    ...raw.quaternion,
    sleeping ? 1 : 0,
    phaseCode(raw.phase),
  ];
  if (!sleeping) {
    packed.push(
      ...(finiteVector(raw.velocity, 3) ? raw.velocity : [0, 0, 0]),
      ...(finiteVector(raw.angularVelocity, 3) ? raw.angularVelocity : [0, 0, 0]),
    );
  }
  if (typeof raw.skinId === 'string' && raw.skinId) packed.push(raw.skinId);
  return packed;
}

function sameState(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function ensureCoinIndex(id, coinIds, idToIndex) {
  let index = idToIndex.get(id);
  if (index !== undefined) return index;
  index = coinIds.length;
  coinIds.push(id);
  idToIndex.set(id, index);
  return index;
}

export function initialCoinDeltaState(replayPackage) {
  const coinIds = Array.isArray(replayPackage?.coinIds) ? replayPackage.coinIds : [];
  const idToIndex = new Map(coinIds.map((id, index) => [id, index]));
  const state = new Map();
  for (const raw of replayPackage?.startWorld?.coins ?? []) {
    const packed = normalizePackedReplayCoin(raw);
    if (!packed) continue;
    const index = idToIndex.get(packed[0]);
    if (index === undefined) continue;
    state.set(index, packed.slice(1));
  }
  return state;
}

export function applyCoinDeltaFrame(state, frame) {
  const changed = [];
  const added = [];
  const removed = [];
  const delta = frame?.coinDelta ?? {};
  for (const encoded of delta.changes ?? []) {
    if (!Array.isArray(encoded) || !Number.isInteger(encoded[0]) || encoded.length < 10) continue;
    const index = encoded[0];
    const next = encoded.slice(1);
    if (!state.has(index)) added.push(index);
    state.set(index, next);
    changed.push(index);
  }
  for (const index of delta.removed ?? []) {
    if (!Number.isInteger(index) || !state.delete(index)) continue;
    removed.push(index);
  }
  return { changed, added, removed };
}

export function compressRecordedReplayCoins(replayPackage) {
  if (!replayPackage || replayPackage.replayEncoding === COIN_DELTA_REPLAY_ENCODING) return replayPackage;
  if (!Array.isArray(replayPackage.frames) || !Array.isArray(replayPackage.startWorld?.coins)) return replayPackage;

  const coinIds = [];
  const idToIndex = new Map();
  let previous = new Map();
  let fullCoinSamples = 0;
  let deltaCoinSamples = 0;

  for (const raw of replayPackage.startWorld.coins) {
    const packed = normalizePackedReplayCoin(raw);
    if (!packed) continue;
    const index = ensureCoinIndex(packed[0], coinIds, idToIndex);
    previous.set(index, packed.slice(1));
  }

  const frames = replayPackage.frames.map((frame) => {
    const current = new Map();
    const active = [];
    const changes = [];
    const rawCoins = Array.isArray(frame?.coins) ? frame.coins : [];
    fullCoinSamples += rawCoins.length;

    for (const raw of rawCoins) {
      const packed = normalizePackedReplayCoin(raw);
      if (!packed) continue;
      const index = ensureCoinIndex(packed[0], coinIds, idToIndex);
      const values = packed.slice(1);
      current.set(index, values);
      active.push(index);
      if (!sameState(previous.get(index), values)) changes.push([index, ...values]);
    }

    const removed = [];
    for (const index of previous.keys()) {
      if (!current.has(index)) removed.push(index);
    }
    deltaCoinSamples += changes.length + removed.length;
    previous = current;

    return {
      ...frame,
      coinCount: active.length,
      coins: active,
      coinDelta: { changes, removed },
    };
  });

  return {
    ...replayPackage,
    replayEncoding: COIN_DELTA_REPLAY_ENCODING,
    coinIds,
    coinDeltaStats: {
      fullCoinSamples,
      deltaCoinSamples,
    },
    frames,
  };
}

export function isCoinDeltaReplay(replayPackage) {
  return Boolean(
    replayPackage
    && replayPackage.replayEncoding === COIN_DELTA_REPLAY_ENCODING
    && Array.isArray(replayPackage.coinIds)
    && Array.isArray(replayPackage.frames),
  );
}
