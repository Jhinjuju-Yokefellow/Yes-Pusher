import { PlayerQueue } from './player-queue.js';
import { WalletAuthStore } from './wallet-auth.js';

export const QUEUE_JOIN_RESPONSE_GRACE_MS = 1_500;
export const TURN_RESULT_HOLD_MS = 6_000;

function enabled(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function installQueueFlowPatch() {
  const prototype = PlayerQueue.prototype;
  if (prototype.turnFlowStabilityPatchInstalled) return;

  const join = prototype.join;
  prototype.join = function joinWithResponseGrace(...args) {
    const position = join.apply(this, args);
    this.__queueJoinReadyAt = Math.max(
      Number(this.__queueJoinReadyAt) || 0,
      this.now() + QUEUE_JOIN_RESPONSE_GRACE_MS,
    );
    return position;
  };

  const completeTurn = prototype.completeTurn;
  prototype.completeTurn = function completeTurnWithResultHold(...args) {
    const completedId = completeTurn.apply(this, args);
    if (completedId) {
      this.__nextTurnReadyAt = this.now() + TURN_RESULT_HOLD_MS;
    }
    return completedId;
  };

  const activeRequest = prototype.activeRequest;
  prototype.activeRequest = function activeRequestAfterGrace(...args) {
    const now = this.now();
    if (now < (Number(this.__queueJoinReadyAt) || 0)) return null;
    if (now < (Number(this.__nextTurnReadyAt) || 0)) return null;
    return activeRequest.apply(this, args);
  };

  Object.defineProperty(prototype, 'turnFlowStabilityPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

function installOperatorResetGuard() {
  const prototype = WalletAuthStore.prototype;
  if (prototype.operatorResetGuardPatchInstalled) return;

  const readRequest = prototype.readRequest;
  prototype.readRequest = function readRequestWithoutAutomaticReset(request, ...args) {
    let pathname = '';
    try {
      pathname = new URL(request?.url || '/', 'http://yes-pusher.local').pathname;
    } catch {
      pathname = '';
    }
    if (
      pathname === '/api/operator/test-setup'
      && !enabled(process.env.YES_PUSHER_ENABLE_OPERATOR_TEST_RESET)
    ) {
      return null;
    }
    return readRequest.call(this, request, ...args);
  };

  Object.defineProperty(prototype, 'operatorResetGuardPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installQueueFlowPatch();
installOperatorResetGuard();

export { installOperatorResetGuard, installQueueFlowPatch };
