import { worldServerUrl } from './world-server-url.js';

const PLAYER_ID_KEY = 'yes-pusher:shared-player-id:v1';
const PLAYER_LABEL_KEY = 'yes-pusher:shared-player-label:v1';

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadIdentity() {
  let id;
  let label;
  try {
    id = globalThis.localStorage?.getItem(PLAYER_ID_KEY) || randomId();
    label = globalThis.localStorage?.getItem(PLAYER_LABEL_KEY) || `PLAYER ${id.slice(-4).toUpperCase()}`;
    globalThis.localStorage?.setItem(PLAYER_ID_KEY, id);
    globalThis.localStorage?.setItem(PLAYER_LABEL_KEY, label);
  } catch {
    id = randomId();
    label = `PLAYER ${id.slice(-4).toUpperCase()}`;
  }
  return { id, label };
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Shared-world request failed (${response.status})`);
  return payload;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SharedWorldClient {
  constructor({
    onSnapshot = () => {},
    onConnection = () => {},
    onError = () => {},
  } = {}) {
    this.anonymousIdentity = loadIdentity();
    this.playerId = this.anonymousIdentity.id;
    this.playerLabel = this.anonymousIdentity.label;
    this.sessionToken = '';
    this.onSnapshot = onSnapshot;
    this.onConnection = onConnection;
    this.onError = onError;
    this.streamAbort = null;
    this.streamLoop = null;
    this.closed = false;
    this.snapshot = null;
    this.connected = false;
  }

  query() {
    const params = new URLSearchParams({
      playerId: this.playerId,
      label: this.playerLabel,
    });
    return params.toString();
  }

  authHeaders(headers = {}) {
    return this.sessionToken
      ? { ...headers, authorization: `Bearer ${this.sessionToken}` }
      : headers;
  }

  async connect({ retries = 10, retryDelayMs = 500, timeoutMs = 8_000 } = {}) {
    this.closed = false;
    let lastError = null;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const response = await fetch(worldServerUrl(`/api/world?${this.query()}`), {
          cache: 'no-store',
          credentials: 'include',
          headers: this.authHeaders(),
          signal: AbortSignal.timeout?.(timeoutMs),
        });
        const snapshot = await parseResponse(response);
        if (!snapshot.authoritative) throw new Error('Shared world is not authoritative');
        this.acceptSnapshot(snapshot);
        this.openEvents();
        return snapshot;
      } catch (error) {
        lastError = error;
        if (attempt < retries - 1) await wait(retryDelayMs);
      }
    }
    throw lastError ?? new Error('Shared world server is unavailable');
  }

  openEvents() {
    this.streamAbort?.abort();
    this.streamAbort = new AbortController();
    this.streamLoop = this.runEventLoop(this.streamAbort.signal);
  }

  async runEventLoop(signal) {
    let retryMs = 500;
    while (!signal.aborted && !this.closed) {
      try {
        const response = await fetch(worldServerUrl(`/events?${this.query()}`), {
          cache: 'no-store',
          credentials: 'include',
          headers: this.authHeaders({ accept: 'text/event-stream' }),
          signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`Shared-world stream failed (${response.status})`);
        }
        this.connected = true;
        retryMs = 500;
        this.onConnection({ connected: true });
        await this.consumeEventStream(response.body, signal);
        if (!signal.aborted) throw new Error('Shared-world stream closed');
      } catch (error) {
        if (signal.aborted || this.closed) return;
        this.connected = false;
        this.onConnection({ connected: false, reconnecting: true });
        this.onError(error);
        await wait(retryMs);
        retryMs = Math.min(5_000, Math.round(retryMs * 1.6));
      }
    }
  }

  async consumeEventStream(body, signal) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          this.handleEventBlock(block);
          boundary = buffer.indexOf('\n\n');
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  handleEventBlock(block) {
    let eventName = 'message';
    const data = [];
    for (const line of String(block).split('\n')) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (eventName !== 'world' || !data.length) return;
    try {
      this.acceptSnapshot(JSON.parse(data.join('\n')));
    } catch (error) {
      this.onError(error);
    }
  }

  acceptSnapshot(snapshot) {
    if (!snapshot || snapshot.kind !== 'yes-pusher-shared-world') return;
    if (this.snapshot && Number(snapshot.revision) < Number(this.snapshot.revision)) return;
    this.snapshot = snapshot;
    this.onSnapshot(snapshot);
  }

  useSession(session = null) {
    if (session?.authenticated && session.playerId) {
      this.playerId = session.playerId;
      this.playerLabel = session.label || session.wallet || this.playerId;
      this.sessionToken = String(session.sessionToken ?? '');
      return;
    }
    this.playerId = this.anonymousIdentity.id;
    this.playerLabel = this.anonymousIdentity.label;
    this.sessionToken = '';
  }

  async reconnectWithSession(session = null) {
    this.close();
    this.closed = false;
    this.snapshot = null;
    this.useSession(session);
    return this.connect();
  }

  async command(path, values = {}) {
    const response = await fetch(worldServerUrl(path), {
      method: 'POST',
      headers: this.authHeaders({ 'content-type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({
        playerId: this.playerId,
        label: this.playerLabel,
        ...values,
      }),
    });
    const payload = await parseResponse(response);
    if (payload.snapshot) this.acceptSnapshot(payload.snapshot);
    return payload;
  }

  joinQueue() {
    return this.command('/api/queue/join');
  }

  leaveQueue() {
    return this.command('/api/queue/leave');
  }

  startTurn(coins) {
    return this.command('/api/turn/start', { coins });
  }

  resetTestMachine() {
    return this.command('/api/test/reset');
  }

  close() {
    this.closed = true;
    this.streamAbort?.abort();
    this.streamAbort = null;
    this.streamLoop = null;
    this.connected = false;
  }
}
