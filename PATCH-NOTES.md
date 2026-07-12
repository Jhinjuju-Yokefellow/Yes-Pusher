# CoinPusher 45 — Drop-to-Queue Turns and Stronger Payout Pressure

## Turn flow

- The player chooses 1–10 coins and presses **Drop Coins**.
- That same action submits one queued turn request.
- The chosen coin count is stored with the queue entry.
- The authoritative server starts the request automatically when it reaches the front.
- A completed request leaves the queue instead of rotating forever.
- Players press Drop Coins again when they want another turn.
- A separate **Leave Queue** control only appears for a request that is still waiting.

## Machine pressure

- The flat pusher stroke extends modestly farther while remaining behind the starting loose-coin field.
- Pusher-to-coin grip is slightly higher and board drag is slightly lower.
- A small forward pressure assist is applied without any upward velocity.
- Only the low outer payout-bank coins receive the front-edge pressure assist, keeping the center tower physical and avoiding a full-pile wake-up/lag spike.
- Focused simulation produced regular side-bank payouts while keeping coins flat.
- The authoritative scoring path was corrected so one fallen coin records exactly one payout.

## Preserved

- One persistent Railway-owned machine
- Existing cabinet, peg board, centered tower, random chutes, two-second insertions, and 30-second timer
- Wallet identity, Yokefellow settlement outbox, and random-skin trigger
- Hosted live-stream and polling recovery
