import './load-env.js';
import http from 'node:http';

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

const port = parsePort(process.env.PORT);
const host = '0.0.0.0';
const startup = {
  phase: 'booting',
  startedAt: new Date().toISOString(),
  readyAt: null,
  loadedPatches: [],
  failedPatches: [],
  error: null,
};

const bootstrapServer = http.createServer((request, response) => {
  const payload = {
    ok: startup.phase !== 'failed',
    authoritative: startup.phase === 'ready',
    startup: { ...startup },
  };
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
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
    const message = error instanceof Error ? error.stack || error.message : String(error);
    startup.failedPatches.push({ modulePath, error: message });
    console.error(`[yes-pusher] optional patch failed: ${modulePath}`);
    console.error(message);
  }
}

let instance = null;
try {
  startup.phase = 'initializing-world';
  const { createWorldServer } = await import('./server.js');
  instance = await createWorldServer({ port, host, autoListen: false });

  const requestListeners = instance.server.listeners('request');
  if (!requestListeners.length) throw new Error('Authoritative server did not register an HTTP request handler');

  bootstrapServer.removeAllListeners('request');
  for (const listener of requestListeners) bootstrapServer.on('request', listener);

  startup.phase = 'ready';
  startup.readyAt = new Date().toISOString();
  console.log(`YES Pusher authoritative world server running on http://${host}:${port}`);
} catch (error) {
  startup.phase = 'failed';
  startup.error = error instanceof Error ? error.stack || error.message : String(error);
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
