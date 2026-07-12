import { COIN_SKINS, getCoinSkin } from '../../src/config/skin-catalog.js';

const OUTBOX_KIND = 'yes-pusher-settlement-outbox';
const OUTBOX_VERSION = 2;
const LEGACY_OUTBOX_VERSION = 1;
const DEFAULT_YES_PER_COIN_RAW = '1000000000000000000';
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
  if (typeof value !== 'object') return String(value).slice(0, 1000);
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
    return { ok: response.ok, text: text.slice(0, 1000) };
  }
}

function skinDropStatusFor({ wallet, earned, enabled }) {
  if (!earned) return 'not_earned';
  if (!wallet) return 'wallet_required';
  return enabled ? 'pending' : 'disabled';
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
  const matched = results.find((result) => result?.matched === true) ?? null;
  const duplicate = results.find((result) => result?.resultType === 'rejected_duplicate') ?? null;
  const selected = matched ?? duplicate;
  if (!selected) return null;
  return {
    offeringId: cleanString(selected.offeringId) || null,
    requestId: cleanString(selected.requestId) || null,
    resultType: cleanString(selected.resultType) || null,
    selectionMode: cleanString(selected.selectionMode) || null,
    fulfillmentMode: cleanString(selected.fulfillmentMode) || null,
    selectedOutputId: cleanString(selected.selectedOutputId) || null,
    selectedClassId: cleanString(selected.selectedClassId) || null,
    mintJobId: cleanString(selected.mintJobId) || null,
    mintId: cleanString(selected.mintId) || null,
    duplicate: Boolean(duplicate && !matched),
  };
}

export function settlementConfigFromEnv(env = process.env) {
  const apiBaseUrl = cleanUrl(env.YF_API_BASE_URL);
  const appKey = cleanString(env.YF_APP_KEY);
  const bucketId = cleanString(env.YF_BUCKET_ID);
  const creditGrantUrl = cleanUrl(env.YF_CREDIT_GRANT_URL);
  const yesPerCoinRaw = safeBigInt(env.YES_PUSHER_YES_PER_COIN_RAW, BigInt(DEFAULT_YES_PER_COIN_RAW)).toString();
  return {
    apiBaseUrl,
    appKey,
    bucketId,
    creditGrantUrl,
    yesPerCoinRaw,
    appSlug: cleanString(env.YES_PUSHER_APP_SLUG) || 'yes-pusher',
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
      eventSubmissionConfigured: this.config.eventSubmissionEnabled,
      creditSubmissionConfigured: this.config.creditSubmissionEnabled,
      payoutMode: this.config.creditSubmissionEnabled ? 'yokefellow' : 'record-only',
      yesPerCoinRaw: this.config.yesPerCoinRaw,
      skinDropTriggerKey: this.config.skinDropTriggerKey,
      skinDropOfferingName: this.config.skinDropOfferingName,
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
    const resolvedSkinMilestones = whole(result?.resolvedSkinMilestones);
    const amountYesRaw = (BigInt(coinsWon) * safeBigInt(this.config.yesPerCoinRaw, BigInt(DEFAULT_YES_PER_COIN_RAW))).toString();
    const createdAt = new Date(this.now()).toISOString();
    const creditStatus = !wallet
      ? 'wallet_required'
      : coinsWon === 0
        ? 'no_payout'
        : this.config.creditSubmissionEnabled
          ? 'pending'
          : 'recorded';
    const eventStatus = !wallet
      ? 'wallet_required'
      : this.config.eventSubmissionEnabled
        ? 'pending'
        : 'disabled';
    const externalRef = `yes-pusher:turn:${turnId}`;
    const skinDropExternalRef = skinDropEarned
      ? `yes-pusher:skin-drop:${turnId}:milestone:${Math.max(1, resolvedSkinMilestones)}`
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
      pendingSkinMilestones: whole(result?.pendingSkinMilestones),
      resolvedSkinMilestones,
      amountYesRaw,
      creditStatus,
      eventStatus,
      skinDropStatus: skinDropStatusFor({
        wallet,
        earned: skinDropEarned,
        enabled: this.config.eventSubmissionEnabled,
      }),
      attempts: 0,
      nextAttemptAtMs: this.now(),
      lastError: null,
      creditResponse: null,
      eventResponse: null,
      skinDropResponse: null,
      skinDropSelection: null,
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

  viewForPlayer(playerId) {
    const id = cleanString(playerId);
    const records = [...this.records.values()]
      .filter((record) => record.playerId === id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const pending = records.filter((record) => ['pending', 'failed'].includes(record.creditStatus)).length;
    const skinDropPendingCount = records.filter((record) => ['pending', 'failed'].includes(record.skinDropStatus)).length;
    const owedYesRaw = records
      .filter((record) => ['recorded', 'pending', 'failed'].includes(record.creditStatus))
      .reduce((sum, record) => sum + safeBigInt(record.amountYesRaw), 0n)
      .toString();
    return {
      pendingCount: pending,
      skinDropPendingCount,
      recordedOwedYesRaw: owedYesRaw,
      last: records[0] ? { ...records[0] } : null,
      integration: this.integrationStatus(),
    };
  }

  offeringEventsUrl() {
    return `${this.config.apiBaseUrl}/buckets/${encodeURIComponent(this.config.bucketId)}/offering-events`;
  }

  async postOfferingEvent({ idempotencyKey, body }) {
    const response = await this.fetchImpl(this.offeringEventsUrl(), {
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
      throw new Error(payload?.error?.message || payload?.error || `Offering event failed (${response.status})`);
    }
    return payload;
  }

  async submitEvent(record) {
    if (record.eventStatus !== 'pending' || !this.config.eventSubmissionEnabled) return false;
    const payload = await this.postOfferingEvent({
      idempotencyKey: `${record.externalRef}:event`,
      body: {
        wallet: record.wallet,
        appSlug: this.config.appSlug,
        eventType: 'turn_completed',
        metrics: {
          coinsDropped: record.coinsDropped,
          coinsWon: record.coinsWon,
          coinsLost: record.coinsLost,
          lifetimeCoinsWon: record.lifetimeCoinsWon,
          skinDropEarned: record.skinDropEarned,
          pendingSkinMilestones: record.pendingSkinMilestones,
        },
        meta: {
          eventId: record.externalRef,
          turnId: record.id,
          turnNumber: record.turnNumber,
          externalRef: record.externalRef,
          amountYesRaw: record.amountYesRaw,
        },
      },
    });
    record.eventStatus = 'submitted';
    record.eventResponse = compactResponse(payload);
    return true;
  }

  async enrichSkinDropResolution(resolution) {
    if (!resolution || !this.config.eventSubmissionEnabled) return resolution;
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
      const offering = offerings.find((value) => cleanString(value?.title) === this.config.skinDropOfferingName) ?? null;
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
    const milestoneNumber = Math.max(1, whole(record.resolvedSkinMilestones));
    const payload = await this.postOfferingEvent({
      idempotencyKey: `${record.skinDropExternalRef}:event`,
      body: {
        wallet: record.wallet,
        appSlug: this.config.appSlug,
        eventType: this.config.skinDropTriggerKey,
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
    if (!resolution) {
      throw new Error(`${this.config.skinDropOfferingName} did not match trigger ${this.config.skinDropTriggerKey}`);
    }
    record.skinDropStatus = 'submitted';
    record.skinDropResponse = compactResponse(payload);
    record.skinDropSelection = await this.enrichSkinDropResolution(resolution);
    return true;
  }

  async submitCredit(record) {
    if (record.creditStatus !== 'pending' || !this.config.creditSubmissionEnabled) return false;
    const response = await this.fetchImpl(this.config.creditGrantUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yf-app-key': this.config.appKey,
        'x-idempotency-key': record.externalRef,
      },
      body: JSON.stringify({
        bucketId: this.config.bucketId,
        wallet: record.wallet,
        amountYesRaw: record.amountYesRaw,
        source: this.config.appSlug,
        externalRef: record.externalRef,
        memo: `YES Pusher turn ${record.turnNumber}: ${record.coinsWon} coin${record.coinsWon === 1 ? '' : 's'} won`,
        meta: {
          turnId: record.id,
          turnNumber: record.turnNumber,
          coinsDropped: record.coinsDropped,
          coinsWon: record.coinsWon,
          lifetimeCoinsWon: record.lifetimeCoinsWon,
        },
      }),
    });
    const payload = await readPayload(response);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || payload?.error || `YES credit settlement failed (${response.status})`);
    }
    record.creditStatus = 'confirmed';
    record.creditResponse = compactResponse(payload);
    record.confirmedAt = new Date(this.now()).toISOString();
    return true;
  }

  async processChannel(record, statusKey, submit) {
    if (record[statusKey] !== 'pending') return { changed: false, error: null };
    try {
      return { changed: await submit(), error: null };
    } catch (error) {
      record[statusKey] = 'failed';
      return {
        changed: true,
        error: error instanceof Error ? error.message : 'Settlement submission failed',
      };
    }
  }

  hasPending(record) {
    return record.creditStatus === 'pending'
      || record.eventStatus === 'pending'
      || record.skinDropStatus === 'pending';
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
        record.attempts += 1;
        const errors = [];
        const channels = [
          await this.processChannel(record, 'eventStatus', () => this.submitEvent(record)),
          await this.processChannel(record, 'skinDropStatus', () => this.submitSkinDrop(record)),
          await this.processChannel(record, 'creditStatus', () => this.submitCredit(record)),
        ];
        for (const channel of channels) {
          changed = changed || channel.changed;
          if (channel.error) errors.push(channel.error);
        }
        record.lastError = errors.length ? errors.join(' | ') : null;
        if (errors.length) {
          const delay = Math.min(5 * 60_000, 2_000 * (2 ** Math.min(record.attempts, 7)));
          record.nextAttemptAtMs = this.now() + delay;
        } else if (this.hasPending(record)) {
          record.nextAttemptAtMs = this.now() + 5_000;
        }
        record.updatedAt = new Date(this.now()).toISOString();
      }
    } finally {
      this.processing = false;
    }
    return changed;
  }

  retryFailed() {
    let changed = false;
    const now = this.now();
    for (const record of this.records.values()) {
      if (Number(record.nextAttemptAtMs ?? 0) > now) continue;
      let recordChanged = false;
      if (record.creditStatus === 'failed' && this.config.creditSubmissionEnabled) {
        record.creditStatus = 'pending';
        recordChanged = true;
      }
      if (record.eventStatus === 'failed' && this.config.eventSubmissionEnabled) {
        record.eventStatus = 'pending';
        recordChanged = true;
      }
      if (record.skinDropStatus === 'failed' && this.config.eventSubmissionEnabled && record.skinDropEarned) {
        record.skinDropStatus = 'pending';
        recordChanged = true;
      }
      if (recordChanged) {
        record.updatedAt = new Date(now).toISOString();
        changed = true;
      }
    }
    return changed;
  }

  serialize() {
    return {
      kind: OUTBOX_KIND,
      version: OUTBOX_VERSION,
      records: [...this.records.values()],
    };
  }

  restore(raw) {
    if (!raw || raw.kind !== OUTBOX_KIND || ![LEGACY_OUTBOX_VERSION, OUTBOX_VERSION].includes(raw.version) || !Array.isArray(raw.records)) return false;
    for (const value of raw.records) {
      const id = cleanString(value?.id);
      if (!id) continue;
      const wallet = cleanString(value.wallet) || walletFromPlayerId(value.playerId);
      const skinDropEarned = whole(value.skinDropEarned) > 0 ? 1 : 0;
      const resolvedSkinMilestones = whole(value.resolvedSkinMilestones);
      const skinDropExternalRef = cleanString(value.skinDropExternalRef)
        || (skinDropEarned ? `yes-pusher:skin-drop:${id}:milestone:${Math.max(1, resolvedSkinMilestones)}` : null);
      const record = {
        ...value,
        id,
        wallet,
        skinDropEarned,
        resolvedSkinMilestones,
        skinDropExternalRef,
        skinDropStatus: cleanString(value.skinDropStatus) || skinDropStatusFor({
          wallet,
          earned: skinDropEarned,
          enabled: this.config.eventSubmissionEnabled,
        }),
        skinDropResponse: value.skinDropResponse ?? null,
        skinDropSelection: value.skinDropSelection ?? null,
        attempts: whole(value.attempts),
        nextAttemptAtMs: Number(value.nextAttemptAtMs ?? 0) || 0,
        amountYesRaw: safeBigInt(value.amountYesRaw).toString(),
      };
      if (!record.bucketId && this.config.bucketId) record.bucketId = this.config.bucketId;
      if (record.creditStatus === 'recorded' && this.config.creditSubmissionEnabled && record.wallet && safeBigInt(record.amountYesRaw) > 0n) {
        record.creditStatus = 'pending';
        record.nextAttemptAtMs = this.now();
      }
      if (record.eventStatus === 'disabled' && this.config.eventSubmissionEnabled && record.wallet) {
        record.eventStatus = 'pending';
        record.nextAttemptAtMs = this.now();
      }
      if (record.skinDropStatus === 'disabled' && this.config.eventSubmissionEnabled && record.wallet && record.skinDropEarned) {
        record.skinDropStatus = 'pending';
        record.nextAttemptAtMs = this.now();
      }
      if (record.creditStatus === 'failed' && this.config.creditSubmissionEnabled && record.nextAttemptAtMs <= this.now()) record.creditStatus = 'pending';
      if (record.eventStatus === 'failed' && this.config.eventSubmissionEnabled && record.nextAttemptAtMs <= this.now()) record.eventStatus = 'pending';
      if (record.skinDropStatus === 'failed' && this.config.eventSubmissionEnabled && record.skinDropEarned && record.nextAttemptAtMs <= this.now()) record.skinDropStatus = 'pending';
      this.records.set(id, record);
    }
    return true;
  }
}
