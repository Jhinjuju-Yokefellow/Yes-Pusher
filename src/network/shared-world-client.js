import { worldServerUrl } from './world-server-url.js';

const PLAYER_ID_KEY = 'yes-pusher:shared-player-id:v1';
const PLAYER_LABEL_KEY = 'yes-pusher:shared-player-label:v1';

function randomId(prefix = 'player') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

function wait(ms, signal = null) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function formatRequestError(label, url, error) {
  const detail = error instanceof Error ? error.message : String(error || 'Unknown network error');
  const timeout = error?.name === 'AbortError' || /abort|timeout/i.test(detail);
  return new Error(`${label} ${timeout ? 'timed out' : 'failed'}: ${url} — ${detail}`);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8_000, externalSignal = null) {
  const controller = new AbortController();
  let timeout = null;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    if (timeout) clearTimeout(timeout);
    externalSignal?.removeEventListener?.('abort', abortFromExternal);
  }
}

async function parseResponse(response, url) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Shared-world request failed (${response.status}) at ${url}`);
  }
  return payload;
}

export class SharedWorldClient {
  constructor({
    onSnapshot = () => {},
    onConnection = () => {},
    onError = () => {},
    pollIntervalMs = 1_000,
    hiddenPollIntervalMs = 2_500,
  } = {}) {
    this.anonymousIdentity = loadIdentity();
    this.playerId = this.anonymousIdentity.id;
    this.playerLabel = this.anonymousIdentity.label;
    this.clientId = randomId('client');
    this.sessionToken = '';
    this.onSnapshot = onSnapshot;
    this.onConnection = onConnection;
    this.onError = onError;
    this.pollIntervalMs = pollIntervalMs;
    this.hiddenPollIntervalMs = hiddenPollIntervalMs;

    this.streamAbort = null;
    this.streamLoop = null;
    this.pollAbort = null;
    this.pollLoop = null;
    this.closed = false;
    this.snapshot = null;
    this.connected = false;
    this.streamConnected = false;
    this.streamHasSnapshot = false;
    this.pollingHealthy = false;
    this.connectionMode = 'offline';
    this.lastError = null;
    this.lastFailedUrl = '';
    this.resumePromise = null;
  }

  query() {
    const params = new URLSearchParams({
      playerId: this.playerId,
      label: this.playerLabel,
      clientId: this.clientId,
    });
    return params.toString();
  }

  authHeaders(headers = {}) {
    return this.sessionToken
      ? { ...headers, authorization: `Bearer ${this.sessionToken}` }
      : headers;
  }

  updateConnection({ connected, reconnecting = false, mode = this.connectionMode, error = null, url = '' }) {
    this.connected = Boolean(connected);
    this.connectionMode = this.connected ? mode : 'offline';
    if (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.lastFailedUrl = url;
    } else if (this.connected) {
      this.lastError = null;
      this.lastFailedUrl = '';
    }
    this.onConnection({
      connected: this.connected,
      reconnecting,
      mode: this.connectionMode,
      error: this.lastError,
      url: this.lastFailedUrl,
    });
  }

  reportError(error, url = '') {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.lastError = normalized;
    this.lastFailedUrl = url;
    this.onError(normalized, { url });
    return normalized;
  }

  async fetchSnapshot({ timeoutMs = 8_000, signal = null } = {}) {
    const url = worldServerUrl(`/api/world?${this.query()}`);
    try {
      const response = await fetchWithTimeout(url, {
        cache: 'no-store',
        credentials: 'omit',
        headers: this.authHeaders({ accept: 'application/json' }),
      }, timeoutMs, signal);
      const snapshot = await parseResponse(response, url);
      if (!snapshot.authoritative) throw new Error(`Shared world is not authoritative at ${url}`);
      return snapshot;
    } catch (error) {
      throw formatRequestError('Shared-world snapshot request', url, error);
    }
  }

  async connect({ retries = 10, retryDelayMs = 500, timeoutMs = 8_000 } = {}) {
    this.closed = false;
    let lastError = null;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const snapshot = await this.fetchSnapshot({ timeoutMs });
        this.updateConnection({ connected: true, mode: 'snapshot' });
        this.acceptSnapshot(snapshot, 'snapshot');
        this.openEvents();
        return snapshot;
      } catch (error) {
        lastError = this.reportError(error, worldServerUrl('/api/world'));
        if (attempt < retries - 1) await wait(retryDelayMs);
      }
    }
    // Keep both recovery transports alive even when the very first snapshot
    // request fails. Hosted browsers must never remain on an empty shell just
    // because Railway was waking up or a single request was interrupted.
    this.startPolling();
    if (!this.streamLoop) this.openEvents();
    this.updateConnection({ connected: false, reconnecting: true, error: lastError, url: worldServerUrl('/api/world') });
    throw lastError ?? new Error('Shared world server is unavailable');
  }

  openEvents() {
    this.streamAbort?.abort();
    this.streamAbort = new AbortController();
    const signal = this.streamAbort.signal;
    this.streamLoop = this.runEventLoop(signal)
      .finally(() => {
        if (this.streamAbort?.signal === signal) {
          this.streamLoop = null;
          this.streamAbort = null;
        }
      });
  }

  async runEventLoop(signal) {
    let retryMs = 500;
    while (!signal.aborted && !this.closed) {
      const url = worldServerUrl(`/events?${this.query()}`);
      try {
        const response = await fetchWithTimeout(url, {
          cache: 'no-store',
          credentials: 'omit',
          headers: this.authHeaders({ accept: 'text/event-stream' }),
        }, 12_000, signal);
        if (!response.ok || !response.body) {
          throw new Error(`Shared-world stream failed (${response.status}) at ${url}`);
        }
        this.streamConnected = true;
        this.streamHasSnapshot = false;
        retryMs = 500;
        // Some proxies return stream headers before forwarding the first event.
        // Keep polling until a real stream snapshot arrives so the machine never
        // blanks out while an apparently-open stream is buffered.
        this.startPolling();
        await this.consumeEventStream(response.body, signal);
        if (!signal.aborted) throw new Error(`Shared-world stream closed at ${url}`);
      } catch (error) {
        if (signal.aborted || this.closed) return;
        this.streamConnected = false;
        this.streamHasSnapshot = false;
        const normalized = this.reportError(formatRequestError('Shared-world live stream', url, error), url);
        this.startPolling();
        if (!this.pollingHealthy) {
          this.updateConnection({ connected: false, reconnecting: true, error: normalized, url });
        }
        await wait(retryMs, signal);
        retryMs = Math.min(5_000, Math.round(retryMs * 1.6));
      }
    }
  }

  startPolling() {
    if (this.pollLoop || this.closed) return;
    this.pollAbort = new AbortController();
    const signal = this.pollAbort.signal;
    this.pollLoop = this.runPollingLoop(signal)
      .finally(() => {
        if (this.pollAbort?.signal === signal) {
          this.pollLoop = null;
          this.pollAbort = null;
        }
      });
  }

  stopPolling() {
    this.pollAbort?.abort();
    this.pollAbort = null;
    this.pollLoop = null;
    this.pollingHealthy = false;
  }

  async runPollingLoop(signal) {
    while (!signal.aborted && !this.closed && (!this.streamConnected || !this.streamHasSnapshot)) {
      const url = worldServerUrl(`/api/world?${this.query()}`);
      try {
        const snapshot = await this.fetchSnapshot({ timeoutMs: 8_000, signal });
        if (signal.aborted || this.closed || (this.streamConnected && this.streamHasSnapshot)) return;
        this.pollingHealthy = true;
        this.updateConnection({ connected: true, mode: 'polling' });
        this.acceptSnapshot(snapshot, 'polling');
      } catch (error) {
        if (signal.aborted || this.closed) return;
        this.pollingHealthy = false;
        const normalized = this.reportError(error, url);
        if (!this.streamConnected) {
          this.updateConnection({ connected: false, reconnecting: true, error: normalized, url });
        }
      }
      const hidden = globalThis.document?.visibilityState === 'hidden';
      await wait(hidden ? this.hiddenPollIntervalMs : this.pollIntervalMs, signal);
    }
  }

  async refresh({ timeoutMs = 8_000 } = {}) {
    const snapshot = await this.fetchSnapshot({ timeoutMs });
    const mode = this.streamConnected ? 'stream' : 'polling';
    if (!this.streamConnected) this.pollingHealthy = true;
    this.updateConnection({ connected: true, mode });
    this.acceptSnapshot(snapshot, 'refresh');
    return snapshot;
  }

  async resume() {
    if (this.resumePromise) return this.resumePromise;
    this.resumePromise = (async () => {
      this.closed = false;
      try {
        await this.refresh({ timeoutMs: 8_000 });
      } catch (error) {
        const normalized = this.reportError(error, worldServerUrl('/api/world'));
        this.updateConnection({ connected: false, reconnecting: true, error: normalized, url: worldServerUrl('/api/world') });
        this.startPolling();
      }
      if (!this.streamLoop && !this.streamConnected) this.openEvents();
      return this.snapshot;
    })().finally(() => {
      this.resumePromise = null;
    });
    return this.resumePromise;
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
      this.acceptSnapshot(JSON.parse(data.join('\n')), 'stream');
    } catch (error) {
      this.reportError(error, worldServerUrl('/events'));
    }
  }

  acceptSnapshot(snapshot, source = 'unknown') {
    if (!snapshot || snapshot.kind !== 'yes-pusher-shared-world') return false;
    if (this.snapshot && Number(snapshot.revision) < Number(this.snapshot.revision)) return false;
    this.snapshot = snapshot;
    this.onSnapshot(snapshot);
    if (source === 'stream') {
      this.streamHasSnapshot = true;
      this.pollingHealthy = false;
      this.stopPolling();
      this.updateConnection({ connected: true, mode: 'stream' });
    }
    return true;
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
    const url = worldServerUrl(path);
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: this.authHeaders({ 'content-type': 'application/json' }),
        credentials: 'omit',
        body: JSON.stringify({
          playerId: this.playerId,
          label: this.playerLabel,
          ...values,
        }),
      }, 10_000);
      const payload = await parseResponse(response, url);
      if (payload.snapshot) this.acceptSnapshot(payload.snapshot, 'command');
      if (!this.connected) this.updateConnection({ connected: true, mode: this.streamConnected ? 'stream' : 'polling' });
      return payload;
    } catch (error) {
      const normalized = this.reportError(formatRequestError('Shared-world command', url, error), url);
      throw normalized;
    }
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
    this.stopPolling();
    this.streamConnected = false;
    this.streamHasSnapshot = false;
    this.pollingHealthy = false;
    this.connected = false;
    this.connectionMode = 'offline';
  }
}
