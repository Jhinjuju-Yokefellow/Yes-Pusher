import fs from "node:fs/promises";
import path from "node:path";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  keccak256,
} from "ethers";

const FAMILIES = [
  { key: "four_leaf_clover", label: "Four Leaf Clover", rarity: 1, points: 1 },
  { key: "horseshoe", label: "Horseshoe", rarity: 2, points: 2 },
  { key: "leprechaun", label: "Leprechaun", rarity: 3, points: 3 },
  { key: "pot_of_gold", label: "Pot of Gold", rarity: 4, points: 4 },
  { key: "treasure_chest", label: "Treasure Chest", rarity: 5, points: 5 },
];

const ACTION_BURN = 1n << 2n;
const collection1155Abi = [
  "function balanceOf(address account, uint256 tokenId) view returns (uint256)",
  "function approvedBurners(address account) view returns (bool)",
  "function authorityActions(address account) view returns (uint256)",
  "function burn(address from, uint256 tokenId, uint256 amount)",
];
const collection721Abi = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function approvedBurners(address account) view returns (bool)",
  "function authorityActions(address account) view returns (uint256)",
  "function burn(uint256 tokenId)",
];

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
    .replace(/[-.\\s/]+/g, "_");
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

function classMatchesRule(nftClass, ruleClassKey) {
  const key = String(ruleClassKey || "").trim();
  return key && (String(nftClass?.id || "") === key || String(nftClass?.slug || "") === key);
}

function holdingImage(holding) {
  return String(holding?.meta?.imageUrl || holding?.imageUrl || "").trim();
}

function safeInteger(value, fallback = 0) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? number : fallback;
}

function validReference(value) {
  const ref = String(value || "").trim();
  return ref.length >= 8 && ref.length <= 160 ? ref : "";
}

async function readJsonFile(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, filePath);
}

async function jsonRequest(url, { method = "GET", appApiKey = "", idempotencyKey = "", body = null } = {}) {
  const headers = { Accept: "application/json" };
  if (appApiKey) headers["X-YF-App-Key"] = appApiKey;
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
  bucketId,
  appApiKey,
  rpcUrl,
  chainId,
  contributionPrivateKey,
  statePath,
  buildTarget = 50,
}) {
  const normalizedOrigin = String(yokefellowOrigin || "").replace(/\/+$/, "");
  const normalizedBucketId = String(bucketId || "").trim();
  const normalizedAppKey = String(appApiKey || "").trim();
  const normalizedStatePath = statePath || path.join(process.cwd(), ".local", "yd4-workshop-state.json");
  const target = Math.max(1, safeInteger(buildTarget, 50));

  let contributionProvider = null;
  let contributionSigner = null;
  let contributionLock = Promise.resolve();
  let cachedBucketSlug = "";
  if (/^0x[a-fA-F0-9]{64}$/.test(String(contributionPrivateKey || "").trim())) {
    contributionProvider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    contributionSigner = new Wallet(String(contributionPrivateKey).trim(), contributionProvider);
  }

  async function readStateFile() {
    const state = await readJsonFile(normalizedStatePath);
    return {
      version: 1,
      preferences: state.preferences && typeof state.preferences === "object" ? state.preferences : {},
      contributions: state.contributions && typeof state.contributions === "object" ? state.contributions : {},
    };
  }

  async function saveStateFile(state) {
    await writeJsonFile(normalizedStatePath, state);
  }

  function requireYokefellow() {
    if (!normalizedOrigin || !normalizedBucketId || !normalizedAppKey) {
      throw new Error("Rainbow's End workshop is not connected to its Yokefellow Bucket/App key.");
    }
  }

  function sdkUrl(pathname) {
    return `${normalizedOrigin}/api/sdk/v1${pathname}`;
  }

  async function loadRemote(wallet) {
    requireYokefellow();
    const encodedBucket = encodeURIComponent(normalizedBucketId);
    const encodedWallet = encodeURIComponent(wallet);
    const [catalog, entitlements] = await Promise.all([
      jsonRequest(sdkUrl(`/buckets/${encodedBucket}/catalog?wallet=${encodedWallet}`), { appApiKey: normalizedAppKey }),
      jsonRequest(sdkUrl(`/wallets/${encodedWallet}/entitlements?bucketId=${encodedBucket}`), { appApiKey: normalizedAppKey }),
    ]);

    // The existing public Bucket offerings read exposes the saved craft rule IDs
    // that the atomic craft SDK needs. Merge those rules into the SDK catalog
    // response so Rainbow's End never hard-codes database identifiers.
    const bucketSlug = String(catalog?.bucketSlug || catalog?.bucket?.slug || "").trim();
    if (bucketSlug) {
      cachedBucketSlug = bucketSlug;
      try {
        const full = await jsonRequest(
          `${normalizedOrigin}/api/buckets/${encodeURIComponent(bucketSlug)}/offerings`,
        );
        const fullById = new Map(
          (Array.isArray(full?.offerings) ? full.offerings : [])
            .map((offering) => [String(offering?.id || ""), offering]),
        );
        catalog.offerings = (Array.isArray(catalog?.offerings) ? catalog.offerings : []).map((offering) => {
          const fullOffering = fullById.get(String(offering?.id || ""));
          return fullOffering
            ? { ...offering, craftRules: Array.isArray(fullOffering.craftRules) ? fullOffering.craftRules : [] }
            : offering;
        });
      } catch {
        // Keep the SDK catalog usable for collection display. Craft buttons will
        // remain disabled until recipe details can be read.
      }
    }

    return { catalog, entitlements };
  }

  function buildInventory(catalog, entitlements) {
    const classes = Array.isArray(catalog?.classes) ? catalog.classes : [];
    const holdings = Array.isArray(entitlements?.walletState?.ownedMints)
      ? entitlements.walletState.ownedMints.filter((holding) => String(holding?.status || "current").toLowerCase() === "current")
      : [];
    const classesById = new Map(classes.map((item) => [String(item?.id || ""), item]));
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
      const classSlug = String(holding?.classSlug || "");
      const className = String(holding?.className || "");
      const family = normalizeFamily(`${classSlug} ${className}`);
      if (!family || !familyRows.has(family)) continue;
      const quantity = Math.max(1, safeInteger(holding?.quantity, 1));
      if (isToyClass(classSlug, className)) {
        const tier = toyTier(classSlug, className);
        if (!["small", "medium", "large"].includes(tier)) continue;
        const row = familyRows.get(family);
        const tierRow = row.tiers[tier];
        tierRow.quantity += quantity;
        tierRow.classId ||= String(holding?.classId || "");
        tierRow.classSlug ||= classSlug;
        tierRow.imageUrl ||= holdingImage(holding);
        tierRow.holdings.push({
          id: String(holding?.id || ""),
          classId: String(holding?.classId || ""),
          standard: String(holding?.standard || "").toLowerCase(),
          contractAddress: String(holding?.contractAddress || ""),
          tokenId: String(holding?.tokenId || ""),
          quantity,
          imageUrl: holdingImage(holding),
        });
      } else {
        skinCounts.set(family, (skinCounts.get(family) || 0) + quantity);
        if (!skinImages.get(family)) skinImages.set(family, holdingImage(holding));
      }
    }

    for (const nftClass of classes) {
      const classSlug = String(nftClass?.slug || "");
      const className = String(nftClass?.name || "");
      const family = normalizeFamily(`${classSlug} ${className}`);
      if (!family || !familyRows.has(family)) continue;
      const imageUrl = String(nftClass?.imageUrl || "");
      if (isToyClass(classSlug, className)) {
        const tier = toyTier(classSlug, className);
        if (!["small", "medium", "large"].includes(tier)) continue;
        const tierRow = familyRows.get(family).tiers[tier];
        tierRow.classId ||= String(nftClass?.id || "");
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
      classes,
      classesById,
      holdings,
      toys: FAMILIES.map((item) => familyRows.get(item.key)),
      skins,
    };
  }

  function resolveRecipes(catalog, inventory) {
    const offerings = Array.isArray(catalog?.offerings) ? catalog.offerings : [];
    const recipes = {};
    for (const family of FAMILIES) recipes[family.key] = { medium: null, large: null };

    for (const offering of offerings) {
      if (String(offering?.mode || "").toLowerCase() !== "craft") continue;
      if (String(offering?.status || "").toLowerCase() !== "live") continue;
      const rules = Array.isArray(offering?.craftRules) ? offering.craftRules : [];
      const outputs = Array.isArray(offering?.outputs) ? offering.outputs : [];
      for (const output of outputs) {
        const outputClass = inventory.classesById.get(String(output?.itemClassId || ""));
        if (!outputClass) continue;
        const family = normalizeFamily(`${outputClass.slug || ""} ${outputClass.name || ""}`);
        const targetTier = toyTier(outputClass.slug, outputClass.name);
        if (!family || !["medium", "large"].includes(targetTier)) continue;
        const fromTier = targetTier === "medium" ? "small" : "medium";
        const matchingRules = rules.filter((rule) => {
          if (rule?.outputId && String(rule.outputId) !== String(output?.id || "")) return false;
          const inputClass = inventory.classes.find((candidate) => classMatchesRule(candidate, rule?.classKey));
          if (!inputClass) return false;
          const inputFamily = normalizeFamily(`${inputClass.slug || ""} ${inputClass.name || ""}`);
          return inputFamily === family
            && toyTier(inputClass.slug, inputClass.name) === fromTier
            && safeInteger(rule?.quantity, 0) === 3
            && String(rule?.inputKind || "") === "burn_required";
        });
        if (matchingRules.length !== 1) continue;
        const rule = matchingRules[0];
        const sourceClass = inventory.classes.find((candidate) => classMatchesRule(candidate, rule.classKey));
        recipes[family][targetTier] = {
          offeringId: String(offering.id || ""),
          offeringTitle: String(offering.title || ""),
          outputId: String(output.id || ""),
          outputClassId: String(output.itemClassId || ""),
          ruleId: String(rule.id || ""),
          inputClassId: String(sourceClass?.id || ""),
          inputClassSlug: String(sourceClass?.slug || ""),
          fromTier,
          targetTier,
        };
      }
    }
    return recipes;
  }

  function communityFromState(state) {
    const confirmed = Object.values(state.contributions).filter((entry) => entry?.status === "confirmed");
    const totalPoints = confirmed.reduce((sum, entry) => sum + Math.max(0, safeInteger(entry?.points, 0)), 0);
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
      contributionCount: confirmed.length,
    };
  }

  async function getState(wallet) {
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const [{ catalog, entitlements }, localState] = await Promise.all([
      loadRemote(normalizedWallet),
      readStateFile(),
    ]);
    const inventory = buildInventory(catalog, entitlements);
    const recipes = resolveRecipes(catalog, inventory);
    const preferred = normalizeFamily(localState.preferences?.[normalizedWallet]?.equippedSkin || "");
    const equippedSkin = preferred && inventory.skins.some((skin) => skin.family === preferred) ? preferred : "";

    let funding = {
      ready: false,
      credit: null,
      source: null,
      error: "Participant funding is waiting for Yokefellow Network.",
    };
    try {
      const bucketSlug = String(catalog?.bucketSlug || cachedBucketSlug || "").trim();
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
    } catch (error) {
      funding = {
        ready: false,
        credit: null,
        source: null,
        error: error instanceof Error ? error.message : "Participant funding is unavailable.",
      };
    }

    return {
      ok: true,
      wallet: normalizedWallet,
      bucketSlug: String(catalog?.bucketSlug || cachedBucketSlug || ""),
      bucket: catalog?.bucket || null,
      accountCredit: entitlements?.accountCredit || catalog?.commerce?.bucketCredit || null,
      funding,
      equippedSkin,
      skins: inventory.skins,
      toys: inventory.toys.map((row) => ({
        ...row,
        craft: {
          medium: recipes[row.family]?.medium || null,
          large: recipes[row.family]?.large || null,
        },
      })),
      community: communityFromState(localState),
      craftCatalogReady: Object.values(recipes).some((row) => row.medium || row.large),
      contributionReady: Boolean(contributionSigner && contributionProvider),
    };
  }

  async function equipSkin(wallet, familyValue) {
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const family = normalizeFamily(familyValue);
    const state = await getState(normalizedWallet);
    if (family && !state.skins.some((skin) => skin.family === family)) {
      throw new Error("That wallet does not own the selected Coin Skin.");
    }
    const localState = await readStateFile();
    localState.preferences[normalizedWallet] = {
      ...(localState.preferences[normalizedWallet] || {}),
      equippedSkin: family,
      updatedAt: new Date().toISOString(),
    };
    await saveStateFile(localState);
    return { ok: true, equippedSkin: family };
  }

  async function craft(wallet, { family: familyValue, fromTier, referenceId }) {
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const family = normalizeFamily(familyValue);
    const sourceTier = String(fromTier || "").toLowerCase();
    if (!familyDescriptor(family)) throw new Error("Unknown Rainbow's End Toy family.");
    if (!["small", "medium"].includes(sourceTier)) throw new Error("Craft source tier must be Small or Medium.");
    const targetTier = sourceTier === "small" ? "medium" : "large";
    const reference = validReference(referenceId);
    if (!reference) throw new Error("A stable craft reference is required.");

    const state = await getState(normalizedWallet);
    const familyRow = state.toys.find((row) => row.family === family);
    const tierRow = familyRow?.tiers?.[sourceTier];
    if (!tierRow || tierRow.quantity < 3) {
      throw new Error(`You need 3 ${sourceTier} ${familyDescriptor(family).label} Toys to craft this upgrade.`);
    }
    const recipe = familyRow?.craft?.[targetTier];
    if (!recipe) {
      throw new Error(`The ${familyDescriptor(family).label} ${sourceTier} → ${targetTier} craft Path is not live in Yokefellow yet.`);
    }

    const inputHoldings = Array.isArray(tierRow.holdings) ? tierRow.holdings : [];
    const firstStandard = String(inputHoldings[0]?.standard || "").toLowerCase();
    const tokenIds = firstStandard === "erc721"
      ? inputHoldings.slice(0, 3).map((holding) => String(holding.tokenId || "")).filter(Boolean)
      : undefined;
    if (firstStandard === "erc721" && tokenIds.length !== 3) {
      throw new Error("Three indexed ERC-721 Toy token IDs are required for this craft.");
    }

    const result = await jsonRequest(
      sdkUrl(`/buckets/${encodeURIComponent(normalizedBucketId)}/offerings/craft`),
      {
        method: "POST",
        appApiKey: normalizedAppKey,
        idempotencyKey: reference,
        body: {
          wallet: normalizedWallet,
          offeringId: recipe.offeringId,
          referenceId: reference,
          selectedOutputId: recipe.outputId,
          inputs: [{
            ruleId: recipe.ruleId,
            ...(tokenIds ? { tokenIds } : {}),
          }],
          meta: {
            source: "rainbows-end-workshop",
            toyFamily: family,
            fromTier: sourceTier,
            targetTier,
          },
        },
      },
    );
    return {
      ok: true,
      family,
      fromTier: sourceTier,
      targetTier,
      referenceId: reference,
      execution: result,
    };
  }

  async function signerCanBurn(contract) {
    if (!contributionSigner) return false;
    try {
      if (await contract.approvedBurners(contributionSigner.address)) return true;
    } catch {
      // V2 collections use authorityActions instead of the legacy approvedBurners getter.
    }
    try {
      const actions = await contract.authorityActions(contributionSigner.address);
      return (BigInt(actions) & ACTION_BURN) === ACTION_BURN;
    } catch {
      return false;
    }
  }

  async function prepareContribution(wallet, family) {
    const state = await getState(wallet);
    const familyRow = state.toys.find((row) => row.family === family);
    const large = familyRow?.tiers?.large;
    if (!large || large.quantity < 1 || !large.holdings?.length) {
      throw new Error(`You do not currently hold a Large ${familyDescriptor(family).label} Toy.`);
    }
    const holding = large.holdings.find((item) => item.standard === "erc721")
      || large.holdings.find((item) => item.standard === "erc1155" && item.quantity > 0)
      || large.holdings[0];
    const standard = String(holding.standard || "").toLowerCase();
    if (!["erc721", "erc1155"].includes(standard)) throw new Error("Unsupported Toy NFT standard.");
    const contractAddress = getAddress(holding.contractAddress);
    if (!/^\d+$/.test(String(holding.tokenId || ""))) throw new Error("The Large Toy token ID is not indexed yet.");
    return {
      state,
      holding,
      standard,
      contractAddress,
      tokenId: String(holding.tokenId),
    };
  }

  async function resumeContribution(localState, entry) {
    if (!contributionProvider || !entry.rawTransaction || !entry.txHash) {
      throw new Error("The contribution transaction was not prepared correctly.");
    }
    let receipt = await contributionProvider.getTransactionReceipt(entry.txHash);
    if (!receipt) {
      try {
        await contributionProvider.broadcastTransaction(entry.rawTransaction);
      } catch (error) {
        const existing = await contributionProvider.getTransaction(entry.txHash);
        if (!existing) throw error;
      }
      receipt = await contributionProvider.waitForTransaction(entry.txHash, 1, 120_000);
    }
    if (!receipt || Number(receipt.status) !== 1) {
      entry.status = "failed";
      entry.error = "The Large Toy contribution burn failed onchain.";
      entry.updatedAt = new Date().toISOString();
      await saveStateFile(localState);
      throw new Error(entry.error);
    }
    entry.status = "confirmed";
    entry.blockNumber = String(receipt.blockNumber);
    entry.updatedAt = new Date().toISOString();
    await saveStateFile(localState);
    return entry;
  }

  async function contribute(wallet, { family: familyValue, referenceId }) {
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const family = normalizeFamily(familyValue);
    const descriptor = familyDescriptor(family);
    if (!descriptor) throw new Error("Unknown Rainbow's End Toy family.");
    const reference = validReference(referenceId);
    if (!reference) throw new Error("A stable contribution reference is required.");
    if (!contributionSigner || !contributionProvider) {
      throw new Error("The community-build approved-burner signer is not configured.");
    }

    const run = async () => {
      const localState = await readStateFile();
      const existing = localState.contributions[reference];
      if (existing) {
        if (existing.wallet !== normalizedWallet || existing.family !== family) {
          throw new Error("That contribution reference was already used for different details.");
        }
        if (existing.status === "confirmed") {
          return { ok: true, duplicate: true, contribution: existing, community: communityFromState(localState) };
        }
        if (existing.status === "prepared" || existing.status === "submitted") {
          const completed = await resumeContribution(localState, existing);
          return { ok: true, duplicate: true, contribution: completed, community: communityFromState(localState) };
        }
        if (existing.status === "failed") throw new Error(existing.error || "That contribution previously failed.");
      }

      const prepared = await prepareContribution(normalizedWallet, family);
      const abi = prepared.standard === "erc721" ? collection721Abi : collection1155Abi;
      const contract = new Contract(prepared.contractAddress, abi, contributionSigner);
      if (!await signerCanBurn(contract)) {
        throw new Error(`Contribution signer ${contributionSigner.address} is not approved to burn this Toy collection.`);
      }

      if (prepared.standard === "erc721") {
        const owner = String(await contract.ownerOf(BigInt(prepared.tokenId))).toLowerCase();
        if (owner !== normalizedWallet) throw new Error("The wallet no longer owns that Large Toy.");
      } else {
        const balance = await contract.balanceOf(normalizedWallet, BigInt(prepared.tokenId));
        if (BigInt(balance) < 1n) throw new Error("The wallet no longer owns that Large Toy.");
      }

      const call = prepared.standard === "erc721"
        ? await contract.burn.populateTransaction(BigInt(prepared.tokenId))
        : await contract.burn.populateTransaction(normalizedWallet, BigInt(prepared.tokenId), 1n);
      const populated = await contributionSigner.populateTransaction(call);
      const rawTransaction = await contributionSigner.signTransaction(populated);
      const txHash = keccak256(rawTransaction);
      const now = new Date().toISOString();
      const entry = {
        referenceId: reference,
        wallet: normalizedWallet,
        family,
        points: descriptor.points,
        rarity: descriptor.rarity,
        standard: prepared.standard,
        contractAddress: prepared.contractAddress,
        tokenId: prepared.tokenId,
        txHash,
        rawTransaction,
        status: "prepared",
        createdAt: now,
        updatedAt: now,
      };
      localState.contributions[reference] = entry;
      await saveStateFile(localState);

      const completed = await resumeContribution(localState, entry);
      return { ok: true, duplicate: false, contribution: completed, community: communityFromState(localState) };
    };

    const next = contributionLock.then(run, run);
    contributionLock = next.catch(() => undefined);
    return next;
  }

  async function resolveBucketSlug(wallet) {
    if (cachedBucketSlug) return cachedBucketSlug;
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const remote = await loadRemote(normalizedWallet);
    const slug = String(remote?.catalog?.bucketSlug || "").trim();
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
    return communityFromState(await readStateFile());
  }

  return {
    families: FAMILIES.map((item) => ({ ...item })),
    buildTarget: target,
    contributionSignerAddress: contributionSigner?.address || null,
    getState,
    equipSkin,
    craft,
    contribute,
    prepareFunding,
    fundingStatus,
    getCommunity,
  };
}
