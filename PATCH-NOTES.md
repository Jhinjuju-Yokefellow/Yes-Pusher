# CoinPusher 58 — Unblock automatic queued turns

## Fixed

`Drop Coins` already placed the player into the server-owned queue and Railway already advanced queued turns automatically. The apparent turn-system stall was the authoritative preparation simulation becoming progressively more expensive as the persistent machine filled with settled coins.

- Recorded-turn preparation now uses a lightweight collision hull for settled flat board coins.
- Falling, peg-field, transfer, and freely rolling coins keep the full collision hull.
- Rendered coin geometry is unchanged.
- The authoritative result, exact coin IDs, payout events, replay package, and final-state handoff remain unchanged.
- Preparation yields back to the Railway server more frequently, keeping queue requests, world polling, SSE updates, and health checks responsive while the turn is simulated.

## Turn flow

1. The player presses **Drop Coins** once.
2. The request enters the line with its selected coin count.
3. Railway automatically prepares and starts that turn when it reaches the front.
4. Railway plays the recorded replay and commits its final state.
5. Railway automatically moves to the next queued request.

There is no second player Start action.
