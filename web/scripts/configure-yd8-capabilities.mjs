import crypto from "node:crypto";
import { Wallet, getAddress, keccak256, toUtf8Bytes } from "ethers";

const APPLY = process.argv.includes("--apply");
const networkBaseUrl = cleanOrigin(required("YF_NETWORK_BASE_URL"));
const bucketId = identity(required("YF_NETWORK_BUCKET_ID"), "YF_NETWORK_BUCKET_ID");
const appApiKey = required("YF_NETWORK_APP_API_KEY");
const appKey = (process.env.YES_DROP_APP_KEY || "coin-pusher").trim().toLowerCase();
const appId = keccak256(toUtf8Bytes(appKey)).toLowerCase();
const turnPrice = positiveInteger(
  process.env.YES_PUSHER_TURN_PRICE_YES_RAW || "10000000000000000000",
  "YES_PUSHER_TURN_PRICE_YES_RAW",
);

if (!appApiKey.startsWith("yfk_")) {
  throw new Error("YF_NETWORK_APP_API_KEY must be the server-side yfk_ key for coin-pusher.");
}

const FAMILIES = [
  ["four_leaf_clover", "Four Leaf Clover", 1],
  ["horseshoe", "Horseshoe", 2],
  ["leprechaun", "Leprechaun", 3],
  ["pot_of_gold", "Pot of Gold", 4],
  ["treasure_chest", "Treasure Chest", 5],
];

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function cleanOrigin(value) {
  const url = new URL(value);
  return url.origin;
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
  if (!/^[1-9][0-9]*$/.test(text)) {
    throw new Error(`${name} must be a positive integer in YES base units.`);
  }
  return text;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  if (
    value !== null
    && typeof value !== "string"
    && typeof value !== "boolean"
    && !(typeof value === "number" && Number.isFinite(value))
  ) {
    throw new Error("Capability payload contains an unsupported JSON value.");
  }
  return JSON.stringify(value);
}

function payloadHash(body) {
  return crypto.createHash("sha256").update(canonicalJson(body), "utf8").digest("hex");
}

function controlMessage({ key, controller, body, requestId, issuedAt }) {
  const path = `/v1/control/buckets/${bucketId}/capabilities/${encodeURIComponent(key)}`;
  const hash = payloadHash(body);
  return {
    path,
    hash,
    message: [
      "Yokefellow Network control authorization",
      `Bucket: ${bucketId}`,
      `Resource: capability:${key}`,
      `Controller: ${controller.toLowerCase()}`,
      "Method: PUT",
      `Path: ${path}`,
      `Request: ${requestId}`,
      `Issued: ${issuedAt}`,
      `Payload: ${hash}`,
      "This signature authorizes only the exact Network control operation above.",
    ].join("\n"),
  };
}

async function appRequest(pathname) {
  const response = await fetch(`${networkBaseUrl}${pathname}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${appApiKey}`,
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body?.message || body?.error || `Network returned HTTP ${response.status}.`,
    );
  }
  return body;
}

async function configuredCapabilities() {
  const query = new URLSearchParams({ bucketId });
  const body = await appRequest(`/v1/actions/capabilities?${query}`);
  return Array.isArray(body.capabilities) ? body.capabilities : [];
}

function familyFromClassKey(value) {
  const key = String(value || "").trim().toLowerCase();
  for (const [family] of FAMILIES) {
    if (key.includes(family)) return family;
  }
  return "";
}

function largeToyTargets(capabilities) {
  const found = new Map();

  for (const capability of capabilities) {
    const descriptor = capability?.descriptor && typeof capability.descriptor === "object"
      ? capability.descriptor
      : {};
    const candidates = [
      {
        classKey: descriptor.classKey,
        asset: descriptor.asset,
      },
      ...(Array.isArray(descriptor.results)
        ? descriptor.results.map((item) => ({
            classKey: item?.classKey || item?.externalOutputKey,
            asset: item?.asset,
          }))
        : []),
    ];

    for (const candidate of candidates) {
      const classKey = String(candidate?.classKey || "").trim().toLowerCase();
      if (!classKey || !/(?:^|_)l3(?:$|_)/.test(classKey)) continue;
      const family = familyFromClassKey(classKey);
      if (!family) continue;
      const collectionId = String(candidate?.asset?.collectionId || "").trim().toLowerCase();
      const classId = String(candidate?.asset?.classId || "").trim().toLowerCase();
      if (!/^0x[0-9a-f]{64}$/.test(collectionId) || !/^0x[0-9a-f]{64}$/.test(classId)) {
        continue;
      }
      const prior = found.get(family);
      if (
        prior
        && (prior.collectionId !== collectionId || prior.classId !== classId)
      ) {
        throw new Error(`Conflicting Large Toy targets were found for ${family}.`);
      }
      found.set(family, { family, classKey, collectionId, classId });
    }
  }

  return found;
}

function buildDefinitions(targets) {
  const definitions = [
    {
      key: "yes_drop.turn.capture",
      configuration: {
        state: "active",
        appId,
        executorType: "credit.capture.v1",
        executorConfig: { maxAmount: turnPrice },
        participantRequirements: {
          required: true,
          walletRequired: true,
          assurance: "WALLET_AUTHORIZED",
        },
        sponsorship: { mode: "network_relayer", policyId: null },
        descriptor: {
          source: "yes_drop.game",
          operation: "turn_capture",
          label: "YES drop paid turn",
          amountYesRaw: turnPrice,
        },
      },
    },
  ];

  definitions.push({
    key: "yes_drop.turn.payout",
    configuration: {
      state: "active",
      appId,
      executorType: "credit.grant.v1",
      executorConfig: {},
      participantRequirements: {
        required: true,
        walletRequired: true,
        assurance: "APP_ATTESTED",
      },
      sponsorship: { mode: "network_relayer", policyId: null },
      descriptor: {
        source: "yes_drop.game",
        operation: "turn_payout",
        label: "YES drop turn payout",
        backingConstraint: "bucket_reserve",
      },
    },
  });

  for (const [family, label, points] of FAMILIES) {
    const target = targets.get(family);
    if (!target) continue;
    definitions.push({
      key: `yes_drop.community_build.${family}`,
      configuration: {
        state: "active",
        appId,
        executorType: "nft.v3.v1",
        executorConfig: {
          operation: "burn",
          collectionId: target.collectionId,
          classId: target.classId,
          maxAmount: "1",
        },
        participantRequirements: {
          required: true,
          walletRequired: true,
          assurance: "WALLET_AUTHORIZED",
        },
        sponsorship: { mode: "network_relayer", policyId: null },
        descriptor: {
          source: "yes_drop.community_build",
          family,
          classKey: target.classKey,
          label: `Contribute Large ${label}`,
          buildPoints: points,
          asset: {
            collectionId: target.collectionId,
            classId: target.classId,
            standard: "ERC1155",
          },
        },
      },
    });
  }

  return definitions;
}

async function configureCapability(wallet, definition) {
  const requestId = crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const auth = controlMessage({
    key: definition.key,
    controller: wallet.address,
    body: definition.configuration,
    requestId,
    issuedAt,
  });
  const signature = await wallet.signMessage(auth.message);

  const response = await fetch(`${networkBaseUrl}${auth.path}`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-YF-Controller-Wallet": wallet.address,
      "X-YF-Controller-Signature": signature,
      "X-YF-Controller-Issued-At": issuedAt,
      "X-YF-Controller-Request-Id": requestId,
      "X-YF-Controller-Payload-Hash": auth.hash,
    },
    body: JSON.stringify(definition.configuration),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${definition.key}: ${body?.message || body?.error || `HTTP ${response.status}`}`,
    );
  }
  return body;
}

const existing = await configuredCapabilities();
const largeTargets = largeToyTargets(existing);
const definitions = buildDefinitions(largeTargets);
const missingLarge = FAMILIES
  .map(([family]) => family)
  .filter((family) => !largeTargets.has(family));

const report = {
  ok: !missingLarge.length,
  mode: APPLY ? "apply" : "dry_run",
  networkBaseUrl,
  bucketId,
  appId,
  appKey,
  configuredPathCapabilities: existing.length,
  resolvedLargeToyFamilies: [...largeTargets.keys()],
  missingLargeToyFamilies: missingLarge,
  payoutConstraint: "Bucket reserve only",
  capabilityKeys: definitions.map((item) => item.key),
  definitions,
};

if (!APPLY) {
  console.log(JSON.stringify({
    ...report,
    next: missingLarge.length
      ? "Deploy/configure the ten Toy craft Paths first so every Large class is discoverable, then rerun."
      : "Dry-run is complete. Re-run with --apply and YES_DROP_CONTROLLER_PRIVATE_KEY only after reviewing these definitions.",
  }, null, 2));
  process.exit(report.ok ? 0 : 2);
}

if (missingLarge.length) {
  throw new Error(
    `Cannot apply until Large Toy classes are discoverable from configured Path capabilities: ${missingLarge.join(", ")}.`,
  );
}

const controllerKey = required("YES_DROP_CONTROLLER_PRIVATE_KEY");
const wallet = new Wallet(controllerKey);
const expectedController = String(process.env.YES_DROP_CONTROLLER_ADDRESS || "").trim();
if (expectedController && getAddress(expectedController) !== wallet.address) {
  throw new Error(
    `YES_DROP_CONTROLLER_PRIVATE_KEY resolves to ${wallet.address}, not YES_DROP_CONTROLLER_ADDRESS ${expectedController}.`,
  );
}

const applied = [];
for (const definition of definitions) {
  const result = await configureCapability(wallet, definition);
  applied.push({
    key: definition.key,
    created: Boolean(result.created),
    state: result.capability?.state ?? null,
    executorType: result.capability?.executorType ?? null,
  });
}

console.log(JSON.stringify({
  ok: true,
  mode: "applied",
  bucketId,
  appId,
  controller: wallet.address,
  applied,
}, null, 2));
