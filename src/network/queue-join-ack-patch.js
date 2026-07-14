import { SharedWorldClient } from './shared-world-client.js';

const PATCH_KEY = Symbol.for('yes-pusher:queue-join-ack-patch');

function applyQueueJoinAck(client, payload, requestedCoins) {
  if (!payload?.ok || !payload?.queued || !client?.snapshot?.self) return false;

  const normalizedCoins = Math.max(1, Math.min(10, Math.floor(Number(payload.requestedCoins ?? requestedCoins) || 5)));
  const position = Number.isInteger(Number(payload.position)) ? Number(payload.position) : 1;
  const existingQueue = Array.isArray(client.snapshot.queue) ? client.snapshot.queue : [];
  const selfId = client.snapshot.self.id;
  const selfLabel = client.snapshot.self.label ?? client.playerLabel;
  const nextQueue = existingQueue.some((entry) => entry?.id === selfId)
    ? existingQueue.map((entry) => entry?.id === selfId
      ? { ...entry, position, requestedCoins: normalizedCoins, connected: true }
      : entry)
    : [...existingQueue, {
      id: selfId,
      label: selfLabel,
      connected: true,
      position,
      requestedCoins: normalizedCoins,
    }].sort((a, b) => Number(a.position) - Number(b.position));

  const snapshot = {
    ...client.snapshot,
    queue: nextQueue,
    activePlayerId: position === 1 ? selfId : client.snapshot.activePlayerId,
    self: {
      ...client.snapshot.self,
      queued: true,
      queuePosition: position,
      isActive: position === 1,
      queuedCoins: normalizedCoins,
    },
  };
  client.snapshot = snapshot;
  client.onSnapshot(snapshot);
  return true;
}

function installQueueJoinAckPatch() {
  const prototype = SharedWorldClient.prototype;
  if (prototype[PATCH_KEY]) return;
  const originalJoinQueue = prototype.joinQueue;

  prototype.joinQueue = async function joinQueueWithImmediateCount(coins = 5) {
    const payload = await originalJoinQueue.call(this, coins);
    applyQueueJoinAck(this, payload, coins);
    return payload;
  };

  Object.defineProperty(prototype, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installQueueJoinAckPatch();

export { applyQueueJoinAck, installQueueJoinAckPatch };
