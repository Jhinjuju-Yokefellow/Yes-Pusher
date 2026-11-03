import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// This test intentionally runs the real browser login handler against the real
// YES DROP web server, with no wallet extension, Neon, Network, RPC or game server.
// It replays the user's failure path: repeated attempts, but NO successful login.
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walletA = "0x" + "1".repeat(40);
const walletB = "0x" + "2".repeat(40);
const walletC = "0x" + "3".repeat(40);

async function reservePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function startUpstreamTrap() {
  const calls = [];
  const server = http.createServer((request, response) => {
    calls.push({ method: request.method, url: request.url });
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "Offline upstream trap: this must never be called." }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    calls,
    origin: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startLocalServer(upstreamOrigin) {
  const port = await reservePort();
  const origin = "http://127.0.0.1:" + port;
  // Build an environment from scratch so developer/CI secrets and production
  // service URLs cannot accidentally be inherited by the test child.
  const env = {
    NODE_ENV: "test",
    PORT: String(port),
    PUBLIC_ORIGIN: origin,
    CHAIN_ID: "84532",
    SESSION_SECRET: "offline-only-login-replay-secret-do-not-deploy",
    GAME_SERVER_URL: "ws://127.0.0.1:1",
    YF_API_BASE_URL: upstreamOrigin,
    YF_NETWORK_API_URL: upstreamOrigin,
    YF_NETWORK_APP_API_KEY: "yfk_offline_replay_not_a_real_key",
    YF_BUCKET_ID: "offline-login-replay",
    YES_DROP_CHALLENGES_PER_MINUTE: "180",
    YES_DROP_AUTH_PER_WALLET_PER_MINUTE: "6",
    YES_DROP_VERIFICATIONS_PER_MINUTE: "360",
  };
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: webDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => { output = (output + chunk.toString()).slice(-3000); });
  }

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(origin + "/health", { signal: AbortSignal.timeout(500) });
      if (response.ok) return { origin, child, output: () => output };
    } catch {
      // The child may still be starting.
    }
    await pause(75);
  }
  child.kill();
  throw new Error("Offline YES DROP server did not start. " + output);
}

function launchBrowser(appSource, origin, walletRequest, traffic, options = {}) {
  const elements = new Map();
  const walletCalls = [];
  function element(selector) {
    if (!elements.has(selector)) {
      const handlers = new Map();
      elements.set(selector, {
        disabled: false,
        hidden: selector !== "#login",
        textContent: "",
        src: "about:blank",
        contentWindow: {},
        dataset: {},
        addEventListener(name, handler) { handlers.set(name, handler); },
        click() {
          if (this.disabled) return null; // Browser ignores a disabled button.
          return handlers.get("click")?.();
        },
      });
    }
    return elements.get(selector);
  }
  const ethereum = {
    async request(request) {
      walletCalls.push(request.method);
      return walletRequest(request);
    },
    on() {},
  };
  const browserFetch = async (url, init) => {
    const resolved = new URL(url, origin);
    assert.equal(resolved.origin, origin, "Client must not call external URLs during failed login");
    if (options.failConfig && resolved.pathname === "/config") {
      traffic.push({ method: "GET", path: "/config", status: "offline" });
      throw new Error("Simulated configuration request failure");
    }
    const response = await fetch(resolved, { ...init, signal: AbortSignal.timeout(3000) });
    traffic.push({ method: init?.method || "GET", path: resolved.pathname, status: response.status });
    return response;
  };
  const context = vm.createContext({
    document: {
      querySelector: element,
      querySelectorAll: () => [],
    },
    window: {
      ethereum,
      location: { origin },
      addEventListener() {},
      setTimeout,
      clearTimeout,
    },
    fetch: browserFetch,
    URL,
    sessionStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    crypto: { randomUUID: () => "offline-" + Math.random().toString(16).slice(2) },
    console,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(appSource, context, { filename: "web/public/app.js" });
  return {
    connect: element("#connect"),
    login: element("#login"),
    appShell: element("#app-shell"),
    gameFrame: element("#game"),
    status: element("#status"),
    walletCalls,
    async attempt() {
      await element("#connect").click();
      assert.equal(element("#connect").disabled, false, "Failed login must release connect button");
      assert.equal(element("#app-shell").hidden, true, "Failed login must not reveal authenticated app");
      assert.equal(element("#game").src, "about:blank", "Failed login must not load/reload Godot");
    },
  };
}

function count(traffic, path, status) {
  return traffic.filter((item) => item.path === path && (status === undefined || item.status === status)).length;
}

test("failed wallet sign-in replay makes zero Network/V3 calls and has bounded local auth traffic", { timeout: 35000 }, async (t) => {
  const appSource = await readFile(path.join(webDir, "public", "app.js"), "utf8");
  const upstream = await startUpstreamTrap();
  t.after(async () => { await upstream.close(); });
  const server = await startLocalServer(upstream.origin);
  t.after(() => {
    if (server.child.exitCode === null) server.child.kill();
  });
  const traffic = [];
  const chain = "0x" + (84532).toString(16);

  await t.test("wallet authorization is rejected over repeated tries and reloads", async () => {
    for (let i = 0; i < 12; i++) {
      const browser = launchBrowser(appSource, server.origin, async ({ method }) => {
        if (method === "eth_requestAccounts") throw new Error("User rejected wallet connection");
        throw new Error("Unexpected wallet call: " + method);
      }, traffic);
      await browser.attempt();
      assert.deepEqual(browser.walletCalls, ["eth_requestAccounts"]);
      assert.match(browser.status.textContent, /rejected wallet connection/);
    }
    assert.equal(count(traffic, "/config", 200), 12);
    assert.equal(count(traffic, "/auth/challenge"), 0);
  });

  await t.test("wallet sign-message cancellations trigger rate limits, never verification or state reads", async () => {
    const start = traffic.length;
    let prompted = 0;
    for (let i = 0; i < 30; i++) {
      // A newly loaded page each time, like a player retrying/reloading.
      const browser = launchBrowser(appSource, server.origin, async ({ method }) => {
        if (method === "eth_requestAccounts") return [walletA];
        if (method === "eth_chainId") return chain;
        if (method === "personal_sign") {
          prompted++;
          throw new Error("User rejected the signature");
        }
        throw new Error("Unexpected wallet call: " + method);
      }, traffic);
      await browser.attempt();
    }
    const segment = traffic.slice(start);
    assert.equal(count(segment, "/config", 200), 30);
    assert.equal(count(segment, "/auth/challenge", 200), 6, "Only six challenges allowed for one wallet per minute");
    assert.equal(count(segment, "/auth/challenge", 429), 24, "Subsequent challenges should be rejected locally");
    assert.equal(prompted, 6, "Rate-limited attempts must not prompt another signature");
    assert.equal(count(segment, "/auth/verify"), 0);
    assert.equal(count(segment, "/app/state"), 0);
  });

  await t.test("invalid signatures are rejected and do not unlock the app", async () => {
    const start = traffic.length;
    for (let i = 0; i < 10; i++) {
      const browser = launchBrowser(appSource, server.origin, async ({ method }) => {
        if (method === "eth_requestAccounts") return [walletB];
        if (method === "eth_chainId") return chain;
        if (method === "personal_sign") return "0xdeadbeef";
        throw new Error("Unexpected wallet call: " + method);
      }, traffic);
      await browser.attempt();
    }
    const segment = traffic.slice(start);
    assert.equal(count(segment, "/auth/challenge", 200), 6);
    assert.equal(count(segment, "/auth/challenge", 429), 4);
    assert.equal(count(segment, "/auth/verify", 401), 6, "Bad signatures must fail server-side");
    assert.equal(count(segment, "/app/state"), 0);
  });

  await t.test("chain switch rejection never obtains a challenge", async () => {
    const start = traffic.length;
    const browser = launchBrowser(appSource, server.origin, async ({ method }) => {
      if (method === "eth_requestAccounts") return [walletC];
      if (method === "eth_chainId") return "0x1";
      if (method === "wallet_switchEthereumChain") throw new Error("User rejected chain switch");
      throw new Error("Unexpected wallet call: " + method);
    }, traffic);
    await browser.attempt();
    assert.equal(count(traffic.slice(start), "/auth/challenge"), 0);
  });

  await t.test("a hanging wallet connection does not spin up requests or Godot", async () => {
    let release;
    const pendingWallet = new Promise((_, reject) => { release = reject; });
    const start = traffic.length;
    let reachedWallet = false;
    const browser = launchBrowser(appSource, server.origin, ({ method }) => {
      if (method === "eth_requestAccounts") {
        reachedWallet = true;
        return pendingWallet;
      }
      throw new Error("Unexpected wallet call: " + method);
    }, traffic);
    const pendingLogin = browser.connect.click();
    const deadline = Date.now() + 2500;
    while (!reachedWallet && Date.now() < deadline) await pause(10);
    assert.equal(reachedWallet, true, "Test should reach the wallet prompt");
    assert.equal(browser.connect.disabled, true);
    assert.equal(browser.connect.click(), null, "Disabled connect button must ignore further clicks");
    assert.equal(count(traffic.slice(start), "/config", 200), 1);
    assert.equal(count(traffic.slice(start), "/auth/challenge"), 0);
    assert.equal(browser.gameFrame.src, "about:blank");
    release(new Error("Wallet connection timed out"));
    await pendingLogin;
    assert.equal(browser.connect.disabled, false);
    assert.equal(browser.appShell.hidden, true);
  });

  await t.test("config transport failure is not automatically retried", async () => {
    const start = traffic.length;
    const browser = launchBrowser(appSource, server.origin, () => {
      throw new Error("Wallet must not be contacted without config");
    }, traffic, { failConfig: true });
    await browser.attempt();
    assert.equal(count(traffic.slice(start), "/config", "offline"), 1);
    assert.deepEqual(browser.walletCalls, []);
  });

  await t.test("unauthenticated state endpoint rejects without upstream reads", async () => {
    const response = await fetch(server.origin + "/app/state", { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 401);
  });

  assert.equal(count(traffic, "/app/state"), 0);
  assert.equal(count(traffic, "/app/community"), 0);
  assert.equal(upstream.calls.length, 0, "Failed login must make zero Network or V3 calls");
  // 12 wallet rejects + 30 signature rejects + 10 invalid signatures +
  // 1 rejected chain switch + 1 hung wallet = 54 real local config reads.
  assert.equal(count(traffic, "/config", 200), 54);
  assert.equal(count(traffic, "/auth/challenge"), 40);
  assert.equal(count(traffic, "/auth/verify"), 6);
  console.log("Offline failed-login replay: 54 config reads, 40 challenges (28 rejected), 6 invalid verifications, 0 upstream calls, 0 Godot loads.");
});
