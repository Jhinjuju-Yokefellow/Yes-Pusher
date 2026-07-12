import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTurnSeconds } from '../src/ui/turn-timer.js';

test('turn timer displays whole seconds without partial values', () => {
  assert.equal(formatTurnSeconds(30), '30');
  assert.equal(formatTurnSeconds(29.91), '30');
  assert.equal(formatTurnSeconds(29), '29');
  assert.equal(formatTurnSeconds(0.01), '1');
  assert.equal(formatTurnSeconds(0), '0');
  assert.equal(formatTurnSeconds(-2), '0');
});
