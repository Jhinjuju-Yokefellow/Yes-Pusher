function cleanLabel(value, fallback) {
  const label = String(value ?? '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 28);
  return label || fallback;
}

export class PlayerQueue {
  constructor({ disconnectGraceMs = 20_000, now = () => Date.now() } = {}) {
    this.disconnectGraceMs = disconnectGraceMs;
    this.now = now;
    this.players = new Map();
    this.queue = [];
  }

  ensurePlayer(id, label = '') {
    const playerId = String(id ?? '').trim();
    if (!playerId) throw new Error('playerId is required');
    const fallback = `PLAYER ${playerId.slice(-4).toUpperCase()}`;
    const existing = this.players.get(playerId);
    if (existing) {
      existing.label = cleanLabel(label, existing.label || fallback);
      existing.lastSeenAt = this.now();
      return existing;
    }
    const player = {
      id: playerId,
      label: cleanLabel(label, fallback),
      connected: false,
      connections: 0,
      pollSeenAt: null,
      lastSeenAt: this.now(),
      disconnectedAt: null,
      leaveAfterTurn: false,
    };
    this.players.set(playerId, player);
    return player;
  }

  connect(id, label = '') {
    const player = this.ensurePlayer(id, label);
    player.connections += 1;
    player.connected = true;
    player.disconnectedAt = null;
    player.lastSeenAt = this.now();
    return player;
  }

  touch(id, label = '') {
    const player = this.ensurePlayer(id, label);
    const now = this.now();
    player.pollSeenAt = now;
    player.connected = true;
    player.disconnectedAt = null;
    player.lastSeenAt = now;
    return player;
  }

  disconnect(id) {
    const player = this.players.get(id);
    if (!player) return null;
    const now = this.now();
    player.connections = Math.max(0, player.connections - 1);
    const pollIsFresh = player.pollSeenAt !== null && now - player.pollSeenAt < this.disconnectGraceMs;
    player.connected = player.connections > 0 || pollIsFresh;
    player.lastSeenAt = now;
    if (!player.connected) player.disconnectedAt = now;
    return player;
  }

  join(id, label = '') {
    const player = this.ensurePlayer(id, label);
    if (!this.queue.includes(player.id)) this.queue.push(player.id);
    player.leaveAfterTurn = false;
    return this.positionOf(player.id);
  }

  leave(id, { turnRunning = false } = {}) {
    const index = this.queue.indexOf(id);
    if (index < 0) return false;
    if (index === 0 && turnRunning) {
      const player = this.players.get(id);
      if (player) player.leaveAfterTurn = true;
      return true;
    }
    this.queue.splice(index, 1);
    const player = this.players.get(id);
    if (player) player.leaveAfterTurn = false;
    return true;
  }

  rotateAfterTurn() {
    const completedId = this.queue.shift();
    if (!completedId) return null;
    const player = this.players.get(completedId);
    if (player && player.connected && !player.leaveAfterTurn) this.queue.push(completedId);
    else if (player) player.leaveAfterTurn = false;
    this.prune({ preserveActive: false });
    return completedId;
  }

  prune({ preserveActive = true } = {}) {
    const now = this.now();
    const activeId = preserveActive ? this.activeId() : null;
    for (const player of this.players.values()) {
      const pollIsFresh = player.pollSeenAt !== null && now - player.pollSeenAt < this.disconnectGraceMs;
      const connectedNow = player.connections > 0 || pollIsFresh;
      if (connectedNow) {
        player.connected = true;
        player.disconnectedAt = null;
      } else if (player.connected) {
        player.connected = false;
        player.disconnectedAt = player.pollSeenAt ?? now;
      }
    }

    this.queue = this.queue.filter((id) => {
      if (id === activeId) return true;
      const player = this.players.get(id);
      if (!player) return false;
      if (player.connected) return true;
      const disconnectedSince = player.disconnectedAt ?? player.lastSeenAt;
      return now - disconnectedSince < this.disconnectGraceMs;
    });

    for (const [id, player] of this.players) {
      if (player.connected || this.queue.includes(id)) continue;
      const disconnectedSince = player.disconnectedAt ?? player.lastSeenAt;
      if (now - disconnectedSince >= this.disconnectGraceMs) {
        this.players.delete(id);
      }
    }
  }

  activeId() {
    return this.queue[0] ?? null;
  }

  positionOf(id) {
    const index = this.queue.indexOf(id);
    return index < 0 ? null : index + 1;
  }

  isQueued(id) {
    return this.queue.includes(id);
  }

  publicQueue() {
    return this.queue.map((id, index) => {
      const player = this.players.get(id);
      return {
        id,
        label: player?.label ?? `PLAYER ${id.slice(-4).toUpperCase()}`,
        connected: Boolean(player?.connected),
        position: index + 1,
      };
    });
  }

  getPlayer(id) {
    return this.players.get(id) ?? null;
  }
}
