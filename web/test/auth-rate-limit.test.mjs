import assert from "node:assert/strict";
import test from "node:test";
import { createAuthRateLimiter } from "../auth-rate-limit.mjs";

test("caps requests for the same key and provides a retry interval", () => {
  let time = 1_000;
  const limiter = createAuthRateLimiter({ now: () => time, windowMs: 60_000 });
  assert.equal(limiter.consume("challenge:global", 2).allowed, true);
  assert.equal(limiter.consume("challenge:global", 2).allowed, true);
  assert.deepEqual(limiter.consume("challenge:global", 2), {
    allowed: false, retryAfterSeconds: 60,
  });
  time += 30_000;
  assert.equal(limiter.consume("challenge:global", 2).retryAfterSeconds, 30);
  time += 30_000;
  assert.equal(limiter.consume("challenge:global", 2).allowed, true);
});

test("per-wallet quotas are independent, while a global cap still applies", () => {
  const limiter = createAuthRateLimiter();
  assert.equal(limiter.consume("challenge:wallet:0xa", 1).allowed, true);
  assert.equal(limiter.consume("challenge:wallet:0xa", 1).allowed, false);
  assert.equal(limiter.consume("challenge:wallet:0xb", 1).allowed, true);
  assert.equal(limiter.consume("challenge:global", 1).allowed, true);
  assert.equal(limiter.consume("challenge:global", 1).allowed, false);
});

test("does not allocate unbounded keys under changing wallet addresses", () => {
  let time = 0;
  const limiter = createAuthRateLimiter({ maxKeys: 2, now: () => time });
  assert.equal(limiter.consume("wallet:a", 1).allowed, true);
  assert.equal(limiter.consume("wallet:b", 1).allowed, true);
  assert.equal(limiter.consume("wallet:c", 1).allowed, false);
  assert.equal(limiter.size, 2);
  time += 60_001;
  assert.equal(limiter.consume("wallet:c", 1).allowed, true);
  assert.equal(limiter.size, 1);
  limiter.sweep();
  assert.equal(limiter.size, 1);
});
