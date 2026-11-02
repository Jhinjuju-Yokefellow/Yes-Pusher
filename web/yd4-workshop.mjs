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
  // Ownership is deliberately an hourly read model, not a per-visitor DB query.
  // Coalesce concurrent requests and cap the number of wallets retained in memory.
  const ownershipCache = new Map();
  const OWNERSHIP_CACHE_LIMIT = 256;
  const HOUR_MS = 60 * 60 * 1000;
  const RETRY_MS = 60 * 1000;

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
    const hour = Math.floor(Date.now() / HOUR_MS);
    const existing = ownershipCache.get(wallet);
    if (existing && existing.hour === hour && existing.data) return existing.data;
    if (existing && existing.hour === hour && existing.pending) return existing.pending;
    if (existing && existing.hour === hour && existing.error && Date.now() < existing.retryAt) throw existing.error;

    const pending = (async () => {
      const encodedBucket = encodeURIComponent(normalizedBucketId);
      const encodedWallet = encodeURIComponent(wallet);
      const holdings = await jsonRequest(
        sdkUrl(`/buckets/${encodedBucket}/holdings/${encodedWallet}`),
        { networkAppApiKey: normalizedAppKey },
      );
      if (holdings?.complete === false) throw new Error("V3 hourly NFT ownership is not yet available.");
      const bucketSlug = String(holdings?.bucketSlug || "").trim();
      if (bucketSlug) cachedBucketSlug = bucketSlug;
      if (ownershipCache.get(wallet)?.hour === hour) {
        ownershipCache.set(wallet, { hour, data: holdings });
      }
      return holdings;
    })();
    ownershipCache.set(wallet, { hour, pending });
    while (ownershipCache.size > OWNERSHIP_CACHE_LIMIT) {
      ownershipCache.delete(ownershipCache.keys().next().value);
    }
    try {
      return await pending;
    } catch (error) {
      // Avoid a failed V3 read becoming a new request storm from active players.
      if (ownershipCache.get(wallet)?.hour === hour) {
        ownershipCache.set(wallet, { hour, error, retryAt: Date.now() + RETRY_MS });
      }
      throw error;
    }
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

  async function getState(wallet) {
    const normalizedWallet = getAddress(wallet).toLowerCase();
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

  async function equipSkin(wallet, familyValue) {
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const family = normalizeFamily(familyValue);
    const state = await getState(normalizedWallet);
    if (family && !state.skins.some((skin) => skin.family === family)) {
      throw new Error("That wallet does not own the selected Coin Skin.");
    }
    const saved = await workshopRequest("/preference", {
      method: "PUT", body: { wallet: normalizedWallet, equippedSkin: family },
    });
    return { ok: true, equippedSkin: saved.preference.equippedSkin };
  }

  async function craft(wallet, { family: familyValue, fromTier, referenceId }) {
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

    const state = await getState(normalizedWallet);
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

    return {
      ok: true,
      family,
      fromTier: sourceTier,
      targetTier,
      referenceId: reference,
      execution: result,
    };
  }

  async function contribute(wallet, { family: familyValue, referenceId }) {
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
      if (existing.status === "confirmed") {
        return { ok: true, duplicate: true, contribution: existing, community: await getCommunity() };
      }
    }

    const state = await getState(normalizedWallet);
    const familyRow = state.toys.find((row) => row.family === family);
    if (!familyRow?.tiers?.large || familyRow.tiers.large.quantity < 1) {
      throw new Error(`You do not currently hold a Large ${descriptor.label} Toy.`);
    }

    const result = await jsonRequest(actionPathUrl(COMMUNITY_MACHINE_PATH_KEY), {
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

    const saved = await workshopRequest("/contributions", {
      method: "POST",
      body: {
        referenceId: reference,
        wallet: normalizedWallet,
        family,
        actionPathKey: COMMUNITY_MACHINE_PATH_KEY,
        executionId: String(result?.execution?.id || result?.execution?.executionId || ""),
        reused: Boolean(result?.reused),
      },
    });
    return {
      ok: true,
      duplicate: Boolean(saved.duplicate || result?.reused),
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