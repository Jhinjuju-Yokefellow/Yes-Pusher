import { getAddress } from "ethers";

const FAMILIES = [
  { key: "four_leaf_clover", label: "Four Leaf Clover", rarity: 1, points: 1 },
  { key: "horseshoe", label: "Horseshoe", rarity: 2, points: 2 },
  { key: "leprechaun", label: "Leprechaun", rarity: 3, points: 3 },
  { key: "pot_of_gold", label: "Pot of Gold", rarity: 4, points: 4 },
  { key: "treasure_chest", label: "Treasure Chest", rarity: 5, points: 5 },
];

const TOY_UPGRADE_PATH_KEY = "yes_drop.toy_upgrade";
const COMMUNITY_MACHINE_PATH_KEY = "yes_drop.community_machine";

const UPGRADE_CHOICE_PREFIX = {
  four_leaf_clover: "clover",
  horseshoe: "horseshoe",
  leprechaun: "leprechaun",
  pot_of_gold: "gold",
  treasure_chest: "chest",
};

function normalizeFamily(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[-.\s/]+/g, "_");
  if (text.includes("four_leaf_clover") || text.includes("fourleafclover") || text === "clover") return "four_leaf_clover";
  if (text.includes("pot_of_gold") || text.includes("potofgold")) return "pot_of_gold";
  if (text.includes("treasure_chest") || text.includes("treasurechest")) return "treasure_chest";
  if (text.includes("horseshoe")) return "horseshoe";
  if (text.includes("leprechaun")) return "leprechaun";
  return "";
}

function toyTier(classSlug, className) {
  const text = `${String(classSlug || "")} ${String(className || "")}`
    .trim()
    .toLowerCase()
    .replace(/[-.\s/]+/g, "_");
  if (/(^|_)l3($|_)/.test(text) || text.includes("level_3") || text.includes("level3")) return "large";
  if (/(^|_)l2($|_)/.test(text) || text.includes("level_2") || text.includes("level2")) return "medium";
  if (/(^|_)l1($|_)/.test(text) || text.includes("level_1") || text.includes("level1")) return "small";
  for (const tier of ["large", "medium", "small", "base"]) {
    if (text.includes(tier)) return tier === "base" ? "small" : tier;
  }
  return "";
}

function isToyClass(classSlug, className) {
  const normalized = `${classSlug || ""} ${className || ""}`
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  return normalized.includes("toy") || Boolean(toyTier(classSlug, className));
}

function familyDescriptor(family) {
  return FAMILIES.find((item) => item.key === family) || null;
}

function safeInteger(value, fallback = 0) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? number : fallback;
}

function validReference(value) {
  const ref = String(value || "").trim();
  return ref.length >= 8 && ref.length <= 160 ? ref : "";
}

function upgradeChoice(family, fromTier) {
  const prefix = UPGRADE_CHOICE_PREFIX[family];
  const targetTier = fromTier === "small" ? "medium" : "large";
  return prefix ? `${prefix}_${fromTier}_to_${targetTier}` : "";
}

function contributionChoice(family) {
  return family ? `${family}_large` : "";
}

function holdingQuantity(holding) {
  const standard = String(holding?.standard || "").toUpperCase();
  if (standard === "ERC721") return String(holding?.owner || "").trim() ? 1 : 0;
  return Math.max(0, safeInteger(holding?.quantity ?? holding?.balance, 0));
}

function presentationForHolding(holding) {
  return holding?.presentation && typeof holding.presentation === "object" ? holding.presentation : {};
}

async function jsonRequest(url, { method = "GET", networkAppApiKey = "", idempotencyKey = "", body = null } = {}) {
  const headers = { Accept: "application/json" };
  if (networkAppApiKey) headers["Authorization"] = `Bearer ${networkAppApiKey}`;
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  if (body !== null) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const message = typeof payload?.error === "string"
      ? payload.error
      : typeof payload?.error?.message === "string"
        ? payload.error.message
        : `Yokefellow returned HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function createWorkshopService({
  yokefellowOrigin,
  networkOrigin,
  bucketId,
  networkAppApiKey,
  buildTarget = 50,
}) {
  const normalizedOrigin = String(yokefellowOrigin || "").replace(/\/+$/, "");
  const normalizedNetworkOrigin = String(networkOrigin || "").replace(/\/+$/, "");
  const normalizedBucketId = String(bucketId || "").trim();
  const normalizedAppKey = String(networkAppApiKey || "").trim();
  if (!/^https?:\/\//.test(normalizedNetworkOrigin) || !normalizedAppKey.startsWith("yfk_")) {
    throw new Error("YF_NETWORK_API_URL and the Network App key are required for durable workshop state.");
  }
  const target = Math.max(1, safeInteger(buildTarget, 50));
  let cachedBucketSlug = "";
  // An App session reads its holdings, workshop state and credit once.
  // Network's hourly blockchain-to-database updater is entirely separate.
  const sessionStateCache = new Map();
  const SESSION_CACHE_LIMIT = 1024;
  const SESSION_RETRY_MS = 60_000;
  function sessionCacheKey(wallet, session) {
    if (!session?.sessionId || !Number.isSafeInteger(session.expiresAt) || session.expiresAt * 1000 <= Date.now()) return "";
    return `${wallet}:${session.sessionId}`;
  }
  function invalidateSessionState(wallet, session) {
    const key = sessionCacheKey(wallet, session);
    if (key) sessionStateCache.delete(key);
  }
  function updateSessionSkin(wallet, session, family) {
    const cached = sessionStateCache.get(sessionCacheKey(wallet, session));
    if (cached?.data) cached.data.equippedSkin = family;
  }

  function workshopRequest(pathname, options = {}) {
    return jsonRequest(`${normalizedNetworkOrigin}/v1/workshop${pathname}`, {
      networkAppApiKey: normalizedAppKey,
      ...options,
    });
  }
  let communityCache = null;
  let communityPending = null;
  const COMMUNITY_CACHE_MS = 30_000;
  function cacheCommunity(summary) {
    const value = communityFromSummary(summary);
    // Concurrent state reads must not roll back an already observed contribution.
    if (communityCache && value.contributionCount < communityCache.value.contributionCount) {
      return communityCache.value;
    }
    communityCache = { value, expiresAt: Date.now() + COMMUNITY_CACHE_MS };
    return value;
  }
  async function getNetworkWorkshopState(wallet) {
    return workshopRequest(`/state?wallet=${encodeURIComponent(wallet)}`);
  }

  function requireYokefellow() {
    if (!normalizedOrigin || !normalizedBucketId || !normalizedAppKey.startsWith("yfk_")) {
      throw new Error("Rainbow's End is not connected to its Network App credential.");
    }
  }

  function sdkUrl(pathname) {
    return `${normalizedOrigin}/api/sdk/v1${pathname}`;
  }

  function actionPathUrl(pathKey) {
    return sdkUrl(`/buckets/${encodeURIComponent(normalizedBucketId)}/action-paths/${encodeURIComponent(pathKey)}/execute`);
  }

  async function loadRemote(wallet) {
    requireYokefellow();
    const holdings = await jsonRequest(
      sdkUrl(`/buckets/${encodeURIComponent(normalizedBucketId)}/holdings/${encodeURIComponent(wallet)}`),
      { networkAppApiKey: normalizedAppKey },
    );
    if (holdings?.complete === false) throw new Error("V3 NFT ownership projection is not ready.");
    const slug = String(holdings?.bucketSlug || "").trim();
    if (slug) cachedBucketSlug = slug;
    return holdings;
  }

  function buildInventory(remote) {
    const classes = Array.isArray(remote?.classes) ? remote.classes : [];
    const holdings = Array.isArray(remote?.holdings) ? remote.holdings : [];
    const familyRows = new Map(FAMILIES.map((item) => [item.key, {
      family: item.key,
      label: item.label,
      rarity: item.rarity,
      buildPoints: item.points,
      tiers: {
        small: { quantity: 0, classId: "", classSlug: "", imageUrl: "", holdings: [] },
        medium: { quantity: 0, classId: "", classSlug: "", imageUrl: "", holdings: [] },
        large: { quantity: 0, classId: "", classSlug: "", imageUrl: "", holdings: [] },
      },
    }]));
    const skinCounts = new Map();
    const skinImages = new Map();

    for (const holding of holdings) {
      const presentation = presentationForHolding(holding);
      const classSlug = String(presentation?.slug || "");
      const className = String(presentation?.name || "");
      const family = normalizeFamily(`${classSlug} ${className}`);
      if (!family || !familyRows.has(family)) continue;
      const quantity = holdingQuantity(holding);
      if (quantity <= 0) continue;
      const imageUrl = String(presentation?.imageUrl || "").trim();
      if (isToyClass(classSlug, className)) {
        const tier = toyTier(classSlug, className);
        if (!["small", "medium", "large"].includes(tier)) continue;
        const tierRow = familyRows.get(family).tiers[tier];
        tierRow.quantity += quantity;
        tierRow.classId ||= String(holding?.classId || presentation?.onchainClassId || "");
        tierRow.classSlug ||= classSlug;
        tierRow.imageUrl ||= imageUrl;
        tierRow.holdings.push({
          id: String(holding?.id || ""),
          classId: String(holding?.classId || presentation?.onchainClassId || ""),
          standard: String(holding?.standard || "").toLowerCase(),
          contractAddress: String(holding?.contractAddress || ""),
          tokenId: String(holding?.tokenId || ""),
          quantity,
          imageUrl,
        });
      } else {
        skinCounts.set(family, (skinCounts.get(family) || 0) + quantity);
        if (!skinImages.get(family)) skinImages.set(family, imageUrl);
      }
    }

    for (const nftClass of classes) {
      const classSlug = String(nftClass?.slug || "");
      const className = String(nftClass?.name || "");
      const family = normalizeFamily(`${classSlug} ${className}`);
      if (!family || !familyRows.has(family)) continue;
      const imageUrl = String(nftClass?.imageUrl || "");
      const onchainClassId = String(nftClass?.onchainClassId || nftClass?.id || "");
      if (isToyClass(classSlug, className)) {
        const tier = toyTier(classSlug, className);
        if (!["small", "medium", "large"].includes(tier)) continue;
        const tierRow = familyRows.get(family).tiers[tier];
        tierRow.classId ||= onchainClassId;
        tierRow.classSlug ||= classSlug;
        tierRow.imageUrl ||= imageUrl;
      } else if (!skinImages.get(family)) {
        skinImages.set(family, imageUrl);
      }
    }

    const skins = FAMILIES
      .filter((item) => (skinCounts.get(item.key) || 0) > 0)
      .map((item) => ({
        family: item.key,
        label: item.label,
        quantity: skinCounts.get(item.key) || 0,
        imageUrl: skinImages.get(item.key) || "",
        rarity: item.rarity,
      }));

    return {
      toys: FAMILIES.map((item) => familyRows.get(item.key)),
      skins,
    };
  }

  function attachUpgradePaths(toys) {
    return toys.map((row) => ({
      ...row,
      craft: {
        medium: { pathKey: TOY_UPGRADE_PATH_KEY, choice: upgradeChoice(row.family, "small") },
        large: { pathKey: TOY_UPGRADE_PATH_KEY, choice: upgradeChoice(row.family, "medium") },
      },
    }));
  }

  function communityFromSummary(summary) {
    const totalPoints = Math.max(0, safeInteger(summary?.totalPoints, 0));
    const contributionCount = Math.max(0, safeInteger(summary?.contributionCount, 0));
    const unlockedMachines = 1 + Math.floor(totalPoints / target);
    const progressPoints = totalPoints % target;
    return {
      target,
      totalPoints,
      progressPoints,
      remainingPoints: progressPoints === 0 && totalPoints > 0 ? target : target - progressPoints,
      unlockedMachines,
      nextMachineNumber: unlockedMachines + 1,
      justUnlockedAtExactTarget: totalPoints > 0 && progressPoints === 0,
      pointsByFamily: Object.fromEntries(FAMILIES.map((item) => [item.key, item.points])),
      contributionCount,
    };
  }

  async function buildState(normalizedWallet) {
    const [remote, workshopState] = await Promise.all([
      loadRemote(normalizedWallet),
      getNetworkWorkshopState(normalizedWallet),
    ]);
    const inventory = buildInventory(remote);
    const preferred = normalizeFamily(workshopState.preference?.equippedSkin || "");
    const equippedSkin = preferred && inventory.skins.some((skin) => skin.family === preferred) ? preferred : "";

    let funding = {
      ready: false,
      credit: null,
      source: null,
      error: "Unavailable",
    };
    try {
      const bucketSlug = String(remote?.bucketSlug || cachedBucketSlug || "").trim();
      if (bucketSlug) {
        const creditResult = await jsonRequest(
          `${normalizedOrigin}/api/buckets/${encodeURIComponent(bucketSlug)}/credits?wallet=${encodeURIComponent(normalizedWallet)}`,
        );
        funding = {
          ready: true,
          credit: creditResult.credit || null,
          source: creditResult.source || "network_base",
          error: "",
        };
      }
    } catch {
      funding = {
        ready: false,
        credit: null,
        source: null,
        error: "Unavailable",
      };
    }

    return {
      ok: true,
      wallet: normalizedWallet,
      bucketSlug: String(remote?.bucketSlug || cachedBucketSlug || ""),
      bucket: null,
      accountCredit: funding.credit,
      funding,
      equippedSkin,
      skins: inventory.skins,
      toys: attachUpgradePaths(inventory.toys),
      community: cacheCommunity(workshopState.community),
      craftCatalogReady: true,
      contributionReady: true,
      source: remote?.source || { ownership: "yokefellow_network_v1_projection" },
    };
  }

  async function getState(wallet, session = null) {
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const key = sessionCacheKey(normalizedWallet, session);
    if (!key) return buildState(normalizedWallet);
    const current = sessionStateCache.get(key);
    if (current?.data) return structuredClone(current.data);
    if (current?.pending) return structuredClone(await current.pending);
    if (current?.error && current.retryAt > Date.now()) throw current.error;
    const pending = buildState(normalizedWallet);
    const expiresAt = session.expiresAt * 1000;
    sessionStateCache.set(key, { pending, expiresAt });
    try {
      const state = await pending;
      if (sessionStateCache.get(key)?.pending === pending) {
        sessionStateCache.set(key, { data: state, expiresAt });
      }
      // Bounded memory regardless of login volume.
      for (const [oldKey, record] of sessionStateCache) {
        if (record.expiresAt <= Date.now()) sessionStateCache.delete(oldKey);
      }
      while (sessionStateCache.size > SESSION_CACHE_LIMIT) {
        sessionStateCache.delete(sessionStateCache.keys().next().value);
      }
      return structuredClone(state);
    } catch (error) {
      if (sessionStateCache.get(key)?.pending === pending) {
        sessionStateCache.set(key, { error, retryAt: Date.now() + SESSION_RETRY_MS, expiresAt });
      }
      throw error;
    }
  }

  async function equipSkin(wallet, familyValue, session = null) {
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const family = normalizeFamily(familyValue);
    const state = await getState(normalizedWallet, session);
    if (family && !state.skins.some((skin) => skin.family === family)) {
      throw new Error("That wallet does not own the selected Coin Skin.");
    }
    const saved = await workshopRequest("/preference", {
      method: "PUT", body: { wallet: normalizedWallet, equippedSkin: family },
    });
    updateSessionSkin(normalizedWallet, session, saved.preference.equippedSkin);
    return { ok: true, equippedSkin: saved.preference.equippedSkin };
  }

  async function craft(wallet, { family: familyValue, fromTier, referenceId }, session = null) {
    requireYokefellow();
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const family = normalizeFamily(familyValue);
    const descriptor = familyDescriptor(family);
    const sourceTier = String(fromTier || "").toLowerCase();
    if (!descriptor) throw new Error("Unknown Rainbow's End Toy family.");
    if (!["small", "medium"].includes(sourceTier)) throw new Error("Craft source tier must be Small or Medium.");
    const targetTier = sourceTier === "small" ? "medium" : "large";
    const reference = validReference(referenceId);
    if (!reference) throw new Error("A stable craft reference is required.");

    const state = await getState(normalizedWallet, session);
    const familyRow = state.toys.find((row) => row.family === family);
    const tierRow = familyRow?.tiers?.[sourceTier];
    if (!tierRow || tierRow.quantity < 3) {
      throw new Error(`You need 3 ${sourceTier} ${descriptor.label} Toys to craft this upgrade.`);
    }

    const choice = upgradeChoice(family, sourceTier);
    if (!choice) throw new Error("This Toy upgrade is not mapped to a Yokefellow Action Path choice.");
    const tokenIds = (Array.isArray(tierRow.holdings) ? tierRow.holdings : [])
      .filter((holding) => String(holding.standard || "").toLowerCase() === "erc721")
      .slice(0, 3)
      .map((holding) => String(holding.tokenId || ""))
      .filter((tokenId) => /^\d+$/.test(tokenId));

    const result = await jsonRequest(actionPathUrl(TOY_UPGRADE_PATH_KEY), {
      method: "POST",
      networkAppApiKey: normalizedAppKey,
      idempotencyKey: reference,
      body: {
        wallet: normalizedWallet,
        requestId: reference,
        choice,
        ...(tokenIds.length ? { tokenIds } : {}),
        meta: {
          source: "rainbows-end-workshop",
          toyFamily: family,
          fromTier: sourceTier,
          targetTier,
        },
      },
    });

    // Confirmed execution changes NFT inventory; refresh only on this action event.
    invalidateSessionState(normalizedWallet, session);
    return {
      ok: true,
      family,
      fromTier: sourceTier,
      targetTier,
      referenceId: reference,
      execution: result,
    };
  }

  async function contribute(wallet, { family: familyValue, referenceId }, session = null) {
    requireYokefellow();
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const family = normalizeFamily(familyValue);
    const descriptor = familyDescriptor(family);
    if (!descriptor) throw new Error("Unknown Rainbow's End Toy family.");
    const reference = validReference(referenceId);
    if (!reference) throw new Error("A stable contribution reference is required.");

    const existingResponse = await workshopRequest(`/contributions?referenceId=${encodeURIComponent(reference)}`);
    const existing = existingResponse.contribution;
    if (existing) {
      if (existing.wallet !== normalizedWallet || existing.family !== family) {
        throw new Error("That contribution reference was already used for different details.");
      }
      // Existing records were written only after Network verified V3's proof.
      if (typeof existing.transactionHash === "string" && /^0x[0-9a-f]{64}$/i.test(existing.transactionHash)) {
        return { ok: true, duplicate: true, contribution: existing, community: await getCommunity() };
      }
      throw new Error("Network returned a contribution without a verified transaction.");
    }

    // V3 can recover the original completed action without re-executing it.
    // This read happens only for an actual contribution or recovery, never login.
    async function recoverConfirmedProof() {
      const recovered = await jsonRequest(
        sdkUrl(`/buckets/${encodeURIComponent(normalizedBucketId)}/action-paths/${encodeURIComponent(COMMUNITY_MACHINE_PATH_KEY)}/executions/${encodeURIComponent(reference)}?wallet=${encodeURIComponent(normalizedWallet)}`),
        { networkAppApiKey: normalizedAppKey },
      );
      if (!recovered?.found || !recovered?.workshopProof) return null;
      if (recovered.path?.key !== COMMUNITY_MACHINE_PATH_KEY ||
          String(recovered.execution?.participantWallet || "").toLowerCase() !== normalizedWallet) {
        throw new Error("Yokefellow returned an execution outside this wallet or Action Path.");
      }
      return recovered;
    }

    const state = await getState(normalizedWallet, session);
    const familyRow = state.toys.find((row) => row.family === family);
    const hasLargeToy = Boolean(familyRow?.tiers?.large?.quantity >= 1);
    let result = null;
    let recovered = null;
    if (!hasLargeToy) {
      // An earlier request may already have consumed the Large Toy while its
      // confirmation write failed. Never require a consumed NFT to be held
      // again merely to recover the original action.
      recovered = await recoverConfirmedProof();
      if (!recovered) {
        throw new Error(`You do not currently hold a Large ${descriptor.label} Toy.`);
      }
    } else {
      try {
        result = await jsonRequest(actionPathUrl(COMMUNITY_MACHINE_PATH_KEY), {
          method: "POST",
          networkAppApiKey: normalizedAppKey,
          idempotencyKey: reference,
          body: {
            wallet: normalizedWallet,
            requestId: reference,
            choice: contributionChoice(family),
            meta: {
              source: "rainbows-end-community-build",
              toyFamily: family,
              points: descriptor.points,
              rarity: descriptor.rarity,
            },
          },
        });
      } catch (error) {
        // Only the same-reference V3 recovered receipt can rescue an
        // uncertain response; no second NFT action or new reference is used.
        recovered = await recoverConfirmedProof().catch(() => null);
        if (!recovered) throw error;
      } finally {
        invalidateSessionState(normalizedWallet, session);
      }
    }

    if (!recovered) recovered = await recoverConfirmedProof();
    if (!recovered) {
      throw new Error("Contribution execution is not yet confirmed. Retry using the same reference.");
    }
    const saved = await workshopRequest("/contributions", {
      method: "POST",
      body: {
        referenceId: reference,
        wallet: normalizedWallet,
        family,
        actionPathKey: COMMUNITY_MACHINE_PATH_KEY,
        executionId: String(recovered.execution.id),
        workshopProof: recovered.workshopProof,
        reused: Boolean(result?.reused || !result),
      },
    });
    invalidateSessionState(normalizedWallet, session);
    return {
      ok: true,
      duplicate: Boolean(saved.duplicate || result?.reused || !result),
      contribution: saved.contribution,
      community: cacheCommunity(saved.community),
    };
  }

  async function resolveBucketSlug(wallet) {
    if (cachedBucketSlug) return cachedBucketSlug;
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const remote = await loadRemote(normalizedWallet);
    const slug = String(remote?.bucketSlug || "").trim();
    if (!slug) throw new Error("Rainbow's End could not resolve its Yokefellow Bucket slug.");
    cachedBucketSlug = slug;
    return slug;
  }

  async function prepareFunding(wallet, { operation, amountYesRaw, referenceId }) {
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const op = String(operation || "").toLowerCase();
    if (!["deposit", "withdrawal"].includes(op)) {
      throw new Error("Funding operation must be deposit or withdrawal.");
    }
    const amount = String(amountYesRaw || "").trim();
    if (!/^[1-9]\d*$/.test(amount)) throw new Error("Funding amount must be greater than zero.");
    const reference = validReference(referenceId);
    if (!reference) throw new Error("A stable funding reference is required.");
    const slug = await resolveBucketSlug(normalizedWallet);
    const pathname = op === "deposit"
      ? `/api/buckets/${encodeURIComponent(slug)}/deposits`
      : `/api/buckets/${encodeURIComponent(slug)}/credits/withdraw`;
    return jsonRequest(`${normalizedOrigin}${pathname}`, {
      method: "POST",
      body: {
        phase: "prepare",
        walletAddress: normalizedWallet,
        amountYesRaw: amount,
        referenceId: reference,
      },
    });
  }

  async function fundingStatus(wallet, { operation, referenceId }) {
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const op = String(operation || "").toLowerCase();
    if (!["deposit", "withdrawal"].includes(op)) {
      throw new Error("Funding operation must be deposit or withdrawal.");
    }
    const reference = validReference(referenceId);
    if (!reference) throw new Error("A stable funding reference is required.");
    const slug = await resolveBucketSlug(normalizedWallet);
    const pathname = op === "deposit"
      ? `/api/buckets/${encodeURIComponent(slug)}/deposits`
      : `/api/buckets/${encodeURIComponent(slug)}/credits/withdraw`;
    return jsonRequest(`${normalizedOrigin}${pathname}`, {
      method: "POST",
      body: {
        phase: "status",
        walletAddress: normalizedWallet,
        referenceId: reference,
      },
    });
  }

  async function getCommunity() {
    if (communityCache && Date.now() < communityCache.expiresAt) return communityCache.value;
    if (communityPending) return communityPending;
    communityPending = workshopRequest("/community").then((body) => cacheCommunity(body.community));
    try { return await communityPending; }
    finally { communityPending = null; }
  }

  return {
    families: FAMILIES.map((item) => ({ ...item })),
    buildTarget: target,
    contributionSignerAddress: null,
    getState,
    equipSkin,
    craft,
    contribute,
    prepareFunding,
    fundingStatus,
    getCommunity,
  };
}