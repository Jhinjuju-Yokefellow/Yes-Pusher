# YES Pusher Shared World

CoinPusher 32 changes the game from one local simulation per browser into one persistent machine controlled by an authoritative Node server.

## Authority boundary

The world server owns:

- the Cannon physics world
- all coin bodies and physical object state
- the continuously cycling pusher
- the random chute plan for every turn
- the two-second insertion schedule
- front payouts and side losses
- the immediate 30-second turn clock, coin insertion, cycle finish, and settlement window
- lifetime score and skin-milestone counters
- the player queue and active-player permission
- separate lifetime score and pending/resolved skin milestones for each anonymous player
- the latest confirmed world saved on disk

A browser owns only:

- its anonymous local player ID
- its selected 1–10 coin count before submitting a drop request
- camera controls
- interpolation and rendering of server snapshots

The browser cannot submit coin positions, scores, chute results, timers, completed turns, lifetime totals, or milestone results.

## Transport

The server exposes:

- `GET /api/health` — server and machine status
- `GET /api/world` — an initial authoritative snapshot
- `GET /events` — live Server-Sent Event snapshots
- `POST /api/queue/join` — submit a one-shot queued drop request with the selected coin count
- `POST /api/queue/leave` — cancel a waiting request
- `POST /api/turn/start` — backward-compatible manual start route; normal clients do not use it

The server broadcasts at the configured shared-world rate (six snapshots per second by default). Browsers interpolate coin positions, coin rotations, and the pusher position between snapshots.

Railway continuously advances the authoritative machine even when every browser is closed. Browsers render snapshots; they do not own machine time.

## Queue rules

- Watching does not require joining the queue.
- Pressing **Drop Coins** records the selected 1–10 coin count and adds one turn request to the queue.
- When that request reaches the front, the server starts it automatically; the player does not press again.
- The server creates the turn ID and random chute plan.
- A completed request leaves the queue. The player presses Drop Coins again to request another turn.
- A disconnected active turn finishes on the server.
- Short disconnects keep a player’s queue position for twenty seconds so a refresh can reconnect cleanly.

## Persistence

The shared server saves `.world-data/confirmed-world.json` and `.world-data/player-progress.json` after completed turns and while the machine is ready. Writes use temporary files and atomic renames.

An unfinished turn is not committed. Restarting during a partial turn restores the previous confirmed world.

Set `YES_PUSHER_DATA_DIR` to move the runtime save directory. Set `PORT` or `HOST` to change the server listener.

## Development and production

Development:

```powershell
npm run dev
```

Production-style local run:

```powershell
npm run build
npm start
```

When `dist/` exists, the world server serves both the built game and the shared API from the same origin.

## Local fallback

A hosted build with `VITE_WORLD_SERVER_URL` never silently creates a separate local machine. It reconnects to Railway and falls back from the live stream to authoritative `/api/world` polling when necessary. Local confirmed-world mode remains available only for explicit local development without a configured server URL.

## Wallet-owned queue control

The machine remains public to watch. Queue control is wallet-owned by default. A browser signs a short-lived server challenge and receives an HTTP-only session; queue and turn commands use that verified session instead of trusting a wallet string sent by the client.

The wallet is identity only at this stage. The login signature does not spend YES or submit a chain transaction.

## Durable turn settlement

The authoritative server writes one settlement record after each finalized wallet-owned turn. The record is saved before external SDK calls. Yokefellow offering events and optional YES bucket-credit submission are retried independently with idempotency keys. See `WALLET-AND-SETTLEMENT.md`.
