# CoinPusher 47 — Flat starting field and lower physics load

## Starting field

- Removed the center jackpot tower.
- Removed every upper starting layer.
- The machine now starts with 135 non-overlapping coins in one flat layer.
- No starting coin is behind or outside the guide walls.
- The front row begins at the payout edge so normal pressure can create earlier wins.

## Performance

- Starting physics bodies reduced from 253 to 135.
- Removed the expensive stack-on-stack contact graph.
- Physics solver iterations reduced from 8 to 6 for the flat field.
- The existing instanced renderer and packed network snapshots remain in place.

## Persistence

The machine revision changed to `coinpusher-47-flat-starting-field-v1`. Railway will reject the old stacked save and seed the new flat field once after deployment. Later saves continue using the `/data` volume normally.

## Preserved

Pusher geometry, stronger forward pressure, payout scoring, drop-to-queue turns, wallet identity, shared-world persistence, and Yokefellow settlement behavior are unchanged.
