# CoinPusher 48 — smooth hosted rendering and lower server load

The flat starting field proved the remaining lag was not primarily caused by the old towers. The hosted client was still visibly chasing six network targets per second, while the Vercel renderer was paying for shadows, physical transmission materials, several real-time lights, and repeated matrix uploads for stationary coins.

## Changes

- Replaced exponential target chasing with timed linear interpolation between authoritative snapshots.
- The first snapshot now appears immediately; later snapshots animate continuously over their measured interval.
- Stationary coin instances no longer rewrite their transform matrix every animation frame.
- Added a hosted performance renderer for Vercel/remote-world builds.
- Disabled the hosted shadow-map pass and high-cost transmission shaders.
- Replaced the individual peg meshes with one instanced peg mesh.
- Reduced hosted coin and peg geometry detail without changing physical dimensions.
- Reduced hosted render pixel density and texture anisotropy.
- Simplified hosted lighting while preserving the emissive cabinet artwork and neon strips.
- Reduced authoritative physics from 60 to 45 steps per second and solver iterations from 6 to 5.
- Reduced collision-cylinder sides from 12 to 10.
- Added `physicsStepsPerSecond` to `/api/health`.
- Changed the recommended Railway `YES_PUSHER_TICK_RATE` to `45`.

## Preserved

- 135-coin flat starting field
- Drop-to-queue turn flow
- Pusher dimensions and travel
- Payout pressure and scoring boundaries
- Shared-world persistence
- Wallet authentication and Yokefellow settlement paths

## Validation

- `npm test`: 38 tests pass
- `npm run build`: passes
