import fs from "node:fs/promises";
import path from "node:path";
import { getAddress } from "ethers";

const FAMILIES = [
  { key: "four_leaf_clover", label: "Four Leaf Clover", rarity: 1, points: 1 },
  { key: "horseshoe", label: "Horseshoe", rarity: 2, points: 2 },
  { key: "leprechaun", label: "Leprechaun", rarity: 3, points: 3 },
  { key: "pot_of_gold", label: "Pot of Gold", rarity: 4, points: 4 },
  { key: "treasure_chest", label: "Treasure Chest", rarity: 5, points: 5 },
];

const TERMINAL_ACTION_STATUSES = new Set([
  "confirmed",
  "recovered",
  "readable",
  "projected",
  "indexed",
]);

function normalizeFamily(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[-.\s/]+/g, "_");
  if (text.includes("four_leaf_clover") || text.includes("fourleafclover") || text === "clover") return "four_leaf_clover";
  if (text.includes("pot_of_gold") || text.includes("potofgold")) return "pot_of_gold";
  if (text.includes("treasure_chest") || text.includes("treasurechest")) return "treasure_chest";
  if (text.includes("horseshoe")) return "horseshoe";
  if (text.includes("leprechaun")) return "leprechaun";
  return "";
}

function toyTier(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[-.\s/]+/g, "_");
  if (/(^|_)l3($|_)/.test(text) || text.includes("level_3") || text.includes("large")) return "large";
  if (/(^|_)l2($|_)/.test(text) || text.includes("level_2") || text.includes("medium")) return "medium";
  if (/(^|_)l1($|_)/.test(text) || text.includes("level_1") || text.includes("small")) return "small";
  return "";
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
  return ref.length >= 8 && ref.length <= 256 ? ref : "";
}

function normalizedClassId(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(text) ? text : "";
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

function emptyFamilyRows() {
  return new Map(FAMILIES.map((item) => [item.key, {
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
}

function buildCapabilityCatalog(capabilities) {
  const classById = new Map();
  const recipes = Object.fromEntries(
    FAMILIES.map((family) => [family.key, { medium: null, large: null }]),
  );
  const contributionActionKeys = {};

  function registerClass(classIdValue, classKeyValue, source = "") {
    const classId = normalizedClassId(classIdValue);
    const classKey = String(classKeyValue || "").trim();
    if (!classId || !classKey) return;
    const family = normalizeFamily(classKey);
    if (!family) return;
    const tier = toyTier(classKey);
    classById.set(classId, {
      classId,
      classKey,
      family,
      tier,
      kind: tier ? "toy" : "skin",
      source,
    });
  }

  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const descriptor = capability?.descriptor && typeof capability.descriptor === "object"
      ? capability.descriptor
      : {};

    registerClass(
      descriptor?.asset?.classId,
      descriptor?.classKey,
      capability.key,
    );

    for (const result of Array.isArray(descriptor?.results) ? descriptor.results : []) {
      registerClass(
        result?.asset?.classId,
        result?.classKey || result?.externalOutputKey,
        capability.key,
      );
    }

    for (const input of Array.isArray(descriptor?.craftInputs) ? descriptor.craftInputs : []) {
      registerClass(
        input?.asset?.classId,
        input?.classKey,
        capability.key,
      );
    }

    if (String(descriptor?.mode || "").toLowerCase() === "craft") {
      const targetFamily = normalizeFamily(descriptor?.classKey);
      const targetTier = toyTier(descriptor?.classKey);
      const inputs = Array.isArray(descriptor?.craftInputs) ? descriptor.craftInputs : [];
      if (
        targetFamily
        && ["medium", "large"].includes(targetTier)
        && inputs.length > 0
      ) {
        const sourceFamily = normalizeFamily(inputs[0]?.classKey);
        const sourceTier = toyTier(inputs[0]?.classKey);
        const expectedSource = targetTier === "medium" ? "small" : "medium";
        if (
          sourceFamily === targetFamily
          && sourceTier === expectedSource
          && inputs.every((item) => safeInteger(item?.quantity, 0) > 0)
        ) {
          recipes[targetFamily][targetTier] = {
            actionKey: String(capability.key || ""),
            fromTier: sourceTier,
            targetTier,
            inputCount: inputs.length,
            inputs: inputs.map((item) => ({
              classKey: String(item?.classKey || ""),
              quantity: safeInteger(item?.quantity, 1),
              classId: normalizedClassId(item?.asset?.classId),
            })),
            outputClassKey: String(descriptor?.classKey || ""),
            outputClassId: normalizedClassId(descriptor?.asset?.classId),
          };
        }
      }
    }

    if (String(descriptor?.source || "") === "yes_drop.community_build") {
      const family = normalizeFamily(descriptor?.family || descriptor?.classKey);
      if (family) contributionActionKeys[family] = String(capability.key || "");
    }
  }

  return { classById, recipes, contributionActionKeys };
}

function buildInventory(catalog, holdings) {
  const familyRows = emptyFamilyRows();
  const skinCounts = new Map();
  const skinImages = new Map();

  for (const meta of catalog.classById.values()) {
    if (meta.kind !== "toy" || !meta.tier) continue;
    const row = familyRows.get(meta.family);
    if (!row) continue;
    row.tiers[meta.tier].classId ||= meta.classId;
    row.tiers[meta.tier].classSlug ||= meta.classKey;
  }

  for (const holding of Array.isArray(holdings) ? holdings : []) {
    const classId = normalizedClassId(holding?.classId);
    const meta = catalog.classById.get(classId);
    if (!meta) continue;
    const quantity = Math.max(0, safeInteger(holding?.quantity, 0));
    if (quantity <= 0) continue;

    if (meta.kind === "toy" && meta.tier) {
      const row = familyRows.get(meta.family);
      if (!row) continue;
      const tierRow = row.tiers[meta.tier];
      tierRow.quantity += quantity;
      tierRow.classId ||= classId;
      tierRow.classSlug ||= meta.classKey;
      tierRow.holdings.push({
        classId,
        classSlug: meta.classKey,
        standard: String(holding?.standard || "").toLowerCase(),
        tokenId: holding?.tokenId === null ? "" : String(holding?.tokenId || ""),
        quantity,
        metadataURI: String(holding?.metadataURI || ""),
      });
      continue;
    }

    skinCounts.set(meta.family, (skinCounts.get(meta.family) || 0) + quantity);
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

function actionError(action, fallback) {
  return String(
    action?.error?.message
    || action?.error?.code
    || fallback
    || "The Network action did not complete.",
  );
}

export function createWorkshopService({
  network,
  statePath,
  buildTarget = 50,
}) {
  const normalizedStatePath = statePath
    || path.join(process.cwd(), ".local", "yd8-workshop-state.json");
  const target = Math.max(1, safeInteger(buildTarget, 50));

  function requireNetwork() {
    if (!network?.configured?.()) {
      const error = new Error("Unavailable");
      error.statusCode = 503;
      throw error;
    }
  }

  async function readStateFile() {
    const state = await readJsonFile(normalizedStatePath);
    return {
      version: 2,
      preferences:
        state.preferences && typeof state.preferences === "object"
          ? state.preferences
          : {},
      contributions:
        state.contributions && typeof state.contributions === "object"
          ? state.contributions
          : {},
    };
  }

  async function saveStateFile(state) {
    await writeJsonFile(normalizedStatePath, state);
  }

  function communityFromState(state) {
    const contributions = Object.values(state.contributions || {})
      .filter((entry) => entry?.status === "confirmed");
    const progressPoints = contributions.reduce(
      (sum, entry) => sum + safeInteger(entry?.points, 0),
      0,
    );
    return {
      progressPoints,
      target,
      remainingPoints: Math.max(0, target - progressPoints),
      complete: progressPoints >= target,
      nextMachineNumber: 2,
      contributionCount: contributions.length,
    };
  }

  async function loadRemote(wallet) {
    requireNetwork();
    const [capabilityResult, holdingsResult] = await Promise.all([
      network.listCapabilities(),
      network.holdings(wallet, { limit: 200 }),
    ]);
    const catalog = buildCapabilityCatalog(capabilityResult?.capabilities || []);
    const inventory = buildInventory(catalog, holdingsResult?.holdings || []);
    return { catalog, inventory };
  }

  async function getState(wallet, _participantSessionToken = "") {
    requireNetwork();
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const [{ catalog, inventory }, localState, creditResult] = await Promise.all([
      loadRemote(normalizedWallet),
      readStateFile(),
      network.getCredit(normalizedWallet).catch(() => null),
    ]);

    const preferred = normalizeFamily(
      localState.preferences?.[normalizedWallet]?.equippedSkin || "",
    );
    const equippedSkin = preferred
      && inventory.skins.some((skin) => skin.family === preferred)
      ? preferred
      : "";

    const fundingCredit = creditResult?.credit || null;
    const contributionReady = FAMILIES.every(
      (family) => Boolean(catalog.contributionActionKeys[family.key]),
    );

    return {
      ok: true,
      wallet: normalizedWallet,
      bucketSlug: "YES drop",
      bucket: { networkBucketId: network.bucketId },
      accountCredit: fundingCredit,
      funding: {
        ready: Boolean(fundingCredit),
        credit: fundingCredit,
        source: fundingCredit ? "yokefellow_network" : null,
        error: fundingCredit ? "" : "Unavailable",
      },
      equippedSkin,
      skins: inventory.skins,
      toys: inventory.toys.map((row) => ({
        ...row,
        craft: {
          medium: catalog.recipes[row.family]?.medium || null,
          large: catalog.recipes[row.family]?.large || null,
        },
      })),
      community: communityFromState(localState),
      craftCatalogReady: Object.values(catalog.recipes).some(
        (row) => row.medium || row.large,
      ),
      contributionReady,
    };
  }

  async function equipSkin(wallet, familyValue, participantSessionToken = "") {
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const family = normalizeFamily(familyValue);
    const state = await getState(normalizedWallet, participantSessionToken);
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

  async function settleAction(action) {
    if (!action) throw new Error("The Network did not return an action.");
    if (TERMINAL_ACTION_STATUSES.has(action.status)) return action;
    if (action.status === "failed") {
      throw new Error(actionError(action));
    }

    if (action.actionId) {
      const reconciled = await network.reconcileAction(action.actionId)
        .then((result) => result?.action || null)
        .catch(() => null);
      if (reconciled) {
        if (TERMINAL_ACTION_STATUSES.has(reconciled.status)) return reconciled;
        if (reconciled.status === "failed") {
          throw new Error(actionError(reconciled));
        }
        action = reconciled;
      }
    }

    const error = new Error(
      actionError(
        action,
        "The Network action is still reconciling. Retry with the same reference.",
      ),
    );
    error.statusCode = 409;
    error.action = action;
    throw error;
  }

  async function craft(
    wallet,
    { family: familyValue, fromTier, referenceId },
    participantSessionToken = "",
  ) {
    requireNetwork();
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const family = normalizeFamily(familyValue);
    const sourceTier = String(fromTier || "").trim().toLowerCase();
    const descriptor = familyDescriptor(family);
    if (!descriptor) throw new Error("Unknown Rainbow's End Toy family.");
    if (!["small", "medium"].includes(sourceTier)) {
      throw new Error("Craft source tier must be Small or Medium.");
    }
    const targetTier = sourceTier === "small" ? "medium" : "large";
    const reference = validReference(referenceId);
    if (!reference) throw new Error("A stable craft reference is required.");

    const state = await getState(normalizedWallet, participantSessionToken);
    const familyRow = state.toys.find((row) => row.family === family);
    const tierRow = familyRow?.tiers?.[sourceTier];
    if (!tierRow || tierRow.quantity < 3) {
      throw new Error(
        `You need 3 ${sourceTier} ${descriptor.label} Toys to craft this upgrade.`,
      );
    }
    const recipe = familyRow?.craft?.[targetTier];
    if (!recipe?.actionKey) {
      throw new Error(
        `The ${descriptor.label} ${sourceTier} → ${targetTier} craft Path is not live in Yokefellow Network yet.`,
      );
    }

    const invoked = await network.invokeAction({
      key: recipe.actionKey,
      referenceId: reference,
      wallet: normalizedWallet,
      participantSessionToken,
      data: {
        tokenIds: Array.from({ length: Math.max(1, recipe.inputCount) }, () => null),
      },
    });
    const action = await settleAction(invoked?.action);

    return {
      ok: true,
      family,
      fromTier: sourceTier,
      targetTier,
      referenceId: reference,
      execution: { action },
    };
  }

  async function contribute(
    wallet,
    { family: familyValue, referenceId },
    participantSessionToken = "",
  ) {
    requireNetwork();
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const family = normalizeFamily(familyValue);
    const descriptor = familyDescriptor(family);
    if (!descriptor) throw new Error("Unknown Rainbow's End Toy family.");
    const reference = validReference(referenceId);
    if (!reference) throw new Error("A stable contribution reference is required.");

    const state = await getState(normalizedWallet, participantSessionToken);
    const familyRow = state.toys.find((row) => row.family === family);
    if (safeInteger(familyRow?.tiers?.large?.quantity, 0) < 1) {
      throw new Error(
        `You do not currently hold a Large ${descriptor.label} Toy.`,
      );
    }

    const capabilities = await network.listCapabilities();
    const catalog = buildCapabilityCatalog(capabilities?.capabilities || []);
    const actionKey = catalog.contributionActionKeys[family];
    if (!actionKey) {
      throw new Error(
        `The Large ${descriptor.label} community contribution action is not live in Yokefellow Network yet.`,
      );
    }

    const invoked = await network.invokeAction({
      key: actionKey,
      referenceId: reference,
      wallet: normalizedWallet,
      participantSessionToken,
      data: { amount: "1" },
    });
    const action = await settleAction(invoked?.action);

    const localState = await readStateFile();
    const existing = localState.contributions[reference];
    if (
      existing
      && (existing.wallet !== normalizedWallet || existing.family !== family)
    ) {
      throw new Error("That contribution reference was already used for different details.");
    }
    if (!existing) {
      localState.contributions[reference] = {
        referenceId: reference,
        wallet: normalizedWallet,
        family,
        points: descriptor.points,
        rarity: descriptor.rarity,
        actionId: action.actionId,
        transactionHash: action.transactionHash || null,
        status: "confirmed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveStateFile(localState);

      await network.publishEvent({
        type: "yes_drop.community_contribution",
        referenceId: `community:${reference}`,
        wallet: normalizedWallet,
        data: {
          family,
          points: descriptor.points,
          actionId: action.actionId,
        },
      }).catch(() => null);
    }

    return {
      ok: true,
      duplicate: Boolean(existing),
      contribution: localState.contributions[reference],
      community: communityFromState(localState),
    };
  }

  async function prepareFunding(
    wallet,
    { operation, amountYesRaw, referenceId },
    participantSessionToken = "",
  ) {
    requireNetwork();
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const op = String(operation || "").toLowerCase();
    if (!["deposit", "withdrawal"].includes(op)) {
      throw new Error("Funding operation must be deposit or withdrawal.");
    }
    const amount = String(amountYesRaw || "").trim();
    if (!/^[1-9]\d*$/.test(amount)) {
      throw new Error("Funding amount must be greater than zero.");
    }
    const reference = validReference(referenceId);
    if (!reference) throw new Error("A stable funding reference is required.");

    return network.prepareFunding({
      operation: op,
      wallet: normalizedWallet,
      amount,
      referenceId: reference,
      participantSessionToken,
    });
  }

  async function fundingStatus(
    wallet,
    { operation, referenceId },
    _participantSessionToken = "",
  ) {
    requireNetwork();
    const normalizedWallet = getAddress(wallet).toLowerCase();
    const op = String(operation || "").toLowerCase();
    if (!["deposit", "withdrawal"].includes(op)) {
      throw new Error("Funding operation must be deposit or withdrawal.");
    }
    const reference = validReference(referenceId);
    if (!reference) throw new Error("A stable funding reference is required.");

    return network.fundingStatus({
      operation: op,
      wallet: normalizedWallet,
      referenceId: reference,
    });
  }

  async function getCommunity() {
    return communityFromState(await readStateFile());
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
