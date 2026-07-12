# CoinPusher 57 — authoritative simulation and recorded replay

## Replaced

- Removed the shared-mode browser physics simulation.
- Removed the second, competing live Railway/browser result path.
- Replaced seed-and-boundary reconstruction with one recorded authoritative replay.

## Added

- Visible `Preparing turn…` state while Railway simulates the complete turn in fast-forward.
- Replay packages stored under `/data/replays/<turn-id>.json`.
- Exact permanent coin-ID payout and loss events.
- Browser-only frame interpolation with no Cannon physics in shared mode.
- Mid-turn replay download and seeking.
- Final-world promotion after replay completion.
- Active replay pointer persistence for Railway restarts.
- `GET /api/replays/:turnId`.
- `YES_PUSHER_REPLAY_FRAME_RATE` configuration.

## Preserved

- CoinPusher 56 machine geometry and physics behavior.
- Queue and wallet identity.
- Yokefellow YES credit and random skin triggers.
- Player progress and scoring rules.
- Confirmed-world persistence.

## Validation

- `npm test` — 48 tests pass.
- `npm run build` — production Vite build passes.
