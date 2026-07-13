import { SharedWorldClient } from './network/shared-world-client.js';

function ensureToyRewardRow() {
  if (typeof document === 'undefined') return null;
  let row = document.querySelector('#resultToyReward');
  if (row) return row;
  const credit = document.querySelector('#resultCredit');
  const modal = document.querySelector('#turnResult');
  if (!credit || !modal) return null;
  row = document.createElement('span');
  row.id = 'resultToyReward';
  row.className = 'result-credit hidden';
  credit.before(row);
  return row;
}

function renderToyReward(snapshot) {
  const row = ensureToyRewardRow();
  if (!row) return;
  const rewards = Array.isArray(snapshot?.settlement?.last?.toyRewards)
    ? snapshot.settlement.last.toyRewards
    : [];
  const reward = rewards.find((candidate) => candidate?.toyKey === 'rubber_duck') ?? null;
  row.classList.remove('confirmed', 'pending', 'failed');
  if (!reward) {
    row.classList.add('hidden');
    row.textContent = '';
    return;
  }
  row.classList.remove('hidden');
  if (reward.status === 'issued' || reward.selection?.mintId) {
    row.textContent = 'RUBBER DUCK TOY NFT ISSUED';
    row.classList.add('confirmed');
  } else if (reward.status === 'submitted') {
    row.textContent = reward.selection?.mintJobId
      ? 'RUBBER DUCK TOY NFT MINT QUEUED'
      : 'RUBBER DUCK TOY REWARD RECORDED';
    row.classList.add('pending');
  } else if (reward.status === 'pending') {
    row.textContent = 'RUBBER DUCK TOY NFT SUBMITTING';
    row.classList.add('pending');
  } else if (reward.status === 'failed') {
    row.textContent = `RUBBER DUCK TOY NFT FAILED — ${String(reward.error || 'CHECK YOKEFELLOW SETUP').toUpperCase()}`;
    row.classList.add('failed');
  } else if (reward.status === 'wallet_required') {
    row.textContent = 'CONNECT WALLET FOR RUBBER DUCK TOY NFT';
    row.classList.add('failed');
  } else {
    row.textContent = 'RUBBER DUCK TOY NFT WAITING';
    row.classList.add('pending');
  }
}

function installToyRewardUiPatch() {
  const prototype = SharedWorldClient.prototype;
  if (prototype.toyRewardUiPatchInstalled) return;
  const acceptSnapshot = prototype.acceptSnapshot;
  prototype.acceptSnapshot = function acceptSnapshotWithToyReward(snapshot, source = 'unknown') {
    const accepted = acceptSnapshot.call(this, snapshot, source);
    if (accepted) renderToyReward(snapshot);
    return accepted;
  };
  Object.defineProperty(prototype, 'toyRewardUiPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installToyRewardUiPatch();

export { ensureToyRewardRow, installToyRewardUiPatch, renderToyReward };
