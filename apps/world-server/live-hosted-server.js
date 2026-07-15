import './load-env.js';
import './normalize-sdk-base-url.js';
import './personal-result-patch.js';
import './settlement-recovery-patch.js';
import './direct-offering-resolution-patch.js';
import './automatic-mint-patch.js';
import './toy-reward-settlement-patch.js';
import './toy-reward-startup-fix.js';
import './squeak-wave-boost-patch.js';
import './skin-loadout-patch.js';
import './rubber-duck-toy-patch.js';
import './cucumber-slice-toy-patch.js';
import './squeak-wave-patch.js';
import { createWorldServer } from './server.js';

function numericEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const port = numericEnv('PORT', 8787);
const tickRate = numericEnv('YES_PUSHER_TICK_RATE', 60);
const broadcastRate = numericEnv('YES_PUSHER_STREAM_RATE', 12);
const instance = await createWorldServer({
  port,
  host: '0.0.0.0',
  tickRate,
  broadcastRate,
});

console.log(`[yes-pusher] live authoritative stream listening on 0.0.0.0:${port}`);
console.log(`[yes-pusher] physics ${tickRate} Hz; network stream ${broadcastRate} Hz`);

const shutdown = async () => {
  await instance.close();
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
