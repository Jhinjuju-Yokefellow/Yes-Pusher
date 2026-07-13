import './load-env.js';
import http from 'node:http';
import path from 'node:path';
import { mkdir, rename } from 'node:fs/promises';

function parsePort(value, fallback = 8787) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function errorText(error) {
  return error instanceof Error ? error.stack || error.message : String(error);
}

function configuredDataDir() {
  const configured = String(process.env.YES_PUSHER_DATA_DIR || '').trim();
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), '.world-data');
}

function anonymousIdentity(playerId, label = '') {
  const requestedId = String(playerId ?? '').trim();
  if (!requestedId) return null;
  const id = requestedId.startsWith('wallet:')
    ? `guest:${requestedId.slice('wallet:'.length)}`
    : requestedId;
  return {
    playerId: id,
    label: String(label ?? ''),
    wallet: null,
    authenticated: false,
  };
}

function requestIdentity(instance, request, requestUrl) {
  const session = instance.authStore.readRequest(request);
  if (session) {
    return {
      playerId: session.playerId,
      label: session.label,
      wallet: session.wallet,
      authenticated: true,
    };
  }
  return anonymousIdentity(
    requestUrl?.searchParams.get('playerId'),
    requestUrl?.searchParams.get('label') ?? '',
  );
}

function writeJson(response, statusCode, payload, request = null) {
  const body = JSON.stringify(payload);
  const origin = String(request?.headers?.origin ?? '').trim();
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    vary: 'origin',
    ...(origin ? {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
    } : {}),
  });
  response.end(body);
}

function personalizeCachedWorld(instance, cachedWorld, identity) {
  const playerId = identity?.playerId ?? null;
  const queue = instance.queue.publicQueue();
  const activePlayerId = instance.queue.activeId();
  const player = playerId ? instance.queue.getPlayer(playerId) : null;
  const position = playerId ? instance.queue.positionOf(playerId) : null;

  let turn = cachedWorld.turn;
  try {
    turn = instance.progressStore.decorateTurnSnapshot(cachedWorld.turn, playerId);
  } catch (error) {
    console.error('[yes-pusher] could not decorate cached turn snapshot');
    console.error(errorText(error));
  }

  let settlement = cachedWorld.settlement;
  if (playerId) {
    try {
      settlement = instance.settlementStore.viewForPlayer(playerId);
    } catch (error) {
      console.error(`[yes-pusher] could not personalize settlement for ${playerId}`);
      console.error(errorText(error));
    }
  }

  return {
    ...cachedWorld,
    serverTime: Date.now(),
    activePlayerId,
    queue,
    auth: {
      requireWallet: Boolean(cachedWorld.auth?.requireWallet),
      testMode: Boolean(cachedWorld.auth?.testMode),
      authenticated: Boolean(identity?.authenticated),
      wallet: identity?.wallet ?? null,
    },
    settlement,
    self: playerId ? {
      id: playerId,
      label: player?.label ?? identity?.label ?? `PLAYER ${playerId.slice(-4).toUpperCase()}`,
      wallet: identity?.wallet ?? null,
      authenticated: Boolean(identity?.authenticated),
      queued: position !== null,
      queuePosition: position,
      isActive: activePlayerId === playerId,
      queuedCoins: position !== null ? player?.requestedCoins ?? 5 : null,
    } : null,
    turn,
  };
}

async function archiveMachineBoundary(dataDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const recoveryDir = path.join(dataDir, 'startup-recovery', stamp);
  await mkdir(recoveryDir, { recursive: true });
  const archived = [];
  for (const filename of [
    'confirmed-world.json',
    'confirmed-world.json.tmp',
    'active-replay.json',
    'active-replay.json.tmp',
  ]) {
    try {
      await rename(path.join(dataDir, filename), path.join(recoveryDir, filename));
      archived.push(filename);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return { recoveryDir, archived };
}

const port = parsePort(process.env.PORT);
const host = '0.0.0.0';
const startup = {
  phase: 'booting',
  startedAt: new Date().toISOString(),
  readyAt: null,
  loadedPatches: [],
  failedPatches: [],
  recovery: null,
  error: null,
};

const bootstrapServer = http.createServer((request, response) => {
  const failed = startup.phase === 'failed';
  const initializing = startup.phase !== 'ready' && !failed;
  const payload = {
    ok: !failed,
    authoritative: false,
    error: failed
      ? startup.error || 'The authoritative shared world failed to initialize.'
      : initializing
        ? 'The authoritative shared world is initializing.'
        : null,
    startup: { ...startup },
  };
  const pathname = (() => {
    try { return new URL(request.url || '/', 'http://bootstrap').pathname; } catch { return '/'; }
  })();
  const statusCode = failed ? 503 : pathname === '/api/world' || pathname === '/events' ? 503 : 200;
  writeJson(response, statusCode, payload, request);
});

await listen(bootstrapServer, port, host);
console.log(`[yes-pusher] Railway health listener bound on ${host}:${port}`);

const OPTIONAL_PATCHES = Object.freeze([
  './normalize-sdk-base-url.js',
  './personal-result-patch.js',
  './settlement-recovery-patch.js',
  './direct-offering-resolution-patch.js',
  './automatic-mint-patch.js',
  './toy-reward-settlement-patch.js',
  './toy-reward-startup-fix.js',
  './skin-loadout-patch.js',
  './rubber-duck-toy-patch.js',
  './squeak-wave-patch.js',
  './front-edge-demo-duck-patch.js',
  './fast-preparation-patch.js',
  '../../src/game/replay-physics.js',
]);

startup.phase = 'loading-patches';
for (const modulePath of OPTIONAL_PATCHES) {
  try {
    await import(modulePath);
    startup.loadedPatches.push(modulePath);
    console.log(`[yes-pusher] loaded ${modulePath}`);
  } catch (error) {
    const message = errorText(error);
    startup.failedPatches.push({ modulePath, error: message });
    console.error(`[yes-pusher] optional patch failed: ${modulePath}`);
    console.error(message);
  }
}

let instance = null;
let snapshotRefreshInterval = null;
const dataDir = configuredDataDir();
try {
  startup.phase = 'initializing-world';
  const { createWorldServer } = await import('./server.js');
  try {
    instance = await createWorldServer({ port, host, autoListen: false, dataDir });
  } catch (firstError) {
    const firstMessage = errorText(firstError);
    console.error('[yes-pusher] saved shared-world boundary failed to restore; archiving machine boundary and retrying');
    console.error(firstMessage);
    const recovery = await archiveMachineBoundary(dataDir);
    startup.recovery = {
      attemptedAt: new Date().toISOString(),
      reason: firstMessage,
      ...recovery,
    };
    instance = await createWorldServer({ port, host, autoListen: false, dataDir });
  }

  let cachedWorld = instance.publicSnapshot(null);
  if (!cachedWorld.replay && Number(cachedWorld.coinCount || 0) === 0) {
    instance.engine.resetMachine();
    cachedWorld = instance.publicSnapshot(null);
    startup.recovery = {
      ...(startup.recovery ?? {}),
      machineReseededAt: new Date().toISOString(),
      machineReseedReason: 'Saved machine boundary contained zero coins.',
    };
    console.warn('[yes-pusher] saved machine contained zero coins; rebuilt the standard shared machine');
  }

  const requestListeners = instance.server.listeners('request');
  if (!requestListeners.length) throw new Error('Authoritative server did not register an HTTP request handler');

  snapshotRefreshInterval = setInterval(() => {
    try {
      cachedWorld = instance.publicSnapshot(null);
    } catch (error) {
      console.error('[yes-pusher] cached shared-world refresh failed; keeping the last valid snapshot');
      console.error(errorText(error));
    }
  }, 500);
  snapshotRefreshInterval.unref?.();

  bootstrapServer.removeAllListeners('request');
  bootstrapServer.on('request', (request, response) => {
    let requestUrl = null;
    try {
      requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    } catch {
      requestUrl = null;
    }

    if (request.method === 'GET' && requestUrl?.pathname === '/api/world') {
      try {
        const identity = requestIdentity(instance, request, requestUrl);
        if (identity?.playerId) instance.queue.touch(identity.playerId, identity.label);
        writeJson(response, 200, personalizeCachedWorld(instance, cachedWorld, identity), request);
      } catch (error) {
        console.error('[yes-pusher] /api/world snapshot response failed');
        console.error(errorText(error));
        writeJson(response, 500, {
          ok: false,
          authoritative: true,
          error: error instanceof Error ? error.message : 'Could not build the shared-world response.',
        }, request);
      }
      return;
    }

    if (request.method === 'GET' && requestUrl?.pathname === '/events' && !requestUrl.searchParams.get('playerId')) {
      writeJson(response, 200, {
        ok: true,
        authoritative: true,
        ready: true,
        transport: 'event-stream',
      }, request);
      return;
    }

    for (const listener of requestListeners) listener.call(instance.server, request, response);
  });

  startup.phase = 'ready';
  startup.readyAt = new Date().toISOString();
  console.log(`YES Pusher authoritative world server running on http://${host}:${port}`);
} catch (error) {
  startup.phase = 'failed';
  startup.error = errorText(error);
  console.error('[yes-pusher] authoritative server failed to initialize');
  console.error(startup.error);
}

const shutdown = async () => {
  if (snapshotRefreshInterval) clearInterval(snapshotRefreshInterval);
  await instance?.close?.().catch(() => {});
  await new Promise((resolve) => bootstrapServer.close(() => resolve()));
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
