import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { COIN_SKINS, getCoinSkin } from '../../src/config/skin-catalog.js';

const STORE_KIND = 'yes-pusher-skin-loadouts';
const STORE_VERSION = 1;
const BRIDGE_KEY = Symbol.for('yes-pusher:skin-loadout-bridge');
const dataDir = path.resolve(process.env.YES_PUSHER_DATA_DIR || path.resolve(process.cwd(), '.world-data'));
const loadoutFile = path.join(dataDir, 'skin-loadouts.json');

const bridge = globalThis[BRIDGE_KEY] ??= {
  authStore: null,
  loadouts: new Map(),
  ready: null,
  savePromise: Promise.resolve(),
};

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeWallet(value) {
  return clean(value).toLowerCase();
}

function validWallet(value) {
  return /^0x[a-f0-9]{40}$/i.test(value);
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parsedObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return safeObject(parsed);
  } catch {
    return {};
  }
}

function metadataForHolding(value) {
  return {
    ...parsedObject(value?.metadataJson),
    ...parsedObject(value?.metadata),
    ...parsedObject(value?.meta),
  };
}

function copyLoadout(value) {
  if (!value) return null;
  return {
    wallet: value.wallet,
    holdingId: value.holdingId,
    skinId: value.skinId,
    name: value.name,
    imageUrl: value.imageUrl,
    classId: value.classId,
    tokenId: value.tokenId,
    contractAddress: value.contractAddress,
    owned: Boolean(value.owned),
    verifiedAt: Number(value.verifiedAt) || 0,
    updatedAt: value.updatedAt || null,
  };
}

function skinFromValues(...values) {
  for (const value of values) {
    const candidate = clean(value);
    if (!candidate) continue;
    const direct = getCoinSkin(candidate);
    if (direct) return direct;
    const lower = candidate.toLowerCase();
    const byName = COIN_SKINS.find((skin) => skin.name.toLowerCase() === lower);
    if (byName) return byName;
    const byImage = COIN_SKINS.find((skin) => skin.imageUrl === candidate);
    if (byImage) return byImage;
  }
  return null;
}

function normalizeHolding(value) {
  const meta = metadataForHolding(value);
  const skin = skinFromValues(
    value?.classSlug,
    value?.classKey,
    value?.className,
    meta.outputKey,
    meta.skinId,
    meta.imageUrl,
    value?.imageUrl,
  );
  if (!skin || !clean(value?.id)) return null;
  return {
    holdingId: clean(value.id),
    skinId: skin.id,
    name: skin.name,
    imageUrl: clean(meta.imageUrl || meta.image || value?.imageUrl || value?.image || skin.imageUrl) || skin.imageUrl,
    classId: clean(value?.classId) || null,
    classSlug: clean(value?.classSlug || value?.classKey) || skin.id,
    tokenId: clean(value?.tokenId) || null,
    contractAddress: clean(value?.contractAddress) || null,
    quantity: Math.max(1, Math.floor(Number(value?.quantity) || 1)),
    status: clean(value?.status) || 'current',
    mintedAt: value?.createdAt ?? null,
  };
}

function attributeValue(attributes, traitType) {
  if (!Array.isArray(attributes)) return '';
  const target = clean(traitType).toLowerCase();
  const match = attributes.find((attribute) => clean(attribute?.trait_type || attribute?.traitType).toLowerCase() === target);
  return clean(match?.value);
}

function normalizeToyHolding(value) {
  const meta = metadataForHolding(value);
  const classKey = clean(value?.classKey || value?.classSlug || meta.classKey);
  const objectType = clean(meta.objectType || value?.objectType).toLowerCase();
  const toyClass = /^yes[_-]pusher\.toy\./i.test(classKey);
  if (objectType !== 'machine_toy_reward' && !toyClass) return null;
  if (meta.walletEligible === false || clean(meta.walletEligible).toLowerCase() === 'false') return null;

  const holdingId = clean(value?.id);
  if (!holdingId) return null;
  const attributes = Array.isArray(meta.attributes) ? meta.attributes : [];
  const classParts = classKey.split('.').filter(Boolean);
  const toyKey = clean(meta.toyKey || attributeValue(attributes, 'Toy') || classParts.at(-2)).toLowerCase().replace(/\s+/g, '_');
  const sizeTier = clean(meta.sizeTier || attributeValue(attributes, 'Size') || classParts.at(-1)).toLowerCase();

  return {
    holdingId,
    name: clean(value?.className || value?.name || meta.name || `${toyKey || 'YES Pusher'} Toy`),
    imageUrl: clean(meta.imageUrl || meta.image || value?.imageUrl || value?.image),
    classId: clean(value?.classId) || null,
    classKey: classKey || null,
    tokenId: clean(value?.tokenId) || null,
    contractAddress: clean(value?.contractAddress) || null,
    quantity: Math.max(1, Math.floor(Number(value?.quantity) || 1)),
    status: clean(value?.status) || 'current',
    mintedAt: value?.createdAt ?? null,
    objectType: 'machine_toy_reward',
    toyKey: toyKey || null,
    sizeTier: sizeTier || null,
    powerKey: clean(meta.powerKey) || null,
    craftFamily: clean(meta.craftFamily) || null,
    craftTier: Number.isFinite(Number(meta.craftTier)) ? Number(meta.craftTier) : null,
    walletEligible: true,
  };
}

async function loadStore() {
  try {
    const raw = JSON.parse(await readFile(loadoutFile, 'utf8'));
    if (raw?.kind !== STORE_KIND || raw?.version !== STORE_VERSION || !Array.isArray(raw.loadouts)) return;
    for (const item of raw.loadouts) {
      const wallet = normalizeWallet(item?.wallet);
      const skin = getCoinSkin(item?.skinId);
      if (!validWallet(wallet) || !skin || !clean(item?.holdingId)) continue;
      bridge.loadouts.set(wallet, {
        wallet,
        holdingId: clean(item.holdingId),
        skinId: skin.id,
        name: skin.name,
        imageUrl: clean(item.imageUrl) || skin.imageUrl,
        classId: clean(item.classId) || null,
        tokenId: clean(item.tokenId) || null,
        contractAddress: clean(item.contractAddress) || null,
        owned: false,
        verifiedAt: 0,
        updatedAt: item.updatedAt || null,
      });
    }
  } catch {
    // A missing or old loadout file starts with the starter coin.
  }
}

async function persistStore() {
  const payload = {
    kind: STORE_KIND,
    version: STORE_VERSION,
    savedAt: new Date().toISOString(),
    loadouts: [...bridge.loadouts.values()].map(copyLoadout),
  };
  await mkdir(path.dirname(loadoutFile), { recursive: true });
  const temporary = `${loadoutFile}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(temporary, loadoutFile);
}

function queueSave() {
  bridge.savePromise = bridge.savePromise.catch(() => {}).then(persistStore);
  return bridge.savePromise;
}

bridge.ready ??= loadStore();
await bridge.ready;

function entitlementsUrl(wallet) {
  const base = clean(process.env.YF_API_BASE_URL).replace(/\/+$/, '');
  const bucketId = clean(process.env.YF_BUCKET_ID);
  if (!base || !bucketId) throw new Error('Yokefellow skin inventory is not configured.');
  return `${base}/wallets/${encodeURIComponent(wallet)}/entitlements?bucketId=${encodeURIComponent(bucketId)}`;
}

async function readPayload(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 1000) };
  }
}

async function fetchInventory(wallet, fetchImpl = globalThis.fetch) {
  const normalized = normalizeWallet(wallet);
  if (!validWallet(normalized)) throw new Error('A valid connected wallet is required.');
  if (typeof fetchImpl !== 'function') throw new Error('Yokefellow inventory cannot be loaded.');
  const response = await fetchImpl(entitlementsUrl(normalized), {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(clean(process.env.YF_APP_KEY) ? { 'x-yf-app-key': clean(process.env.YF_APP_KEY) } : {}),
    },
  });
  const payload = await readPayload(response);
  if (!response.ok || payload?.ok === false) {
    throw new Error(clean(payload?.error?.message || payload?.error || payload?.message)
      || `Yokefellow skin inventory failed (${response.status}).`);
  }
  const rawOwned = Array.isArray(payload?.walletState?.ownedMints) ? payload.walletState.ownedMints : [];
  const owned = rawOwned.map(normalizeHolding).filter(Boolean);
  const toys = rawOwned.map(normalizeToyHolding).filter(Boolean);
  return {
    wallet: normalized,
    owned,
    toys,
    queued: Array.isArray(payload?.walletState?.queuedMintJobs) ? payload.walletState.queuedMintJobs : [],
    counts: {
      ...(payload?.walletState?.counts ?? {}),
      skins: owned.length,
      toys: toys.length,
      queued: Array.isArray(payload?.walletState?.queuedMintJobs) ? payload.walletState.queuedMintJobs.length : 0,
    },
  };
}

async function refreshWallet(wallet) {
  const inventory = await fetchInventory(wallet);
  const current = bridge.loadouts.get(inventory.wallet);
  if (current) {
    const holding = inventory.owned.find((item) => item.holdingId === current.holdingId && item.skinId === current.skinId);
    if (holding) {
      bridge.loadouts.set(inventory.wallet, {
        wallet: inventory.wallet,
        ...holding,
        owned: true,
        verifiedAt: Date.now(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      bridge.loadouts.delete(inventory.wallet);
    }
    await queueSave();
  }
  return inventory;
}

function equippedForWallet(wallet, inventory = null) {
  const normalized = normalizeWallet(wallet);
  const current = bridge.loadouts.get(normalized) ?? null;
  if (!current) return null;
  if (inventory && !inventory.owned.some((item) => item.holdingId === current.holdingId && item.skinId === current.skinId)) return null;
  return copyLoadout(current);
}

export {
  bridge,
  clean,
  copyLoadout,
  equippedForWallet,
  fetchInventory,
  metadataForHolding,
  normalizeHolding,
  normalizeToyHolding,
  normalizeWallet,
  queueSave,
  refreshWallet,
};
