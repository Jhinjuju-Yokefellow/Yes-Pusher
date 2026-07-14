import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('Recorded turn worker requires a parent thread');

const patchModules = Array.isArray(workerData?.patchModules) ? workerData.patchModules : [];
for (const modulePath of patchModules) await import(modulePath);
if (patchModules.includes('./rubber-duck-toy-patch.js')) {
  await import('./cucumber-slice-toy-patch.js');
  await import('./cucumber-demo-seed-patch.js');
}

const options = workerData?.options ?? {};
const activeTurnSkinId = String(options.activeTurnSkinId ?? '').trim();
const playerId = String(options.playerId ?? '').trim().toLowerCase();
const deltaReplayEnabled = process.env.YES_PUSHER_REPLAY_DELTA !== 'false';

if (activeTurnSkinId && playerId.startsWith('wallet:') && patchModules.includes('./skin-loadout-patch.js')) {
  const { bridge } = await import('./skin-loadout-store.js');
  const wallet = playerId.slice('wallet:'.length);
  bridge.loadouts.set(wallet, {
    wallet,
    skinId: activeTurnSkinId,
    owned: true,
    verifiedAt: Date.now(),
    updatedAt: new Date().toISOString(),
  });
}

const { simulateRecordedTurn } = await import('../../src/game/replay-package.js');
const { compressRecordedReplayCoins } = await import('../../src/game/replay-coin-delta.js');

try {
  const fullReplayPackage = await simulateRecordedTurn({
    ...options,
    __runInWorker: true,
    onProgress: (progress) => {
      parentPort.postMessage({ type: 'progress', progress });
    },
  });
  const replayPackage = deltaReplayEnabled
    ? compressRecordedReplayCoins(fullReplayPackage)
    : fullReplayPackage;
  parentPort.postMessage({ type: 'result', replayPackage });
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    },
  });
}
