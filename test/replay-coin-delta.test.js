import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCoinDeltaFrame,
  compressRecordedReplayCoins,
  initialCoinDeltaState,
  isCoinDeltaReplay,
} from '../src/game/replay-coin-delta.js';

const sleeping = (id, x) => [id, x, 1, 2, 0, 0, 0, 1, 1, 0];
const moving = (id, x) => [id, x, 1, 2, 0, 0, 0, 1, 0, 0, 0.1, 0, 0, 0, 0.2, 0];

test('stores only changed coin transforms and stable numeric indexes', () => {
  const replay = {
    id: 'turn-1',
    startWorld: { coins: [sleeping('coin-1', 0), sleeping('coin-2', 1)] },
    frames: [
      { t: 0, coins: [sleeping('coin-1', 0), sleeping('coin-2', 1)] },
      { t: 0.2, coins: [moving('coin-1', 0.1), sleeping('coin-2', 1), moving('coin-3', 2)] },
      { t: 0.4, coins: [moving('coin-1', 0.2), moving('coin-3', 2.1)] },
    ],
  };
  const compressed = compressRecordedReplayCoins(replay);
  assert.equal(isCoinDeltaReplay(compressed), true);
  assert.deepEqual(compressed.coinIds, ['coin-1', 'coin-2', 'coin-3']);
  assert.deepEqual(compressed.frames[0].coinDelta, { changes: [], removed: [] });
  assert.equal(compressed.frames[1].coinDelta.changes.length, 2);
  assert.deepEqual(compressed.frames[2].coinDelta.removed, [1]);
  assert.deepEqual(compressed.frames[2].coins, [0, 2]);
  assert.deepEqual(compressed.coinDeltaStats, { fullCoinSamples: 7, deltaCoinSamples: 5 });
});

test('reconstructs the authoritative coin state frame by frame', () => {
  const compressed = compressRecordedReplayCoins({
    startWorld: { coins: [sleeping('coin-1', 0)] },
    frames: [
      { t: 0, coins: [moving('coin-1', 0.5), moving('coin-2', 2)] },
      { t: 0.2, coins: [sleeping('coin-2', 2.2)] },
    ],
  });
  const state = initialCoinDeltaState(compressed);
  assert.deepEqual([...state.keys()], [0]);
  const first = applyCoinDeltaFrame(state, compressed.frames[0]);
  assert.deepEqual(first.added, [1]);
  assert.equal(state.size, 2);
  const second = applyCoinDeltaFrame(state, compressed.frames[1]);
  assert.deepEqual(second.removed, [0]);
  assert.equal(state.size, 1);
  assert.equal(state.get(1)[0], 2.2);
});
