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

console.log("Coin Drop per-app login ownership cache: single-flight, scoped, bounded, failure-safe.");
