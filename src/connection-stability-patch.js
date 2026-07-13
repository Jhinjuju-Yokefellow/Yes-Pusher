import { SharedWorldClient } from './network/shared-world-client.js';

export const CONNECTION_GRACE_MS = 30_000;

function installConnectionStabilityPatch() {
  const prototype = SharedWorldClient.prototype;
  if (prototype.connectionStabilityPatchInstalled) return;

  const acceptSnapshot = prototype.acceptSnapshot;
  prototype.acceptSnapshot = function acceptSnapshotWithFreshness(snapshot, source = 'unknown') {
    const accepted = acceptSnapshot.call(this, snapshot, source);
    if (accepted) this.lastHealthySnapshotAt = Date.now();
    return accepted;
  };

  const reportError = prototype.reportError;
  prototype.reportError = function reportErrorWithoutTransientNoise(error, url = '') {
    const lastHealthy = Number(this.lastHealthySnapshotAt) || 0;
    const hasRecentWorld = Boolean(this.snapshot) && Date.now() - lastHealthy < CONNECTION_GRACE_MS;
    if (!hasRecentWorld) return reportError.call(this, error, url);

    const onError = this.onError;
    this.onError = () => {};
    try {
      return reportError.call(this, error, url);
    } finally {
      this.onError = onError;
    }
  };

  const updateConnection = prototype.updateConnection;
  prototype.updateConnection = function updateConnectionWithoutTransientFlash(state = {}) {
    const lastHealthy = Number(this.lastHealthySnapshotAt) || 0;
    const hasRecentWorld = Boolean(this.snapshot) && Date.now() - lastHealthy < CONNECTION_GRACE_MS;
    if (!state.connected && state.reconnecting && hasRecentWorld) {
      return updateConnection.call(this, {
        connected: true,
        reconnecting: true,
        mode: this.connectionMode === 'offline' ? 'polling' : this.connectionMode,
        error: null,
        url: '',
      });
    }
    return updateConnection.call(this, state);
  };

  Object.defineProperty(prototype, 'connectionStabilityPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installConnectionStabilityPatch();

export { installConnectionStabilityPatch };
