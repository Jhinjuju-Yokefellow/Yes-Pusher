# CoinPusher 55 — Multi-Coin Turn Replay Render Fix

## Fixed

The event-driven replay engine was correctly spawning every selected coin, but the shared renderer only registered the first coin created when the turn began. Later scheduled coins existed in local physics but were never added to the instanced render list, making a multi-coin turn look like a one-coin turn.

The shared-world view now detects coins added by the replay drop schedule and rebuilds the instanced membership only when a coin is added or removed.

## Preserved

- Two-second spacing between selected coins
- Random chute plan supplied by Railway
- Event-driven local turn physics
- No live transform steering or checkpoint snapping
- Authoritative Railway scoring and turn-boundary persistence
- Existing machine geometry, friction, payout behavior, queue, wallets, and Yokefellow integration
