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
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'retry-after': '1',
  });
  response.end(JSON.stringify(payload));
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

  const initialPublicSnapshot = instance.publicSnapshot(null);
  if (!initialPublicSnapshot.replay && Number(initialPublicSnapshot.coinCount || 0) === 0) {
    instance.engine.resetMachine();
    startup.recovery = {
      ...(startup.recovery ?? {}),
      machineReseededAt: new Date().toISOString(),
      machineReseedReason: 'Saved machine boundary contained zero coins.',
    };
    console.warn('[yes-pusher] saved machine contained zero coins; rebuilt the standard shared machine');
  }

  const requestListeners = instance.server.listeners('request');
  if (!requestListeners.length) throw new Error('Authoritative server did not register an HTTP request handler');

  bootstrapServer.removeAllListeners('request');
  for (const listener of requestListeners) bootstrapServer.on('request', listener);

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
  await instance?.close?.().catch(() => {});
  await new Promise((resolve) => bootstrapServer.close(() => resolve()));
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
