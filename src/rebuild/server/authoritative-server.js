import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MachineCore } from '../core/machine-core.js';
import { createBoundary, createDeltaFrame, encodeSse } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_STATIC_DIR = path.join(PROJECT_ROOT, 'dist');
const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, '.rebuild-data');

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJsonBody(request, limit = 24_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function loadJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function saveJsonAtomic(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload)}\n`, 'utf8');
  await rename(temporary, filePath);
}

function mimeType(filePath) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  })[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function safeStaticPath(staticDir, pathname) {
  const requested = pathname === '/' || pathname === '/rebuild' || pathname === '/rebuild/'
    ? '/rebuild.html'
    : pathname;
  const decoded = decodeURIComponent(requested);
  const normalized = path.posix.normalize(decoded).replace(/^\.\.(\/|$)/, '');
  const resolved = path.resolve(staticDir, `.${normalized.startsWith('/') ? normalized : `/${normalized}`}`);
  return resolved.startsWith(path.resolve(staticDir)) ? resolved : null;
}

async function serveStatic(response, staticDir, pathname) {
  if (!staticDir) return false;
  let filePath = safeStaticPath(staticDir, pathname);
  if (!filePath) return false;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
    const finalInfo = await stat(filePath);
    if (!finalInfo.isFile()) return false;
    response.writeHead(200, {
      'content-type': mimeType(filePath),
      'content-length': finalInfo.size,
      'cache-control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    });
    createReadStream(filePath).pipe(response);
    return true;
  } catch {
    return false;
  }
}

export async function createAuthoritativeRebuildServer({
  host = '0.0.0.0',
  port = positiveNumber(process.env.PORT, 8787),
  tickRate = positiveNumber(process.env.YES_PUSHER_REBUILD_TICK_RATE, 60),
  streamRate = positiveNumber(process.env.YES_PUSHER_REBUILD_STREAM_RATE, 12),
  persistenceSeconds = positiveNumber(process.env.YES_PUSHER_REBUILD_SAVE_SECONDS, 10),
  staticDir = DEFAULT_STATIC_DIR,
  dataDir = process.env.YES_PUSHER_REBUILD_DATA_DIR || DEFAULT_DATA_DIR,
  seed = 20260715,
  seedMachine = true,
  autoListen = true,
} = {}) {
  const stateFile = path.join(dataDir, 'machine-core.json');
  const initialState = await loadJson(stateFile);
  const core = new MachineCore({ seed, seedMachine, initialState });
  const clients = new Set();
  const previousObjects = new Map();
  let sequence = 0;
  let closed = false;
  let savePromise = Promise.resolve();
  let lastTickAt = performance.now();

  function persistAtBoundary() {
    if (!core.isIdle()) return Promise.resolve(false);
    savePromise = savePromise
      .catch(() => {})
      .then(async () => {
        await saveJsonAtomic(stateFile, core.exportState());
        return true;
      });
    return savePromise;
  }

  function sendBoundary(response) {
    sequence += 1;
    response.write(encodeSse('boundary', createBoundary(core, sequence)));
  }

  function broadcastFrame() {
    if (!clients.size) {
      core.drainEvents();
      return;
    }
    sequence += 1;
    const frame = createDeltaFrame(core, previousObjects, sequence);
    const packet = encodeSse('frame', frame);
    for (const response of [...clients]) {
      try {
        response.write(packet);
      } catch {
        clients.delete(response);
      }
    }
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      if (request.method === 'GET' && pathname === '/healthz') {
        writeJson(response, 200, {
          ok: true,
          service: 'yes-pusher-rebuild',
          protocol: 1,
          clients: clients.size,
          activePlay: core.snapshot().activePlay,
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/rebuild/state') {
        sequence += 1;
        writeJson(response, 200, createBoundary(core, sequence));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/rebuild/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        response.write(': connected\n\n');
        clients.add(response);
        sendBoundary(response);
        request.on('close', () => clients.delete(response));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/rebuild/drop') {
        const body = await readJsonBody(request);
        const play = core.enqueueDrop({
          id: body.id,
          playerId: body.playerId,
          coins: body.coins,
          visualKey: body.visualKey,
          seed: body.seed,
        });
        core.tick(0);
        writeJson(response, 202, {
          ok: true,
          acceptedAt: Date.now(),
          play,
          activePlay: core.snapshot().activePlay,
          queuePosition: core.sessions.pending.findIndex((item) => item.id === play.id) + 1,
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/rebuild/save') {
        const saved = await persistAtBoundary();
        writeJson(response, saved ? 200 : 409, {
          ok: saved,
          reason: saved ? null : 'Machine state is saved only at an idle play boundary',
        });
        return;
      }

      if (request.method === 'GET' && await serveStatic(response, staticDir, pathname)) return;
      writeJson(response, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      writeJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const tickTimer = setInterval(() => {
    const now = performance.now();
    const elapsed = Math.max(0, Math.min((now - lastTickAt) / 1000, 0.25));
    lastTickAt = now;
    core.tick(elapsed);
  }, Math.max(1, Math.floor(1000 / tickRate)));
  tickTimer.unref?.();

  const streamTimer = setInterval(broadcastFrame, Math.max(1, Math.floor(1000 / streamRate)));
  streamTimer.unref?.();

  const persistenceTimer = setInterval(() => {
    void persistAtBoundary().catch(() => null);
  }, Math.max(1_000, Math.floor(persistenceSeconds * 1000)));
  persistenceTimer.unref?.();

  if (autoListen) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  }

  return {
    server,
    core,
    clients,
    address() {
      return server.address();
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(tickTimer);
      clearInterval(streamTimer);
      clearInterval(persistenceTimer);
      for (const response of clients) response.end();
      clients.clear();
      await persistAtBoundary().catch(() => false);
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
