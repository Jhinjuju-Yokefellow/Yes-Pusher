# CoinPusher 50 — local visual physics with server authority

## Why the previous build failed

The predictive hosted renderer moved each coin forward from its last network velocity and then corrected it toward the next Railway snapshot. In a dense contact pile, those predictions cannot know the collisions that happened on the server. The result was jumping coins and a pusher that could visually pass through or fail to move the pile. Lowering graphics settings could not fix that architecture.

## New hosted model

- Railway remains authoritative for the official machine, queue, turns, scoring, persistence, wallet identity, and Yokefellow settlement.
- The browser creates a local Cannon visual machine from the first authoritative checkpoint.
- The local pusher and coins use real collision physics between checkpoints.
- No coin position or velocity is extrapolated as a rendered transform.
- Railway checkpoints are capped at two per second instead of six movement streams per second.
- Small active-turn drift is corrected through low-speed steering, not teleportation.
- Exact reconciliation happens while the machine is ready/settled or after a reconnect-scale divergence.
- New dropped coins enter the browser from their authoritative position, phase, and velocity.
- Sleeping state and peg/board phase are included in the compact transport.

## Reverted from CoinPusher 49

- Removed predictive coin transform extrapolation.
- Removed the forced 30 FPS render cap.
- Restored the CoinPusher 48 visual materials and styling instead of the ultra-flat hosted downgrade.
- Restored the 45-step authoritative physics configuration.

## Preserved

- 135 flat starting coins with no towers or stacks.
- Drop-to-queue automatic turns.
- Stronger forward payout pressure.
- Persistent Railway world and volume storage.
- Wallet authentication and Yokefellow skin-drop trigger.

## Verification

- `npm test`: 40 tests pass.
- `npm run build`: passes.
- Focused visual-physics test confirms the flat pusher physically moves a board coin.
