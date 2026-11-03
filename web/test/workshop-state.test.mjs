import assert from "node:assert/strict";
import test from "node:test";
import { createWorkshopService } from "../yd4-workshop.mjs";

const walletA = "0x0000000000000000000000000000000000000001";
const walletB = "0x0000000000000000000000000000000000000002";
const key = "yfk_test";
function service() {
  return createWorkshopService({
    yokefellowOrigin: "https://v3.example.test",
    networkOrigin: "https://network.example.test",
    bucketId: "test-bucket",
    networkAppApiKey: key,
  });
}
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("two wallets use authenticated Network storage, not local JSON state", async (t) => {
  const previousFetch = globalThis.fetch;
  const preferences = new Map();
  let networkReads = 0, networkWrites = 0;
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(url);
    if (requestUrl.host === "v3.example.test") {
      return response({ complete: true, holdings: [], classes: [], bucketSlug: "" });
    }
    assert.equal(requestUrl.host, "network.example.test");
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    if (requestUrl.pathname === "/v1/workshop/state") {
      networkReads++;
      const owner = requestUrl.searchParams.get("wallet");
      return response({
        ok: true,
        preference: { equippedSkin: preferences.get(owner) || "" },
        community: { totalPoints: 0, contributionCount: 0 },
      });
    }
    if (requestUrl.pathname === "/v1/workshop/preference") {
      networkWrites++;
      const body = JSON.parse(options.body);
      preferences.set(body.wallet, body.equippedSkin);
      return response({ ok: true, preference: body });
    }
    throw new Error("Unexpected request: " + requestUrl.pathname);
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const workshop = service();
  await Promise.all([workshop.equipSkin(walletA, ""), workshop.equipSkin(walletB, "")]);
  assert.equal(networkReads, 2);
  assert.equal(networkWrites, 2);
  assert.equal(preferences.size, 2);
});

test("public community requests coalesce to one protected Network read", async (t) => {
  const previousFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(new URL(url).pathname, "/v1/workshop/community");
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    reads++;
    return response({ ok: true, community: { totalPoints: 7, contributionCount: 2 } });
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const workshop = service();
  const [one, two, three] = await Promise.all([
    workshop.getCommunity(), workshop.getCommunity(), workshop.getCommunity(),
  ]);
  assert.equal(reads, 1);
  assert.deepEqual(one, two);
  assert.deepEqual(two, three);
  assert.equal(one.totalPoints, 7);
  await workshop.getCommunity();
  assert.equal(reads, 1);
});

test("missing Network configuration fails closed", () => {
  assert.throws(() => createWorkshopService({
    yokefellowOrigin: "https://v3.example.test",
    bucketId: "test-bucket",
    networkAppApiKey: key,
  }), /YF_NETWORK_API_URL/);
});

test("a verified session fetches ownership, workshop and credit once, then reuses its snapshot", async (t) => {
  const previousFetch = globalThis.fetch;
  const counts = { holdings: 0, state: 0, credit: 0 };
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/holdings/")) {
      counts.holdings++;
      return response({ complete: true, holdings: [], classes: [], bucketSlug: "rainbows-end" });
    }
    if (parsed.pathname === "/v1/workshop/state") {
      assert.equal(options.headers.Authorization, `Bearer ${key}`);
      counts.state++;
      return response({ ok: true, preference: { equippedSkin: "" },
        community: { totalPoints: 0, contributionCount: 0 } });
    }
    if (parsed.pathname.endsWith("/credits")) {
      counts.credit++;
      return response({ credit: { amountYesRaw: "20" }, source: "network_base" });
    }
    throw new Error("unexpected " + parsed.pathname);
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const workshop = service();
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const one = { sessionId: "session-one", expiresAt: expiry };
  await Promise.all(Array.from({ length: 40 }, () => workshop.getState(walletA, one)));
  assert.deepEqual(counts, { holdings: 1, state: 1, credit: 1 });
  await workshop.getState(walletA, one);
  assert.deepEqual(counts, { holdings: 1, state: 1, credit: 1 });
  await workshop.getState(walletA, { sessionId: "session-two", expiresAt: expiry });
  assert.deepEqual(counts, { holdings: 2, state: 2, credit: 2 });
});

test("100 independent authenticated sessions make 100 cold reads, not 200 repeated reads", async (t) => {
  const previousFetch = globalThis.fetch;
  const counts = { holdings: 0, state: 0, credit: 0 };
  globalThis.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.includes("/holdings/")) {
      counts.holdings++;
      return response({ complete: true, holdings: [], classes: [], bucketSlug: "rainbows-end" });
    }
    if (pathname === "/v1/workshop/state") {
      counts.state++;
      return response({ ok: true, preference: { equippedSkin: "" },
        community: { totalPoints: 0, contributionCount: 0 } });
    }
    if (pathname.endsWith("/credits")) {
      counts.credit++;
      return response({ credit: { amountYesRaw: "10" } });
    }
    throw new Error("unexpected " + pathname);
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const workshop = service();
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const sessions = Array.from({ length: 100 }, (_, i) => ({
    wallet: "0x" + (i + 1).toString(16).padStart(40, "0"),
    session: { sessionId: "simulated-" + i, expiresAt: expiry },
  }));
  await Promise.all(sessions.map(({ wallet, session }) => workshop.getState(wallet, session)));
  await Promise.all(sessions.map(({ wallet, session }) => workshop.getState(wallet, session)));
  assert.deepEqual(counts, { holdings: 100, state: 100, credit: 100 });
});


test("confirmed contribution retries succeed after the Large Toy has been consumed", async (t) => {
  const previousFetch = globalThis.fetch;
  const referenceId = "coin-drop:confirmed:001";
  const transactionHash = "0x" + "a".repeat(64);
  let contributionReads = 0;
  let communityReads = 0;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    assert.equal(parsed.host, "network.example.test", "no V3 ownership or action replay on confirmed retry");
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    if (parsed.pathname === "/v1/workshop/contributions") {
      contributionReads++;
      assert.equal(parsed.searchParams.get("referenceId"), referenceId);
      return response({ ok: true, contribution: {
        referenceId, wallet: walletA, family: "four_leaf_clover",
        transactionHash, points: 1,
      } });
    }
    if (parsed.pathname === "/v1/workshop/community") {
      communityReads++;
      return response({ ok: true, community: { totalPoints: 1, contributionCount: 1 } });
    }
    throw new Error("unexpected request: " + parsed.pathname);
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const result = await service().contribute(walletA, { family: "four_leaf_clover", referenceId });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.contribution.transactionHash, transactionHash);
  assert.equal(result.community.totalPoints, 1);
  assert.equal(contributionReads, 1);
  assert.equal(communityReads, 1);
});


test("confirmed community contribution passes V3 proof to Network and does not replay a consumed Toy", async (t) => {
  const previousFetch = globalThis.fetch;
  const referenceId = "coin-drop:proof:complete-01";
  const transactionHash = "0x" + "a".repeat(64);
  const workshopProof = "wpr1.verified.sig";
  const counters = { actions: 0, recoveries: 0, contributions: 0 };
  let stored = null;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/v1/workshop/contributions") {
      if (options.method === "POST") {
        counters.contributions++;
        const body = JSON.parse(options.body);
        assert.equal(body.referenceId, referenceId);
        assert.equal(body.executionId, "v3-exec-1");
        assert.equal(body.workshopProof, workshopProof);
        stored = { ...body, status: "confirmed", transactionHash };
        return response({ ok: true, duplicate: false, contribution: stored,
          community: { totalPoints: 1, contributionCount: 1 } });
      }
      return response({ ok: true, contribution: stored });
    }
    if (parsed.pathname === "/v1/workshop/state") return response({
      ok: true, preference: { equippedSkin: "" },
      community: { totalPoints: 0, contributionCount: 0 },
    });
    if (parsed.pathname.endsWith("/holdings/" + walletA)) return response({
      complete: true, bucketSlug: "rainbows-end", classes: [],
      holdings: [{ standard: "ERC1155", quantity: 1,
        presentation: { slug: "four_leaf_clover_toy_large", name: "Large Toy" } }],
    });
    if (parsed.pathname.endsWith("/credits")) return response({ credit: null });
    if (parsed.pathname.endsWith("/execute")) {
      counters.actions++;
      return response({ ok: true, reused: false, execution: { id: "v3-exec-1" } });
    }
    if (parsed.pathname.includes("/executions/")) {
      counters.recoveries++;
      return response({ ok: true, found: true, workshopProof,
        path: { key: "yes_drop.community_machine" },
        execution: { id: "v3-exec-1", participantWallet: walletA } });
    }
    throw new Error("unexpected " + parsed.pathname);
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const workshop = service();
  const first = await workshop.contribute(walletA, { family: "four_leaf_clover", referenceId });
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  const replay = await workshop.contribute(walletA, { family: "four_leaf_clover", referenceId });
  assert.equal(replay.duplicate, true);
  assert.deepEqual(counters, { actions: 1, recoveries: 1, contributions: 1 });
});

test("a confirmed V3 receipt recovers contribution when Large Toy is already consumed", async (t) => {
  const previousFetch = globalThis.fetch;
  const referenceId = "coin-drop:proof:recovery-01";
  let actions = 0, writes = 0;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/v1/workshop/contributions" && options.method !== "POST") {
      return response({ ok: true, contribution: null });
    }
    if (parsed.pathname === "/v1/workshop/state") return response({
      ok: true, preference: { equippedSkin: "" },
      community: { totalPoints: 0, contributionCount: 0 },
    });
    if (parsed.pathname.includes("/holdings/")) return response({
      complete: true, bucketSlug: "rainbows-end", holdings: [], classes: [],
    });
    if (parsed.pathname.endsWith("/credits")) return response({ credit: null });
    if (parsed.pathname.endsWith("/execute")) {
      actions++;
      throw new Error("already consumed; must never execute again");
    }
    if (parsed.pathname.includes("/executions/")) return response({
      ok: true, found: true, workshopProof: "wpr1.recovered.sig",
      path: { key: "yes_drop.community_machine" },
      execution: { id: "v3-exec-previous", participantWallet: walletA },
    });
    if (parsed.pathname === "/v1/workshop/contributions" && options.method === "POST") {
      writes++;
      const body = JSON.parse(options.body);
      assert.equal(body.executionId, "v3-exec-previous");
      assert.equal(body.workshopProof, "wpr1.recovered.sig");
      return response({ ok: true, duplicate: false,
        contribution: { ...body, transactionHash: "0x" + "b".repeat(64) },
        community: { totalPoints: 1, contributionCount: 1 } });
    }
    throw new Error("unexpected " + parsed.pathname);
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const result = await service().contribute(walletA, { family: "four_leaf_clover", referenceId });
  assert.equal(result.ok, true);
  assert.equal(actions, 0);
  assert.equal(writes, 1);
});
