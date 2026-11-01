/**
 * Rainbow's End ownership belongs to THIS app's wallet-signed session only.
 * A session reads Yokefellow ownership at most once. Repeated views, parallel
 * requests, and action polling all reuse the same settled or pending promise.
 * Failed reads are memoized too: a broken upstream cannot trigger a retry storm.
 *
 * This is intentionally process-local, never shared with other apps or wallets.
 * A restart may require one new read for an otherwise valid session.
 */
export function createOwnershipSessionCache({
  load,
  now = () => Date.now(),
  maxEntries = 2000,
} = {}) {
  if (typeof load !== "function") throw new Error("ownership_loader_required");
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("invalid_ownership_cache_limit");
  const entries = new Map();

  function prune() {
    const time = now();
    for (const [id, entry] of entries) {
      if (entry.expiresAtMs <= time) entries.delete(id);
    }
    while (entries.size >= maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  function begin({ sessionId, wallet, expiresAtMs }) {
    const id = String(sessionId || "");
    const owner = String(wallet || "").toLowerCase();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
      throw new Error("invalid_ownership_session_id");
    }
    if (!/^0x[a-f0-9]{40}$/.test(owner)) throw new Error("invalid_ownership_wallet");
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now()) {
      throw new Error("ownership_session_expired");
    }
    const existing = entries.get(id);
    if (existing && existing.expiresAtMs > now()) {
      if (existing.wallet !== owner || existing.expiresAtMs !== expiresAtMs) {
        throw new Error("ownership_session_mismatch");
      }
      return existing.promise;
    }
    prune();
    const promise = Promise.resolve().then(() => load(owner, id));
    entries.set(id, { wallet: owner, expiresAtMs, promise });
    // Prime can run after login response without an unhandled rejection.
    void promise.catch(() => {});
    return promise;
  }

  function read(session) {
    return begin(session);
  }

  function clear(sessionId) {
    entries.delete(String(sessionId));
  }

  return {
    begin, read, clear,
    size: () => entries.size,
  };
}
