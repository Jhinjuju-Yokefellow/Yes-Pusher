import { Worker } from 'node:worker_threads';
import { WorldEngine } from '../../src/game/world-engine.js';

const WORKER_URL = new URL('./replay-worker.js', import.meta.url);
const WORKER_HOOK = '__YES_PUSHER_RECORDED_TURN_WORKER__';
const SKIN_BRIDGE_KEY = Symbol.for('yes-pusher:skin-loadout-bridge');

const PATCH_MODULES = Object.freeze([
  {
    modulePath: './squeak-wave-boost-patch.js',
    active: () => Boolean(WorldEngine.prototype.squeakWaveBoostPatchInstalled),
  },
  {
    modulePath: './skin-loadout-patch.js',
    active: () => Boolean(WorldEngine.prototype.createCoin?.__skinLoadoutPatched),
  },
  {
    modulePath: './rubber-duck-toy-patch.js',
    active: () => Boolean(WorldEngine.prototype.rubberDuckToyPatchInstalled),
  },
  {
    modulePath: './squeak-wave-patch.js',
    active: () => Boolean(WorldEngine.prototype.squeakWavePatchInstalled),
  },
  {
    modulePath: './front-edge-demo-duck-patch.js',
    active: () => Boolean(WorldEngine.prototype.frontEdgeDemoDuckPatchInstalled),
  },
  {
    modulePath: './fast-preparation-patch.js',
    active: () => Boolean(WorldEngine.prototype.fastPreparationPatchInstalled),
  },
  {
    modulePath: '../../src/game/replay-physics.js',
    active: () => Boolean(WorldEngine.prototype.recordedReplayPhysicsOptimizationInstalled),
  },
]);

function walletFromPlayerId(playerId) {
  const value = String(playerId ?? '').trim().toLowerCase();
  return value.startsWith('wallet:') ? value.slice('wallet:'.length) : '';
}

function activeTurnSkinId(playerId) {
  const wallet = walletFromPlayerId(playerId);
  if (!wallet) return null;
  const loadout = globalThis[SKIN_BRIDGE_KEY]?.loadouts?.get(wallet);
  return loadout?.owned ? String(loadout.skinId ?? '').trim() || null : null;
}

function activePatchModules() {
  return PATCH_MODULES
    .filter((entry) => {
      try {
        return entry.active();
      } catch {
        return false;
      }
    })
    .map((entry) => entry.modulePath);
}

function errorFromWorker(payload) {
  const error = new Error(String(payload?.message || 'Recorded turn worker failed'));
  if (payload?.stack) error.stack = String(payload.stack);
  return error;
}

function prepareRecordedTurnInWorker(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const { onProgress: _ignored, ...serializableOptions } = options;

  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_URL, {
      type: 'module',
      execArgv: [],
      workerData: {
        options: {
          ...serializableOptions,
          activeTurnSkinId: activeTurnSkinId(serializableOptions.playerId),
        },
        patchModules: activePatchModules(),
      },
    });

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      worker.removeAllListeners();
      void worker.terminate().catch(() => {});
      callback(value);
    };

    worker.on('message', (message) => {
      if (message?.type === 'progress') {
        onProgress(message.progress ?? {});
        return;
      }
      if (message?.type === 'result') {
        finish(resolve, message.replayPackage);
        return;
      }
      if (message?.type === 'error') finish(reject, errorFromWorker(message.error));
    });
    worker.on('error', (error) => finish(reject, error));
    worker.on('exit', (code) => {
      if (!settled) finish(reject, new Error(`Recorded turn worker exited before returning a replay (code ${code})`));
    });
  });
}

if (typeof globalThis[WORKER_HOOK] !== 'function') {
  Object.defineProperty(globalThis, WORKER_HOOK, {
    value: prepareRecordedTurnInWorker,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

export {
  activePatchModules,
  activeTurnSkinId,
  prepareRecordedTurnInWorker,
};
