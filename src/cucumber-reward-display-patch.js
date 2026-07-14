import { SharedWorldView } from './network/shared-world-view.js';

function rewardForToyId(toyId) {
  let hash = 2166136261;
  for (const character of String(toyId ?? '').trim()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return 6 + (hash % 5);
}

function installCucumberRewardDisplayPatch() {
  const prototype = SharedWorldView.prototype;
  if (prototype.cucumberRewardDisplayPatchInstalled) return;
  const startCucumberChopVisual = prototype.startCucumberChopVisual;
  if (typeof startCucumberChopVisual !== 'function') {
    throw new Error('Cucumber reward display requires the cucumber chop view patch first');
  }

  prototype.startCucumberChopVisual = function startCucumberChopVisualWithExactReward(event = {}) {
    return startCucumberChopVisual.call(this, {
      ...event,
      rewardCoins: rewardForToyId(event.toyId),
    });
  };

  Object.defineProperty(prototype, 'cucumberRewardDisplayPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installCucumberRewardDisplayPatch();

export { installCucumberRewardDisplayPatch, rewardForToyId };
