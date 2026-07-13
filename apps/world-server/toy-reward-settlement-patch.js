import fs from 'node:fs';
import path from 'node:path';
import { SettlementOutbox } from './settlement-outbox.js';

export const TOY_REWARD_TRIGGER_KEY = 'coin_pusher.toy_knocked_off';
export const TOY_REWARD_OFFERING_NAME = 'YES Pusher Toy Rewards';
export const RUBBER_DUCK_CLASS_KEY = 'yes_pusher.toy.rubber_duck.small';

function clean(value) {
  return String(value ?? '').trim();
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compact(value) {
  try {
    return value == null ? null : JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function walletFromPlayerId(playerId) {
  const value = clean(playerId);
  return value.startsWith('wallet:') ? value.slice('wallet:'.length).toLowerCase() : null;
}

function dataDir() {
  return clean(process.env.YES_PUSHER_DATA_DIR) || '.world-data';
}

function replayPath(turnId) {
  const safeId = clean(turnId).replace(/[^a-zA-Z0-9._-]/g, '');
  return safeId ? path.join(dataDir(), 'replays', `${safeId}.json`) : null;
}

function toyPayoutsFromReplay(turnId) {
  const filePath = replayPath(turnId);
  if (!filePath) return [];
  try {
    const replay = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return (Array.isArray(replay?.events) ? replay.events : [])
      .filter((event) => event?.type === 'toy-payout' && clean(event?.toyKey) === 'rubber_duck')
      .map((event) => ({
        toyId: clean(event.toyId),
        toyKey: 'rubber_duck',
        turnId: clean(event.turnId || turnId),
        playerId: clean(event.playerId),
        at: Number(event.at) || 0,
        position: Array.isArray(event.position) ? [...event.position] : null,
      }))
      .filter((event) => event.toyId);
  } catch {
    return [];
  }
}

function normalizeToyPayouts(value, turnId) {
  const payouts = Array.isArray(value) ? value : [];
  return payouts
    .filter((event) => clean(event?.toyKey) === 'rubber_duck' && clean(event?.toyId))
    .map((event) => ({
      toyId: clean(event.toyId),
      toyKey: 'rubber_duck',
      turnId: clean(event.turnId || turnId),
      playerId: clean(event.playerId),
      at: Number(event.at) || 0,
      position: Array.isArray(event.position) ? [...event.position] : null,
    }));
}

function createReward(record, payout, now) {
  const wallet = clean(record.wallet) || walletFromPlayerId(record.playerId);
  const configured = Boolean(record.bucketId && clean(record.__toyEventConfigured));
  const createdAt = new Date(now).toISOString();
  return {
    toyId: payout.toyId,
    toyKey: payout.toyKey,
    turnId: payout.turnId || record.id,
    playerId: payout.playerId || record.playerId,
    wallet: wallet || null,
    eventAt: payout.at,
    position: payout.position,
    classKey: RUBBER_DUCK_CLASS_KEY,
    externalRef: `yes-pusher:toy-reward:${(wallet || record.playerId || 'unknown').toLowerCase()}:${payout.toyId}`,
    status: !wallet ? 'wallet_required' : configured ? 'pending' : 'disabled',
    attempts: 0,
    error: null,
    response: null,
    selection: null,
    createdAt,
    updatedAt: createdAt,
  };
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
  return clean(payload?.error?.message)
    || clean(payload?.error)
    || clean(payload?.message)
    || fallback;
}

function firstResolution(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const failed = results.find((result) => result?.matched === true && result?.resultType === 'failed');
  if (failed) throw new Error(clean(failed.error) || 'Yokefellow matched the toy reward but failed to create it.');
  const selected = results.find((result) => result?.matched === true)
    ?? results.find((result) => result?.resultType === 'rejected_duplicate')
    ?? null;
  if (!selected) {
    const rejected = results.find((result) => result?.matched === false) ?? null;
    throw new Error(clean(rejected?.error || rejected?.reason || rejected?.resultType)
      || 'Yokefellow recorded the toy event without resolving a reward.');
  }
  const selectedClassId = clean(selected.selectedClassId || selected.classId) || null;
  const selectedOutputId = clean(selected.selectedOutputId) || null;
  if (!selectedClassId && !selectedOutputId) {
    throw new Error(clean(selected.error || selected.reason || selected.resultType)
      || 'The toy reward offering did not return an NFT output.');
  }
  return {
    offeringId: clean(selected.offeringId) || null,
    requestId: clean(selected.requestId) || null,
    resultType: clean(selected.resultType) || null,
    selectedOutputId,
    selectedClassId,
    mintJobId: clean(selected.mintJobId) || null,
    mintId: clean(selected.mintId) || null,
    duplicate: selected.resultType === 'rejected_duplicate',
  };
}

async function fetchToyCatalog(outbox) {
  const response = await outbox.fetchImpl(
    `${outbox.config.apiBaseUrl}/buckets/${encodeURIComponent(outbox.config.bucketId)}/catalog`,
    {
      method: 'GET',
      headers: { 'x-yf-app-key': outbox.config.appKey },
    },
  );
  const payload = await readPayload(response);
  if (!response.ok || payload?.ok === false) {
    throw new Error(errorMessage(payload, `Could not load the Yokefellow toy catalog (${response.status})`));
  }
  return payload;
}

function resolveToyOffering(catalog) {
  const offerings = Array.isArray(catalog?.offerings) ? catalog.offerings : [];
  const classes = Array.isArray(catalog?.classes) ? catalog.classes : [];
  const triggerKey = clean(process.env.YES_PUSHER_TOY_REWARD_TRIGGER_KEY) || TOY_REWARD_TRIGGER_KEY;
  const offeringName = clean(process.env.YES_PUSHER_TOY_REWARD_OFFERING_NAME) || TOY_REWARD_OFFERING_NAME;
  const classKey = clean(process.env.YES_PUSHER_RUBBER_DUCK_TOY_CLASS_KEY) || RUBBER_DUCK_CLASS_KEY;

  const offering = offerings.find((candidate) => {
    const meta = safeObject(candidate?.meta);
    return [meta.appBindingKey, meta.gameAction, meta.triggerKey].map(clean).includes(triggerKey);
  }) ?? offerings.find((candidate) => clean(candidate?.title) === offeringName) ?? null;
  if (!offering) throw new Error(`${offeringName} was not found in the Yokefellow bucket catalog.`);
  if (clean(offering.status) !== 'live' || offering.active === false) throw new Error(`${offeringName} is not live.`);
  if (clean(offering.mode) !== 'earned') throw new Error(`${offeringName} must use earned mode.`);

  const itemClass = classes.find((candidate) => clean(candidate?.slug) === classKey)
    ?? classes.find((candidate) => clean(safeObject(candidate?.metadataTemplate).classKey) === classKey)
    ?? null;
  if (!itemClass) throw new Error(`NFT class ${classKey} was not found in the Yokefellow bucket catalog.`);
  const outputs = Array.isArray(offering.outputs) ? offering.outputs : [];
  const output = outputs.find((candidate) => clean(candidate?.itemClassId) === clean(itemClass.id)) ?? null;
  if (!output) throw new Error(`${itemClass.name || classKey} is not attached to ${offeringName}.`);

  return { offering, output, itemClass, triggerKey, offeringName, classKey };
}

async function executeQueuedMint(outbox, reward) {
  const jobId = clean(reward?.selection?.mintJobId);
  if (!jobId || reward.selection?.mintId || reward.selection?.automaticMintAttempted) return false;
  reward.selection.automaticMintAttempted = true;
  reward.selection.automaticMintAttemptedAt = new Date(outbox.now()).toISOString();
  const response = await outbox.fetchImpl(`${outbox.config.apiBaseUrl}/queues/mint`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-yf-app-key': outbox.config.appKey,
      'x-idempotency-key': `${reward.externalRef}:automatic-mint:v1`,
    },
    body: JSON.stringify({
      bucketId: outbox.config.bucketId,
      jobId,
      limit: 1,
    }),
  });
  const payload = await readPayload(response);
  if (!response.ok || payload?.ok === false) {
    throw new Error(errorMessage(payload, `Automatic toy mint request failed (${response.status})`));
  }
  const result = Array.isArray(payload?.results)
    ? payload.results.find((candidate) => clean(candidate?.jobId) === jobId) ?? payload.results[0]
    : null;
  if (result?.minted && clean(result?.tokenId)) {
    reward.selection.mintId = clean(result.tokenId);
    reward.selection.mintJobId = null;
    reward.selection.mintStatus = 'completed';
    reward.selection.mintTxHash = clean(result.txHash) || null;
    reward.status = 'issued';
    reward.error = null;
    return true;
  }
  reward.selection.mintStatus = clean(result?.status) || reward.selection.mintStatus || 'queued';
  reward.selection.automaticMintError = clean(result?.error)
    || (result?.attempted === false ? 'Automatic mint signer is not configured.' : 'Automatic mint did not complete.');
  reward.status = 'submitted';
  return true;
}

async function submitToyReward(outbox, record, reward) {
  const catalog = await fetchToyCatalog(outbox);
  const resolved = resolveToyOffering(catalog);
  const response = await outbox.postJson(outbox.offeringEventsUrl(), {
    idempotencyKey: `${reward.externalRef}:event`,
    body: {
      wallet: reward.wallet,
      appSlug: outbox.config.appSlug,
      eventType: 'toy_knocked_off',
      offeringId: resolved.offering.id,
      selectedOutputId: resolved.output.id,
      metrics: {
        toyKnockedOff: 1,
        toyKey: reward.toyKey,
      },
      meta: {
        eventId: reward.externalRef,
        triggerKey: resolved.triggerKey,
        offeringName: resolved.offeringName,
        resolvedOfferingId: resolved.offering.id,
        resultKey: resolved.classKey,
        selectedOutputId: resolved.output.id,
        classId: resolved.itemClass.id,
        turnId: reward.turnId,
        toyId: reward.toyId,
        toyKey: reward.toyKey,
        externalRef: reward.externalRef,
      },
    },
  });
  reward.response = compact(response);
  reward.selection = firstResolution(response);
  reward.status = 'submitted';
  reward.error = null;
  await executeQueuedMint(outbox, reward);
  return true;
}

function installToyRewardSettlementPatch() {
  const prototype = SettlementOutbox.prototype;
  if (prototype.toyRewardSettlementPatchInstalled) return;

  const integrationStatus = prototype.integrationStatus;
  prototype.integrationStatus = function integrationStatusWithToyRewards() {
    const status = integrationStatus.call(this);
    return {
      ...status,
      toyRewardTriggerKey: clean(process.env.YES_PUSHER_TOY_REWARD_TRIGGER_KEY) || TOY_REWARD_TRIGGER_KEY,
      toyRewardOfferingName: clean(process.env.YES_PUSHER_TOY_REWARD_OFFERING_NAME) || TOY_REWARD_OFFERING_NAME,
      rubberDuckToyClassKey: clean(process.env.YES_PUSHER_RUBBER_DUCK_TOY_CLASS_KEY) || RUBBER_DUCK_CLASS_KEY,
      toyRewardSubmissionConfigured: Boolean(this.config.eventSubmissionEnabled),
    };
  };

  const enqueue = prototype.enqueue;
  prototype.enqueue = function enqueueWithToyRewards(result) {
    const response = enqueue.call(this, result);
    const record = this.records.get(clean(result?.id));
    if (!record) return response;
    record.__toyEventConfigured = this.config.eventSubmissionEnabled ? 'true' : '';
    const payouts = normalizeToyPayouts(result?.toyPayouts, record.id);
    record.toyRewards = payouts.map((payout) => createReward(record, payout, this.now()));
    delete record.__toyEventConfigured;
    return { ...record };
  };

  const viewForPlayer = prototype.viewForPlayer;
  prototype.viewForPlayer = function viewForPlayerWithToyRewards(playerId) {
    const view = viewForPlayer.call(this, playerId);
    const records = [...this.records.values()].filter((record) => record.playerId === clean(playerId));
    const rewards = records.flatMap((record) => Array.isArray(record.toyRewards) ? record.toyRewards : []);
    return {
      ...view,
      toyRewardPendingCount: rewards.filter((reward) => ['pending', 'submitted', 'disabled'].includes(reward.status)).length,
      failedToyRewardIds: rewards.filter((reward) => reward.status === 'failed').map((reward) => reward.toyId),
    };
  };

  const process = prototype.process;
  prototype.process = async function processWithToyRewards(options = {}) {
    const changed = await process.call(this, options);
    if (this.__toyRewardProcessing || typeof this.fetchImpl !== 'function') return changed;
    this.__toyRewardProcessing = true;
    let toyChanged = false;
    try {
      const limit = Math.max(1, Math.floor(Number(options?.limit) || 10));
      let processed = 0;
      for (const record of this.records.values()) {
        if (processed >= limit) break;
        if (!Array.isArray(record.toyRewards) || !record.toyRewards.length) {
          const recovered = toyPayoutsFromReplay(record.id);
          if (recovered.length) {
            record.__toyEventConfigured = this.config.eventSubmissionEnabled ? 'true' : '';
            record.toyRewards = recovered.map((payout) => createReward(record, payout, this.now()));
            delete record.__toyEventConfigured;
            toyChanged = true;
          }
        }
        for (const reward of record.toyRewards ?? []) {
          if (processed >= limit) break;
          if (reward.status === 'disabled' && this.config.eventSubmissionEnabled && reward.wallet) {
            reward.status = 'pending';
            toyChanged = true;
          }
          if (reward.status === 'pending') {
            reward.attempts = Math.max(0, Number(reward.attempts) || 0) + 1;
            try {
              await submitToyReward(this, record, reward);
            } catch (error) {
              reward.status = 'failed';
              reward.error = error instanceof Error ? error.message : 'Toy reward submission failed.';
            }
            reward.updatedAt = new Date(this.now()).toISOString();
            record.updatedAt = reward.updatedAt;
            toyChanged = true;
            processed += 1;
            continue;
          }
          if (reward.status === 'submitted' && reward.selection?.mintJobId && !reward.selection?.automaticMintAttempted) {
            try {
              await executeQueuedMint(this, reward);
            } catch (error) {
              reward.selection.automaticMintAttempted = true;
              reward.selection.automaticMintError = error instanceof Error ? error.message : 'Automatic toy mint failed.';
            }
            reward.updatedAt = new Date(this.now()).toISOString();
            record.updatedAt = reward.updatedAt;
            toyChanged = true;
            processed += 1;
          }
        }
      }
    } finally {
      this.__toyRewardProcessing = false;
    }
    return changed || toyChanged;
  };

  Object.defineProperty(prototype, 'toyRewardSettlementPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installToyRewardSettlementPatch();

export {
  executeQueuedMint,
  fetchToyCatalog,
  installToyRewardSettlementPatch,
  resolveToyOffering,
  submitToyReward,
  toyPayoutsFromReplay,
};
