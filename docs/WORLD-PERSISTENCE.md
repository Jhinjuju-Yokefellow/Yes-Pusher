# YES Pusher Local Fallback Persistence

This document describes confirmed-world persistence. Normal hosted play saves canonical turn-boundary snapshots on Railway; explicit browser-only local development uses IndexedDB/localStorage as a fallback. Both preserve the locked cabinet, peg board, pusher, scoring edges, and coin physics.

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
- while the machine is ready at the rear handoff position
- when the page becomes hidden or closes in explicit local mode, when the game is in a confirmed ready state
- after Reset Machine creates a fresh starting world

An unfinished turn is never committed as the confirmed world. Reloading during an active turn restores the most recent confirmed state from before that turn. This prevents a partial drop, partial payout, or interrupted timer from becoming permanent.

## Compatibility

Snapshots include a schema version and machine revision. A snapshot created for incompatible machine geometry is rejected and replaced with a clean starting world rather than being loaded into the wrong cabinet or collision layout.

## Reset Machine in local fallback mode

Reset Machine clears the previous confirmed save, rebuilds the 121-coin balanced-friction starting field, resets local progression, and immediately saves that new starting world.
