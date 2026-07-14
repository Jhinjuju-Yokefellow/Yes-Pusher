export const SHARED_STATUS_KIND = 'yes-pusher-shared-status';
export const SHARED_WORLD_KIND = 'yes-pusher-shared-world';

function clean(value) {
  return String(value ?? '').trim();
}

export function isSharedStatus(value) {
  return Boolean(
    value
    && value.kind === SHARED_STATUS_KIND
    && value.authoritative === true
    && Number.isFinite(Number(value.revision))
  );
}

export function sharedStatusNeedsBoundary(snapshot, status) {
  if (!snapshot || snapshot.kind !== SHARED_WORLD_KIND) return true;
  if (!isSharedStatus(status)) return true;

  const currentServer = clean(snapshot.serverInstanceId);
  const nextServer = clean(status.serverInstanceId);
  if (currentServer && nextServer && currentServer !== nextServer) return true;

  const currentBoundary = clean(snapshot.boundaryId);
  const nextBoundary = clean(status.boundaryId);
  if (!currentBoundary || !nextBoundary || currentBoundary !== nextBoundary) return true;

  return false;
}

export function mergeSharedStatus(snapshot, status) {
  if (sharedStatusNeedsBoundary(snapshot, status)) return null;

  const coins = snapshot.coins;
  const toys = snapshot.toys;
  const coinEncoding = snapshot.coinEncoding;

  return {
    ...snapshot,
    ...status,
    kind: SHARED_WORLD_KIND,
    protocolVersion: snapshot.protocolVersion,
    coins,
    toys,
    coinEncoding,
  };
}
