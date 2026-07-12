# YES Pusher Shared World

CoinPusher 32 changes the game from one local simulation per browser into one persistent machine controlled by an authoritative Node server.

## Authority boundary

The world server owns:

- the Cannon physics world
- all coin bodies and tower state
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
- its selected 1–10 coin count before starting a turn
- camera controls
- interpolation and rendering of server snapshots

The browser cannot submit coin positions, scores, chute results, timers, completed turns, lifetime totals, or milestone results.

## Transport

The server exposes:

- `GET /api/health` — server and machine status
- `GET /api/world` — an initial authoritative snapshot
- `GET /events` — live Server-Sent Event snapshots
- `POST /api/queue/join` — join the turn queue
- `POST /api/queue/leave` — leave now or after an active turn
- `POST /api/turn/start` — start a turn when the caller is first in queue

The server broadcasts approximately twelve snapshots per second. Browsers interpolate coin positions, coin rotations, and the pusher position between snapshots.

When nobody is connected and no turn is running, physics pauses at the exact current machine state so an unattended server cannot slowly push coins out without a player. Any turn already started continues to completion even if every browser disconnects.

## Queue rules

- Watching does not require joining the queue.
- The first queued player is the only player allowed to start a turn.
- The server creates the turn ID and random chute plan.
- A completed, connected player moves to the back of the queue.
- Leaving during an active turn takes effect after that turn settles.
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

If the browser cannot reach the shared server during startup, it falls back to the previous local confirmed-world mode. Queue controls disappear and Reset Machine becomes available again. This fallback is for development and recovery; the intended game mode is the authoritative shared world.

## Wallet-owned queue control

The machine remains public to watch. Queue control is wallet-owned by default. A browser signs a short-lived server challenge and receives an HTTP-only session; queue and turn commands use that verified session instead of trusting a wallet string sent by the client.

The wallet is identity only at this stage. The login signature does not spend YES or submit a chain transaction.

## Durable turn settlement

The authoritative server writes one settlement record after each finalized wallet-owned turn. The record is saved before external SDK calls. Yokefellow offering events and optional YES bucket-credit submission are retried independently with idempotency keys. See `WALLET-AND-SETTLEMENT.md`.
