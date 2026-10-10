import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, verifyMessage } from "ethers";
import { createWorkshopService } from "./yd4-workshop.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const localDir = path.join(__dirname, ".local");
const port = integerEnv("PORT", 8080, 1, 65535);
const chainId = integerEnv("CHAIN_ID", 84532, 1, Number.MAX_SAFE_INTEGER);
const sessionTtlSeconds = integerEnv("SESSION_TTL_SECONDS", 14_400, 300, 86_400);
const publicOrigin = cleanOrigin(process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`);
const gameServerUrl = (process.env.GAME_SERVER_URL || "ws://127.0.0.1:8787").trim();
const sessionSecret = (process.env.SESSION_SECRET || "").trim();
const yokefellowOrigin = normalizeYokefellowOrigin(process.env.YF_API_BASE_URL || "");
const configuredBucketId = (process.env.YF_BUCKET_ID || "").trim();
const appApiKey = (process.env.YF_APP_API_KEY || process.env.YF_APP_KEY || "").trim();
const communityBuildStatePath = (process.env.YES_PUSHER_COMMUNITY_BUILD_STATE_PATH || path.join(localDir, "yd4-workshop-state.json")).trim();
const communityBuildTarget = integerEnv("YES_PUSHER_MACHINE_BUILD_TARGET", 50, 1, 1_000_000);

if (sessionSecret.length < 32 || sessionSecret === "REPLACE_WITH_A_LONG_RANDOM_SECRET") {
  throw new Error("SESSION_SECRET must be a private random value of at least 32 characters.");
}
if (!/^wss?:\/\//i.test(gameServerUrl)) {
  throw new Error("GAME_SERVER_URL must begin with ws:// or wss://.");
}

const workshop = createWorkshopService({
  yokefellowOrigin,
  bucketId: configuredBucketId,
  appApiKey,
  statePath: communityBuildStatePath,
  buildTarget: communityBuildTarget,
});

const challenges = new Map();
const challengeTtlMs = 5 * 60 * 1000;
const maxBodyBytes = 64 * 1024;

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".pck", "application/octet-stream"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
]);

const server = http.createServer(async (request, response) => {
  setSecurityHeaders(response);
  try {
    const requestUrl = new URL(request.url || "/", publicOrigin);

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "yes-drop-wallet-session",
        workshopReady: Boolean(yokefellowOrigin && configuredBucketId && appApiKey),
        machineBuildTarget: workshop.buildTarget,
        nftExecution: "yokefellow_action_paths",
      });
    }
    if (request.method === "GET" && requestUrl.pathname === "/config") {
      return sendJson(response, 200, {
        ok: true,
        chainId,
        gameServerUrl,
        gameReady: await fileExists(path.join(publicDir, "game", "index.html")),
        workshop: {
          buildTarget: workshop.buildTarget,
          families: workshop.families,
        },
        nftExecution: "yokefellow_action_paths",
      });
    }
    if (request.method === "POST" && requestUrl.pathname === "/auth/challenge") {
      return handleChallenge(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/auth/verify") {
      return handleVerify(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/auth/session/verify") {
      return handleSessionVerify(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/app/community") {
      return sendJson(response, 200, { ok: true, community: await workshop.getCommunity() });
    }
    if (request.method === "GET" && requestUrl.pathname === "/app/state") {
      const session = requirePlayerSession(request);
      return sendJson(response, 200, await workshop.getState(session.wallet));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/equip-skin") {
      const session = requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.equipSkin(session.wallet, body.family || ""));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/funding/prepare") {
      const session = requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.prepareFunding(session.wallet, body));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/funding/status") {
      const session = requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.fundingStatus(session.wallet, body));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/craft") {
      const session = requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.craft(session.wallet, body));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/contribute") {
      const session = requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.contribute(session.wallet, body));
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { ok: false, error: "Method not allowed." });
    }
    return serveStatic(requestUrl.pathname, request.method === "HEAD", response);
  } catch (error) {
    console.error(error);
    const status = Number.isInteger(error?.statusCode)
      ? error.statusCode
      : Number.isInteger(error?.status)
        ? error.status
        : 500;
    return sendJson(response, status, {
      ok: false,
      error: error instanceof Error ? error.message : "The wallet session service failed.",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`YES DROP wallet player: ${publicOrigin}`);
  console.log(`Godot shared machine: ${gameServerUrl}`);
  console.log(`Godot session verifier: ${publicOrigin}/auth/session/verify`);
  console.log(`Workshop: ${publicOrigin}/app/state · build target ${workshop.buildTarget}`);
  console.log("NFT execution: Yokefellow Action Paths only.");
});

setInterval(() => {
  const now = Date.now();
  for (const [id, challenge] of challenges.entries()) {
    if (challenge.expiresAtMs <= now || challenge.used) challenges.delete(id);
  }
}, 60_000).unref();

async function handleChallenge(request, response) {
  const body = await readJson(request);
  const wallet = normalizeWallet(body.wallet);
  const now = new Date();
  const expiration = new Date(now.getTime() + challengeTtlMs);
  const challengeId = crypto.randomUUID();
  const nonce = crypto.randomBytes(16).toString("hex");
  const message = [
    "YES DROP wants you to sign in with your Ethereum account:",
    wallet,
    "",
    "Sign in to YES DROP. Rainbow's End is the active machine theme.",
    "This signature does not send a transaction or spend YES.",
    "",
    `URI: ${publicOrigin}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiration.toISOString()}`,
    `Request ID: ${challengeId}`,
  ].join("\n");

  challenges.set(challengeId, {
    id: challengeId,
    wallet,
    message,
    expiresAtMs: expiration.getTime(),
    used: false,
  });
  return sendJson(response, 200, {
    ok: true,
    challengeId,
    wallet,
    message,
    expiresAt: expiration.toISOString(),
  });
}

async function handleVerify(request, response) {
  const body = await readJson(request);
  const wallet = normalizeWallet(body.wallet);
  const challengeId = String(body.challengeId || "").trim();
  const signature = String(body.signature || "").trim();
  const challenge = challenges.get(challengeId);

  if (!challenge || challenge.used || challenge.expiresAtMs <= Date.now()) {
    return sendJson(response, 401, { ok: false, error: "That login request expired. Connect the wallet again." });
  }
  if (challenge.wallet !== wallet) {
    return sendJson(response, 401, { ok: false, error: "The login request belongs to a different wallet." });
  }
  if (!signature) {
    return sendJson(response, 400, { ok: false, error: "The wallet signature is missing." });
  }

  let recovered;
  try {
    recovered = normalizeWallet(verifyMessage(challenge.message, signature));
  } catch {
    return sendJson(response, 401, { ok: false, error: "The wallet signature could not be verified." });
  }
  if (recovered !== wallet) {
    return sendJson(response, 401, { ok: false, error: "The signature does not belong to this wallet." });
  }

  challenge.used = true;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    version: 1,
    app: "yes-drop",
    wallet,
    chainId,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + sessionTtlSeconds,
    sessionId: crypto.randomUUID(),
  };
  const sessionToken = signSession(payload);
  return sendJson(response, 200, {
    ok: true,
    wallet,
    sessionToken,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
  });
}

async function handleSessionVerify(request, response) {
  const body = await readJson(request);
  let wallet;
  try {
    wallet = normalizeWallet(body.wallet);
  } catch {
    return sendJson(response, 400, { ok: false, error: "Invalid wallet." });
  }
  const token = String(body.sessionToken || "").trim();
  const payload = verifySession(token);
  if (!payload || !(["yes-drop", "yes-pusher", "rainbows-end"].includes(payload.app)) || payload.wallet !== wallet || payload.expiresAt <= Math.floor(Date.now() / 1000)) {
    return sendJson(response, 401, { ok: false, error: "The wallet session is invalid or expired." });
  }
  return sendJson(response, 200, { ok: true, wallet: payload.wallet, expiresAt: payload.expiresAt });
}

function requirePlayerSession(request) {
  const authorization = String(request.headers.authorization || "").trim();
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const payload = verifySession(token);
  const now = Math.floor(Date.now() / 1000);
  if (!payload || !(["yes-drop", "yes-pusher", "rainbows-end"].includes(payload.app)) || !payload.wallet || payload.expiresAt <= now) {
    const error = new Error("The Rainbow's End wallet session is invalid or expired.");
    error.statusCode = 401;
    throw error;
  }
  return payload;
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifySession(token) {
  const [encoded, suppliedSignature, extra] = String(token || "").split(".");
  if (!encoded || !suppliedSignature || extra !== undefined) return null;
  const expectedSignature = crypto.createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

async function serveStatic(pathname, headOnly, response) {
  const decoded = decodeURIComponent(pathname);
  const requested = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const relative = requested.replace(/^\/+/, "");
  const filePath = path.resolve(publicDir, relative || "index.html");
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
    return sendJson(response, 403, { ok: false, error: "Forbidden." });
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return sendJson(response, 404, { ok: false, error: "Not found." });
  }
  if (!stat.isFile()) return sendJson(response, 404, { ok: false, error: "Not found." });

  const extension = path.extname(filePath).toLowerCase();
  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypes.get(extension) || "application/octet-stream");
  const isGameAsset = relative === "game" || relative.startsWith("game/");
  response.setHeader("Cache-Control", extension === ".html" || isGameAsset ? "no-store" : "public, max-age=300");
  response.setHeader("Content-Length", stat.size);
  if (headOnly) return response.end();
  const data = await fs.readFile(filePath);
  return response.end(data);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function normalizeWallet(value) {
  return getAddress(String(value || "").trim()).toLowerCase();
}

function normalizeYokefellowOrigin(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed || /YOUR-YOKEFELLOW-DOMAIN/i.test(trimmed)) return "";
  const withoutSdk = trimmed.replace(/\/api\/sdk\/v1$/i, "");
  try {
    return new URL(withoutSdk).origin;
  } catch {
    return "";
  }
}

function cleanOrigin(value) {
  const url = new URL(value);
  return url.origin;
}

function integerEnv(name, fallback, minimum, maximum) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function sendJson(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", payload.length);
  response.end(payload);
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self' https: ws: wss:; frame-src 'self'; worker-src 'self' blob:");
}

async function fileExists(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}