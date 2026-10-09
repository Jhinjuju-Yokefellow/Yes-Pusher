import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkshopService } from "./yd4-workshop.mjs";
import { createYokefellowNetworkClient } from "./yokefellow-network.mjs";
import { getAddress } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const localDir = path.join(__dirname, ".local");
const port = integerEnv("PORT", 8080, 1, 65535);
const chainId = integerEnv("CHAIN_ID", 84532, 1, Number.MAX_SAFE_INTEGER);
const publicOrigin = cleanOrigin(process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`);
const gameServerUrl = (process.env.GAME_SERVER_URL || "ws://127.0.0.1:8787").trim();
const networkBaseUrl = (process.env.YF_NETWORK_BASE_URL || "").trim();
const networkBucketId = (process.env.YF_NETWORK_BUCKET_ID || "").trim();
const networkAppApiKey = (process.env.YF_NETWORK_APP_API_KEY || "").trim();
const communityBuildStatePath = (process.env.YES_PUSHER_COMMUNITY_BUILD_STATE_PATH || path.join(localDir, "yd4-workshop-state.json")).trim();
const communityBuildTarget = integerEnv("YES_PUSHER_MACHINE_BUILD_TARGET", 50, 1, 1_000_000);

if (!/^wss?:\/\//i.test(gameServerUrl)) {
  throw new Error("GAME_SERVER_URL must begin with ws:// or wss://.");
}

const network = createYokefellowNetworkClient({
  baseUrl: networkBaseUrl,
  appApiKey: networkAppApiKey,
  bucketId: networkBucketId,
});

const workshop = createWorkshopService({
  network,
  statePath: communityBuildStatePath,
  buildTarget: communityBuildTarget,
});

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
        service: "yes-drop-web",
        networkReady: network.configured(),
        workshopReady: network.configured(),
        communityContributionReady: network.configured(),
        machineBuildTarget: workshop.buildTarget,
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
      const session = await requirePlayerSession(request);
      return sendJson(response, 200, await workshop.getState(session.wallet, session.participantSessionToken));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/equip-skin") {
      const session = await requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.equipSkin(session.wallet, body.family || "", session.participantSessionToken));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/funding/prepare") {
      const session = await requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.prepareFunding(session.wallet, body, session.participantSessionToken));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/funding/status") {
      const session = await requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.fundingStatus(session.wallet, body, session.participantSessionToken));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/craft") {
      const session = await requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.craft(session.wallet, body, session.participantSessionToken));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/contribute") {
      const session = await requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.contribute(session.wallet, body, session.participantSessionToken));
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
  console.log(`YES drop web: ${publicOrigin}`);
  console.log(`Godot shared machine: ${gameServerUrl}`);
  console.log(`Yokefellow Network session verifier: ${publicOrigin}/auth/session/verify`);
  console.log(`YD-4 workshop: ${publicOrigin}/app/state · build target ${workshop.buildTarget}`);
});

async function handleChallenge(request, response) {
  const body = await readJson(request);
  const wallet = normalizeWallet(body.wallet);
  const challenge = await network.createParticipantChallenge(wallet);
  return sendJson(response, 200, {
    ok: true,
    challengeId: challenge.id,
    wallet: String(challenge.wallet || wallet).toLowerCase(),
    message: challenge.message,
    expiresAt: challenge.expiresAt,
    signingMethod: challenge.signingMethod || "personal_sign",
  });
}

async function handleVerify(request, response) {
  const body = await readJson(request);
  const wallet = normalizeWallet(body.wallet);
  const challengeId = String(body.challengeId || "").trim();
  const signature = String(body.signature || "").trim();
  if (!challengeId || !signature) {
    return sendJson(response, 400, {
      ok: false,
      error: "The Network login request or wallet signature is missing.",
    });
  }

  const result = await network.createParticipantSession(challengeId, signature);
  const sessionWallet = normalizeWallet(result?.session?.wallet || "");
  if (sessionWallet !== wallet) {
    return sendJson(response, 403, {
      ok: false,
      error: "The Network participant session belongs to a different wallet.",
    });
  }

  return sendJson(response, 200, {
    ok: true,
    wallet: sessionWallet,
    sessionToken: result.participantSessionToken,
    expiresAt: result.session.expiresAt,
  });
}

async function handleSessionVerify(request, response) {
  const body = await readJson(request);
  const wallet = normalizeWallet(body.wallet);
  const participantSessionToken = String(body.sessionToken || "").trim();
  if (!participantSessionToken) {
    return sendJson(response, 401, {
      ok: false,
      error: "The Yokefellow Network participant session is missing.",
    });
  }
  const result = await network.verifyParticipantSession(
    wallet,
    participantSessionToken,
  );
  return sendJson(response, 200, {
    ok: true,
    wallet,
    expiresAt: result?.session?.expiresAt ?? null,
    assurance: result?.session?.assurance ?? "WALLET_AUTHORIZED",
  });
}

async function requirePlayerSession(request) {
  const authorization = String(request.headers.authorization || "").trim();
  const participantSessionToken = authorization.replace(/^Bearer\s+/i, "").trim();
  const suppliedWallet = Array.isArray(request.headers["x-yes-drop-wallet"])
    ? request.headers["x-yes-drop-wallet"][0]
    : request.headers["x-yes-drop-wallet"];
  let wallet;
  try {
    wallet = normalizeWallet(suppliedWallet || "");
  } catch {
    const error = new Error("The YES drop wallet header is missing or invalid.");
    error.statusCode = 401;
    throw error;
  }
  if (!participantSessionToken) {
    const error = new Error("The Yokefellow Network participant session is missing.");
    error.statusCode = 401;
    throw error;
  }

  const result = await network.verifyParticipantSession(
    wallet,
    participantSessionToken,
  );
  return {
    wallet,
    participantSessionToken,
    expiresAt: result?.session?.expiresAt ?? null,
    assurance: result?.session?.assurance ?? "WALLET_AUTHORIZED",
  };
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
