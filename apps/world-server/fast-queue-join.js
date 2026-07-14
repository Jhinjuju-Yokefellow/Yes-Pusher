export function fastQueueJoin({ queue, identity, requireWallet = true, requestedCoins = 5 } = {}) {
  if (!identity?.playerId) {
    return { status: 400, payload: { ok: false, error: 'playerId is required' } };
  }
  if (requireWallet && !identity.authenticated) {
    return {
      status: 401,
      payload: { ok: false, error: 'Connect and sign with a wallet before joining the queue' },
    };
  }
  if (!queue || typeof queue.join !== 'function') {
    return { status: 503, payload: { ok: false, error: 'The shared queue is unavailable' } };
  }

  const position = queue.join(identity.playerId, identity.label ?? '', requestedCoins);
  return {
    status: 200,
    payload: {
      ok: true,
      accepted: true,
      queued: true,
      position,
    },
  };
}
