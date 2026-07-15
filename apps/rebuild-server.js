import { createAuthoritativeRebuildServer } from '../src/rebuild/server/authoritative-server.js';

const instance = await createAuthoritativeRebuildServer();
const address = instance.address();
const port = typeof address === 'object' && address ? address.port : process.env.PORT;

console.log(`[yes-pusher-rebuild] browser + authoritative server listening on ${port}`);
console.log('[yes-pusher-rebuild] physics 60 Hz; same-origin stream 12 Hz');

async function shutdown() {
  await instance.close();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
