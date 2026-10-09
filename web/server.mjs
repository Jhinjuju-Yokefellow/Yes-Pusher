import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkshopService } from "./yd4-workshop.mjs";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  getAddress,
  verifyMessage,
} from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const localDir = path.join(__dirname, ".local");
const instantMintJournalPath = path.join(localDir, "instant-mints.json");
const port = integerEnv("PORT", 8080, 1, 65535);
const chainId = integerEnv("CHAIN_ID", 84532, 1, Number.MAX_SAFE_INTEGER);
const sessionTtlSeconds = integerEnv("SESSION_TTL_SECONDS", 14_400, 300, 86_400);
const publicOrigin = cleanOrigin(process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`);
const gameServerUrl = (process.env.GAME_SERVER_URL || "ws://127.0.0.1:8787").trim();
const sessionSecret = (process.env.SESSION_SECRET || "").trim();
const instantMintSecret = (process.env.YF_INSTANT_MINT_SECRET || "").trim();
const instantMintPrivateKey = (process.env.YF_NFT_MINT_PRIVATE_KEY || "").trim();
const rpcUrl = (process.env.YF_RPC_URL || "https://sepolia.base.org").trim();
const yokefellowOrigin = normalizeYokefellowOrigin(process.env.YF_API_BASE_URL || "");
const configuredBucketId = (process.env.YF_BUCKET_ID || "").trim();
const appApiKey = (process.env.YF_APP_API_KEY || process.env.YF_APP_KEY || "").trim();
const contributionPrivateKey = (process.env.YF_CONTRIBUTION_BURN_PRIVATE_KEY || "").trim();
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
  rpcUrl,
  chainId,
  contributionPrivateKey,
  statePath: communityBuildStatePath,
  buildTarget: communityBuildTarget,
});

let mintProvider = null;
let mintSigner = null;
let mintSetupError = "";
if (instantMintPrivateKey) {
  try {
    mintProvider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    mintSigner = new Wallet(instantMintPrivateKey, mintProvider);
  } catch (error) {
    mintSetupError = error instanceof Error ? error.message : "The instant mint signer could not be loaded.";
  }
}

const challenges = new Map();
const challengeTtlMs = 5 * 60 * 1000;
const maxBodyBytes = 64 * 1024;
const instantMintLocks = new Map();
let instantMintJournal = await readInstantMintJournal();

const commonCollectionAbi = [
  "function owner() view returns (address)",
  "function approvedIssuers(address) view returns (bool)",
];
const collection1155Abi = [
  ...commonCollectionAbi,
  "function mintTo(address to, uint256 tokenId, uint256 amount, bytes data)",
  "event Minted(address indexed operator, address indexed to, uint256 indexed tokenId, uint256 amount)",
];
const collection721Abi = [
  ...commonCollectionAbi,
  "function mintTo(address to, string tokenUriOverride) returns (uint256 tokenId)",
  "event Minted(address indexed operator, address indexed to, uint256 indexed tokenId, uint256 classId, string tokenUriOverride)",
];
const collection721Interface = new Interface(collection721Abi);

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
        service: "yes-pusher-wallet-session",
        instantMintReady: instantMinterReady(),
        workshopReady: Boolean(yokefellowOrigin && configuredBucketId && appApiKey),
        communityContributionReady: Boolean(workshop.contributionSignerAddress),
        machineBuildTarget: workshop.buildTarget,
      });
    }
    if (request.method === "GET" && requestUrl.pathname === "/config") {
      return sendJson(response, 200, {
        ok: true,
        chainId,
        gameServerUrl,
        gameReady: await fileExists(path.join(publicDir, "game", "index.html")),
        instantMintReady: instantMinterReady(),
        instantMintSigner: mintSigner?.address || null,
        workshop: {
          buildTarget: workshop.buildTarget,
          families: workshop.families,
          contributionSigner: workshop.contributionSignerAddress,
        },
      });
    }
    if (request.method === "GET" && requestUrl.pathname === "/mint/config") {
      return handleMintConfig(response);
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
    if (request.method === "POST" && requestUrl.pathname === "/mint/instant") {
      return handleInstantMint(request, response);
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
  console.log(`YES Pusher wallet player: ${publicOrigin}`);
  console.log(`Godot shared machine: ${gameServerUrl}`);
  console.log(`Godot session verifier: ${publicOrigin}/auth/session/verify`);
  console.log(`YD-4 workshop: ${publicOrigin}/app/state · build target ${workshop.buildTarget}`);
  if (workshop.contributionSignerAddress) {
    console.log(`Community contribution burner: ${workshop.contributionSignerAddress}`);
  }
  if (mintSigner) {
    console.log(`Instant NFT mint signer: ${mintSigner.address}`);
    console.log(`Instant minter setup: ${publicOrigin}/instant-mint.html`);
  } else {
    console.log(`Instant NFT minter is not ready${mintSetupError ? `: ${mintSetupError}` : "."}`);
  }
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
    `YES DROP wants you to sign in with your Ethereum account:`,
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
    app: "yes-pusher",
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
  if (!payload || !(["yes-pusher", "rainbows-end"].includes(payload.app)) || payload.wallet !== wallet || payload.expiresAt <= Math.floor(Date.now() / 1000)) {
    return sendJson(response, 401, { ok: false, error: "The wallet session is invalid or expired." });
  }
  return sendJson(response, 200, { ok: true, wallet: payload.wallet, expiresAt: payload.expiresAt });
}

function requirePlayerSession(request) {
  const authorization = String(request.headers.authorization || "").trim();
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const payload = verifySession(token);
  const now = Math.floor(Date.now() / 1000);
  if (!payload || !(["yes-pusher", "rainbows-end"].includes(payload.app)) || !payload.wallet || payload.expiresAt <= now) {
    const error = new Error("The Rainbow's End wallet session is invalid or expired.");
    error.statusCode = 401;
    throw error;
  }
  return payload;
}

async function handleMintConfig(response) {
  const collections = [];
  let catalogError = "";
  if (yokefellowOrigin && configuredBucketId) {
    try {
      const catalog = await fetchJson(
        `${yokefellowOrigin}/api/sdk/v1/buckets/${encodeURIComponent(configuredBucketId)}/catalog`,
      );
      const offeringTargets = [
        {
          name: (process.env.YES_PUSHER_SKIN_DROP_OFFERING_NAME || "Coin Skin Drop").trim().toLowerCase(),
          trigger: (process.env.YES_PUSHER_SKIN_DROP_TRIGGER_KEY || "yes_pusher.skin_drop").trim().toLowerCase(),
        },
        {
          name: (process.env.YES_PUSHER_TOY_OFFERING_NAME || "Catch a Toy").trim().toLowerCase(),
          trigger: (process.env.YES_PUSHER_TOY_TRIGGER_KEY || "yes_pusher.toy_caught").trim().toLowerCase(),
        },
      ];
      const connectedOfferings = (Array.isArray(catalog.offerings) ? catalog.offerings : []).filter((offering) => {
        const title = String(offering?.title || "").trim().toLowerCase();
        const binding = String(offering?.meta?.appBindingKey || "").trim().toLowerCase();
        return offeringTargets.some((target) => title === target.name || binding === target.trigger);
      });
      const appMintClassIds = new Set(connectedOfferings
        .flatMap((offering) => Array.isArray(offering?.outputs) ? offering.outputs : [])
        .map((output) => String(output?.itemClassId || ""))
        .filter(Boolean));
      const appMintCollectionIds = new Set((Array.isArray(catalog.classes) ? catalog.classes : [])
        .filter((itemClass) => appMintClassIds.has(String(itemClass?.id || "")))
        .map((itemClass) => String(itemClass?.collectionId || ""))
        .filter(Boolean));
      for (const collection of Array.isArray(catalog.collections) ? catalog.collections : []) {
        if (!collection?.contractAddress || (appMintCollectionIds.size && !appMintCollectionIds.has(String(collection.id || "")))) continue;
        collections.push({
          id: String(collection.id || ""),
          name: String(collection.name || "NFT collection"),
          standard: String(collection.standard || ""),
          contractAddress: normalizeContractAddress(collection.contractAddress),
          registryStatus: String(collection.registryStatus || ""),
        });
      }
    } catch (error) {
      catalogError = error instanceof Error ? error.message : "The collection catalog could not be loaded.";
    }
  }
  return sendJson(response, 200, {
    ok: true,
    chainId,
    signerAddress: mintSigner?.address || null,
    ready: instantMinterReady(),
    setupError: mintSetupError || catalogError || null,
    collections,
  });
}

async function handleInstantMint(request, response) {
  if (!safeSecretMatches(request.headers["x-yes-pusher-mint-secret"], instantMintSecret)) {
    return sendJson(response, 403, { ok: false, error: "Invalid instant mint service secret." });
  }
  if (!instantMinterReady()) {
    return sendJson(response, 503, {
      ok: false,
      error: mintSetupError || "The instant mint signer, RPC, Yokefellow URL, or service secret is not configured.",
    });
  }

  const body = await readJson(request);
  const jobId = String(body.jobId || "").trim();
  const bucketSlug = String(body.bucketSlug || body.bucketId || configuredBucketId).trim();
  const requestedClassId = String(body.classId || "").trim();
  let requestedWallet;
  try {
    requestedWallet = normalizeWallet(body.wallet);
  } catch {
    return sendJson(response, 400, { ok: false, error: "Invalid mint recipient wallet." });
  }
  if (!jobId || !bucketSlug || !requestedClassId) {
    return sendJson(response, 400, { ok: false, error: "jobId, bucketSlug, wallet, and classId are required." });
  }

  try {
    const result = await withMintLock(jobId, () => executeInstantMint({
      jobId,
      bucketSlug,
      requestedClassId,
      requestedWallet,
    }));
    return sendJson(response, 200, { ok: true, completed: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instant NFT minting failed.";
    console.error(`Instant mint ${jobId} failed:`, error);
    return sendJson(response, 400, { ok: false, completed: false, error: message });
  }
}

async function executeInstantMint({ jobId, bucketSlug, requestedClassId, requestedWallet }) {
  const job = await loadIssuanceJob(bucketSlug, jobId);
  if (String(job.walletAddress || "").toLowerCase() !== requestedWallet) {
    throw new Error("The mint job recipient does not match the verified player wallet.");
  }
  if (String(job.classId || "") !== requestedClassId) {
    throw new Error("The mint job class does not match the selected app result.");
  }
  if (String(job.status || "") === "completed" && job.txHash && job.tokenId) {
    return {
      jobId,
      wallet: requestedWallet,
      classId: requestedClassId,
      txHash: String(job.txHash),
      tokenId: String(job.tokenId),
      duplicate: true,
    };
  }
  if (!["queued", "running"].includes(String(job.status || ""))) {
    throw new Error(`The mint job is ${job.status || "not ready"}, not queued for instant minting.`);
  }
  if (String(job.collectionRegistryStatus || "") !== "recognized") {
    throw new Error("The NFT collection must be recognized before the app can mint it.");
  }

  const contractAddress = normalizeContractAddress(job.collectionContractAddress);
  if (!contractAddress) throw new Error("The NFT collection does not have a deployed contract address.");
  const standard = String(job.standard || "").toLowerCase();
  if (!['erc721', 'erc1155'].includes(standard)) throw new Error("Unsupported NFT collection standard.");

  const existing = instantMintJournal[jobId] || null;
  if (existing?.completed && existing.txHash && existing.tokenId) {
    return { ...existing, duplicate: true };
  }

  const abi = standard === "erc721" ? collection721Abi : collection1155Abi;
  const contract = new Contract(contractAddress, abi, mintSigner);
  await assertSignerAuthorized(contract);

  let txHash = existing?.txHash || "";
  let tokenId = existing?.tokenId || "";
  let receipt = null;

  if (txHash) {
    receipt = await mintProvider.getTransactionReceipt(txHash);
    if (!receipt) {
      const transaction = await mintProvider.getTransaction(txHash);
      if (!transaction) throw new Error("The saved instant mint transaction could not be found.");
      receipt = await transaction.wait();
    }
  } else {
    let transaction;
    if (standard === "erc1155") {
      const classTokenId = String(job.classTokenId || job.tokenId || "").trim();
      if (!/^\d+$/.test(classTokenId)) throw new Error("The ERC-1155 class token ID is missing.");
      transaction = await contract["mintTo(address,uint256,uint256,bytes)"](
        requestedWallet,
        BigInt(classTokenId),
        BigInt(Math.max(1, Number(job.amount || 1))),
        "0x",
      );
      tokenId = classTokenId;
    } else {
      transaction = await contract["mintTo(address,string)"](requestedWallet, "");
    }
    txHash = transaction.hash;
    instantMintJournal[jobId] = {
      jobId,
      wallet: requestedWallet,
      classId: requestedClassId,
      standard,
      contractAddress,
      txHash,
      tokenId,
      completed: false,
      updatedAt: new Date().toISOString(),
    };
    await saveInstantMintJournal();
    receipt = await transaction.wait();
  }

  if (!receipt || Number(receipt.status) !== 1) throw new Error("The instant NFT mint transaction failed onchain.");
  if (standard === "erc721" && !tokenId) tokenId = tokenIdFrom721Receipt(receipt.logs, contractAddress);
  if (!tokenId) throw new Error("The minted token ID could not be read from the transaction receipt.");

  instantMintJournal[jobId] = {
    jobId,
    wallet: requestedWallet,
    classId: requestedClassId,
    standard,
    contractAddress,
    txHash,
    tokenId,
    completed: false,
    updatedAt: new Date().toISOString(),
  };
  await saveInstantMintJournal();
  await recordMintCompletion(jobId, requestedWallet, txHash, tokenId);
  instantMintJournal[jobId].completed = true;
  instantMintJournal[jobId].updatedAt = new Date().toISOString();
  await saveInstantMintJournal();

  return {
    jobId,
    wallet: requestedWallet,
    classId: requestedClassId,
    standard,
    contractAddress,
    txHash,
    tokenId,
    duplicate: false,
  };
}

async function assertSignerAuthorized(contract) {
  const [owner, approved] = await Promise.all([
    contract.owner(),
    contract.approvedIssuers(mintSigner.address),
  ]);
  if (String(owner).toLowerCase() !== mintSigner.address.toLowerCase() && !approved) {
    throw new Error(`Instant mint signer ${mintSigner.address} is not approved as an issuer on this collection. Open ${publicOrigin}/instant-mint.html with the collection owner wallet.`);
  }
}

async function loadIssuanceJob(bucketSlug, jobId) {
  const payload = await fetchJson(
    `${yokefellowOrigin}/api/buckets/${encodeURIComponent(bucketSlug)}/issuance-jobs`,
  );
  const jobs = Array.isArray(payload.issuanceJobs) ? payload.issuanceJobs : [];
  const job = jobs.find((candidate) => String(candidate?.id || "") === jobId);
  if (!job) throw new Error("The Coin Skin mint job could not be found in Yokefellow.");
  return job;
}

async function recordMintCompletion(jobId, walletAddress, txHash, tokenId) {
  await fetchJson(`${yokefellowOrigin}/api/issuance-jobs/${encodeURIComponent(jobId)}/completion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ walletAddress, txHash, tokenId }),
  });
}

function tokenIdFrom721Receipt(logs, contractAddress) {
  for (const log of logs || []) {
    if (String(log.address || "").toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const parsed = collection721Interface.parseLog(log);
      if (parsed?.name === "Minted") return String(parsed.args.tokenId);
    } catch {
      // Ignore unrelated logs.
    }
  }
  return "";
}

function instantMinterReady() {
  return Boolean(
    mintSigner
    && mintProvider
    && instantMintSecret.length >= 32
    && yokefellowOrigin
    && configuredBucketId,
  );
}

async function withMintLock(jobId, operation) {
  if (instantMintLocks.has(jobId)) return instantMintLocks.get(jobId);
  const pending = Promise.resolve().then(operation).finally(() => instantMintLocks.delete(jobId));
  instantMintLocks.set(jobId, pending);
  return pending;
}

async function readInstantMintJournal() {
  try {
    const parsed = JSON.parse(await fs.readFile(instantMintJournalPath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function saveInstantMintJournal() {
  await fs.mkdir(localDir, { recursive: true });
  const temporary = `${instantMintJournalPath}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(instantMintJournal, null, 2)}\n`, "utf8");
  await fs.rename(temporary, instantMintJournalPath);
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

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    const message = typeof body?.error === "string"
      ? body.error
      : typeof body?.error?.message === "string"
        ? body.error.message
        : `Yokefellow returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

function normalizeWallet(value) {
  return getAddress(String(value || "").trim()).toLowerCase();
}

function normalizeContractAddress(value) {
  try {
    return getAddress(String(value || "").trim());
  } catch {
    return "";
  }
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

function safeSecretMatches(suppliedValue, expectedValue) {
  const supplied = Buffer.from(String(Array.isArray(suppliedValue) ? suppliedValue[0] : suppliedValue || ""));
  const expected = Buffer.from(String(expectedValue || ""));
  return supplied.length > 0 && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
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
