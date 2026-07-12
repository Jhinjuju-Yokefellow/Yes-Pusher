export const WORLD_SNAPSHOT_VERSION = 1;
export const MACHINE_REVISION = 'coinpusher-51-planar-pressure-field-v1';

const VECTOR_LENGTHS = Object.freeze({
  position: 3,
  quaternion: 4,
  velocity: 3,
  angularVelocity: 3,
});

function finiteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function wholeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function normalizeCoin(raw) {
  if (!raw || typeof raw !== 'object') return null;
  for (const [field, length] of Object.entries(VECTOR_LENGTHS)) {
    if (!finiteArray(raw[field], length)) return null;
  }

  const phase = ['board', 'peg', 'transfer'].includes(raw.phase) ? raw.phase : 'board';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : null,
    tower: Boolean(raw.tower),
    phase,
    scored: Boolean(raw.scored),
    hasReachedPusher: Boolean(raw.hasReachedPusher),
    pegAngle: Number.isFinite(raw.pegAngle) ? raw.pegAngle : 0,
    pegNudgeDirection: raw.pegNudgeDirection === -1 ? -1 : 1,
    pegStallSeconds: Number.isFinite(raw.pegStallSeconds) ? Math.max(0, raw.pegStallSeconds) : 0,
    slotIndex: Number.isInteger(raw.slotIndex) ? raw.slotIndex : null,
    position: [...raw.position],
    quaternion: [...raw.quaternion],
    velocity: [...raw.velocity],
    angularVelocity: [...raw.angularVelocity],
    sleeping: Boolean(raw.sleeping),
    transfer: raw.transfer && typeof raw.transfer === 'object' ? { ...raw.transfer } : null,
  };
}

export function createConfirmedWorldSnapshot({
  pusherTime,
  pusherZ,
  selectedCount,
  nextCoinId,
  turnProgress,
  coins,
  savedAt = Date.now(),
} = {}) {
  return {
    kind: 'yes-pusher-confirmed-world',
    version: WORLD_SNAPSHOT_VERSION,
    machineRevision: MACHINE_REVISION,
    savedAt,
    pusherTime: Number.isFinite(pusherTime) ? Math.max(0, pusherTime) : 0,
    pusherZ: Number.isFinite(pusherZ) ? pusherZ : null,
    selectedCount: Math.max(1, Math.min(10, wholeNumber(selectedCount, 5))),
    nextCoinId: Math.max(1, wholeNumber(nextCoinId, 1)),
    turnProgress: {
      lifetime: wholeNumber(turnProgress?.lifetime),
      pendingMilestones: wholeNumber(turnProgress?.pendingMilestones),
      resolvedMilestones: wholeNumber(turnProgress?.resolvedMilestones),
      turnNumber: Math.max(1, wholeNumber(turnProgress?.turnNumber, 1)),
    },
    coins: Array.isArray(coins) ? coins.map(normalizeCoin).filter(Boolean) : [],
  };
}

export function normalizeWorldSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'yes-pusher-confirmed-world') return null;
  if (raw.version !== WORLD_SNAPSHOT_VERSION) return null;
  if (raw.machineRevision !== MACHINE_REVISION) return null;

  const snapshot = createConfirmedWorldSnapshot(raw);
  if (!snapshot.coins.length) return null;
  return snapshot;
}
