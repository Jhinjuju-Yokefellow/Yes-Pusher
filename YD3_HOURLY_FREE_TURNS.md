# YD-3 — Hourly free-drop system

## Required behavior

Each verified wallet has at most one hourly free turn available.

State flow:

```text
AVAILABLE
  -> RESERVED / QUEUED
  -> IN PROGRESS
  -> TURN COMPLETES
  -> 1:00:00 COOLDOWN
  -> AVAILABLE
```

The one-hour cooldown starts from the authoritative turn-completion timestamp, not from queue join, reservation, turn start, or browser acceptance.

## Server authority

The machine service owns:

- `next_free_turn_at_unix`
- the current free-turn reservation id
- the reservation timestamp
- the last completed free-turn id and completion timestamp

The client receives a server timestamp and `next_free_turn_at_unix`, then renders the countdown locally using a server-time offset. The server still re-checks eligibility before granting access.

## No stacking

Expiration of the cooldown produces one available free turn. Time beyond the expiry never accumulates additional free turns.

## Reservation and recovery

If a free turn is available when a player joins the queue, that turn is reserved immediately.

- Leaving the queue or disconnecting before the turn becomes active releases the unused reservation.
- Disconnecting during an active turn does not cancel the authoritative turn.
- A server restart during an active free turn restores the active turn and its reservation.
- An orphan reservation with no recoverable active turn is cleared on startup.
- The cooldown is written only after authoritative turn completion.
- Settlement retries do not restart or extend the cooldown.

## Paid/free parity

Both paths call the same active-turn, physics, result, payout, skin, Toy, and settlement code.

The intended production difference is only:

- hourly free: no 10 YES spend
- paid: 10 YES spend

`YES_PUSHER_TEST_FREE_TURNS=true` remains a test-only paid-charge bypass. It must be false for final paid/free charge acceptance.

## UI

A verified player sees one of:

- `FREE DROP AVAILABLE NOW`
- `FREE DROP RESERVED · QUEUED`
- `FREE DROP IN PROGRESS · COOLDOWN STARTS WHEN TURN ENDS`
- `NEXT FREE DROP · H:MM:SS`

When the free turn is available, the play button reads `FREE DROP · 10 COINS`. During cooldown it reads `DROP 10 COINS · 10 YES` in production.
