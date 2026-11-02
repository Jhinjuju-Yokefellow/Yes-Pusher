import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * Godot WebSocket spectator transport load harness.
 * NO wallet auth, transactions, Neon or blockchain requests.
 * Actual Godot capacity requires running against a disposable staging machine.
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function permittedTarget(raw, allowStaging) {
  const url = new URL(raw);
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password) {
    throw Error("Only credential-free ws:// or wss:// targets are allowed");
  }
  const host = url.hostname.toLowerCase();
  if (["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) return url.toString();
  if (!allowStaging || !/(staging|preview|test)/.test(host) || /production/.test(host)) {
    throw Error("Refusing non-staging or production WebSocket load target");
  }
  return url.toString();
}

async function singleSpectator(target, { connectTimeoutMs, holdMs, WebSocketImpl }) {
  const socket = new WebSocketImpl(target);
  const start = performance.now();
  let intentionallyClosing = false;
  const record = { opened: false, connectionMs: null, messages: 0, unexpectedClose: false };
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(Error("websocket_connection_timeout")), connectTimeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(deadline);
      record.opened = true;
      record.connectionMs = Math.round(performance.now() - start);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(deadline);
      reject(Error("websocket_connection_error"));
    }, { once: true });
    socket.addEventListener("close", () => {
      if (!record.opened) {
        clearTimeout(deadline);
        reject(Error("websocket_closed_before_open"));
      } else if (!intentionallyClosing) {
        record.unexpectedClose = true;
      }
    });
    socket.addEventListener("message", () => { record.messages += 1; });
  }).catch(error => {
    try { socket.close(); } catch {}
    throw error;
  });
  await delay(holdMs);
  if (socket.readyState === WebSocketImpl.CLOSED) record.unexpectedClose = true;
  if (socket.readyState === WebSocketImpl.OPEN) {
    intentionallyClosing = true;
    socket.close(1000, "staging spectator load");
  }
  return record;
}

export async function runWebSocketLoad({
  url = "ws://127.0.0.1:8787",
  clients = 100,
  reconnectRounds = 2,
  holdMs = 1000,
  connectTimeoutMs = 10000,
  allowStaging = false,
  WebSocketImpl = WebSocket,
} = {}) {
  if (![clients, reconnectRounds, holdMs, connectTimeoutMs].every(Number.isSafeInteger)
      || clients < 1 || clients > 500 || reconnectRounds < 1 || reconnectRounds > 5
      || holdMs < 20 || holdMs > 60000 || connectTimeoutMs < 100 || connectTimeoutMs > 30000) {
    throw Error("Invalid load parameters");
  }
  const target = permittedTarget(url, allowStaging);
  const all = [];
  for (let round = 0; round < reconnectRounds; round++) {
    const batch = await Promise.allSettled(Array.from({ length: clients }, () =>
      singleSpectator(target, { connectTimeoutMs, holdMs, WebSocketImpl })));
    all.push(...batch);
    if (round + 1 < reconnectRounds) await delay(100);
  }
  const successful = all.filter(item => item.status === "fulfilled").map(item => item.value);
  const failures = all.filter(item => item.status === "rejected");
  const sortedMs = successful.map(x => x.connectionMs).sort((a, b) => a - b);
  return {
    kind: "godot_websocket_transport_only", target,
    clientsPerRound: clients, rounds: reconnectRounds,
    attempted: all.length, opened: successful.length, failed: failures.length,
    unexpectedDisconnects: successful.filter(x => x.unexpectedClose).length,
    messagesReceived: successful.reduce((sum, x) => sum + x.messages, 0),
    p95ConnectMs: sortedMs.length ? sortedMs[Math.ceil(sortedMs.length * 0.95) - 1] : null,
    failureReasons: [...new Set(failures.map(x => String(x.reason?.message || x.reason)))],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  function option(flag, fallback) {
    const pos = args.indexOf(flag);
    if (pos < 0) return fallback;
    if (!args[pos + 1]) throw Error("Missing value for " + flag);
    return args[pos + 1];
  }
  try {
    const result = await runWebSocketLoad({
      url: option("--url", "ws://127.0.0.1:8787"),
      clients: Number(option("--clients", "100")),
      reconnectRounds: Number(option("--rounds", "2")),
      holdMs: Number(option("--hold-ms", "1000")),
      allowStaging: args.includes("--allow-staging"),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.failed > 0 || result.unexpectedDisconnects > 0) process.exitCode = 1;
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  }
}
