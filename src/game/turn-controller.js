export const TURN_STATES = Object.freeze({
  READY: 'ready',
  DROPPING: 'dropping',
  WAITING: 'waiting',
  ACTIVE: 'active',
  FINISHING: 'finishing',
  SETTLING: 'settling',
});

const OWNED_STATES = new Set([
  TURN_STATES.DROPPING,
  TURN_STATES.WAITING,
  TURN_STATES.ACTIVE,
  TURN_STATES.FINISHING,
  TURN_STATES.SETTLING,
]);

function clampWholeNumber(value, min = 0) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.floor(value));
}

export function createTurnController({
  activeDurationSeconds = 30,
  settleQuietSeconds = 1.25,
  settleMaximumSeconds = 3.5,
  milestoneEvery = 50,
  onChange = () => {},
} = {}) {
  let state = TURN_STATES.READY;
  let nextTurnNumber = 1;
  let currentTurn = null;
  let lastResult = null;
  let activeSecondsRemaining = 0;
  let finishAtPusherTime = null;
  let settleQuietRemaining = 0;
  let settleMaximumRemaining = 0;
  let lifetimeCoinsWon = 0;
  let pendingSkinMilestones = 0;
  let resolvedSkinMilestones = 0;

  function displayedLifetime() {
    return lifetimeCoinsWon + (currentTurn?.coinsWon ?? 0);
  }

  function buildSnapshot() {
    const displayed = displayedLifetime();
    return {
      state,
      nextTurnNumber,
      currentTurn: currentTurn ? { ...currentTurn, slotPlan: [...currentTurn.slotPlan] } : null,
      lastResult: lastResult ? { ...lastResult, slotPlan: [...lastResult.slotPlan] } : null,
      activeSecondsRemaining,
      finishAtPusherTime,
      settleQuietRemaining,
      settleMaximumRemaining,
      lifetimeCoinsWon,
      displayedLifetimeCoinsWon: displayed,
      pendingSkinMilestones,
      resolvedSkinMilestones,
      milestoneEvery,
      milestoneProgress: displayed % milestoneEvery,
      nextMilestoneAt: (Math.floor(displayed / milestoneEvery) + 1) * milestoneEvery,
      ownsScoringWindow: Boolean(currentTurn && OWNED_STATES.has(state)),
    };
  }

  function emit(reason) {
    onChange(buildSnapshot(), reason);
  }

  function assertState(expected, action) {
    if (!expected.includes(state)) {
      throw new Error(`${action} is not valid while turn state is ${state}`);
    }
  }

  function startTurn({
    coinsDropped,
    slotPlan = [],
    id = null,
    playerId = null,
    seed = null,
    startedAt = null,
  }) {
    assertState([TURN_STATES.READY], 'startTurn');
    const normalizedCount = Math.max(1, Math.min(10, clampWholeNumber(coinsDropped, 1)));
    const normalizedStartedAt = startedAt !== null
      && startedAt !== undefined
      && Number.isFinite(Number(startedAt))
      ? Number(startedAt)
      : Date.now();
    currentTurn = {
      id: typeof id === 'string' && id ? id : `local-turn-${nextTurnNumber}`,
      playerId: typeof playerId === 'string' && playerId ? playerId : null,
      number: nextTurnNumber,
      coinsDropped: normalizedCount,
      coinsWon: 0,
      coinsLost: 0,
      slotPlan: [...slotPlan],
      seed: Number.isInteger(seed) ? seed >>> 0 : null,
      startedAt: normalizedStartedAt,
      activeStartedAt: normalizedStartedAt,
      completedAt: null,
    };
    lastResult = null;
    activeSecondsRemaining = activeDurationSeconds;
    finishAtPusherTime = null;
    settleQuietRemaining = 0;
    settleMaximumRemaining = 0;
    state = TURN_STATES.DROPPING;
    emit('turn-started');
    return currentTurn.id;
  }

  function markBatchFinished() {
    assertState([TURN_STATES.DROPPING], 'markBatchFinished');
    state = TURN_STATES.ACTIVE;
    emit('batch-finished');
  }

  // Kept as a compatibility hook for the machine code. The turn clock now
  // starts when the player confirms the turn, so reaching the pusher no longer
  // controls the timer.
  function markFinalCoinReached() {
    return false;
  }

  function recordPayout(count = 1) {
    const amount = clampWholeNumber(count);
    if (!amount || !currentTurn || !OWNED_STATES.has(state)) return false;
    currentTurn.coinsWon += amount;
    if (state === TURN_STATES.SETTLING) {
      settleQuietRemaining = settleQuietSeconds;
    }
    emit('payout-recorded');
    return true;
  }

  function recordLoss(count = 1) {
    const amount = clampWholeNumber(count);
    if (!amount || !currentTurn || !OWNED_STATES.has(state)) return false;
    currentTurn.coinsLost += amount;
    if (state === TURN_STATES.SETTLING) {
      settleQuietRemaining = settleQuietSeconds;
    }
    emit('loss-recorded');
    return true;
  }

  function beginFinishing(pusherTime, pusherPeriod) {
    state = TURN_STATES.FINISHING;
    finishAtPusherTime = (Math.floor(pusherTime / pusherPeriod) + 1) * pusherPeriod;
    emit('active-window-ended');
  }

  function beginSettling() {
    if (state !== TURN_STATES.FINISHING) return false;
    state = TURN_STATES.SETTLING;
    finishAtPusherTime = null;
    settleQuietRemaining = settleQuietSeconds;
    settleMaximumRemaining = settleMaximumSeconds;
    emit('settling-started');
    return true;
  }

  function finalizeTurn() {
    if (!currentTurn) return null;

    const oldLifetime = lifetimeCoinsWon;
    lifetimeCoinsWon += currentTurn.coinsWon;
    const oldMilestoneCount = Math.floor(oldLifetime / milestoneEvery);
    const newMilestoneCount = Math.floor(lifetimeCoinsWon / milestoneEvery);
    const crossedMilestones = Math.max(0, newMilestoneCount - oldMilestoneCount);
    const availableMilestones = pendingSkinMilestones + crossedMilestones;
    const skinDropEarned = availableMilestones > 0 ? 1 : 0;

    pendingSkinMilestones = Math.max(0, availableMilestones - skinDropEarned);
    resolvedSkinMilestones += skinDropEarned;

    currentTurn.completedAt = Date.now();
    lastResult = {
      ...currentTurn,
      slotPlan: [...currentTurn.slotPlan],
      lifetimeCoinsWon,
      crossedMilestones,
      skinDropEarned,
      pendingSkinMilestones,
      resolvedSkinMilestones,
    };

    nextTurnNumber += 1;
    currentTurn = null;
    state = TURN_STATES.READY;
    activeSecondsRemaining = 0;
    finishAtPusherTime = null;
    settleQuietRemaining = 0;
    settleMaximumRemaining = 0;
    emit('turn-finalized');
    return { ...lastResult, slotPlan: [...lastResult.slotPlan] };
  }

  function update(dt, { pusherTime, pusherPeriod }) {
    const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);

    if (
      state === TURN_STATES.DROPPING ||
      state === TURN_STATES.WAITING ||
      state === TURN_STATES.ACTIVE
    ) {
      activeSecondsRemaining = Math.max(0, activeSecondsRemaining - safeDt);
      if (activeSecondsRemaining <= 0 && state !== TURN_STATES.DROPPING) {
        beginFinishing(pusherTime, pusherPeriod);
      } else {
        emit('timer-updated');
      }
    } else if (state === TURN_STATES.SETTLING) {
      settleQuietRemaining = Math.max(0, settleQuietRemaining - safeDt);
      settleMaximumRemaining = Math.max(0, settleMaximumRemaining - safeDt);
      if (settleQuietRemaining <= 0 || settleMaximumRemaining <= 0) {
        return finalizeTurn();
      }
    }

    return null;
  }

  function limitPusherTime(nextTime) {
    if (state === TURN_STATES.FINISHING && finishAtPusherTime !== null) {
      return Math.min(nextTime, finishAtPusherTime);
    }
    return nextTime;
  }

  function notifyPusherTime(pusherTime) {
    if (
      state === TURN_STATES.FINISHING &&
      finishAtPusherTime !== null &&
      pusherTime >= finishAtPusherTime - 0.0001
    ) {
      return beginSettling();
    }
    return false;
  }

  function reset({ keepProgress = false } = {}) {
    state = TURN_STATES.READY;
    nextTurnNumber = 1;
    currentTurn = null;
    lastResult = null;
    activeSecondsRemaining = 0;
    finishAtPusherTime = null;
    settleQuietRemaining = 0;
    settleMaximumRemaining = 0;
    if (!keepProgress) {
      lifetimeCoinsWon = 0;
      pendingSkinMilestones = 0;
      resolvedSkinMilestones = 0;
    }
    emit('reset');
  }

  function restoreProgress({
    lifetime = 0,
    pendingMilestones = 0,
    resolvedMilestones = 0,
    turnNumber = 1,
  } = {}) {
    if (currentTurn) throw new Error('Cannot restore progress during an active turn');
    lifetimeCoinsWon = clampWholeNumber(lifetime);
    pendingSkinMilestones = clampWholeNumber(pendingMilestones);
    resolvedSkinMilestones = clampWholeNumber(resolvedMilestones);
    nextTurnNumber = Math.max(1, clampWholeNumber(turnNumber, 1));
    emit('progress-restored');
  }

  return {
    startTurn,
    markBatchFinished,
    markFinalCoinReached,
    recordPayout,
    recordLoss,
    update,
    limitPusherTime,
    notifyPusherTime,
    reset,
    restoreProgress,
    getSnapshot: buildSnapshot,
  };
}
