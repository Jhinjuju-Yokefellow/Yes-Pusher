# CoinPusher 51 — planar pressure bed

## What the video showed

The peg-board drops were moving, but the loaded board behaved like one heavy rigid carpet. The pusher reached the rear row, yet most of its force was consumed by three-dimensional floor contacts and vertical pile resolution. The field barely advanced, and the browser was still paying for a full 3D contact graph on every frame.

## Changed physics model

- Starting lower-board coins are now constrained to the board plane.
- Planar coins can move and rotate across the board but cannot climb, stack, or launch upward.
- Lower-board coins no longer solve unnecessary floor contacts.
- Coins remain fully three-dimensional while falling through the peg board, landing on the moving shelf, transferring to the lower board, and falling over an edge.
- A coin locks into planar mode only after it reaches the lower playfield.
- A coin automatically returns to free 3D motion at the payout or side edge so the visible fall remains physical.

## Pusher correction

- The flat pusher reaches 0.19 units farther than CoinPusher 50.
- A gentle pressure wave now travels through the loaded flat field during the forward stroke.
- Pressure is strongest near the pusher and fades toward the payout edge.
- No upward impulse is added.
- The front edge remains loaded enough for regular payouts without relying on towers.

## Starting field

- 121 flat physical coins.
- No towers or stacked layers.
- No starting coin behind the pusher or guide walls.
- Nine staggered rows keep the sides visibly loaded while reducing the contact count.

## Persistence

The machine revision changed to `coinpusher-51-planar-pressure-field-v1`. Railway will reject the incompatible saved CoinPusher 50 geometry once and create the new planar starting field.

## Verification

- `npm test`: 41 tests pass.
- `npm run build`: passes.
- A 20-second deterministic loaded-field test advanced more than 30 starting coins by at least 0.20 units without vertical rise.
- The same test produced early payouts instead of leaving the bed stationary.
- A 42-second five-coin authoritative turn simulation completed substantially faster than real time in the test environment.
