import { SettlementOutbox } from './settlement-outbox.js';

function clean(value) {
  return String(value ?? '').trim();
}

function installAutomaticMintPatch() {
  const prototype = SettlementOutbox.prototype;
  if (prototype.automaticMintPatchInstalled) return;

  prototype.submitQueuedSkinMint = async function submitQueuedSkinMint(record) {
    const selection = record?.skinDropSelection;
    const jobId = clean(selection?.mintJobId);
    if (!jobId || selection?.mintId || selection?.automaticMintAttempted) return false;

    selection.automaticMintAttempted = true;
    selection.automaticMintAttemptedAt = new Date(this.now()).toISOString();
    try {
      const response = await this.fetchImpl(`${this.config.apiBaseUrl}/queues/mint`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-yf-app-key': this.config.appKey,
          'x-idempotency-key': `${record.skinDropExternalRef || record.id}:automatic-mint`,
        },
        body: JSON.stringify({
          bucketId: this.config.bucketId,
          jobId,
          limit: 1,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        const message = clean(payload?.error?.message || payload?.error || payload?.message)
          || `Automatic mint request failed (${response.status})`;
        throw new Error(message);
      }
      const result = Array.isArray(payload?.results)
        ? payload.results.find((candidate) => clean(candidate?.jobId) === jobId) ?? payload.results[0]
        : null;

      if (result?.minted && clean(result?.tokenId)) {
        selection.mintId = clean(result.tokenId);
        selection.mintJobId = null;
        selection.mintStatus = 'completed';
        selection.mintTxHash = clean(result.txHash) || null;
        selection.automaticMintError = null;
      } else {
        selection.mintStatus = clean(result?.status) || selection.mintStatus || 'queued';
        selection.automaticMintError = clean(result?.error)
          || (result?.attempted === false ? 'Automatic mint signer is not configured.' : 'Automatic mint did not complete.');
      }
    } catch (error) {
      selection.automaticMintError = error instanceof Error ? error.message : 'Automatic mint request failed.';
    }
    record.updatedAt = new Date(this.now()).toISOString();
    return true;
  };

  const process = prototype.process;
  prototype.process = async function processWithAutomaticMint(options = {}) {
    const changed = await process.call(this, options);
    if (!this.config.eventSubmissionEnabled || typeof this.fetchImpl !== 'function') return changed;

    let mintChanged = false;
    const limit = Math.max(1, Number(options?.limit) || 10);
    const candidates = [...this.records.values()]
      .filter((record) => (
        record.skinDropStatus === 'submitted'
        && record.skinDropSelection?.mintJobId
        && !record.skinDropSelection?.mintId
        && !record.skinDropSelection?.automaticMintAttempted
      ))
      .slice(0, limit);

    for (const record of candidates) {
      mintChanged = await this.submitQueuedSkinMint(record) || mintChanged;
    }
    return changed || mintChanged;
  };

  Object.defineProperty(prototype, 'automaticMintPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installAutomaticMintPatch();

export { installAutomaticMintPatch };
