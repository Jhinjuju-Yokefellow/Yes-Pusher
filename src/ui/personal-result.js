function cleanString(value) {
  return String(value ?? '').trim();
}

function normalizeWallet(value) {
  return cleanString(value).toLowerCase();
}

export function resultBelongsToSnapshotSelf(snapshot, result = snapshot?.turn?.lastResult ?? null) {
  const selfId = cleanString(snapshot?.self?.id);
  const resultPlayerId = cleanString(result?.playerId);
  if (!selfId || !result?.id || resultPlayerId !== selfId) return false;

  const selfWallet = normalizeWallet(snapshot?.self?.wallet || snapshot?.auth?.wallet);
  const settlementWallet = normalizeWallet(snapshot?.settlement?.last?.wallet);
  if (selfWallet && settlementWallet && selfWallet !== settlementWallet) return false;
  return true;
}

export function settlementBelongsToSnapshotSelf(snapshot, record = snapshot?.settlement?.last ?? null) {
  const selfId = cleanString(snapshot?.self?.id);
  if (!selfId || !record || cleanString(record.playerId) !== selfId) return false;

  const selfWallet = normalizeWallet(snapshot?.self?.wallet || snapshot?.auth?.wallet);
  const recordWallet = normalizeWallet(record.wallet);
  if (selfWallet && recordWallet && selfWallet !== recordWallet) return false;
  return true;
}

export function sanitizePersonalSnapshot(snapshot) {
  if (!snapshot || snapshot.kind !== 'yes-pusher-shared-world') return snapshot;

  const result = snapshot.turn?.lastResult ?? null;
  const settlementRecord = snapshot.settlement?.last ?? null;
  const keepResult = resultBelongsToSnapshotSelf(snapshot, result);
  const keepSettlement = settlementBelongsToSnapshotSelf(snapshot, settlementRecord);

  if ((!result || keepResult) && (!settlementRecord || keepSettlement)) return snapshot;

  return {
    ...snapshot,
    turn: result && !keepResult
      ? { ...snapshot.turn, lastResult: null }
      : snapshot.turn,
    settlement: settlementRecord && !keepSettlement
      ? { ...snapshot.settlement, last: null }
      : snapshot.settlement,
  };
}
