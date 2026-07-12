# CoinPusher 46 — Shared-World Performance Pass

## What caused the lag

The hosted client was still creating one separate Three.js mesh for every coin. With the loaded 253-coin field, that meant hundreds of draw objects were interpolated and rendered every frame. The Railway server also sent verbose transform objects for every coin six times per second and used the original high-cost physics solver settings.

## Browser rendering

- Replaced hundreds of separate shared-world coin meshes with one dynamic `THREE.InstancedMesh`.
- Preserved the existing three-material coin face, back, and rim appearance.
- Kept per-coin position and quaternion interpolation while updating one GPU instance buffer.
- Added support for both the new packed snapshots and older object-form snapshots.
- Added adaptive render resolution:
  - maximum device pixel ratio: `1.1`
  - minimum under sustained load: `0.72`
  - resolution can recover upward when frame time improves
- Replaced the expensive soft-shadow filter with standard PCF shadows.
- Reduced the main directional shadow map from 1536² to 1024².
- Limited texture anisotropy to 8 instead of always requesting the hardware maximum.

## Network transport

- Added packed coin transforms for hosted snapshots:

```text
[id, x, y, z, qx, qy, qz, qw]
```

- Rounded transport-only transforms to four decimal places.
- The authoritative confirmed-world save remains full precision and unchanged.
- The server now creates the common physics snapshot once per broadcast instead of rebuilding it separately for every connected player.
- Protocol version increased to `2`; the client remains backward-compatible with protocol-1 coin objects.

For the 253-coin starting machine in this environment:

```text
Previous coin snapshot: 41,090 bytes
Packed coin snapshot:   12,091 bytes
Reduction:               about 70%
```

## Railway physics

- Reduced Cannon solver iterations from 12 to 8 in both authoritative and local fallback physics.
- Kept the same 60 Hz fixed physics step, pusher path, payout pressure, collision geometry, loaded field, and scoring rules.
- The health endpoint now reports the active coin encoding, approximate transform snapshot size, and solver iteration count.

## Preserved

- Drop-to-queue turn flow
- Stronger forward payout pressure from CoinPusher 45
- Center jackpot tower and loaded side banks
- Persistent Railway-owned world
- Wallet authentication, Yokefellow settlement outbox, and random skin trigger
- Front payout counting and side-loss behavior

## Validation

```text
npm test       37 tests pass
npm run build  passes
```

Focused checks confirm one instanced coin renderer holds all 253 starting coins and that old object-form snapshots still render.
