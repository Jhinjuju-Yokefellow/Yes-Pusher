# CoinPusher 54 — Event-Driven Turn Replay

## Architecture replacement

The hosted game no longer runs local physics while continuously reconciling against Railway coin checkpoints.

Railway now sends:

- one canonical starting boundary
- turn ID
- deterministic seed
- random chute plan
- selected coin count
- turn start time and elapsed time
- authoritative timer, score, queue, and settlement status

The browser replays the active turn continuously from that boundary and ignores all moving server coin transforms.

At turn completion, Railway sends the canonical settled boundary used by every player for the next turn.

## Behavior

- Falling coins are never steered or snapped by network updates.
- The lower coin bed is never pulled toward server checkpoints.
- A browser joining mid-turn fast-forwards the replay from the starting boundary.
- A backgrounded browser catches up by simulating missing time.
- The pusher pauses at the rear handoff position while the machine is ready.
- Railway remains authoritative for scoring, persistence, wallets, queue order, and Yokefellow settlement.
- No environment-variable changes are required.

## Validation

- `npm test`: 45 passing tests
- `npm run build`: production build passes
- Focused server check confirmed active envelopes reuse an unchanged starting boundary while elapsed time advances.
