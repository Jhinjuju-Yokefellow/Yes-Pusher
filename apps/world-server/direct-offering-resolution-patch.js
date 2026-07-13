import { SettlementOutbox } from './settlement-outbox.js';

function cleanString(value) {
  return String(value ?? '').trim();
}

function normalize(value) {
  return cleanString(value).toLowerCase();
}

function whole(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function readPayload(response) {
  const text = await response.text().catch(() => '');
  if (!text) return { ok: response.ok };
  try {
    return JSON.parse(text);
  } catch {
    return { ok: response.ok, text: text.slice(0, 2000) };
  }
}

function errorMessage(payload, fallback) {
  return cleanString(payload?.error?.message)
    || cleanString(payload?.error)
    || cleanString(payload?.message)
    || fallback;
}

function compactResponse(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function firstResolution(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const failed = results.find((result) => result?.matched === true && result?.resultType === 'failed');
  if (failed) throw new Error(cleanString(failed.error) || 'Yokefellow matched the skin offering but failed to create its result.');

  const matched = results.find((result) => result?.matched === true) ?? null;
  const duplicate = results.find((result) => result?.resultType === 'rejected_duplicate') ?? null;
  const selected = matched ?? duplicate;
  if (!selected) {
    const rejected = results.find((result) => result?.matched === false) ?? null;
    throw new Error(cleanString(rejected?.error || rejected?.reason || rejected?.resultType)
      || 'Yokefellow recorded the event but did not resolve the selected offering.');
  }

  const selectedClassId = cleanString(selected.selectedClassId || selected.classId) || null;
  const selectedOutputId = cleanString(selected.selectedOutputId) || null;
  if (!selectedClassId && !selectedOutputId) {
    throw new Error(cleanString(selected.error || selected.reason || selected.resultType)
      || 'The matched offering did not return an NFT output.');
  }

  return {
    offeringId: cleanString(selected.offeringId) || null,
    requestId: cleanString(selected.requestId) || null,
    resultType: cleanString(selected.resultType) || null,
    selectionMode: cleanString(selected.selectionMode) || null,
    fulfillmentMode: cleanString(selected.fulfillmentMode) || null,
    selectedOutputId,
    selectedClassId,
    mintJobId: cleanString(selected.mintJobId) || null,
    mintId: cleanString(selected.mintId) || null,
    duplicate: Boolean(duplicate && !matched),
  };
}

async function fetchCatalog(outbox) {
  const url = `${outbox.config.apiBaseUrl}/buckets/${encodeURIComponent(outbox.config.bucketId)}/catalog`;
  const response = await outbox.fetchImpl(url, {
    method: 'GET',
    headers: { 'x-yf-app-key': outbox.config.appKey },
  });
  const payload = await readPayload(response);
  if (!response.ok || payload?.ok === false) {
    throw new Error(errorMessage(payload, `Could not load Yokefellow bucket catalog (${response.status})`));
  }
  return payload;
}

async function resolveOffering(outbox) {
  const catalog = await fetchCatalog(outbox);
  const offerings = Array.isArray(catalog?.offerings) ? catalog.offerings : [];
  const triggerKey = normalize(outbox.config.skinDropTriggerKey);
  const offeringName = normalize(outbox.config.skinDropOfferingName);
  const appSlug = normalize(outbox.config.appSlug);

  const exactBinding = offerings.find((offering) => {
    const meta = safeObject(offering?.meta);
    return [meta.appBindingKey, meta.gameAction, meta.triggerKey]
      .map(normalize)
      .some((value) => value && value === triggerKey);
  });
  const exactTitle = offerings.find((offering) => normalize(offering?.title) === offeringName);
  const exactApp = offerings.find((offering) => normalize(safeObject(offering?.meta).appSlug) === appSlug);
  const offering = exactBinding ?? exactTitle ?? exactApp ?? null;

  if (!offering) {
    const available = offerings.map((value) => cleanString(value?.title)).filter(Boolean).slice(0, 8).join(', ');
    throw new Error(`${outbox.config.skinDropOfferingName} was not found in the Yokefellow bucket catalog${available ? ` (available: ${available})` : ''}.`);
  }
  if (cleanString(offering.status) !== 'live' || offering.active === false) {
    throw new Error(`${cleanString(offering.title) || outbox.config.skinDropOfferingName} is not live.`);
  }
  if (cleanString(offering.mode) !== 'earned') {
    throw new Error(`${cleanString(offering.title) || outbox.config.skinDropOfferingName} must use earned mode.`);
  }
  if (!cleanString(offering.id)) {
    throw new Error(`${outbox.config.skinDropOfferingName} does not expose an offering ID.`);
  }
  return offering;
}

const prototype = SettlementOutbox.prototype;
if (!prototype.directOfferingResolutionInstalled) {
  prototype.submitSkinDrop = async function submitSkinDropByOfferingId(record) {
    if (record.skinDropStatus !== 'pending' || !this.config.eventSubmissionEnabled) return false;
    const milestoneNumber = Math.max(1, whole(record.skinDropMilestoneNumber));
    const offering = await resolveOffering(this);
    const payload = await this.postJson(this.offeringEventsUrl(), {
      idempotencyKey: `${record.skinDropExternalRef}:event`,
      body: {
        wallet: record.wallet,
        appSlug: this.config.appSlug,
        eventType: this.config.eventType,
        offeringId: offering.id,
        metrics: {
          skinDropEarned: 1,
          milestoneNumber,
          milestoneEvery: 50,
          lifetimeCoinsWon: record.lifetimeCoinsWon,
          coinsWonThisTurn: record.coinsWon,
          pendingSkinMilestones: record.pendingSkinMilestones,
        },
        meta: {
          eventId: record.skinDropExternalRef,
          triggerKey: this.config.skinDropTriggerKey,
          offeringName: this.config.skinDropOfferingName,
          resolvedOfferingId: offering.id,
          turnId: record.id,
          turnNumber: record.turnNumber,
          milestoneNumber,
          externalRef: record.skinDropExternalRef,
        },
      },
    });

    const resolution = firstResolution(payload);
    record.skinDropStatus = 'submitted';
    record.skinDropError = null;
    record.skinDropResponse = compactResponse(payload);
    record.skinDropSelection = await this.enrichSkinDropResolution(resolution);
    return true;
  };

  Object.defineProperty(prototype, 'directOfferingResolutionInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

export { fetchCatalog, resolveOffering };
