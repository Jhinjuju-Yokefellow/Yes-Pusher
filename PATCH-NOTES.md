# CoinPusher 53 — Front payout counting and clean timer

## Fixed

- Front-edge coins are credited as soon as the authoritative machine commits them to the front fall.
- Front-corner exits across the full payout width count correctly.
- Scoring runs before the final settlement frame can close, so a coin falling at the end of a turn is not missed.
- Each payout coin still counts only once.
- Side exits remain losses.

## UI

- The turn timer now displays whole seconds only.
- Removed the instructional help line below the machine.

## Physics

- Removed the invisible front-edge payout boost.
- Kept the smaller pressure assist directly in front of the physical pusher so the bed remains movable without looking like it is pushed over the edge artificially.

## Validation

- `npm test`: 45 tests pass.
- `npm run build`: passes.
