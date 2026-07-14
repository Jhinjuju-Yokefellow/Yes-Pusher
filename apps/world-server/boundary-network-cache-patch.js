import { WorldEngine } from '../../src/game/world-engine.js';
import { TURN_STATES } from '../../src/game/turn-controller.js';

const PATCH_KEY = Symbol.for('yes-pusher:boundary-network-cache-patch');
const CACHE_KEY = Symbol.for('yes-pusher:boundary-network-cache');

function cacheFor(engine) {
  if (!engine[CACHE_KEY]) {
    Object.defineProperty(engine, CACHE_KEY, {
      value: { packed: null, object: null },
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }
  return engine[CACHE_KEY];
}

export function invalidateBoundaryNetworkCache(engine) {
  const cache = engine?.[CACHE_KEY];
  if (!cache) return;
  cache.packed = null;
  cache.object = null;
}

function boundaryIsStable(engine) {
  return Boolean(
    engine
    && !engine.visualReplayActive
    && engine.turnController?.getSnapshot?.().state === TURN_STATES.READY
  );
}

function wrapInvalidator(prototype, methodName) {
  const original = prototype[methodName];
  if (typeof original !== 'function' || original.__boundaryCacheInvalidator) return;
  const wrapped = function invalidateBeforeBoundaryMutation(...args) {
    invalidateBoundaryNetworkCache(this);
    return original.apply(this, args);
  };
  Object.defineProperty(wrapped, '__boundaryCacheInvalidator', { value: true });
  prototype[methodName] = wrapped;
}

function installBoundaryNetworkCachePatch() {
  const prototype = WorldEngine.prototype;
  if (prototype[PATCH_KEY]) return;

  const getNetworkSnapshot = prototype.getNetworkSnapshot;
  prototype.getNetworkSnapshot = function getCachedBoundaryNetworkSnapshot(options = {}) {
    if (!boundaryIsStable(this)) return getNetworkSnapshot.call(this, options);
    const slot = options?.packed ? 'packed' : 'object';
    const cache = cacheFor(this);
    if (!cache[slot]) cache[slot] = getNetworkSnapshot.call(this, options);
    return cache[slot];
  };

  for (const methodName of [
    'initializeEmptyMachine',
    'resetMachine',
    'clearCoins',
    'createCoin',
    'removeCoin',
    'restoreCoin',
    'restoreConfirmedWorld',
    'createToy',
    'removeToy',
    'clearToys',
    'createRubberDuckToy',
  ]) {
    wrapInvalidator(prototype, methodName);
  }

  Object.defineProperty(prototype, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installBoundaryNetworkCachePatch();

export { boundaryIsStable, installBoundaryNetworkCachePatch };
