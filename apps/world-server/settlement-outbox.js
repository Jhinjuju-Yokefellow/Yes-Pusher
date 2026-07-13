import { COIN_SKINS, getCoinSkin } from '../../src/config/skin-catalog.js';

const OUTBOX_KIND = 'yes-pusher-settlement-outbox';
const OUTBOX_VERSION = 3;
const SUPPORTED_OUTBOX_VERSIONS = new Set([1, 2, 3]);
const DEFAULT_YES_PER_COIN_RAW = '1000000000000000000';
const DEFAULT_EVENT_TYPE = 'coin_drop_completed';
const DEFAULT_SKIN_DROP_TRIGGER_KEY = 'coin_pusher.random_skin_drop';
const DEFAULT_SKIN_DROP_OFFERING_NAME = 'Random Coin Skin Drop';

function cleanUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function cleanString(value) {
  return String(value ?? '').trim();
}

function whole(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function walletFromPlayerId(playerId) {
  const value = cleanString(playerId);
  return value.startsWith('wallet:') ? value.slice('wallet:'.length).toLowerCase() : null;
}

function safeBigInt(value, fallback = 0n) {
  try {
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    const parsed = BigInt(raw);
    return parsed >= 0n ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function compactResponse(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return String(value).slice(0, 2000);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
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

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function knownSkinFromValues(...values) {
  for (const value of values) {
    const candidate = cleanString(value);
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

function firstSkinDropResolution(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const failed = results.find((result) => result?.matched === true && result?.resultType === 'failed');
  if (failed) throw new Error(cleanString(failed.error) || 'Yokefellow matched the skin offering but failed to create its result.');

  const matched = results.find((result) => result?.matched === true) ?? null;
  const duplicate = results.find((result) => result?.resultType === 'rejected_duplicate') ?? null;
  const selected = matched ?? duplicate;
  if (!selected) {
    const rejected = results.find((result) => result?.matched === false) ?? null;
    const reason = cleanString(rejected?.error || rejected?.reason || rejected?.resultType);
    return { error: reason || null };
  }

  const selectedClassId = cleanString(selected.selectedClassId || selected.classId) || null;
  const selectedOutputId = cleanString(selected.selectedOutputId) || null;
  if (!selectedClassId && !selectedOutputId) {
    const reason = cleanString(selected.error || selected.reason || selected.resultType);
    return { error: reason || 'The matched offering did not return an NFT output.' };
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

function stableSkinExternalRef({ wallet, milestoneNumber, turnId }) {
  const owner = cleanString(wallet).toLowerCase() || cleanString(turnId) || 'unknown';
  return `yes-pusher:skin-drop:${owner}:milestone:${Math.max(1, whole(milestoneNumber))}`;
}

export function settlementConfigFromEnv(env = process.env) {
  const apiBaseUrl = cleanUrl(env.YF_API_BASE_URL);
  const appKey = cleanString(env.YF_APP_KEY);
  const bucketId = cleanString(env.YF_BUCKET_ID);
  const explicitCreditUrl = cleanUrl(env.YF_CREDIT_GRANT_URL);
  const creditGrantUrl = explicitCreditUrl || (apiBaseUrl && bucketId
    ? `${apiBaseUrl}/buckets/${encodeURIComponent(bucketId)}/credit-grants`
    : '');
  const yesPerCoinRaw = safeBigInt(env.YES_PUSHER_YES_PER_COIN_RAW, BigInt(DEFAULT_YES_PER_COIN_RAW)).toString();
  return {
    apiBaseUrl,
    appKey,
    bucketId,
    creditGrantUrl,
    yesPerCoinRaw,
    appSlug: cleanString(env.YES_PUSHER_APP_SLUG) || 'yes-pusher',
    eventType: cleanString(env.YES_PUSHER_EVENT_TYPE) || DEFAULT_EVENT_TYPE,
    skinDropTriggerKey: cleanString(env.YES_PUSHER_SKIN_DROP_TRIGGER_KEY) || DEFAULT_SKIN_DROP_TRIGGER_KEY,
    skinDropOfferingName: cleanString(env.YES_PUSHER_SKIN_DROP_OFFERING_NAME) || DEFAULT_SKIN_DROP_OFFERING_NAME,
    eventSubmissionEnabled: Boolean(apiBaseUrl && appKey && bucketId),
    creditSubmissionEnabled: Boolean(creditGrantUrl && appKey && bucketId),
  };
}

export class SettlementOutbox {
  constructor(raw = null, {
    config = settlementConfigFromEnv(),
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
  } = {}) {
    this.config = {
      ...config,
      eventType: cleanString(config.eventType) || DEFAULT_EVENT_TYPE,
      skinDropTriggerKey: cleanString(config.skinDropTriggerKey) || DEFAULT_SKIN_DROP_TRIGGER_KEY,
      skinDropOfferingName: cleanString(config.skinDropOfferingName) || DEFAULT_SKIN_DROP_OFFERING_NAME,
    };
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.records = new Map();
    this.processing = false;
    this.restore(raw);
  }

  integrationStatus() {
    return {
      bucketId: this.config.bucketId || null,
      eventType: this.config.eventType,
      eventSubmissionConfigured: this.config.eventSubmissionEnabled,
      creditSubmissionConfigured: this.config.creditSubmissionEnabled,
      creditGrantUrl: this.config.creditSubmissionEnabled ? this.config.creditGrantUrl : null,
      payoutMode: this.config.creditSubmissionEnabled ? 'yokefellow-bucket-credit' : 'record-only',
      yesPerCoinRaw: this.config.yesPerCoinRaw,
      skinDropTriggerKey: this.config.skinDropTriggerKey,
      skinDropOfferingName: this.config.skinDropOfferingName,
      automaticFailureRetry: false,
    };
  }

  enqueue(result) {
    const turnId = cleanString(result?.id);
    if (!turnId) throw new Error('A completed turn id is required for settlement');
    const existing = this.records.get(turnId);
    if (existing) return { ...existing };

    const wallet = walletFromPlayerId(result?.playerId);
    const coinsWon = whole(result?.coinsWon);
    const skinDropEarned = whole(result?.skinDropEarned) > 0 ? 1 : 0;
    const milestoneNumber = whole(result?.assignedSkinMilestoneNumber ?? result?.resolvedSkinMilestones);
    const amountYesRaw = (BigInt(coinsWon) * safeBigInt(this.config.yesPerCoinRaw, BigInt(DEFAULT_YES_PER_COIN_RAW))).toString();
    const createdAt = new Date(this.now()).toISOString();
    const creditStatus = !wallet
      ? 'wallet_required'
      : coinsWon === 0
        ? 'no_payout'
        : this.config.creditSubmissionEnabled
          ? 'pending'
          : 'recorded';
    const skinDropStatus = !skinDropEarned
      ? 'not_earned'
      : !wallet
        ? 'wallet_required'
        : this.config.eventSubmissionEnabled
          ? 'pending'
          : 'disabled';
    const externalRef = `yes-pusher:turn:${turnId}`;
    const skinDropExternalRef = skinDropEarned
      ? stableSkinExternalRef({ wallet, milestoneNumber, turnId })
      : null;

    const record = {
      id: turnId,
      externalRef,
      skinDropExternalRef,
      playerId: cleanString(result?.playerId),
      wallet,
      bucketId: this.config.bucketId || null,
      turnNumber: whole(result?.number ?? result?.turnNumber),
      coinsDropped: whole(result?.coinsDropped),
      coinsWon,
      coinsLost: whole(result?.coinsLost),
      lifetimeCoinsWon: whole(result?.lifetimeCoinsWon),
      crossedMilestones: whole(result?.crossedMilestones),
      skinDropEarned,
      skinDropMilestoneNumber: milestoneNumber || (skinDropEarned ? 1 : 0),
      pendingSkinMilestones: whole(result?.pendingSkinMilestones),
      amountYesRaw,
      creditStatus,
      eventStatus: 'not_required',
      skinDropStatus,
      attempts: 0,
      creditAttempts: 0,
      skinDropAttempts: 0,
      nextAttemptAtMs: this.now(),
      lastError: null,
      creditError: null,
      skinDropError: null,
      creditResponse: null,
      eventResponse: null,
      skinDropResponse: null,
      skinDropSelection: null,
      skinProgressConfirmed: false,
      createdAt,
      updatedAt: createdAt,
      confirmedAt: null,
    };
    this.records.set(turnId, record);
    return { ...record };
  }

  get(turnId) {
    const record = this.records.get(cleanString(turnId));
    return record ? { ...record } : null;
  }

  allRecords() {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  viewForPlayer(playerId) {
    const id = cleanString(playerId);
    const records = [...this.records.values()]
      .filter((record) => record.playerId === id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const pending = records.filter((record) => ['pending', 'failed', 'recorded'].includes(record.creditStatus)).length;
    const skinDropPendingCount = records.filter((record) => ['pending', 'failed', 'disabled'].includes(record.skinDropStatus)).length;
    const recordedOwedYesRaw = records
      .filter((record) => ['recorded', 'pending', 'failed'].includes(record.creditStatus))
      .reduce((sum, record) => sum + safeBigInt(record.amountYesRaw), 0n)
      .toString();
    return {
      pendingCount: pending,
      skinDropPendingCount,
      recordedOwedYesRaw,
      last: records[0] ? { ...records[0] } : null,
      failedSkinDropIds: records.filter((record) => record.skinDropStatus === 'failed').map((record) => record.id),
      failedCreditIds: records.filter((record) => record.creditStatus === 'failed').map((record) => record.id),
      integration: this.integrationStatus(),
    };
  }

  offeringEventsUrl() {
    return `${this.config.apiBaseUrl}/buckets/${encodeURIComponent(this.config.bucketId)}/offering-events`;
  }

  async postJson(url, { idempotencyKey, body }) {
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yf-app-key': this.config.appKey,
        'x-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    const payload = await readPayload(response);
    if (!response.ok || payload?.ok === false) {
      throw new Error(errorMessage(payload, `Yokefellow request failed (${response.status})`));
    }
    return payload;
  }

  async enrichSkinDropResolution(resolution) {
    if (!resolution || resolution.error || !this.config.eventSubmissionEnabled) return resolution;
    try {
      const response = await this.fetchImpl(
        `${this.config.apiBaseUrl}/buckets/${encodeURIComponent(this.config.bucketId)}/catalog`,
        {
          method: 'GET',
          headers: { 'x-yf-app-key': this.config.appKey },
        },
      );
      const payload = await readPayload(response);
      if (!response.ok || payload?.ok === false) return resolution;
      const offerings = Array.isArray(payload?.offerings) ? payload.offerings : [];
      const classes = Array.isArray(payload?.classes) ? payload.classes : [];
      const offering = offerings.find((value) => cleanString(value?.title) === this.config.skinDropOfferingName)
        ?? offerings.find((value) => cleanString(value?.id) === resolution.offeringId)
        ?? null;
      const outputs = Array.isArray(offering?.outputs) ? offering.outputs : [];
      const output = outputs.find((value) => cleanString(value?.id) === resolution.selectedOutputId)
        ?? outputs.find((value) => cleanString(value?.itemClassId) === resolution.selectedClassId)
        ?? null;
      const itemClass = classes.find((value) => cleanString(value?.id) === resolution.selectedClassId)
        ?? classes.find((value) => cleanString(value?.id) === cleanString(output?.itemClassId))
        ?? null;
      const outputMeta = safeObject(output?.meta);
      const classMeta = safeObject(itemClass?.metadataTemplate);
      const skin = knownSkinFromValues(
        outputMeta.outputKey,
        outputMeta.key,
        outputMeta.identifier,
        outputMeta.metadataKey,
        outputMeta.slug,
        classMeta.outputKey,
        classMeta.key,
        classMeta.identifier,
        classMeta.metadataKey,
        itemClass?.slug,
        output?.label,
        output?.itemClassName,
        itemClass?.name,
        output?.imageUrl,
        itemClass?.imageUrl,
      );
      return {
        ...resolution,
        outputKey: skin?.id ?? null,
        displayName: skin?.name ?? (cleanString(output?.label || output?.itemClassName || itemClass?.name) || null),
        imageUrl: skin?.imageUrl ?? (cleanString(output?.imageUrl || itemClass?.imageUrl) || null),
      };
    } catch {
      return resolution;
    }
  }

  async submitSkinDrop(record) {
    if (record.skinDropStatus !== 'pending' || !this.config.eventSubmissionEnabled) return false;
    const milestoneNumber = Math.max(1, whole(record.skinDropMilestoneNumber));
    const payload = await this.postJson(this.offeringEventsUrl(), {
      idempotencyKey: `${record.skinDropExternalRef}:event`,
      body: {
        wallet: record.wallet,
        appSlug: this.config.appSlug,
        eventType: this.config.eventType,
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
          turnId: record.id,
          turnNumber: record.turnNumber,
          milestoneNumber,
          externalRef: record.skinDropExternalRef,
        },
      },
    });
    const resolution = firstSkinDropResolution(payload);
    if (!resolution || resolution.error) {
      throw new Error(resolution?.error
        ? `${this.config.skinDropOfferingName}: ${resolution.error}`
        : `${this.config.skinDropOfferingName} did not match trigger ${this.config.skinDropTriggerKey}`);
    }
    record.skinDropStatus = 'submitted';
    record.skinDropError = null;
    record.skinDropResponse = compactResponse(payload);
    record.skinDropSelection = await this.enrichSkinDropResolution(resolution);
    return true;
  }

  async submitCredit(record) {
    if (record.creditStatus !== 'pending' || !this.config.creditSubmissionEnabled) return false;
    const payload = await this.postJson(this.config.creditGrantUrl, {
      idempotencyKey: record.externalRef,
      body: {
        wallet: record.wallet,
        amountYesRaw: record.amountYesRaw,
        source: this.config.appSlug,
        eventType: this.config.eventType,
        externalRef: record.externalRef,
        creditKind: 'policy',
        memo: `YES Pusher turn ${record.turnNumber}: ${record.coinsWon} coin${record.coinsWon === 1 ? '' : 's'} won`,
        meta: {
          turnId: record.id,
          turnNumber: record.turnNumber,
          coinsDropped: record.coinsDropped,
          coinsWon: record.coinsWon,
          lifetimeCoinsWon: record.lifetimeCoinsWon,
        },
      },
    });
    record.creditStatus = 'confirmed';
    record.creditError = null;
    record.creditResponse = compactResponse(payload);
    record.confirmedAt = new Date(this.now()).toISOString();
    return true;
  }

  async processChannel(record, statusKey, errorKey, attemptKey, submit) {
    if (record[statusKey] !== 'pending') return { changed: false, error: null };
    record[attemptKey] = whole(record[attemptKey]) + 1;
    try {
      const changed = await submit();
      record[errorKey] = null;
      return { changed, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Settlement submission failed';
      record[statusKey] = 'failed';
      record[errorKey] = message;
      return { changed: true, error: message };
    }
  }

  hasPending(record) {
    return record.creditStatus === 'pending' || record.skinDropStatus === 'pending';
  }

  async process({ limit = 10 } = {}) {
    if (this.processing || typeof this.fetchImpl !== 'function') return false;
    this.processing = true;
    let changed = false;
    try {
      const due = [...this.records.values()]
        .filter((record) => this.hasPending(record) && Number(record.nextAttemptAtMs ?? 0) <= this.now())
        .sort((a, b) => Number(a.nextAttemptAtMs ?? 0) - Number(b.nextAttemptAtMs ?? 0))
        .slice(0, Math.max(1, whole(limit)));

      for (const record of due) {
        record.attempts = whole(record.attempts) + 1;
        const channels = [
          await this.processChannel(record, 'skinDropStatus', 'skinDropError', 'skinDropAttempts', () => this.submitSkinDrop(record)),
          await this.processChannel(record, 'creditStatus', 'creditError', 'creditAttempts', () => this.submitCredit(record)),
        ];
        const errors = channels.map((channel) => channel.error).filter(Boolean);
        changed = channels.some((channel) => channel.changed) || changed;
        record.lastError = errors.length ? errors.join(' | ') : null;
        record.nextAttemptAtMs = 0;
        record.updatedAt = new Date(this.now()).toISOString();
      }
    } finally {
      this.processing = false;
    }
    return changed;
  }

  retryFailedSkinDropsForPlayer(playerId) {
    const id = cleanString(playerId);
    let changed = false;
    for (const record of this.records.values()) {
      if (record.playerId !== id || record.skinDropStatus !== 'failed' || !record.skinDropEarned) continue;
      record.skinDropStatus = this.config.eventSubmissionEnabled ? 'pending' : 'disabled';
      record.skinDropError = null;
      record.lastError = null;
      record.nextAttemptAtMs = this.now();
      record.updatedAt = new Date(this.now()).toISOString();
      changed = true;
    }
    return changed;
  }

  retryFailedCreditsForPlayer(playerId) {
    const id = cleanString(playerId);
    let changed = false;
    for (const record of this.records.values()) {
      if (record.playerId !== id || !['failed', 'recorded'].includes(record.creditStatus) || !safeBigInt(record.amountYesRaw)) continue;
      record.creditStatus = this.config.creditSubmissionEnabled ? 'pending' : 'recorded';
      record.creditError = null;
      record.lastError = null;
      record.nextAttemptAtMs = this.now();
      record.updatedAt = new Date(this.now()).toISOString();
      changed = true;
    }
    return changed;
  }

  // Kept for older callers, but failures are intentionally not requeued automatically.
  retryFailed() {
    return false;
  }

  recordsAwaitingSkinProgressConfirmation() {
    return [...this.records.values()]
      .filter((record) => record.skinDropStatus === 'submitted' && record.skinDropEarned && !record.skinProgressConfirmed)
      .sort((a, b) => whole(a.skinDropMilestoneNumber) - whole(b.skinDropMilestoneNumber))
      .map((record) => ({ ...record }));
  }

  markSkinProgressConfirmed(turnId) {
    const record = this.records.get(cleanString(turnId));
    if (!record || record.skinProgressConfirmed) return false;
    record.skinProgressConfirmed = true;
    record.updatedAt = new Date(this.now()).toISOString();
    return true;
  }

  serialize() {
    return {
      kind: OUTBOX_KIND,
      version: OUTBOX_VERSION,
      records: [...this.records.values()],
    };
  }

  restore(raw) {
    if (!raw || raw.kind !== OUTBOX_KIND || !SUPPORTED_OUTBOX_VERSIONS.has(raw.version) || !Array.isArray(raw.records)) return false;
    for (const value of raw.records) {
      const id = cleanString(value?.id);
      if (!id) continue;
      const wallet = cleanString(value.wallet) || walletFromPlayerId(value.playerId);
      const skinDropEarned = whole(value.skinDropEarned) > 0 ? 1 : 0;
      const milestoneNumber = whole(value.skinDropMilestoneNumber ?? value.assignedSkinMilestoneNumber ?? value.resolvedSkinMilestones) || (skinDropEarned ? 1 : 0);
      let creditStatus = cleanString(value.creditStatus) || 'recorded';
      if (creditStatus === 'recorded' && this.config.creditSubmissionEnabled && safeBigInt(value.amountYesRaw) > 0n) creditStatus = 'pending';
      let skinDropStatus = skinDropEarned ? cleanString(value.skinDropStatus) || 'pending' : 'not_earned';
      if (skinDropStatus === 'disabled' && this.config.eventSubmissionEnabled) skinDropStatus = 'pending';
      const createdAt = cleanString(value.createdAt) || new Date(this.now()).toISOString();
      const record = {
        ...value,
        id,
        externalRef: cleanString(value.externalRef) || `yes-pusher:turn:${id}`,
        skinDropExternalRef: skinDropEarned
          ? cleanString(value.skinDropExternalRef) || stableSkinExternalRef({ wallet, milestoneNumber, turnId: id })
          : null,
        playerId: cleanString(value.playerId),
        wallet: wallet || null,
        bucketId: this.config.bucketId || cleanString(value.bucketId) || null,
        turnNumber: whole(value.turnNumber ?? value.number),
        coinsDropped: whole(value.coinsDropped),
        coinsWon: whole(value.coinsWon),
        coinsLost: whole(value.coinsLost),
        lifetimeCoinsWon: whole(value.lifetimeCoinsWon),
        crossedMilestones: whole(value.crossedMilestones),
        skinDropEarned,
        skinDropMilestoneNumber: milestoneNumber,
        pendingSkinMilestones: whole(value.pendingSkinMilestones),
        amountYesRaw: safeBigInt(value.amountYesRaw).toString(),
        creditStatus,
        eventStatus: 'not_required',
        skinDropStatus,
        attempts: whole(value.attempts),
        creditAttempts: whole(value.creditAttempts),
        skinDropAttempts: whole(value.skinDropAttempts),
        nextAttemptAtMs: ['pending'].includes(creditStatus) || ['pending'].includes(skinDropStatus) ? this.now() : 0,
        lastError: cleanString(value.lastError) || null,
        creditError: cleanString(value.creditError) || (creditStatus === 'failed' ? cleanString(value.lastError) || null : null),
        skinDropError: cleanString(value.skinDropError) || (skinDropStatus === 'failed' ? cleanString(value.lastError) || null : null),
        creditResponse: compactResponse(value.creditResponse),
        eventResponse: compactResponse(value.eventResponse),
        skinDropResponse: compactResponse(value.skinDropResponse),
        skinDropSelection: compactResponse(value.skinDropSelection),
        skinProgressConfirmed: Boolean(value.skinProgressConfirmed),
        createdAt,
        updatedAt: cleanString(value.updatedAt) || createdAt,
        confirmedAt: cleanString(value.confirmedAt) || null,
      };
      this.records.set(id, record);
    }
    return true;
  }
}
