import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function awaitReady(origin, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error("YES DROP server exited before readiness.");
    try {
      const response = await fetch(origin + "/health", { signal: AbortSignal.timeout(200) });
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await delay(100);
  }
  throw new Error("YES DROP server did not become ready.");
}

test("Godot assets revalidate to 304 without redownloading; login HTML remains fresh", { timeout: 15000 }, async (t) => {
  const gameDir = path.join(webDir, "public", "game");
  const filename = "cache-fixture-" + crypto.randomUUID() + ".bin";
  const asset = path.join(gameDir, filename);
  await fs.mkdir(gameDir, { recursive: true });
  await fs.writeFile(asset, "first game bundle", "utf8");
  t.after(async () => {
    await fs.rm(asset, { force: true });
    await fs.rmdir(gameDir).catch(() => {}); // Only remove the directory if it is empty.
  });

  const port = await freePort();
  const origin = "http://127.0.0.1:" + port;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: webDir,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_ORIGIN: origin,
      SESSION_SECRET: "test-only-static-cache-session-secret-at-least-32",
      YF_API_BASE_URL: "",
      YF_BUCKET_ID: "",
    },
    stdio: "ignore",
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  await awaitReady(origin, child);

  const url = origin + "/game/" + filename;
  const initial = await fetch(url);
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(await initial.text(), "first game bundle");
  const etag = initial.headers.get("etag");
  assert.ok(etag, "game bundles need a stable validator");

  const repeat = await fetch(url, { headers: { "If-None-Match": etag } });
  assert.equal(repeat.status, 304);
  assert.equal(await repeat.text(), "");

  await fs.writeFile(asset, "second updated game bundle", "utf8");
  const updated = await fetch(url, { headers: { "If-None-Match": etag } });
  assert.equal(updated.status, 200, "a changed deployment asset must not return 304");
  assert.notEqual(updated.headers.get("etag"), etag);
  assert.equal(await updated.text(), "second updated game bundle");

  const html = await fetch(origin + "/", { method: "HEAD" });
  const browserJs = await fetch(origin + "/app.js", { method: "HEAD" });
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.equal(browserJs.headers.get("cache-control"), "no-store");
});
