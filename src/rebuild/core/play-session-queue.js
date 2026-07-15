function clean(value) {
  return String(value ?? '').trim();
}

function normalizeCoins(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(10, Math.floor(numeric)));
}

function normalizeVisualKey(value) {
  const key = clean(value).toLowerCase();
  if (!key) return 'starter';
  return /^[a-z0-9][a-z0-9._-]{0,95}$/.test(key) ? key : 'starter';
}

export class PlaySessionQueue {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.pending = [];
    this.active = null;
    this.completed = [];
    this.nextSequence = 1;
  }

  enqueue({ id = null, playerId, coins = 1, visualKey = 'starter', seed = null } = {}) {
    const normalizedPlayerId = clean(playerId);
    if (!normalizedPlayerId) throw new Error('playerId is required');
    const sessionId = clean(id) || `play-${this.nextSequence}`;
    if (this.active?.id === sessionId || this.pending.some((session) => session.id === sessionId)) {
      throw new Error(`Play session ${sessionId} already exists`);
    }

    const session = {
      id: sessionId,
      sequence: this.nextSequence,
      playerId: normalizedPlayerId,
      coins: normalizeCoins(coins),
      visualKey: normalizeVisualKey(visualKey),
      seed: Number.isInteger(seed) ? seed >>> 0 : null,
      status: 'queued',
      requestedAt: this.now(),
      startedAt: null,
      completedAt: null,
      result: null,
    };
    this.nextSequence += 1;
    this.pending.push(session);
    return { ...session };
  }

  startNext() {
    if (this.active || !this.pending.length) return null;
    const session = this.pending.shift();
    session.status = 'active';
    session.startedAt = this.now();
    this.active = session;
    return { ...session };
  }

  completeActive(result = null) {
    if (!this.active) return null;
    const session = this.active;
    session.status = 'completed';
    session.completedAt = this.now();
    session.result = result ? { ...result } : null;
    this.completed.push(session);
    this.active = null;
    return { ...session, result: session.result ? { ...session.result } : null };
  }

  failActive(error) {
    if (!this.active) return null;
    const session = this.active;
    session.status = 'failed';
    session.completedAt = this.now();
    session.result = {
      error: error instanceof Error ? error.message : String(error ?? 'Play failed'),
    };
    this.completed.push(session);
    this.active = null;
    return { ...session, result: { ...session.result } };
  }

  snapshot() {
    return {
      active: this.active ? { ...this.active, result: this.active.result ? { ...this.active.result } : null } : null,
      pending: this.pending.map((session) => ({ ...session, result: null })),
      completedCount: this.completed.length,
      nextSequence: this.nextSequence,
    };
  }
}

export { normalizeCoins, normalizeVisualKey };
