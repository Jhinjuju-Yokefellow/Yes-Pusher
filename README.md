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

The hosted browser no longer tries to animate coins by chasing network transforms. That approach caused visible jumping and could make the pusher appear to miss the pile.

Railway still owns the official machine, turns, scores, queue, persistence, wallet identity, and Yokefellow settlement. The browser receives an authoritative checkpoint, builds a local visual copy of the same Cannon machine, and runs real coin collisions and pusher contact between checkpoints. Railway sends two compact checkpoints per second for reconciliation rather than attempting to stream every physics frame.

Normal movement is never position-extrapolated. Small differences are corrected with gentle velocity steering; exact position corrections happen when the machine is settled or after an impossible reconnect-scale divergence. The result keeps the shared-world authority while restoring actual physical pushing in the browser.

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

When `VITE_WORLD_SERVER_URL` is present, the browser remains an authoritative shared-world client. It does not silently create a separate local machine if Railway is waking up or temporarily unreachable. Railway continuously advances and saves the machine independently of browser focus.

The Railway health endpoint reports persistence details at `/api/health`.


## Hosted transport recovery

The browser prefers Railway's live event stream. If a browser, proxy, or background-tab policy closes that stream, the game automatically switches to authoritative `/api/world` polling. The UI shows `FALLBACK SYNC`, keeps the queue usable, and continues retrying the live stream. Returning to the tab forces an immediate snapshot refresh so the renderer catches up to Railway's current machine.

Railway health reports `connections`, `streamConnections`, and `pollingClients` so the active transport is visible.

## Shared-world performance

Hosted shared-world coins are rendered through one instanced mesh. The browser runs a real visual physics copy and Railway sends only compact authoritative checkpoints at up to two per second. Full-precision confirmed-world saves remain unchanged on the Railway volume. The renderer also adapts its pixel ratio under sustained frame pressure instead of forcing a high-resolution frame on every device.

After deployment, `/api/health` includes:

```json
{
  "network": {
    "coinEncoding": "id-position-quaternion-v1",
    "snapshotBytes": 12091,
    "physicsSolverIterations": 8
  }
}
```

The exact byte count changes as coins enter or leave the machine.


## CoinPusher 47 flat starting field

The authoritative machine now starts with 135 non-overlapping coins in one flat layer. There are no starting towers or stacked side banks. This reduces physics load and lets pusher pressure travel through the bed more directly.
