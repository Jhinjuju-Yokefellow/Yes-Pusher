import test from 'node:test';
import assert from 'node:assert/strict';
import '../apps/world-server/boundary-network-cache-patch.js';
import { WorldEngine } from '../src/game/world-engine.js';

test('stable authoritative boundaries reuse their packed network snapshot', () => {
  const engine = new WorldEngine({ seed: 1, seedMachine: false });
  const first = engine.getNetworkSnapshot({ packed: true });
  const second = engine.getNetworkSnapshot({ packed: true });
  assert.equal(second, first);

  engine.createCoin({ x: 0, y: 1, z: 0, startAsleep: true, planar: true });
  const changed = engine.getNetworkSnapshot({ packed: true });
  assert.notEqual(changed, first);
  assert.equal(changed.coinCount, 1);
});
