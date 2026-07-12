# YES Pusher Shared World

YES Pusher uses one persistent machine with server-authoritative turn results and event-driven browser replay.

## Authority boundary

Railway owns:

- the confirmed machine at every turn boundary
- queue order and the active player
- turn IDs and random seeds
- random chute plans and insertion timing
- authoritative physics for scoring
- front payouts and side losses
- the 30-second timer, cycle finish, and settlement window
- per-wallet lifetime score and skin milestones
- settlement records and Yokefellow submissions
- persistent confirmed-world files on the `/data` volume

A browser owns only:

- camera controls
- the selected 1–10 coin count before queueing
- a temporary visual replay of the active turn

Browser coin positions and local scores are never submitted to Railway.

## Turn transport

While ready, Railway sends a full canonical boundary snapshot.

When a queued turn starts, Railway sends:

- the boundary ID
- the starting coin snapshot
- turn ID
- player ID
- selected coin count
- chute plan
- deterministic turn seed
- start time and elapsed time

The browser starts the same turn locally and does not accept moving coin transforms from Railway during that turn.

Railway continues its independent authoritative simulation for scoring. Repeated live events carry queue, timer, score, and settlement status, but the coin array remains the unchanged starting boundary.

When the turn is finalized, Railway sends a new canonical boundary. That boundary replaces the browser replay before the next turn.

A browser joining mid-turn reconstructs the starting boundary and fast-forwards the replay to the server's elapsed time.

## Idle behavior

The pusher pauses at the rear handoff position while the turn state is `ready`. Railway does not advance idle physics, so payouts cannot occur without a scoring owner.

## Endpoints

- `GET /api/health`
- `GET /api/world`
- `GET /events`
- `POST /api/queue/join`
- `POST /api/queue/leave`
- `POST /api/turn/start` for backward compatibility
- wallet authentication and settlement endpoints documented separately

## Queue rules

- Watching does not require queueing.
- Pressing **Drop Coins** records the chosen 1–10 coins and creates one queued turn.
- The server starts the request automatically when it reaches the front.
- The player does not press again.
- A completed request leaves the queue.
- A disconnected active turn finishes on Railway.
- Short disconnects preserve queue position for reconnection.

## Persistence

Railway saves the confirmed world after finalized turns. An unfinished turn is not committed. Restarting during a partial turn restores the prior confirmed boundary.

## Transport fallback

The browser prefers the live event stream and falls back to `/api/world` polling when needed. Both paths deliver the same event-driven turn envelope. Neither path streams active coin corrections.
