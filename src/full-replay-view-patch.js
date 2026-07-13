import { SharedWorldView } from './network/shared-world-view.js';

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function installFullReplayViewPatch() {
  const prototype = SharedWorldView.prototype;
  if (prototype.fullReplayViewPatchInstalled) return;

  const beginRecordedReplay = prototype.beginRecordedReplay;
  const loadRecordedReplay = prototype.loadRecordedReplay;
  const applySnapshot = prototype.applySnapshot;
  const update = prototype.update;
  const clear = prototype.clear;

  prototype.beginRecordedReplay = function beginFullRecordedReplay(snapshot) {
    const turnId = snapshot?.replay?.turnId ?? null;
    const isNewReplay = Boolean(turnId && turnId !== this.fullReplayTurnId);
    const preservedElapsed = !isNewReplay && this.fullReplayStarted
      ? this.currentReplayElapsed()
      : 0;

    const result = beginRecordedReplay.call(this, snapshot);
    if (!result || !turnId) return result;

    if (isNewReplay) {
      this.fullReplayTurnId = turnId;
      this.fullReplayStarted = false;
      this.pendingBoundarySnapshot = null;
      this.replayInitialElapsed = 0;
      this.replayAnchorElapsed = 0;
      this.replayElapsed = 0;
      this.replayAnchorLocalMs = nowMs();
      this.emittedReplayEvents?.clear?.();
      return result;
    }

    if (this.fullReplayTurnId === turnId) {
      const elapsed = this.fullReplayStarted ? preservedElapsed : 0;
      this.replayInitialElapsed = 0;
      this.replayAnchorElapsed = elapsed;
      this.replayElapsed = elapsed;
      this.replayAnchorLocalMs = nowMs();
    }
    return result;
  };

  prototype.loadRecordedReplay = async function loadFullRecordedReplay(descriptor) {
    const replayPackage = await loadRecordedReplay.call(this, descriptor);
    const turnId = descriptor?.turnId ?? replayPackage?.id ?? null;
    if (
      replayPackage
      && turnId
      && turnId === this.fullReplayTurnId
      && !this.fullReplayStarted
      && this.activeReplayId === turnId
    ) {
      this.fullReplayStarted = true;
      this.replayInitialElapsed = 0;
      this.replayAnchorElapsed = 0;
      this.replayElapsed = 0;
      this.replayAnchorLocalMs = nowMs();
      this.emittedReplayEvents?.clear?.();
      this.seekReplay(0, { emitEvents: false });
    }
    return replayPackage;
  };

  prototype.applySnapshot = function applyFullReplaySnapshot(snapshot) {
    const incomingRecordedReplay = snapshot?.syncMode === 'recorded-replay' && snapshot?.replay?.turnId;
    if (
      !incomingRecordedReplay
      && this.activeReplayId
      && this.replayPackage
      && this.fullReplayStarted
    ) {
      const duration = Number(this.replayDurationSeconds || this.replayPackage.durationSeconds) || 0;
      const elapsed = this.currentReplayElapsed();
      if (duration > 0 && elapsed < duration - 0.02) {
        this.pendingBoundarySnapshot = snapshot;
        return;
      }
    }
    return applySnapshot.call(this, snapshot);
  };

  prototype.update = function updateFullReplayView(...args) {
    const result = update.apply(this, args);
    if (
      this.pendingBoundarySnapshot
      && this.activeReplayId
      && this.replayPackage
      && this.fullReplayStarted
    ) {
      const duration = Number(this.replayDurationSeconds || this.replayPackage.durationSeconds) || 0;
      if (duration > 0 && this.currentReplayElapsed() >= duration - 0.02) {
        const pending = this.pendingBoundarySnapshot;
        this.pendingBoundarySnapshot = null;
        applySnapshot.call(this, pending);
        this.fullReplayTurnId = null;
        this.fullReplayStarted = false;
      }
    }
    return result;
  };

  prototype.clear = function clearFullReplayView(...args) {
    const result = clear.apply(this, args);
    this.fullReplayTurnId = null;
    this.fullReplayStarted = false;
    this.pendingBoundarySnapshot = null;
    return result;
  };

  Object.defineProperty(prototype, 'fullReplayViewPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installFullReplayViewPatch();

export { installFullReplayViewPatch };
