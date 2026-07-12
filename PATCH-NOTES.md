# CoinPusher 49 — Predictive shared-world rendering

The prior hosted build still looked slow because the browser was always rendering delayed server transforms. Reducing shadows and coin count did not remove that network-frame delay.

## Architecture correction

- Railway remains authoritative for physics, scoring, turns, queue order, persistence, and Yokefellow settlement.
- Network snapshots now include velocity and angular velocity for awake coins.
- The browser predicts coin motion between snapshots and smoothly corrects back to Railway state.
- The pusher is animated from authoritative pusher time instead of waiting for each network position update.
- Sleeping coins remain compact and do not receive unnecessary per-frame matrix updates.

## Hosted rendering reduction

- Hosted builds render at a stable 30 FPS instead of attempting an unstable 60 FPS.
- Maximum hosted pixel ratio is reduced to 0.62.
- Hosted materials use lightweight unlit shaders while preserving textures and machine colors.
- Fog, tone mapping, dynamic shadows, glass blur, and UI backdrop blur are disabled in hosted mode.
- Hosted coin geometry uses eight sides.

## Railway physics reduction

- Authoritative physics runs at 30 steps per second with four solver iterations.
- The broadphase is aligned to the machine's forward axis.
- A Railway variable requesting a higher tick rate is automatically capped at the engine physics rate.
- The flat 135-coin starting field and all game rules remain unchanged.

## Compatibility

- The browser still accepts older v1 transform snapshots.
- Saved world files are unchanged and remain compatible.
