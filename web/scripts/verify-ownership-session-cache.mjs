import assert from "node:assert/strict";
import { createOwnershipSessionCache } from "../ownership-session-cache.mjs";

const walletA = "0x" + "a".repeat(40);
const walletB = "0x" + "b".repeat(40);
const sessionA = "11111111-1111-4111-8111-111111111111";
const sessionB = "22222222-2222-4222-8222-222222222222";
const sessionC = "33333333-3333-4333-8333-333333333333";
let time = 1_000_000;
let reads = 0;
const cache = createOwnershipSessionCache({
  now: () => time,
  load: async (wallet, id) => {
    reads++;
    return { wallet, id, holdings: [{tokenId:"2"}] };
  },
});
const first = {wallet:walletA,sessionId:sessionA,expiresAtMs:time+600_000};
const [a,b,c] = await Promise.all([
  cache.begin(first),
  cache.read(first),
  cache.read(first),
]);
assert.equal(reads,1,"parallel app views must single-flight into one ownership read");
assert.deepEqual(a,b);
assert.deepEqual(a,c);
assert.equal((await cache.read(first)).id,sessionA);
assert.equal(reads,1,"the whole session must reuse its login snapshot");

await assert.rejects(cache.read({...first,wallet:walletB}),/ownership_session_mismatch/);
assert.equal(reads,1,"a different wallet cannot reuse this app session snapshot");
const second = {wallet:walletA,sessionId:sessionB,expiresAtMs:time+600_000};
assert.equal((await cache.read(second)).id,sessionB);
assert.equal(reads,2,"a separate login has a separate snapshot");
time+=601_000;
assert.throws(()=>cache.read(first),/ownership_session_expired/);

let failures=0;
const broken=createOwnershipSessionCache({
  now:()=>time,
  load:async()=>{failures++;throw Error("upstream_offline");},
});
const failed={wallet:walletB,sessionId:sessionC,expiresAtMs:time+60_000};
await assert.rejects(broken.begin(failed),/upstream_offline/);
await assert.rejects(broken.read(failed),/upstream_offline/);
assert.equal(failures,1,"upstream errors cannot cause repeat database requests");

// Integration: the actual Workshop path must not refetch holdings on views.
const { createWorkshopService } = await import("../yd4-workshop.mjs");
const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "coin-drop-stage3-"));
let ownershipCalls = 0;
let creditCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const pathname = new URL(url).pathname;
  if (pathname.includes("/holdings/")) {
    ownershipCalls++;
    assert.equal(options.headers.Authorization,"Bearer yfk_test-only");
    assert.equal(options.headers["X-YF-App-Session-ID"],sessionA);
    return { ok:true, status:200, json:async()=>({
      ok:true,bucketSlug:"rainbows-end",classes:[],holdings:[],source:{ownership:"v3_database"}
    }) };
  }
  if (pathname.endsWith("/credits")) {
    creditCalls++;
    return {ok:true,status:200,json:async()=>({ok:true,credit:null})};
  }
  throw Error("Unexpected external request " + pathname);
};
try {
  const workshop = createWorkshopService({
    yokefellowOrigin:"https://v3.example.test",
    bucketId:"rainbows-end",
    appApiKey:"yfk_test-only",
    statePath:path.join(folder,"workshop.json"),
  });
  const login = {
    wallet:walletA,sessionId:sessionA,expiresAt:Math.floor(Date.now()/1000)+3600,
  };
  await workshop.primeOwnershipSession(login);
  await Promise.all([
    workshop.getState(walletA,login),
    workshop.getState(walletA,login),
    workshop.getState(walletA,login),
  ]);
  assert.equal(ownershipCalls,1,"Workshop views must reuse the login ownership snapshot");
  assert.equal(creditCalls,3,"funding remains a separate live read path");
} finally {
  globalThis.fetch = originalFetch;
  fs.rmSync(folder,{recursive:true,force:true});
}

console.log("Coin Drop per-app login ownership cache: single-flight, scoped, bounded, failure-safe.");
