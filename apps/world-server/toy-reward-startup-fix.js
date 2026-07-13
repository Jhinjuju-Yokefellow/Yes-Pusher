import { SettlementOutbox } from './settlement-outbox.js';
import {
  RUBBER_DUCK_CLASS_KEY,
  TOY_REWARD_OFFERING_NAME,
  TOY_REWARD_TRIGGER_KEY,
} from './toy-reward-settlement-patch.js';

function clean(value) {
  return String(value ?? '').trim();
}

function installToyRewardStartupFix() {
  const prototype = SettlementOutbox.prototype;
  if (prototype.toyRewardStartupFixInstalled) return;

  prototype.integrationStatus = function integrationStatusWithoutProcessShadow() {
    const env = globalThis.process?.env ?? {};
    return {
      bucketId: this.config.bucketId || null,
      eventType: this.config.eventType,
      eventSubmissionConfigured: this.config.eventSubmissionEnabled,
      creditSubmissionConfigured: this.config.creditSubmissionEnabled,
      creditGrantUrl: this.config.creditSubmissionEnabled ? this.config.creditGrantUrl : null,
      payoutMode: this.config.creditSubmissionEnabled ? 'yokefellow-bucket-credit' : 'record-only',
      yesPerCoinRaw: this.config.yesPerCoinRaw,
      skinDropTriggerKey: this.config.skinDropTriggerKey,
      skinDropOfferingName: this.config.skinDropOfferingName,
      automaticFailureRetry: false,
      toyRewardTriggerKey: clean(env.YES_PUSHER_TOY_REWARD_TRIGGER_KEY) || TOY_REWARD_TRIGGER_KEY,
      toyRewardOfferingName: clean(env.YES_PUSHER_TOY_REWARD_OFFERING_NAME) || TOY_REWARD_OFFERING_NAME,
      rubberDuckToyClassKey: clean(env.YES_PUSHER_RUBBER_DUCK_TOY_CLASS_KEY) || RUBBER_DUCK_CLASS_KEY,
      toyRewardSubmissionConfigured: Boolean(this.config.eventSubmissionEnabled),
    };
  };

  Object.defineProperty(prototype, 'toyRewardStartupFixInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installToyRewardStartupFix();

export { installToyRewardStartupFix };
