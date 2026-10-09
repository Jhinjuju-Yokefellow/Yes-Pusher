const origin = cleanOrigin(required("YF_NETWORK_BASE_URL"));
const bucketId = identity(required("YF_NETWORK_BUCKET_ID"), "YF_NETWORK_BUCKET_ID");
const appApiKey = required("YF_NETWORK_APP_API_KEY");
const expectedAppKey = (process.env.YES_DROP_APP_KEY || "coin-pusher").trim().toLowerCase();
const expectedAppId = await appIdentity(expectedAppKey);
const turnPriceRaw = positiveInteger(
  process.env.YES_PUSHER_TURN_PRICE_YES_RAW || "10000000000000000000",
  "YES_PUSHER_TURN_PRICE_YES_RAW",
);
const skinActionKey = (process.env.YES_DROP_SKIN_ACTION_KEY || "yes_pusher.skin_drop").trim();
const toyActionKey = (process.env.YES_DROP_TOY_ACTION_KEY || "yes_pusher.toy_caught").trim();

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function cleanOrigin(value) {
  return new URL(value).origin;
}

function identity(value, name) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${name} must be a bytes32 0x identity.`);
  }
  return normalized;
}

function positiveInteger(value, name) {
  const text = String(value || "").trim();
  if (!/^[1-9][0-9]*$/.test(text)) throw new Error(`${name} must be a positive integer.`);
  return text;
}

async function appIdentity(key) {
  const { keccak256, toUtf8Bytes } = await import("ethers");
  return keccak256(toUtf8Bytes(key)).toLowerCase();
}

async function request(pathname) {
  const response = await fetch(`${origin}${pathname}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${appApiKey}`,
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${pathname}: ${body?.message || body?.error || `HTTP ${response.status}`}`,
    );
  }
  return body;
}

function capabilityMap(capabilities) {
  return new Map(capabilities.map((item) => [String(item.key || ""), item]));
}

function assurance(capability) {
  return String(capability?.participantRequirements?.assurance || "");
}

function enabled(classView, name) {
  return Array.isArray(classView?.capabilities?.enabled)
    && classView.capabilities.enabled.includes(name);
}

function classTarget(targets, kind, value) {
  if (!value?.asset?.collectionId || !value?.asset?.classId) return;
  const classKey = String(value.classKey || value.externalOutputKey || "").trim();
  if (!classKey) return;
  const collectionId = identity(value.asset.collectionId, `${classKey} collectionId`);
  const classId = identity(value.asset.classId, `${classKey} classId`);
  const prior = targets.get(classKey);
  if (
    prior
    && (prior.collectionId !== collectionId || prior.classId !== classId || prior.kind !== kind)
  ) {
    throw new Error(`Conflicting class target for ${classKey}.`);
  }
  targets.set(classKey, { classKey, collectionId, classId, kind });
}

const issues = [];
const details = {};

const me = await request("/v1/me");
const actualAppId = String(me?.app?.appId || "").toLowerCase();
details.app = { expectedAppId, actualAppId, appKey: expectedAppKey };
if (actualAppId !== expectedAppId) {
  issues.push(`App API key resolves to ${actualAppId || "no App"}, expected ${expectedAppId}.`);
}

const funding = await request(
  `/v1/funding/buckets/${encodeURIComponent(bucketId)}`,
);
details.funding = funding.balance || null;
if (!funding?.balance?.policy?.configured) {
  issues.push("Network participant funding policy is not configured.");
} else {
  if (funding.balance.policy.captureMode !== "on_action") {
    issues.push("YES drop funding policy is not capture-on-action.");
  }
  if (funding.balance.policy.withdrawable !== true) {
    issues.push("YES drop participant credit is not withdrawable.");
  }
}

const capBody = await request(
  `/v1/actions/capabilities?${new URLSearchParams({ bucketId })}`,
);
const capabilities = Array.isArray(capBody.capabilities) ? capBody.capabilities : [];
const caps = capabilityMap(capabilities);
details.capabilityCount = capabilities.length;

const capture = caps.get("yes_drop.turn.capture");
if (!capture) {
  issues.push("Missing yes_drop.turn.capture.");
} else {
  if (capture.state !== "active") issues.push("yes_drop.turn.capture is not active.");
  if (capture.executorType !== "credit.capture.v1") issues.push("Turn capture is not credit.capture.v1.");
  if (String(capture.executorConfig?.maxAmount || "") !== turnPriceRaw) {
    issues.push("Turn capture maxAmount does not equal the 10 YES turn price.");
  }
  if (assurance(capture) !== "WALLET_AUTHORIZED") {
    issues.push("Turn capture is not WALLET_AUTHORIZED.");
  }
}

const payout = caps.get("yes_drop.turn.payout");
if (!payout) {
  issues.push("Missing yes_drop.turn.payout.");
} else {
  if (payout.state !== "active") issues.push("yes_drop.turn.payout is not active.");
  if (payout.executorType !== "credit.grant.v1") issues.push("Turn payout is not credit.grant.v1.");
  try {
    positiveInteger(payout.executorConfig?.maxAmount, "turn payout maxAmount");
  } catch {
    issues.push("Turn payout does not have a positive configured maxAmount.");
  }
  if (assurance(payout) !== "APP_ATTESTED") {
    issues.push("Turn payout is not APP_ATTESTED.");
  }
}

const skin = caps.get(skinActionKey);
if (!skin) {
  issues.push(`Missing Skin action ${skinActionKey}.`);
} else {
  if (skin.executorType !== "nft.result.v1") issues.push("Skin action is not nft.result.v1.");
  if (skin.executorConfig?.selectionMode !== "weighted") issues.push("Skin action is not weighted.");
  if (!Array.isArray(skin.executorConfig?.outputs) || skin.executorConfig.outputs.length !== 5) {
    issues.push("Skin action does not expose exactly five configured outputs.");
  }
  if (assurance(skin) !== "APP_ATTESTED") issues.push("Skin action is not APP_ATTESTED.");
}

const toy = caps.get(toyActionKey);
if (!toy) {
  issues.push(`Missing Toy action ${toyActionKey}.`);
} else {
  if (toy.executorType !== "nft.result.v1") issues.push("Toy action is not nft.result.v1.");
  if (toy.executorConfig?.selectionMode !== "app_selected") issues.push("Toy action is not app_selected.");
  if (!Array.isArray(toy.executorConfig?.outputs) || toy.executorConfig.outputs.length !== 5) {
    issues.push("Toy action does not expose exactly five Small Toy outputs.");
  }
  const selectionKeys = new Set(
    Array.isArray(toy.executorConfig?.outputs)
      ? toy.executorConfig.outputs.map((item) => String(item?.key || ""))
      : [],
  );
  for (const family of [
    "four_leaf_clover",
    "horseshoe",
    "leprechaun",
    "pot_of_gold",
    "treasure_chest",
  ]) {
    if (!selectionKeys.has(family)) issues.push(`Toy action is missing selection key ${family}.`);
  }
  if (assurance(toy) !== "APP_ATTESTED") issues.push("Toy action is not APP_ATTESTED.");
}

const craft = capabilities.filter((capability) =>
  String(capability?.descriptor?.mode || "").toLowerCase() === "craft"
  && capability?.executorConfig?.operation === "craft"
);
details.craftCount = craft.length;
if (craft.length !== 10) {
  issues.push(`Expected 10 configured craft capabilities, found ${craft.length}.`);
}
for (const capability of craft) {
  if (capability.executorType !== "nft.v3.v1") {
    issues.push(`${capability.key} craft is not nft.v3.v1.`);
  }
  if (assurance(capability) !== "WALLET_AUTHORIZED") {
    issues.push(`${capability.key} craft is not WALLET_AUTHORIZED.`);
  }
}

const contributions = capabilities.filter(
  (capability) => capability?.descriptor?.source === "yes_drop.community_build",
);
details.contributionCount = contributions.length;
if (contributions.length !== 5) {
  issues.push(`Expected 5 Large Toy contribution capabilities, found ${contributions.length}.`);
}
for (const capability of contributions) {
  if (
    capability.executorType !== "nft.v3.v1"
    || capability.executorConfig?.operation !== "burn"
    || String(capability.executorConfig?.maxAmount || "") !== "1"
  ) {
    issues.push(`${capability.key} is not a bounded one-unit Network burn.`);
  }
  if (assurance(capability) !== "WALLET_AUTHORIZED") {
    issues.push(`${capability.key} contribution is not WALLET_AUTHORIZED.`);
  }
}

const targets = new Map();
for (const result of Array.isArray(skin?.descriptor?.results) ? skin.descriptor.results : []) {
  classTarget(targets, "skin", result);
}
for (const result of Array.isArray(toy?.descriptor?.results) ? toy.descriptor.results : []) {
  classTarget(targets, "toy_small", result);
}
for (const capability of craft) {
  const descriptor = capability?.descriptor || {};
  classTarget(targets, "toy", {
    classKey: descriptor.classKey,
    asset: descriptor.asset,
  });
  for (const input of Array.isArray(descriptor.craftInputs) ? descriptor.craftInputs : []) {
    const key = String(input?.classKey || "");
    classTarget(
      targets,
      /(?:^|_)l1(?:$|_)/.test(key) ? "toy_small" : "toy",
      input,
    );
  }
}

details.classTargetCount = targets.size;
if (targets.size !== 20) {
  issues.push(`Expected 20 distinct launch classes from configured capabilities, resolved ${targets.size}.`);
}

const collectionIds = new Set();
const checkedClasses = [];
for (const target of [...targets.values()].sort((a, b) => a.classKey.localeCompare(b.classKey))) {
  collectionIds.add(target.collectionId);
  const body = await request(
    `/v1/nfts/buckets/${encodeURIComponent(bucketId)}/collections/${encodeURIComponent(target.collectionId)}/classes/${encodeURIComponent(target.classId)}`,
  );
  const view = body.class;
  checkedClasses.push({
    classKey: target.classKey,
    kind: target.kind,
    collectionId: target.collectionId,
    classId: target.classId,
    capabilities: view?.capabilities?.enabled || [],
  });

  for (const requiredCapability of ["APP_MINT", "TRANSFERABLE", "AUCTION"]) {
    if (!enabled(view, requiredCapability)) {
      issues.push(`${target.classKey} is missing ${requiredCapability}.`);
    }
  }
  if (enabled(view, "HOLDER_BURN")) {
    issues.push(`${target.classKey} unexpectedly enables HOLDER_BURN.`);
  }

  if (target.kind === "skin") {
    if (enabled(view, "APP_BURN") || enabled(view, "CRAFT_CONSUME")) {
      issues.push(`${target.classKey} Skin unexpectedly enables burn/craft consumption.`);
    }
    continue;
  }

  const tier =
    /(?:^|_)l1(?:$|_)/.test(target.classKey)
      ? "small"
      : /(?:^|_)l2(?:$|_)/.test(target.classKey)
        ? "medium"
        : /(?:^|_)l3(?:$|_)/.test(target.classKey)
          ? "large"
          : "";

  if (!tier) {
    issues.push(`${target.classKey} does not expose a stable l1/l2/l3 Toy key.`);
  } else if (tier === "small" || tier === "medium") {
    if (!enabled(view, "CRAFT_CONSUME")) {
      issues.push(`${target.classKey} is missing CRAFT_CONSUME.`);
    }
    if (enabled(view, "APP_BURN")) {
      issues.push(`${target.classKey} should not enable generic APP_BURN.`);
    }
  } else {
    if (!enabled(view, "APP_BURN")) {
      issues.push(`${target.classKey} Large Toy is missing APP_BURN.`);
    }
    if (enabled(view, "CRAFT_CONSUME")) {
      issues.push(`${target.classKey} Large Toy should not enable CRAFT_CONSUME.`);
    }
  }
}

details.collectionCount = collectionIds.size;
details.classes = checkedClasses;
if (collectionIds.size !== 2) {
  issues.push(`Expected two launch collections (Skins + Toys), resolved ${collectionIds.size}.`);
}

console.log(JSON.stringify({
  ok: issues.length === 0,
  gate: "YD-8 YokefellowNetwork live configuration",
  bucketId,
  ...details,
  issues,
}, null, 2));

process.exit(issues.length ? 1 : 0);
