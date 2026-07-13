import './load-env.js';

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

for (const modulePath of OPTIONAL_PATCHES) {
  try {
    await import(modulePath);
    console.log(`[yes-pusher] loaded ${modulePath}`);
  } catch (error) {
    console.error(`[yes-pusher] optional patch failed: ${modulePath}`);
    console.error(error instanceof Error ? error.stack || error.message : error);
  }
}

const { createWorldServer } = await import('./server.js');

function parsePort(value, fallback = 8787) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

const port = parsePort(process.env.PORT);
const host = String(process.env.HOST || '0.0.0.0');

try {
  const instance = await createWorldServer({ port, host });
  const address = instance.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`YES Pusher authoritative world server running on http://${host}:${actualPort}`);

  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error('[yes-pusher] authoritative server failed to start');
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
}
