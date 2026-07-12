# YES Pusher Local Fallback Persistence

This document describes the browser-only fallback used when the authoritative shared server cannot be reached. Normal shared play stores the confirmed machine on the world server; see `SHARED-WORLD.md`. The fallback still saves and restores the approved local machine between browser reloads without changing the locked cabinet, peg board, pusher, scoring edges, or coin physics.

## What is saved

A confirmed world snapshot contains:

- every coin ID
- coin phase and scoring state
- position and rotation
- linear and angular velocity
- sleeping state
- pusher cycle time and position
- selected 1–10 coin count
- lifetime coins won
- pending and resolved skin milestones
- next turn number

The snapshot is stored in IndexedDB with a synchronous localStorage fallback.

## Confirmation boundary

The game saves a confirmed snapshot:

- after a turn fully settles and finalizes
- periodically while the machine is ready between turns
- when the page becomes hidden or closes, when the game is in a confirmed ready state
- after Reset Machine creates a fresh starting world

An unfinished turn is never committed as the confirmed world. Reloading during an active turn restores the most recent confirmed state from before that turn. This prevents a partial drop, partial payout, or interrupted timer from becoming permanent.

## Compatibility

Snapshots include a schema version and machine revision. A snapshot created for incompatible machine geometry is rejected and replaced with a clean starting world rather than being loaded into the wrong cabinet or collision layout.

## Reset Machine in local fallback mode

Reset Machine clears the previous confirmed save, rebuilds the 121-coin planar starting field, resets local progression, and immediately saves that new starting world.
