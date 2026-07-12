const PROGRESS_VERSION = 1;
const DEFAULT_MILESTONE_EVERY = 50;

function whole(value, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
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
    skinDropEarned: whole(value.skinDropEarned),
    pendingSkinMilestones: whole(value.pendingSkinMilestones),
    resolvedSkinMilestones: whole(value.resolvedSkinMilestones),
    slotPlan: Array.isArray(value.slotPlan) ? [...value.slotPlan] : [],
  };
}

export class PlayerProgressStore {
  constructor(raw = null, { milestoneEvery = DEFAULT_MILESTONE_EVERY } = {}) {
    this.milestoneEvery = Math.max(1, whole(milestoneEvery, DEFAULT_MILESTONE_EVERY));
    this.players = new Map();
    this.restore(raw);
  }

  ensure(playerId) {
    const id = String(playerId ?? '').trim();
    if (!id) return null;
    let progress = this.players.get(id);
    if (!progress) {
      progress = {
        lifetime: 0,
        pendingMilestones: 0,
        resolvedMilestones: 0,
        lastResult: null,
      };
      this.players.set(id, progress);
    }
    return progress;
  }

  finalizeTurn(result) {
    const playerId = String(result?.playerId ?? '').trim();
    if (!playerId) return null;
    const progress = this.ensure(playerId);
    const oldLifetime = progress.lifetime;
    const coinsWon = whole(result.coinsWon);
    const lifetime = oldLifetime + coinsWon;
    const oldMilestones = Math.floor(oldLifetime / this.milestoneEvery);
    const newMilestones = Math.floor(lifetime / this.milestoneEvery);
    const crossedMilestones = Math.max(0, newMilestones - oldMilestones);
    const available = progress.pendingMilestones + crossedMilestones;
    const skinDropEarned = available > 0 ? 1 : 0;

    progress.lifetime = lifetime;
    progress.pendingMilestones = Math.max(0, available - skinDropEarned);
    progress.resolvedMilestones += skinDropEarned;
    progress.lastResult = normalizeResult({
      ...result,
      lifetimeCoinsWon: lifetime,
      crossedMilestones,
      skinDropEarned,
      pendingSkinMilestones: progress.pendingMilestones,
      resolvedSkinMilestones: progress.resolvedMilestones,
    });
    return progress.lastResult ? { ...progress.lastResult, slotPlan: [...progress.lastResult.slotPlan] } : null;
  }

  view(playerId, currentTurn = null) {
    const progress = this.ensure(playerId) ?? {
      lifetime: 0,
      pendingMilestones: 0,
      resolvedMilestones: 0,
      lastResult: null,
    };
    const currentWinnings = currentTurn?.playerId === playerId ? whole(currentTurn.coinsWon) : 0;
    const displayedLifetime = progress.lifetime + currentWinnings;
    return {
      lifetimeCoinsWon: progress.lifetime,
      displayedLifetimeCoinsWon: displayedLifetime,
      pendingSkinMilestones: progress.pendingMilestones,
      resolvedSkinMilestones: progress.resolvedMilestones,
      milestoneEvery: this.milestoneEvery,
      milestoneProgress: displayedLifetime % this.milestoneEvery,
      nextMilestoneAt: (Math.floor(displayedLifetime / this.milestoneEvery) + 1) * this.milestoneEvery,
      lastResult: progress.lastResult
        ? { ...progress.lastResult, slotPlan: [...progress.lastResult.slotPlan] }
        : null,
    };
  }

  decorateTurnSnapshot(turn, playerId) {
    const view = this.view(playerId, turn?.currentTurn ?? null);
    return {
      ...turn,
      ...view,
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
        resolvedMilestones: progress.resolvedMilestones,
        lastResult: progress.lastResult,
      }])),
    };
  }

  restore(raw) {
    if (!raw || raw.kind !== 'yes-pusher-player-progress' || raw.version !== PROGRESS_VERSION) return false;
    this.milestoneEvery = Math.max(1, whole(raw.milestoneEvery, this.milestoneEvery));
    for (const [id, value] of Object.entries(raw.players ?? {})) {
      if (!id || !value || typeof value !== 'object') continue;
      this.players.set(id, {
        lifetime: whole(value.lifetime),
        pendingMilestones: whole(value.pendingMilestones),
        resolvedMilestones: whole(value.resolvedMilestones),
        lastResult: normalizeResult(value.lastResult),
      });
    }
    return true;
  }
}
