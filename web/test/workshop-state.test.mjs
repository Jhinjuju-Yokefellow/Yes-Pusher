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
