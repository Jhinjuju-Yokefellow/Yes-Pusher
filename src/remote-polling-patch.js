import { WORLD_SERVER_IS_REMOTE, worldServerUrl } from './network/world-server-url.js';
import { SharedWorldClient } from './network/shared-world-client.js';
import {
  isSharedStatus,
  mergeSharedStatus,
  sharedStatusNeedsBoundary,
} from './network/shared-status.js';

export const REMOTE_STATUS_INTERVAL_MS = 1_000;
export const REMOTE_STATUS_TIMEOUT_MS = 6_000;
export const REMOTE_SNAPSHOT_TIMEOUT_MS = 20_000;

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

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = REMOTE_STATUS_TIMEOUT_MS, signal = null) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', relayAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `Shared status failed (${response.status})`);
    return payload;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', relayAbort);
  }
}

async function fetchHostedStatus(client, signal = null) {
  const url = worldServerUrl(`/api/status?${client.query()}`);
  const status = await fetchJsonWithTimeout(url, {
    cache: 'no-store',
    credentials: 'omit',
    headers: client.authHeaders({ accept: 'application/json' }),
  }, REMOTE_STATUS_TIMEOUT_MS, signal);
  if (!isSharedStatus(status)) throw new Error('Shared server returned an invalid lightweight status');
  return status;
}

async function acceptHostedStatus(client, status, signal = null) {
  if (sharedStatusNeedsBoundary(client.snapshot, status)) {
    const snapshot = await client.fetchSnapshot({ timeoutMs: REMOTE_SNAPSHOT_TIMEOUT_MS, signal });
    client.acceptSnapshot(snapshot, 'boundary');
    return snapshot;
  }

  const merged = mergeSharedStatus(client.snapshot, status);
  if (!merged) throw new Error('Shared status could not be applied to the loaded boundary');
  client.acceptSnapshot(merged, 'status');
  return merged;
}

function installRemotePollingPatch() {
  if (!WORLD_SERVER_IS_REMOTE) return;
  const prototype = SharedWorldClient.prototype;
  if (prototype.remotePollingPatchInstalled) return;

  const fetchSnapshot = prototype.fetchSnapshot;
  prototype.fetchSnapshot = function fetchHostedBoundary(options = {}) {
    return fetchSnapshot.call(this, {
      ...options,
      timeoutMs: Math.max(
        REMOTE_SNAPSHOT_TIMEOUT_MS,
        Number(options?.timeoutMs) || 0,
      ),
    });
  };

  prototype.runPollingLoop = async function runHostedStatusLoop(signal) {
    while (!signal.aborted && !this.closed) {
      const url = worldServerUrl(`/api/status?${this.query()}`);
      try {
        const status = await fetchHostedStatus(this, signal);
        if (signal.aborted || this.closed) return;
        await acceptHostedStatus(this, status, signal);
        if (signal.aborted || this.closed) return;
        this.pollingHealthy = true;
        this.updateConnection({ connected: true, mode: 'status', error: null, url: '' });
      } catch (error) {
        if (signal.aborted || this.closed) return;
        this.pollingHealthy = false;
        const normalized = this.reportError(error, url);
        this.updateConnection({ connected: false, reconnecting: true, error: normalized, url });
      }
      const hidden = globalThis.document?.visibilityState === 'hidden';
      await wait(hidden ? Math.max(2_500, this.hiddenPollIntervalMs || 0) : REMOTE_STATUS_INTERVAL_MS, signal);
    }
  };

  const openEvents = prototype.openEvents;
  prototype.openEvents = function openHostedStatusTransport() {
    this.streamAbort?.abort();
    this.streamAbort = null;
    this.streamLoop = null;
    this.streamConnected = false;
    this.streamHasSnapshot = false;
    this.pollIntervalMs = REMOTE_STATUS_INTERVAL_MS;
    this.startPolling();
  };

  prototype.resume = async function resumeHostedStatusTransport() {
    if (this.resumePromise) return this.resumePromise;
    this.resumePromise = (async () => {
      this.closed = false;
      const url = worldServerUrl(`/api/status?${this.query()}`);
      try {
        const status = await fetchHostedStatus(this);
        const snapshot = await acceptHostedStatus(this, status);
        this.pollingHealthy = true;
        this.updateConnection({ connected: true, mode: 'status', error: null, url: '' });
        this.startPolling();
        return snapshot;
      } catch (error) {
        const normalized = this.reportError(error, url);
        this.updateConnection({ connected: false, reconnecting: true, error: normalized, url });
        this.startPolling();
        return this.snapshot;
      }
    })().finally(() => {
      this.resumePromise = null;
    });
    return this.resumePromise;
  };

  Object.defineProperty(prototype, 'remotePollingPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  Object.defineProperty(prototype, 'originalOpenEvents', {
    value: openEvents,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installRemotePollingPatch();

export {
  acceptHostedStatus,
  fetchHostedStatus,
  installRemotePollingPatch,
};
