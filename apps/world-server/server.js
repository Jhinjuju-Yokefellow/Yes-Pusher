import './load-env.js';
import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WorldEngine } from '../../src/game/world-engine.js';
import { normalizeWorldSnapshot } from '../../src/game/world-snapshot.js';
import {
  isReplayPackage,
  publicTurnSnapshotFromReplay,
  replayFramesAt,
  simulateRecordedTurn,
} from '../../src/game/replay-package.js';
import { TURN_STATES } from '../../src/game/turn-controller.js';
import { PlayerQueue } from './player-queue.js';
import { PlayerProgressStore } from './player-progress.js';
import {
  WalletAuthStore,
  clearSessionCookie,
  sessionCookie,
  walletLabel,
} from './wallet-auth.js';
import { SettlementOutbox, settlementConfigFromEnv } from './settlement-outbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, '.world-data');

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function parsePort(value, fallback = 8787) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function parseRate(value, fallback, minimum = 1, maximum = 120) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= minimum && rate <= maximum ? rate : fallback;
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload));
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value ?? ''));
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

function parseAllowedOrigins(value = '') {
  return new Set(String(value)
    .split(',')
    .map((entry) => normalizeOrigin(entry.trim()))
    .filter(Boolean));
}

function requestHeaderOrigin(request) {
  return normalizeOrigin(request.headers.origin);
}

function originIsAllowed(request, allowedOrigins) {
  const origin = requestHeaderOrigin(request);
  return !origin || allowedOrigins.size === 0 || allowedOrigins.has(origin);
}

function corsHeaders(request, allowedOrigins) {
  const origin = requestHeaderOrigin(request);
  const headers = {
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    vary: 'origin',
  };
  if (origin && originIsAllowed(request, allowedOrigins)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-credentials'] = 'true';
  }
  return headers;
}

function serverOrigin(request) {
  const forwarded = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const protocol = forwarded || (request.socket?.encrypted ? 'https' : 'http');
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '').split(',')[0].trim();
  const host = forwardedHost || request.headers.host || 'localhost';
  return `${protocol}://${host}`;
}

function requestOrigin(request, allowedOrigins) {
  const browserOrigin = requestHeaderOrigin(request);
  if (browserOrigin && originIsAllowed(request, allowedOrigins)) return browserOrigin;
  return serverOrigin(request);
}

function requestUsesCrossSiteCookie(request, allowedOrigins) {
  const browserOrigin = requestOrigin(request, allowedOrigins);
  return Boolean(browserOrigin && browserOrigin !== serverOrigin(request));
}

function anonymousIdentity(playerId, label = '') {
  const requestedId = String(playerId ?? '').trim();
  if (!requestedId) return null;
  // Never allow an unsigned browser identifier to masquerade as a wallet session.
  const id = requestedId.startsWith('wallet:') ? `guest:${requestedId.slice('wallet:'.length)}` : requestedId;
  return {
    playerId: id,
    label: String(label ?? ''),
    wallet: null,
    authenticated: false,
  };
}

async function readJsonBody(request, limit = 32_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
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
  })[extension] ?? 'application/octet-stream';
}

function statusText(engineSnapshot, queue) {
  const turn = engineSnapshot.turn;
  const active = queue.publicQueue()[0];
  const activeName = active?.label ?? 'NEXT PLAYER';
  if (engineSnapshot.syncMode === 'preparing') {
    return `PREPARING TURN ${turn.currentTurn?.number ?? turn.nextTurnNumber} — ${activeName}`;
  }
  switch (turn.state) {
    case TURN_STATES.PREPARING:
      return `PREPARING TURN ${turn.currentTurn?.number ?? turn.nextTurnNumber} — ${activeName}`;
    case TURN_STATES.DROPPING:
      return `TURN ${turn.currentTurn?.number ?? turn.nextTurnNumber} — ${activeName} INSERTING COINS`;
    case TURN_STATES.WAITING:
      return 'FINAL COIN ENTERING PUSHER';
    case TURN_STATES.ACTIVE:
      return `TURN ${turn.currentTurn?.number ?? turn.nextTurnNumber} — ${activeName} PUSH WINDOW`;
    case TURN_STATES.FINISHING:
      return 'FINISHING CURRENT PUSHER CYCLE';
    case TURN_STATES.SETTLING:
      return 'SETTLING FINAL PAYOUTS';
    default:
      return active ? `STARTING ${activeName} — ${active.requestedCoins ?? 5} COINS` : 'MACHINE RUNNING — PRESS DROP TO JOIN';
  }
}

async function loadJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function loadSavedWorld(worldFile) {
  return normalizeWorldSnapshot(await loadJson(worldFile));
}

async function saveWorldAtomic(worldFile, snapshot) {
  await mkdir(path.dirname(worldFile), { recursive: true });
  const temporary = `${worldFile}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, 'utf8');
  await rename(temporary, worldFile);
}

export async function createWorldServer({
  port = parsePort(process.env.PORT),
  host = process.env.HOST || '0.0.0.0',
  dataDir = process.env.YES_PUSHER_DATA_DIR || DEFAULT_DATA_DIR,
  autoListen = true,
  tickRate = parseRate(process.env.YES_PUSHER_TICK_RATE, 60, 30, 120),
  broadcastRate = parseRate(process.env.YES_PUSHER_BROADCAST_RATE, 2, 1, 2),
  replayFrameRate = parseRate(process.env.YES_PUSHER_REPLAY_FRAME_RATE, 15, 5, 30),
  testMode = process.env.YES_PUSHER_TEST_MODE === 'true',
  requireWallet = process.env.YES_PUSHER_REQUIRE_WALLET !== 'false'
    && process.env.YES_PUSHER_TEST_MODE !== 'true',
  authStore = new WalletAuthStore(),
  settlementConfig = settlementConfigFromEnv(),
  fetchImpl = globalThis.fetch,
  allowedOrigins = parseAllowedOrigins(process.env.YES_PUSHER_ALLOWED_ORIGINS),
} = {}) {
  const worldFile = path.join(dataDir, 'confirmed-world.json');
  const progressFile = path.join(dataDir, 'player-progress.json');
  const settlementFile = path.join(dataDir, 'settlements.json');
  const replayDir = path.join(dataDir, 'replays');
  const activeReplayFile = path.join(dataDir, 'active-replay.json');
  const [initialSnapshot, savedProgress, savedSettlements, savedActiveReplay] = await Promise.all([
    loadSavedWorld(worldFile),
    loadJson(progressFile),
    loadJson(settlementFile),
    loadJson(activeReplayFile),
  ]);
  const queue = new PlayerQueue();
  const progressStore = new PlayerProgressStore(savedProgress);
  const settlementStore = new SettlementOutbox(savedSettlements, {
    config: settlementConfig,
    fetchImpl,
  });
  const connections = new Map();
  const connectionIdentities = new Map();
  const connectionClientIds = new Map();
  const recentPollClients = new Map();
  let revision = 0;
  let boundaryRevision = 1;
  let preparingTurn = null;
  let activeReplay = null;
  let preparationPromise = null;
  let lastPreparationError = null;
  let savePromise = Promise.resolve();
  let closed = false;
  let lastSavedAt = initialSnapshot ? Date.now() : null;

  const engine = new WorldEngine({
    initialSnapshot,
    onEvent: () => {
      revision += 1;
    },
  });


  async function persistConfirmedState() {
    await Promise.all([
      saveWorldAtomic(worldFile, engine.exportConfirmedWorld()),
      saveWorldAtomic(progressFile, progressStore.serialize()),
      saveWorldAtomic(settlementFile, settlementStore.serialize()),
    ]);
    lastSavedAt = Date.now();
  }

  function replayFilePath(turnId) {
    const safeId = String(turnId ?? '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safeId) throw new Error('Invalid replay ID');
    return path.join(replayDir, `${safeId}.json`);
  }

  async function saveReplayPackage(replayPackage) {
    await mkdir(replayDir, { recursive: true });
    await saveWorldAtomic(replayFilePath(replayPackage.id), replayPackage);
  }

  async function saveActiveReplayState() {
    if (!activeReplay) {
      await unlink(activeReplayFile).catch(() => {});
      return;
    }
    await saveWorldAtomic(activeReplayFile, {
      kind: 'yes-pusher-active-replay',
      version: 1,
      turnId: activeReplay.package.id,
      startedAt: activeReplay.startedAt,
      boundaryId: activeReplay.boundaryId,
    });
  }

  function connectionCount() {
    let total = 0;
    for (const set of connections.values()) total += set.size;
    return total;
  }

  function markPollClient(clientId, playerId) {
    const id = String(clientId ?? '').trim();
    if (!id) return;
    recentPollClients.set(id, { playerId: String(playerId ?? ''), seenAt: Date.now() });
  }

  function pollingClientCount() {
    const cutoff = Date.now() - 15_000;
    const streamedClientIds = new Set(connectionClientIds.values());
    let total = 0;
    for (const [clientId, state] of recentPollClients) {
      if (state.seenAt < cutoff) {
        recentPollClients.delete(clientId);
        continue;
      }
      if (!streamedClientIds.has(clientId)) total += 1;
    }
    return total;
  }

  function activeClientCount() {
    return connectionCount() + pollingClientCount();
  }

  function identityFromRequest(request, fallbackId = null, fallbackLabel = '') {
    const session = authStore.readRequest(request);
    if (session) {
      return {
        playerId: session.playerId,
        label: session.label,
        wallet: session.wallet,
        authenticated: true,
      };
    }
    return anonymousIdentity(fallbackId, fallbackLabel);
  }

  function preparingTurnSnapshot() {
    const base = engine.turnController.getSnapshot();
    if (!preparingTurn) return base;
    return {
      ...base,
      state: TURN_STATES.PREPARING,
      currentTurn: {
        id: preparingTurn.turnId,
        playerId: preparingTurn.playerId,
        number: preparingTurn.number,
        coinsDropped: preparingTurn.coinsDropped,
        coinsWon: 0,
        coinsLost: 0,
        slotPlan: [],
        seed: preparingTurn.seed,
        startedAt: preparingTurn.requestedAt,
        activeStartedAt: null,
        completedAt: null,
      },
      lastResult: null,
      activeSecondsRemaining: 30,
      ownsScoringWindow: false,
    };
  }

  function transportWorld() {
    const boundary = engine.getNetworkSnapshot({ packed: true });
    const boundaryId = `boundary-${boundaryRevision}`;

    if (preparingTurn) {
      return {
        ...boundary,
        syncMode: 'preparing',
        boundaryId,
        prepare: {
          turnId: preparingTurn.turnId,
          playerId: preparingTurn.playerId,
          coinsDropped: preparingTurn.coinsDropped,
          requestedAt: preparingTurn.requestedAt,
          simulatedSeconds: preparingTurn.simulatedSeconds ?? 0,
          frameCount: preparingTurn.frameCount ?? 0,
          coinCount: preparingTurn.coinCount ?? boundary.coinCount,
        },
        replay: null,
        turn: preparingTurnSnapshot(),
      };
    }

    if (activeReplay) {
      const elapsedSeconds = Math.max(0, (Date.now() - activeReplay.startedAt) / 1000);
      const frame = replayFramesAt(activeReplay.package, elapsedSeconds).previous;
      const replayTurn = publicTurnSnapshotFromReplay(
        activeReplay.package,
        Math.min(elapsedSeconds, Math.max(0, activeReplay.package.durationSeconds - 0.0001)),
        boundary.turn,
      );
      if (replayTurn.currentTurn) {
        replayTurn.currentTurn.startedAt = activeReplay.startedAt;
        replayTurn.currentTurn.activeStartedAt = activeReplay.startedAt;
      }
      return {
        ...activeReplay.package.startWorld,
        syncMode: 'recorded-replay',
        boundaryId: activeReplay.boundaryId,
        prepare: null,
        replay: {
          turnId: activeReplay.package.id,
          packageUrl: `/api/replays/${encodeURIComponent(activeReplay.package.id)}`,
          startedAt: activeReplay.startedAt,
          elapsedSeconds,
          durationSeconds: activeReplay.package.durationSeconds,
          frameRate: activeReplay.package.frameRate,
          eventCount: activeReplay.package.events.length,
          payoutCoinIds: activeReplay.package.events.filter((event) => event.type === 'payout').map((event) => event.coinId),
        },
        pusherZ: frame?.pusherZ ?? activeReplay.package.startWorld?.pusherZ ?? boundary.pusherZ,
        activeSlotIndex: frame?.activeSlotIndex ?? -1,
        coinCount: frame?.coins?.length ?? activeReplay.package.startWorld?.coinCount ?? boundary.coinCount,
        turn: replayTurn,
      };
    }

    return {
      ...boundary,
      syncMode: 'boundary',
      boundaryId,
      prepare: null,
      replay: null,
    };
  }

  function publicSnapshot(playerId = null, identity = null, world = transportWorld()) {
    const decoratedTurn = progressStore.decorateTurnSnapshot(world.turn, playerId);
    const activePlayerId = queue.activeId();
    const player = playerId ? queue.getPlayer(playerId) : null;
    const position = playerId ? queue.positionOf(playerId) : null;
    return {
      kind: 'yes-pusher-shared-world',
      protocolVersion: 4,
      revision,
      serverTime: Date.now(),
      authoritative: true,
      status: statusText(world, queue),
      activePlayerId,
      queue: queue.publicQueue(),
      spectators: Math.max(0, activeClientCount() - queue.publicQueue().filter((entry) => entry.connected).length),
      auth: {
        requireWallet,
        testMode,
        authenticated: Boolean(identity?.authenticated),
        wallet: identity?.wallet ?? null,
      },
      settlement: playerId ? settlementStore.viewForPlayer(playerId) : {
        pendingCount: 0,
        recordedOwedYesRaw: '0',
        last: null,
        integration: settlementStore.integrationStatus(),
      },
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
      ...world,
      turn: decoratedTurn,
    };
  }

  function sendEvent(response, event, payload) {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  async function prepareTurn(preparation) {
    const initialWorld = engine.exportConfirmedWorld();
    const startBoundary = engine.getNetworkSnapshot({ packed: true });
    const replayPackage = await simulateRecordedTurn({
      initialWorld,
      startBoundary,
      playerId: preparation.playerId,
      playerLabel: preparation.playerLabel,
      coinsDropped: preparation.coinsDropped,
      seed: preparation.seed,
      turnId: preparation.turnId,
      frameRate: replayFrameRate,
      onProgress: (progress) => {
        if (preparingTurn?.turnId !== preparation.turnId) return;
        preparingTurn.simulatedSeconds = progress.elapsedSeconds;
        preparingTurn.frameCount = progress.frameCount;
        preparingTurn.coinCount = progress.coinCount;
      },
    });

    if (closed || preparingTurn?.turnId !== preparation.turnId) return null;
    await saveReplayPackage(replayPackage);
    activeReplay = {
      package: replayPackage,
      startedAt: Date.now(),
      boundaryId: preparation.boundaryId,
    };
    preparingTurn = null;
    lastPreparationError = null;
    await saveActiveReplayState();
    revision += 1;
    broadcast();
    return replayPackage;
  }

  function startNextQueuedTurnIfReady() {
    if (preparingTurn || activeReplay || preparationPromise) return null;
    if (engine.turnController.getSnapshot().state !== TURN_STATES.READY) return null;
    const request = queue.activeRequest();
    if (!request) return null;

    const turnNumber = engine.turnController.getSnapshot().nextTurnNumber;
    const seed = ((Date.now() ^ Math.imul(revision + 1, 0x9e3779b1)) >>> 0);
    const turnId = `shared-turn-${turnNumber}-${seed.toString(36)}`;
    preparingTurn = {
      turnId,
      number: turnNumber,
      playerId: request.id,
      playerLabel: request.label,
      coinsDropped: request.requestedCoins,
      seed,
      requestedAt: Date.now(),
      boundaryId: `boundary-${boundaryRevision}`,
      simulatedSeconds: 0,
      frameCount: 0,
      coinCount: engine.coins.length,
    };
    revision += 1;
    broadcast();
    preparationPromise = prepareTurn(preparingTurn)
      .catch((error) => {
        lastPreparationError = error instanceof Error ? error.message : String(error);
        preparingTurn = null;
        queue.completeTurn();
        revision += 1;
        broadcast();
        return null;
      })
      .finally(() => {
        preparationPromise = null;
      });
    return {
      id: preparingTurn.turnId,
      playerId: preparingTurn.playerId,
      number: preparingTurn.number,
      coinsDropped: preparingTurn.coinsDropped,
      coinsWon: 0,
      coinsLost: 0,
      slotPlan: [],
      seed: preparingTurn.seed,
      startedAt: preparingTurn.requestedAt,
      completedAt: null,
    };
  }

  function commitReplayIfFinished() {
    if (!activeReplay) return false;
    const elapsedSeconds = Math.max(0, (Date.now() - activeReplay.startedAt) / 1000);
    if (elapsedSeconds + 0.0001 < activeReplay.package.durationSeconds) return false;

    const completedReplay = activeReplay;
    activeReplay = null;
    engine.restoreConfirmedWorld(completedReplay.package.finalWorld);
    boundaryRevision += 1;
    const committedResult = {
      ...completedReplay.package.result,
      startedAt: completedReplay.startedAt,
      activeStartedAt: completedReplay.startedAt,
      completedAt: Date.now(),
    };
    const finalizedResult = progressStore.finalizeTurn(committedResult);
    if (finalizedResult) settlementStore.enqueue(finalizedResult);
    queue.completeTurn();
    revision += 1;
    savePromise = savePromise
      .catch(() => {})
      .then(async () => {
        await saveActiveReplayState();
        await persistConfirmedState();
        const changed = await settlementStore.process();
        if (changed) await saveWorldAtomic(settlementFile, settlementStore.serialize());
      });
    broadcast();
    return true;
  }

  async function restoreActiveReplayFromDisk() {
    if (
      savedActiveReplay?.kind !== 'yes-pusher-active-replay'
      || savedActiveReplay.version !== 1
      || typeof savedActiveReplay.turnId !== 'string'
    ) return false;
    const replayPackage = await loadJson(replayFilePath(savedActiveReplay.turnId));
    if (!isReplayPackage(replayPackage)) {
      await unlink(activeReplayFile).catch(() => {});
      return false;
    }
    queue.join(
      replayPackage.turn.playerId,
      replayPackage.turn.playerLabel || `PLAYER ${String(replayPackage.turn.playerId).slice(-4).toUpperCase()}`,
      replayPackage.turn.coinsDropped,
    );
    activeReplay = {
      package: replayPackage,
      startedAt: Number(savedActiveReplay.startedAt) || Date.now(),
      boundaryId: savedActiveReplay.boundaryId || `boundary-${boundaryRevision}`,
    };
    revision += 1;
    return true;
  }

  await restoreActiveReplayFromDisk();
  commitReplayIfFinished();

  function broadcast() {
    queue.prune({ preserveActive: Boolean(preparingTurn || activeReplay) });
    revision += 1;
    const world = transportWorld();
    for (const [playerId, responses] of connections) {
      for (const response of responses) {
        const identity = connectionIdentities.get(response) ?? anonymousIdentity(playerId, queue.getPlayer(playerId)?.label ?? '');
        const payload = publicSnapshot(playerId, identity, world);
        try {
          sendEvent(response, 'world', payload);
        } catch {
          // The close handler removes dead streams.
        }
      }
    }
  }

  function addConnection(playerId, response, identity, clientId = '') {
    let responses = connections.get(playerId);
    if (!responses) {
      responses = new Set();
      connections.set(playerId, responses);
    }
    responses.add(response);
    connectionIdentities.set(response, {
      playerId,
      label: identity?.label ?? queue.getPlayer(playerId)?.label ?? '',
      wallet: identity?.authenticated ? identity.wallet : null,
      authenticated: Boolean(identity?.authenticated),
    });
    const normalizedClientId = String(clientId ?? '').trim();
    if (normalizedClientId) {
      connectionClientIds.set(response, normalizedClientId);
      recentPollClients.delete(normalizedClientId);
    }
  }

  function removeConnection(playerId, response) {
    const responses = connections.get(playerId);
    if (!responses) return;
    responses.delete(response);
    connectionIdentities.delete(response);
    connectionClientIds.delete(response);
    if (!responses.size) {
      connections.delete(playerId);
      queue.disconnect(playerId);
    }
  }

  async function serveStatic(request, response, pathname) {
    if (!existsSync(DIST_DIR)) return false;
    let relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    relativePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    let filePath = path.join(DIST_DIR, relativePath);
    if (!filePath.startsWith(DIST_DIR)) return false;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {
      filePath = path.join(DIST_DIR, 'index.html');
    }
    try {
      const info = await stat(filePath);
      if (!info.isFile()) return false;
      response.writeHead(200, {
        'content-type': mimeType(filePath),
        'cache-control': path.basename(filePath) === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      });
      createReadStream(filePath).pipe(response);
      return true;
    } catch {
      return false;
    }
  }

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const pathname = requestUrl.pathname;
    Object.entries(corsHeaders(request, allowedOrigins)).forEach(([key, value]) => response.setHeader(key, value));

    if (!originIsAllowed(request, allowedOrigins)) {
      writeJson(response, 403, { ok: false, error: 'This web origin is not allowed to use the YES Pusher world server' });
      return;
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === 'GET' && pathname === '/api/health') {
      const transportSnapshot = transportWorld();
      writeJson(response, 200, {
        ok: true,
        authoritative: true,
        revision,
        coinCount: engine.coins.length,
        turnState: preparingTurn ? TURN_STATES.PREPARING : activeReplay ? 'replaying' : engine.turnController.getSnapshot().state,
        connections: activeClientCount(),
        streamConnections: connectionCount(),
        pollingClients: pollingClientCount(),
        requireWallet,
        testMode,
        tickRate,
        broadcastRate,
        network: {
          coinEncoding: transportSnapshot.coinEncoding,
          snapshotBytes: Buffer.byteLength(JSON.stringify(transportSnapshot)),
          physicsSolverIterations: engine.world.solver.iterations,
          physicsStepsPerSecond: engine.physicsRate,
          replayFramesPerSecond: replayFrameRate,
          statusBroadcastsPerSecond: broadcastRate,
          clientVisualMode: 'recorded-authoritative-replay-with-interpolation',
          visibleCoinPhysicsRunsInBrowser: false,
          authoritativeTurnSimulationRunsOnRailway: true,
          liveCoinTransformStreaming: false,
          replayPackageDownload: true,
          replayCompression: 'gzip',
          exactCoinIdEvents: true,
          guidedBoardCoins: engine.coins.filter((coin) => coin.planar).length,
        },
        lastPreparationError,
        allowedOrigins: [...allowedOrigins],
        settlement: settlementStore.integrationStatus(),
        persistence: {
          dataDir,
          loadedFromDisk: Boolean(initialSnapshot),
          lastSavedAt: lastSavedAt ? new Date(lastSavedAt).toISOString() : null,
          continuousPhysics: false,
          boundarySnapshots: true,
          replayDirectory: replayDir,
          activeReplayId: activeReplay?.package?.id ?? null,
          preparingTurnId: preparingTurn?.turnId ?? null,
        },
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/auth/session') {
      const session = authStore.readRequest(request);
      writeJson(response, 200, {
        ok: true,
        authenticated: Boolean(session),
        wallet: session?.wallet ?? null,
        playerId: session?.playerId ?? null,
        label: session?.label ?? null,
        expiresAt: session ? new Date(session.expiresAtMs).toISOString() : null,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/auth/challenge') {
      try {
        const body = await readJsonBody(request);
        const challenge = authStore.createChallenge({
          wallet: body.wallet,
          chainId: body.chainId,
          origin: requestOrigin(request, allowedOrigins),
        });
        writeJson(response, 200, { ok: true, ...challenge });
      } catch (error) {
        writeJson(response, 400, { ok: false, error: error instanceof Error ? error.message : 'Could not create wallet challenge' });
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/api/auth/verify') {
      try {
        const body = await readJsonBody(request);
        const session = await authStore.verifyChallenge({
          challengeId: body.challengeId,
          wallet: body.wallet,
          signature: body.signature,
          origin: requestOrigin(request, allowedOrigins),
        });
        const crossSite = requestUsesCrossSiteCookie(request, allowedOrigins);
        const secureCookie = requestOrigin(request, allowedOrigins).startsWith('https://')
          || serverOrigin(request).startsWith('https://');
        response.setHeader('set-cookie', sessionCookie(session.token, {
          maxAgeSeconds: Math.floor((session.expiresAtMs - Date.now()) / 1000),
          secure: secureCookie,
          sameSite: crossSite ? 'None' : 'Lax',
        }));
        writeJson(response, 200, {
          ok: true,
          authenticated: true,
          wallet: session.wallet,
          playerId: session.playerId,
          label: session.label,
          sessionToken: session.token,
          expiresAt: new Date(session.expiresAtMs).toISOString(),
        });
      } catch (error) {
        writeJson(response, 401, { ok: false, error: error instanceof Error ? error.message : 'Wallet signature verification failed' });
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      authStore.revokeRequest(request);
      const crossSite = requestUsesCrossSiteCookie(request, allowedOrigins);
      const secureCookie = requestOrigin(request, allowedOrigins).startsWith('https://')
        || serverOrigin(request).startsWith('https://');
      response.setHeader('set-cookie', clearSessionCookie({
        secure: secureCookie,
        sameSite: crossSite ? 'None' : 'Lax',
      }));
      writeJson(response, 200, { ok: true, authenticated: false });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/world') {
      const fallbackId = requestUrl.searchParams.get('playerId');
      const fallbackLabel = requestUrl.searchParams.get('label') ?? '';
      const clientId = requestUrl.searchParams.get('clientId') ?? '';
      const identity = identityFromRequest(request, fallbackId, fallbackLabel);
      if (identity?.playerId) {
        queue.touch(identity.playerId, identity.label);
        markPollClient(clientId, identity.playerId);
      }
      writeJson(response, 200, publicSnapshot(identity?.playerId ?? null, identity));
      return;
    }

    if (request.method === 'GET' && pathname === '/events') {
      const fallbackId = requestUrl.searchParams.get('playerId');
      const fallbackLabel = requestUrl.searchParams.get('label') ?? '';
      const identity = identityFromRequest(request, fallbackId, fallbackLabel);
      if (!identity?.playerId) {
        writeJson(response, 400, { error: 'playerId is required' });
        return;
      }
      const { playerId } = identity;
      const clientId = requestUrl.searchParams.get('clientId') ?? '';
      const label = identity.label || (testMode ? 'LOCAL TESTER' : '');
      queue.connect(playerId, label);
      if (testMode && !queue.activeId()) queue.join(playerId, label || 'LOCAL TESTER');
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      response.write(': connected\n\n');
      addConnection(playerId, response, identity, clientId);
      sendEvent(response, 'world', publicSnapshot(playerId, identity));
      const heartbeat = setInterval(() => {
        try { response.write(': heartbeat\n\n'); } catch { /* close handler */ }
      }, 15_000);
      request.on('close', () => {
        clearInterval(heartbeat);
        removeConnection(playerId, response);
      });
      return;
    }

    if (request.method === 'GET' && pathname.startsWith('/api/replays/')) {
      const replayId = decodeURIComponent(pathname.slice('/api/replays/'.length));
      if (!/^[a-zA-Z0-9._-]+$/.test(replayId)) {
        writeJson(response, 400, { ok: false, error: 'Invalid replay ID' });
        return;
      }
      try {
        const inMemory = activeReplay?.package?.id === replayId ? activeReplay.package : null;
        const raw = inMemory
          ? JSON.stringify(inMemory)
          : await readFile(replayFilePath(replayId), 'utf8');
        const replayPackage = inMemory ?? JSON.parse(raw);
        if (!isReplayPackage(replayPackage)) {
          writeJson(response, 404, { ok: false, error: 'Replay not found' });
          return;
        }
        const acceptsGzip = /(?:^|,)\s*gzip(?:\s*;|\s*,|$)/i.test(String(request.headers['accept-encoding'] ?? ''));
        const body = acceptsGzip ? gzipSync(raw, { level: 6 }) : Buffer.from(raw);
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': body.length,
          'cache-control': 'public, max-age=31536000, immutable',
          ...(acceptsGzip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
        });
        response.end(body);
      } catch {
        writeJson(response, 404, { ok: false, error: 'Replay not found' });
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/settlements/self') {
      const identity = identityFromRequest(request);
      if (!identity?.authenticated) {
        writeJson(response, 401, { ok: false, error: 'Connect and sign with a wallet first' });
        return;
      }
      writeJson(response, 200, { ok: true, settlement: settlementStore.viewForPlayer(identity.playerId) });
      return;
    }

    if (request.method === 'POST' && pathname.startsWith('/api/')) {
      try {
        const body = await readJsonBody(request);
        const identity = identityFromRequest(request, body.playerId, body.label);
        if (!identity?.playerId) {
          writeJson(response, 400, { error: 'playerId is required' });
          return;
        }
        if (requireWallet && !identity.authenticated) {
          writeJson(response, 401, { error: 'Connect and sign with a wallet before joining the queue' });
          return;
        }
        const { playerId, label } = identity;
        queue.ensurePlayer(playerId, label);
        const turnState = preparingTurn ? TURN_STATES.PREPARING : activeReplay ? 'replaying' : engine.turnController.getSnapshot().state;

        if (pathname === '/api/queue/join') {
          const position = queue.join(playerId, label, body.coins);
          revision += 1;
          const turn = startNextQueuedTurnIfReady();
          if (!turn) broadcast();
          writeJson(response, 200, {
            ok: true,
            position,
            turn,
            snapshot: publicSnapshot(playerId, identity),
          });
          return;
        }

        if (pathname === '/api/queue/leave') {
          queue.leave(playerId, { turnRunning: Boolean(preparingTurn || activeReplay) });
          revision += 1;
          broadcast();
          writeJson(response, 200, { ok: true, snapshot: publicSnapshot(playerId, identity) });
          return;
        }

        if (pathname === '/api/turn/start') {
          if (queue.activeId() !== playerId) {
            writeJson(response, 403, { error: 'Only the active queued player can start the turn' });
            return;
          }
          if (preparingTurn || activeReplay || preparationPromise || turnState !== TURN_STATES.READY) {
            writeJson(response, 409, { error: 'The current turn has not finished' });
            return;
          }
          const turn = startNextQueuedTurnIfReady();
          if (!turn) {
            writeJson(response, 409, { error: 'The queued turn could not be started' });
            return;
          }
          writeJson(response, 200, { ok: true, turn, snapshot: publicSnapshot(playerId, identity) });
          return;
        }

        if (pathname === '/api/test/reset') {
          if (!testMode) {
            writeJson(response, 404, { error: 'Test controls are disabled' });
            return;
          }
          if (preparingTurn || activeReplay || preparationPromise || turnState !== TURN_STATES.READY) {
            writeJson(response, 409, { error: 'Wait for the current turn to finish before resetting' });
            return;
          }
          engine.resetMachine();
          preparingTurn = null;
          activeReplay = null;
          boundaryRevision += 1;
          revision += 1;
          savePromise = savePromise
            .catch(() => {})
            .then(async () => {
              await saveActiveReplayState();
              await saveWorldAtomic(worldFile, engine.exportConfirmedWorld());
            });
          broadcast();
          writeJson(response, 200, { ok: true, snapshot: publicSnapshot(playerId, identity) });
          return;
        }

        writeJson(response, 404, { error: 'Unknown shared-world command' });
      } catch (error) {
        writeJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
      }
      return;
    }

    if (request.method === 'GET' && await serveStatic(request, response, pathname)) return;
    writeJson(response, 404, { error: 'Not found' });
  });

  const tickInterval = setInterval(() => {
    if (!commitReplayIfFinished()) startNextQueuedTurnIfReady();
  }, Math.max(10, Math.floor(1000 / tickRate)));
  tickInterval.unref?.();

  const broadcastInterval = setInterval(broadcast, Math.max(40, Math.floor(1000 / broadcastRate)));
  broadcastInterval.unref?.();

  const saveInterval = setInterval(() => {
    if (preparingTurn || activeReplay || preparationPromise || engine.turnController.getSnapshot().state !== TURN_STATES.READY) return;
    savePromise = savePromise
      .catch(() => {})
      .then(() => persistConfirmedState());
  }, 10_000);
  saveInterval.unref?.();

  const settlementInterval = setInterval(() => {
    settlementStore.retryFailed();
    savePromise = savePromise
      .catch(() => {})
      .then(async () => {
        const changed = await settlementStore.process();
        if (changed) {
          revision += 1;
          await saveWorldAtomic(settlementFile, settlementStore.serialize());
        }
      });
  }, 5_000);
  settlementInterval.unref?.();

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(tickInterval);
    clearInterval(broadcastInterval);
    clearInterval(saveInterval);
    clearInterval(settlementInterval);
    for (const responses of connections.values()) {
      for (const response of responses) response.end();
    }
    connectionIdentities.clear();
    await preparationPromise?.catch(() => {});
    await savePromise.catch(() => {});
    if (!preparingTurn && !activeReplay && engine.turnController.getSnapshot().state === TURN_STATES.READY) {
      await persistConfirmedState().catch(() => {});
    }
    await new Promise((resolve) => server.close(() => resolve()));
  }

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
    engine,
    queue,
    progressStore,
    settlementStore,
    authStore,
    publicSnapshot,
    close,
    address: () => server.address(),
  };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const port = parsePort(process.env.PORT);
  const instance = await createWorldServer({ port });
  const address = instance.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`YES Pusher authoritative world server running on http://localhost:${actualPort}`);
  if (process.env.YES_PUSHER_TEST_MODE === 'true') {
    console.log('Local test mode: wallet and internet deployment are not required.');
  }
  console.log(existsSync(DIST_DIR)
    ? 'Serving the built game and shared-world API.'
    : 'Vite should run separately during development (npm run dev).');

  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
