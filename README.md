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

## Performance correction

The loaded shared machine previously rendered every coin as a separate textured mesh. With roughly 253 coins and three coin material groups, that could create hundreds of draw calls every frame. The shared renderer now uses one instanced coin mesh, reducing that work to only a few draw calls. Server snapshots default to six updates per second and are smoothly interpolated in the browser. The authoritative physics remains at 60 steps per second.

## Current build

- Approved cabinet, peg board, pusher, centered jackpot tower, and loaded side payout banks
- One persistent shared machine for players and spectators
- Server-owned physics and 1–10 coin turns
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
- Local confirmed-world fallback when the shared server cannot be reached

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
- Join Queue: enter the shared turn order
- − / +: choose 1–10 coins while active
- Drop Coins: confirm the turn
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
