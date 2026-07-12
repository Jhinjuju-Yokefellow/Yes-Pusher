# YES Pusher Shared World

YES Pusher uses one persistent machine with authoritative fast simulation followed by recorded public replay.

## Authority boundary

Railway owns:

- the confirmed machine at every turn boundary
- queue order and the active player
- the one physics simulation for each turn
- permanent coin IDs
- random chute plans and insertion timing
- front payouts and side/rear losses
- exact payout/loss event records by coin ID
- the final machine state
- replay package storage on the `/data` volume
- per-wallet lifetime score, skin milestones, and settlement records

A browser owns only:

- camera controls
- the selected 1–10 coin count before queueing
- smooth interpolation of the recorded replay
- local presentation effects driven by recorded payout/loss events

Browser coin positions, local physics, and local scores are never authoritative because shared-mode browsers do not simulate the turn.

## Turn flow

1. The player presses **Drop Coins** and enters the queue.
2. When the request reaches the front, Railway exposes `syncMode: preparing`.
3. Railway copies the current confirmed world and simulates the complete turn faster than real time.
4. During simulation Railway records sampled transforms, pusher motion, chute state, permanent coin IDs, exact payout/loss events, the result, and the final world.
5. Railway writes one replay package to `/data/replays/<turn-id>.json`.
6. Railway exposes `syncMode: recorded-replay` with one package URL and public start time.
7. Every browser downloads the same package and interpolates between recorded frames.
8. A browser joining midway downloads the package and seeks to Railway's current elapsed time.
9. When playback finishes, Railway promotes `finalWorld` from the package to the next confirmed boundary.
10. Settlement, player progress, queue advancement, and the next preparation begin from that committed result.

There is only one physics result and one set of payout coin IDs.

## Replay package

A replay package contains:

- turn ID, player ID, coin count, chute plan, and seed
- the starting confirmed boundary
- recorded frames with coin transforms, pusher position, active chute, and scoring counters
- exact `payout` and `loss` events with permanent coin IDs
- the finalized turn result
- the complete final confirmed world

Frames are recorded at `YES_PUSHER_REPLAY_FRAME_RATE` and rendered smoothly at the browser frame rate through interpolation. Railway does not stream hundreds of transforms continuously.

## Persistence and restart behavior

- Confirmed worlds remain in `/data/confirmed-world.json`.
- Replay packages remain in `/data/replays`.
- The active replay pointer is stored in `/data/active-replay.json`.
- A Railway restart during public playback restores the replay and elapsed time.
- A restart during preparation discards the unfinished simulation and preserves the previous confirmed boundary.
- The final world is not committed until replay playback completes.

## Endpoints

- `GET /api/health`
- `GET /api/world`
- `GET /events`
- `GET /api/replays/:turnId`
- `POST /api/queue/join`
- `POST /api/queue/leave`
- `POST /api/turn/start` for backward compatibility
- wallet authentication and settlement endpoints documented separately

## Queue rules

- Watching does not require queueing.
- Pressing **Drop Coins** records the chosen 1–10 coins and creates one queued turn.
- The server prepares the request automatically when it reaches the front.
- The active request stays at the front through preparation and replay.
- A completed replay removes that request and advances the queue.
- A disconnected active turn still prepares, replays, commits, and settles on Railway.

## Transport fallback

The browser prefers the live event stream and falls back to `/api/world` polling when needed. Both transports carry queue, timing, result, and replay descriptors. The recorded movement itself is downloaded once from `/api/replays/:turnId`.
