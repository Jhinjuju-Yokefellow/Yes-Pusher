// Bounded, process-local admission control for public YES DROP wallet login.
// Shared limits belong at the edge once multiple web instances are deployed.
export function createAuthRateLimiter({ windowMs = 60_000, maxKeys = 4096, now = Date.now } = {}) {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new RangeError("windowMs must be positive");
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new RangeError("maxKeys must be positive");
  const counts = new Map();

  function sweep() {
    const timestamp = now();
    for (const [key, record] of counts) {
      if (record.expiresAt <= timestamp) counts.delete(key);
    }
  }

  function consume(key, limit) {
    if (typeof key !== "string" || !key) throw new TypeError("rate-limit key must be a string");
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("rate-limit must be positive");
    const timestamp = now();
    const current = counts.get(key);
    if (current && current.expiresAt > timestamp) {
      if (current.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt - timestamp) / 1000)),
        };
      }
      current.count += 1;
      return { allowed: true };
    }

    if (current) counts.delete(key);
    if (counts.size >= maxKeys) sweep();
    // Never allocate unlimited per-wallet counters under untrusted traffic.
    if (counts.size >= maxKeys) {
      return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    }
    counts.set(key, { count: 1, expiresAt: timestamp + windowMs });
    return { allowed: true };
  }

  return { consume, sweep, get size() { return counts.size; } };
}
