const PROGRESS_VERSION = 2;
const LEGACY_PROGRESS_VERSION = 1;
const DEFAULT_MILESTONE_EVERY = 50;

function whole(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback;
}

function cleanId(value) {
  return String(value ?? '').trim();
}

function normalizeAssignment(value) {
  const number = whole(value?.number);
  if (!number) return null;
  return {
    number,
    turnId: cleanId(value?.turnId) || null,
    settlementId: cleanId(value?.settlementId) || null,
  };
}

function normalizeResult(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string') return null;
  return {
    ...value,
    coinsDropped: whole(value.coinsDropped),
    coinsWon: whole(value.coinsWon),
    coinsLost: whole(value.coinsLost),
    lifetimeCoinsWon: whole(value.lifetimeCoinsWon),
    crossedMilestones: whole(value.crossedMilestones),
    skinDropEarned: whole(value.skinDropEarned) > 0 ? 1 : 0,
    pendingSkinMilestones: whole(value.pendingSkinMilestones),
    queuedSkinMilestones: whole(value.queuedSkinMilestones),
    assignedSkinMilestones: whole(value.assignedSkinMilestones),
    confirmedSkinMilestones: whole(value.confirmedSkinMilestones),
    assignedSkinMilestoneNumber: whole(value.assignedSkinMilestoneNumber) || null,
    slotPlan: Array.isArray(value.slotPlan) ? [...value.slotPlan] : [],
  };
}

function copyResult(value) {
  return value ? { ...value, slotPlan: [...value.slotPlan] } : null;
}

function emptyProgress() {
  return {
    lifetime: 0,
    pendingMilestones: 0,
    confirmedMilestones: 0,
    assignments: [],
    lastResult: null,
  };
}

export class PlayerProgressStore {
  constructor(raw = null, { milestoneEvery = DEFAULT_MILESTONE_EVERY } = {}) {
    this.milestoneEvery = Math.max(1, whole(milestoneEvery, DEFAULT_MILESTONE_EVERY));
    this.players = new Map();
    this.restore(raw);
  }

  ensure(playerId) {
    const id = cleanId(playerId);
    if (!id) return null;
    let progress = this.players.get(id);
    if (!progress) {
      progress = emptyProgress();
      this.players.set(id, progress);
    }
    return progress;
  }

  finalizeTurn(result) {
    const playerId = cleanId(result?.playerId);
    if (!playerId) return null;
    const progress = this.ensure(playerId);
    const oldLifetime = progress.lifetime;
    const coinsWon = whole(result?.coinsWon);
    const lifetime = oldLifetime + coinsWon;
    const oldMilestones = Math.floor(oldLifetime / this.milestoneEvery);
    const newMilestones = Math.floor(lifetime / this.milestoneEvery);
    const crossedMilestones = Math.max(0, newMilestones - oldMilestones);
    const available = progress.pendingMilestones + crossedMilestones;

    // Keep one durable milestone request outstanding at a time. A failed request
    // remains assigned to its original turn and idempotency key until Yokefellow
    // accepts it; later milestones stay pending rather than being consumed twice.
    const canAssign = available > 0 && progress.assignments.length === 0;
    const assignedSkinMilestoneNumber = canAssign
      ? progress.confirmedMilestones + 1
      : null;
    if (assignedSkinMilestoneNumber) {
      progress.assignments.push({
        number: assignedSkinMilestoneNumber,
        turnId: cleanId(result?.id) || null,
        settlementId: null,
      });
    }

    progress.lifetime = lifetime;
    progress.pendingMilestones = Math.max(0, available - (canAssign ? 1 : 0));
    progress.lastResult = normalizeResult({
      ...result,
      lifetimeCoinsWon: lifetime,
      crossedMilestones,
      skinDropEarned: canAssign ? 1 : 0,
      pendingSkinMilestones: progress.pendingMilestones + progress.assignments.length,
      queuedSkinMilestones: progress.pendingMilestones,
      assignedSkinMilestones: progress.assignments.length,
      confirmedSkinMilestones: progress.confirmedMilestones,
      assignedSkinMilestoneNumber,
      resolvedSkinMilestones: progress.confirmedMilestones,
    });
    return copyResult(progress.lastResult);
  }

  confirmSkinMilestone(playerId, milestoneNumber, settlementId = null) {
    const progress = this.ensure(playerId);
    const number = whole(milestoneNumber);
    if (!progress || !number) return false;
    const index = progress.assignments.findIndex((assignment) => assignment.number === number);
    if (number <= progress.confirmedMilestones) return false;
    if (index >= 0) progress.assignments.splice(index, 1);
    else if (number !== progress.confirmedMilestones + 1) return false;
    progress.confirmedMilestones = Math.max(progress.confirmedMilestones + 1, number);
    const totalMilestones = Math.floor(progress.lifetime / this.milestoneEvery);
    progress.pendingMilestones = Math.max(0, totalMilestones - progress.confirmedMilestones - progress.assignments.length);
    if (progress.lastResult) {
      progress.lastResult = normalizeResult({
        ...progress.lastResult,
        pendingSkinMilestones: progress.pendingMilestones + progress.assignments.length,
        queuedSkinMilestones: progress.pendingMilestones,
        assignedSkinMilestones: progress.assignments.length,
        confirmedSkinMilestones: progress.confirmedMilestones,
        resolvedSkinMilestones: progress.confirmedMilestones,
        skinDropSettlementId: cleanId(settlementId) || progress.lastResult.skinDropSettlementId || null,
      });
    }
    return true;
  }

  reconcileSettlementRecords(records = []) {
    let changed = false;
    const byPlayer = new Map();
    for (const record of records) {
      const playerId = cleanId(record?.playerId);
      const milestoneNumber = whole(record?.skinDropMilestoneNumber ?? record?.resolvedSkinMilestones);
      if (!playerId || !milestoneNumber || !whole(record?.skinDropEarned)) continue;
      let list = byPlayer.get(playerId);
      if (!list) {
        list = [];
        byPlayer.set(playerId, list);
      }
      list.push({ record, milestoneNumber });
    }

    for (const [playerId, progress] of this.players) {
      const totalMilestones = Math.floor(progress.lifetime / this.milestoneEvery);
      const recordsForPlayer = byPlayer.get(playerId) ?? [];
      const confirmedNumbers = new Set(recordsForPlayer
        .filter(({ record }) => record.skinDropStatus === 'submitted' && record.skinProgressConfirmed)
        .map(({ milestoneNumber }) => milestoneNumber));
      const acceptedButUnconfirmed = recordsForPlayer
        .filter(({ record }) => record.skinDropStatus === 'submitted' && !record.skinProgressConfirmed)
        .map(({ milestoneNumber }) => milestoneNumber);
      const outstandingNumbers = recordsForPlayer
        .filter(({ record }) => ['pending', 'failed', 'disabled'].includes(record.skinDropStatus))
        .map(({ milestoneNumber }) => milestoneNumber);

      const confirmed = Math.max(progress.confirmedMilestones, ...confirmedNumbers, 0);
      const assignments = [...new Set([...acceptedButUnconfirmed, ...outstandingNumbers])]
        .filter((number) => number > confirmed)
        .sort((a, b) => a - b)
        .slice(0, 1)
        .map((number) => {
          const match = recordsForPlayer.find((item) => item.milestoneNumber === number)?.record;
          return {
            number,
            turnId: cleanId(match?.id) || null,
            settlementId: cleanId(match?.id) || null,
          };
        });
      const pending = Math.max(0, totalMilestones - confirmed - assignments.length);

      if (
        progress.confirmedMilestones !== confirmed
        || progress.pendingMilestones !== pending
        || JSON.stringify(progress.assignments) !== JSON.stringify(assignments)
      ) {
        progress.confirmedMilestones = confirmed;
        progress.pendingMilestones = pending;
        progress.assignments = assignments;
        changed = true;
      }
    }
    return changed;
  }

  view(playerId, currentTurn = null) {
    const progress = this.ensure(playerId) ?? emptyProgress();
    const currentWinnings = currentTurn?.playerId === playerId ? whole(currentTurn.coinsWon) : 0;
    const displayedLifetime = progress.lifetime + currentWinnings;
    return {
      lifetimeCoinsWon: progress.lifetime,
      displayedLifetimeCoinsWon: displayedLifetime,
      pendingSkinMilestones: progress.pendingMilestones + progress.assignments.length,
      queuedSkinMilestones: progress.pendingMilestones,
      assignedSkinMilestones: progress.assignments.length,
      assignedSkinMilestoneNumber: progress.assignments[0]?.number ?? null,
      confirmedSkinMilestones: progress.confirmedMilestones,
      resolvedSkinMilestones: progress.confirmedMilestones,
      milestoneEvery: this.milestoneEvery,
      milestoneProgress: displayedLifetime % this.milestoneEvery,
      nextMilestoneAt: (Math.floor(displayedLifetime / this.milestoneEvery) + 1) * this.milestoneEvery,
      lastResult: copyResult(progress.lastResult),
    };
  }

  decorateTurnSnapshot(turn, playerId) {
    return {
      ...turn,
      ...this.view(playerId, turn?.currentTurn ?? null),
    };
  }

  serialize() {
    return {
      kind: 'yes-pusher-player-progress',
      version: PROGRESS_VERSION,
      milestoneEvery: this.milestoneEvery,
      players: Object.fromEntries([...this.players.entries()].map(([id, progress]) => [id, {
        lifetime: progress.lifetime,
        pendingMilestones: progress.pendingMilestones,
        confirmedMilestones: progress.confirmedMilestones,
        assignments: progress.assignments,
        lastResult: progress.lastResult,
      }])),
    };
  }

  restore(raw) {
    if (!raw || raw.kind !== 'yes-pusher-player-progress') return false;
    if (![LEGACY_PROGRESS_VERSION, PROGRESS_VERSION].includes(raw.version)) return false;
    this.milestoneEvery = Math.max(1, whole(raw.milestoneEvery, this.milestoneEvery));
    for (const [id, value] of Object.entries(raw.players ?? {})) {
      if (!id || !value || typeof value !== 'object') continue;
      if (raw.version === LEGACY_PROGRESS_VERSION) {
        const lifetime = whole(value.lifetime);
        const totalMilestones = Math.floor(lifetime / this.milestoneEvery);
        // Version 1 marked milestones resolved before Yokefellow accepted them.
        // Recover them as unconfirmed; settlement records reconcile exact turn IDs.
        this.players.set(id, {
          lifetime,
          pendingMilestones: Math.max(totalMilestones, whole(value.pendingMilestones) + whole(value.resolvedMilestones)),
          confirmedMilestones: 0,
          assignments: [],
          lastResult: normalizeResult(value.lastResult),
        });
        continue;
      }
      this.players.set(id, {
        lifetime: whole(value.lifetime),
        pendingMilestones: whole(value.pendingMilestones),
        confirmedMilestones: whole(value.confirmedMilestones),
        assignments: (Array.isArray(value.assignments) ? value.assignments : []).map(normalizeAssignment).filter(Boolean),
        lastResult: normalizeResult(value.lastResult),
      });
    }
    return true;
  }
}
