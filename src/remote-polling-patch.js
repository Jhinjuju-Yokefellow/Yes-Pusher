import { WORLD_SERVER_IS_REMOTE } from './network/world-server-url.js';
import { SharedWorldClient } from './network/shared-world-client.js';

export const REMOTE_POLL_INTERVAL_MS = 1_000;
export const REMOTE_SNAPSHOT_TIMEOUT_MS = 20_000;

function installRemotePollingPatch() {
  if (!WORLD_SERVER_IS_REMOTE) return;
  const prototype = SharedWorldClient.prototype;
  if (prototype.remotePollingPatchInstalled) return;

  const fetchSnapshot = prototype.fetchSnapshot;
  prototype.fetchSnapshot = function fetchHostedSnapshot(options = {}) {
    return fetchSnapshot.call(this, {
      ...options,
      timeoutMs: Math.max(
        REMOTE_SNAPSHOT_TIMEOUT_MS,
        Number(options?.timeoutMs) || 0,
      ),
    });
  };

  const openEvents = prototype.openEvents;
  prototype.openEvents = function openHostedPollingTransport() {
    this.streamAbort?.abort();
    this.streamAbort = null;
    this.streamLoop = null;
    this.streamConnected = false;
    this.streamHasSnapshot = false;
    this.pollIntervalMs = Math.min(Number(this.pollIntervalMs) || 1_000, REMOTE_POLL_INTERVAL_MS);
    this.startPolling();
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

export { installRemotePollingPatch };
