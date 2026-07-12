# CoinPusher 52 — balanced friction and smooth falling coins

This patch corrects the two problems in the previous planar-pressure build: the lower bed felt like it was sliding on ice, and server checkpoints could visibly jerk coins while they were falling.

## Board feel

- Lower-board coins again collide with the physical board and use real board friction.
- Coin-to-board, coin-to-coin, and pusher contact friction were increased.
- Board coins may wobble slightly, but their rise and tilt are limited so a 121-coin field does not rebuild the old expensive stack graph.
- Rolling resistance now slows loose coins instead of allowing them to coast across the machine.
- The whole bed is no longer given a broad artificial forward velocity.
- A smaller pressure aid acts near the pusher, while a side-weighted edge assist helps a few front coins pay out during normal play.
- The starting field remains one non-overlapping layer, shifted only enough to keep the payout edge active.

## Falling motion

- Peg-board, transfer, and payout-fall coins are never steered or snapped by later Railway checkpoints.
- Those visible falls run continuously in the browser from their original spawn state.
- Reconciliation is limited to grounded board coins.
- Grounded correction is weaker and never changes vertical velocity.
- Large corrections are reserved for settled sleeping coins or the initial connection.
- Pusher clock correction is also rate-limited to avoid visible jumps.

## Persistence

The machine revision is now `coinpusher-52-balanced-friction-field-v1`. Railway will replace the incompatible CoinPusher 51 saved field once after deployment.

## Validation

- `npm test`: 43 tests pass.
- `npm run build`: passes.
- A friction test confirms a loose board coin loses more than 42% of its speed in one second.
- Airborne checkpoint tests confirm a falling peg coin receives no position or velocity correction.
- Four deterministic 20-second loaded-field simulations produced 2–4 early payouts rather than dropping the entire front row at once.
