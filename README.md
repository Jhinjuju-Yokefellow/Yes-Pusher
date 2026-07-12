# YES Pusher — Shared Machine

YES Pusher is a standalone Three.js/Cannon game connected to Yokefellow through its SDK/API surface. It is not part of the Yokefellow repository.

One authoritative Node server owns the persistent machine, physics, queue, random chute plan, timer, scoring, player progress, and turn settlement records. Every browser renders that same live world.


## Test it locally now

You do **not** need to deploy YES Pusher to the internet to test the machine, turns, queue, persistence, or shared-world renderer.

On Windows, extract the ZIP and run:

```powershell
.\RUN-ME.ps1
```

The script installs dependencies when needed, builds the game, starts the authoritative world on `http://localhost:8787`, and opens it in the browser. Local test mode automatically gives the first browser control of the machine. Wallet login and Yokefellow submissions are disabled so they cannot block ordinary play-testing.

Use **Reset Machine** between layout tests. Close the PowerShell window to stop the local server.

The separate `RUN-SHARED-DEV.ps1` script keeps the normal development workflow for later wallet and Yokefellow integration testing.

## Hosted motion model

Hosted turns use **event-driven local replay with authoritative turn boundaries**.

Railway owns the official queue, random seed, chute plan, timer, scoring, payouts, persistence, wallet identity, and Yokefellow settlement. At the start of a turn it sends the confirmed machine boundary plus the turn ID, seed, selected coin count, chute plan, and start time.

Each browser then runs that turn continuously in its own Cannon world. Railway does not stream or correct individual coin transforms during the turn, so falling coins and the lower pile are never pulled, snapped, or steered by network checkpoints.

When the turn fully settles, Railway sends the canonical end-of-turn boundary. The browser replaces its local replay with that confirmed shared state before the next queued turn starts.

A browser joining during a running turn receives the same starting boundary and replay data, then fast-forwards the local simulation to the current elapsed time.

## Current build

- Approved cabinet, peg board, pusher, and loaded flat payout field
- One persistent shared machine for players and spectators
- Server-owned physics and one-shot queued 1–10 coin turns
- Two seconds between inserted coins
- A 30-second timer beginning immediately when the turn is confirmed
- Front-edge payouts counted once; side losses do not score
- Per-wallet lifetime score and one skin milestone resolved per completed turn
- Signed wallet identity using an injected EVM wallet
- Wallet required to join the queue by default; unsigned users can spectate
- Durable, idempotent settlement outbox keyed by completed turn ID
- Existing Yokefellow `offering-events` submission for app-readable turn achievements
- Exact `coin_pusher.random_skin_drop` trigger when one 50-coin skin milestone resolves
- Yokefellow-owned random output selection from the `Random Coin Skin Drop` offering
- Result-card display of the selected `yes_drop.*` skin and mint/request status
- Optional YES bucket-credit submission through a separately configured grant endpoint
- Record-only mode when that credit endpoint has not been added yet
- Atomic server persistence and confirmed-world recovery
- Hosted reconnect and authoritative polling fallback when the live stream is interrupted

The wallet signature only identifies the player. It does not submit a transaction or spend YES.

## Normal shared/integration development

```powershell
npm install
Copy-Item .env.example .env
.\RUN-SHARED-DEV.ps1
```

`RUN-SHARED-DEV.ps1` starts:

- authoritative world server: `http://localhost:8787`
- Vite game client: usually `http://localhost:5173`

For one production-style process:

```powershell
npm run build
npm start
```

Then open `http://localhost:8787`.

## Yokefellow configuration

Edit `.env`:

```dotenv
YES_PUSHER_REQUIRE_WALLET=true
YF_API_BASE_URL=http://localhost:3000/api/sdk/v1
YF_APP_KEY=your-app-key
YF_BUCKET_ID=your-bucket-uuid
YES_PUSHER_APP_SLUG=yes-pusher
YES_PUSHER_SKIN_DROP_TRIGGER_KEY=coin_pusher.random_skin_drop
YES_PUSHER_SKIN_DROP_OFFERING_NAME=Random Coin Skin Drop
YES_PUSHER_YES_PER_COIN_RAW=1000000000000000000
YF_CREDIT_GRANT_URL=
```

With `YF_API_BASE_URL`, `YF_APP_KEY`, and `YF_BUCKET_ID`, completed turns are submitted to the existing Yokefellow bucket offering-event route. Every completed turn still sends `turn_completed`. When the server resolves one 50-coin skin milestone, it also sends the exact event type `coin_pusher.random_skin_drop`.

The game does not choose a skin. The active earned offering named `Random Coin Skin Drop` must use random selection and match that trigger key. Yokefellow selects one of the configured outputs and returns its output/class/request/mint state. The game then reads the bucket catalog to resolve that selection back to the known `yes_drop.*` skin key and image.

The supplied Yokefellow repo does not yet contain an app-authenticated direct YES-credit grant route. Until `YF_CREDIT_GRANT_URL` points to such a route, the game records exactly what each completed turn is owed but labels it **recorded**, not **confirmed**. No payout is falsely reported as transferred.

See [`docs/WALLET-AND-SETTLEMENT.md`](docs/WALLET-AND-SETTLEMENT.md) for the expected endpoint contract and retry behavior.

## Controls

- Connect: sign in with the browser wallet
- − / +: choose 1–10 coins before entering the turn order
- Drop Coins: submit that coin count and enter the queue; the server starts the turn automatically when it reaches the front
- Leave Queue: cancel a waiting drop request before it becomes active
- Drag / wheel: limited camera inspection
- Reset View: restore the intended camera
- Reset Machine: local fallback only; shared resets remain operator actions

## Source structure

```text
apps/world-server/
├── server.js
├── wallet-auth.js
├── settlement-outbox.js
├── player-queue.js
└── player-progress.js

src/
├── main.js
├── config/
├── game/
├── machine/
└── network/
    ├── shared-world-client.js
    ├── shared-world-view.js
    └── wallet-auth-client.js
```

## Persistence

The server writes these files under `.world-data/`:

```text
confirmed-world.json
player-progress.json
settlements.json
```

A completed turn is inserted into the settlement outbox before external submission. The turn ID is the permanent idempotency key. Network failures remain recorded and retry with backoff; they do not cause a second game payout record.

## Validation

```powershell
npm test
npm run build
```

Read `docs/BASELINE-LOCK.md` before changing machine physics or geometry. Use `docs/REGRESSION-CHECKLIST.md` after every machine-related patch.

## Hosted test deployment

This build is prepared for a public test environment:

- Vercel serves the Vite browser game.
- Railway runs the authoritative physics/world server.
- `VITE_WORLD_SERVER_URL` connects the Vercel client to Railway.
- Bearer-backed wallet sessions keep authentication working across the two HTTPS origins.
- `YES_PUSHER_ALLOWED_ORIGINS` limits the Railway server to the Vercel app.
- A Railway volume mounted at `/data` preserves the machine and settlement records.

See `DEPLOY-TESTNET.md` for the deployment order and exact variables.


## Persistent hosted-world behavior

When `VITE_WORLD_SERVER_URL` is present, the browser remains connected to the authoritative Railway machine. It does not create a separate local world when Railway is waking or reconnecting.

The confirmed machine is saved to the Railway `/data` volume after completed turns. Between turns, the pusher pauses at the rear handoff position so unowned payouts cannot occur while the machine is idle.

The Railway health endpoint reports persistence details at `/api/health`.

## Hosted transport recovery

The browser prefers Railway's live event stream. If that stream is interrupted, it switches to `/api/world` polling and continues retrying the stream. The queue and turn status remain server-owned in either transport mode.

Returning to a throttled or hidden tab fast-forwards the local replay through missing elapsed time. It does not apply intermediate server coin positions.

## Shared-world performance

- One instanced coin mesh renders the shared field.
- Railway broadcasts turn/status envelopes rather than moving coin transforms.
- Active-turn payloads reuse the immutable starting boundary.
- Browser physics runs continuously during a turn without reconciliation.
- Railway physics runs only while a turn is resolving.
- Idle worlds remain persisted but physically paused at the handoff position.

After deployment, `/api/health` reports:

```json
{
  "network": {
    "clientVisualMode": "event-driven-turn-replay-with-boundary-snapshots",
    "liveCoinTransformStreaming": false,
    "statusBroadcastsPerSecond": 2
  },
  "persistence": {
    "boundarySnapshots": true
  }
}
```

## CoinPusher 54

CoinPusher 54 removes the hybrid checkpoint-reconciliation system. Turns now begin from one confirmed boundary and play locally from the server-issued seed and chute plan. Railway sends the next canonical boundary only after settlement. The pusher pauses at the rear position while no turn is active.

## CoinPusher 53

Front payout exits now count at the authoritative release edge across the full playable width, including exits on the last settlement frame. The timer displays whole seconds, the bottom instructional hint has been removed, and the artificial payout-edge boost has been removed while retaining pressure directly ahead of the physical pusher.
