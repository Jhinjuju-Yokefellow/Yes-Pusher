import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkshopService } from "../yd4-workshop.mjs";

const walletA = "0x0000000000000000000000000000000000000001";
const walletB = "0x0000000000000000000000000000000000000002";

function workshop(statePath) {
  return createWorkshopService({
    yokefellowOrigin: "https://example.test",
    bucketId: "test-bucket",
    networkAppApiKey: "yfk_test",
    statePath,
  });
}

test("simultaneous player updates preserve both preferences", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "yd4-workshop-test-"));
  const statePath = path.join(temp, "state.json");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ complete: true, holdings: [], classes: [], bucketSlug: "" }),
  });
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await fs.rm(temp, { recursive: true, force: true });
  });

  const service = workshop(statePath);
  await Promise.all([service.equipSkin(walletA, ""), service.equipSkin(walletB, "")]);
  const saved = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.ok(saved.preferences[walletA.toLowerCase()]);
  assert.ok(saved.preferences[walletB.toLowerCase()]);
});

test("corrupt existing state is not silently treated as empty", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "yd4-workshop-test-"));
  const statePath = path.join(temp, "state.json");
  await fs.writeFile(statePath, "{invalid-json", "utf8");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ complete: true, holdings: [], classes: [], bucketSlug: "" }),
  });
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await fs.rm(temp, { recursive: true, force: true });
  });
  await assert.rejects(workshop(statePath).equipSkin(walletA, ""), SyntaxError);
  assert.equal(await fs.readFile(statePath, "utf8"), "{invalid-json");
});
