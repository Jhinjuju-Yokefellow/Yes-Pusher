import { WorldEngine } from '../../src/game/world-engine.js';
import { TURN_STATES } from '../../src/game/turn-controller.js';

const CACHE_KEY = Symbol.for('yes-pusher:idle-network-snapshot-cache');
const PATCH_KEY = Symbol.for('yes-pusher:idle-network-snapshot-cache-patch');
const MUTATION_WRAPPER_KEY = Symbol.for('yes-pusher:idle-network-snapshot-cache-mutation-wrapper');

function clearIdleNetworkSnapshotCache(engine) {
  if (engine && typeof engine === 'object') engine[CACHE_KEY] = null;
}

function installIdleNetworkSnapshotCachePatch() {
  const prototype = WorldEngine.prototype;
  if (prototype[PATCH_KEY]) return;

  const originalGetNetworkSnapshot = prototype.getNetworkSnapshot;
  prototype.getNetworkSnapshot = function getCachedIdleNetworkSnapshot(options = {}) {
    const packed = Boolean(options?.packed);
    const turnState = this.turnController?.getSnapshot?.().state;
    const cacheable = turnState === TURN_STATES.READY && !this.visualReplayActive;

    if (!cacheable) return originalGetNetworkSnapshot.call(this, options);

    let cache = this[CACHE_KEY];
    if (!(cache instanceof Map)) {
      cache = new Map();
      this[CACHE_KEY] = cache;
    }

    const cacheKey = packed ? 'packed' : 'object';
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const snapshot = originalGetNetworkSnapshot.call(this, options);
    cache.set(cacheKey, snapshot);
    return snapshot;
  };

  for (const methodName of [
    'initializeEmptyMachine',
    'resetMachine',
    'clearCoins',
    'createCoin',
    'removeCoin',
    'restoreCoin',
    'restoreConfirmedWorld',
    'startTurn',
    'fixedStep',
  ]) {
    const original = prototype[methodName];
    if (typeof original !== 'function' || original[MUTATION_WRAPPER_KEY]) continue;

    const wrapped = function invalidateIdleNetworkSnapshotAfterMutation(...args) {
      try {
        return original.apply(this, args);
      } finally {
        clearIdleNetworkSnapshotCache(this);
      }
    };
    Object.defineProperty(wrapped, MUTATION_WRAPPER_KEY, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    prototype[methodName] = wrapped;
  }

  Object.defineProperty(prototype, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installIdleNetworkSnapshotCachePatch();

export {
  clearIdleNetworkSnapshotCache,
  installIdleNetworkSnapshotCachePatch,
};
