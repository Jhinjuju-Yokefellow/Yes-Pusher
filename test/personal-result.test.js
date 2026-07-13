import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resultBelongsToSnapshotSelf,
  sanitizePersonalSnapshot,
  settlementBelongsToSnapshotSelf,
} from '../src/ui/personal-result.js';

function snapshot({ selfId = 'wallet:0x111', resultPlayerId = selfId, settlementPlayerId = selfId } = {}) {
  return {
    kind: 'yes-pusher-shared-world',
    self: { id: selfId, wallet: '0x111' },
    auth: { wallet: '0x111' },
    turn: {
      lastResult: {
        id: 'turn-1',
        playerId: resultPlayerId,
        coinsWon: 3,
      },
    },
    settlement: {
      last: {
        id: 'turn-1',
        playerId: settlementPlayerId,
        wallet: '0x111',
        amountYesRaw: '3000000000000000000',
      },
    },
  };
}

test('the completed result and settlement stay visible to their wallet only', () => {
  const own = snapshot();
  assert.equal(resultBelongsToSnapshotSelf(own), true);
  assert.equal(settlementBelongsToSnapshotSelf(own), true);
  assert.equal(sanitizePersonalSnapshot(own), own);
});

test('another player never receives the coins or NFT result payload', () => {
  const other = snapshot({ resultPlayerId: 'wallet:0x222', settlementPlayerId: 'wallet:0x222' });
  const sanitized = sanitizePersonalSnapshot(other);
  assert.equal(resultBelongsToSnapshotSelf(other), false);
  assert.equal(settlementBelongsToSnapshotSelf(other), false);
  assert.equal(sanitized.turn.lastResult, null);
  assert.equal(sanitized.settlement.last, null);
});

test('a mismatched settlement wallet is removed even when the player id matches', () => {
  const value = snapshot();
  value.settlement.last.wallet = '0x999';
  const sanitized = sanitizePersonalSnapshot(value);
  assert.equal(sanitized.turn.lastResult, null);
  assert.equal(sanitized.settlement.last, null);
});
