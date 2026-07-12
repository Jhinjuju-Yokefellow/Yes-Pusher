# YES Pusher Local Turn System

This build adds the complete local turn lifecycle without changing the approved machine geometry or physics.

## Lifecycle

```text
READY
→ START 30-SECOND CLOCK
→ DROPPING WHILE CLOCK RUNS
→ ACTIVE PUSH WINDOW FOR REMAINING TIME
→ FINISH CURRENT PUSHER CYCLE
→ SETTLE FINAL PAYOUTS
→ FINALIZE RESULT
→ READY
```

## Scoring ownership

A local turn owns front-edge payouts from the moment its batch starts inserting until the settle window closes. Front payouts outside an owned turn are removed from the machine but are not added to player progress.

The turn records:

- coins selected and dropped
- randomized chute plan
- coins won
- side/rear losses during the turn
- lifetime coins won
- skin milestone progress

## End-of-turn handling

The 30-second timer starts as soon as the player confirms the turn, so the two-second coin insertion spacing is included in the turn. When the timer expires, the current pusher cycle completes before settlement begins. Settlement uses a quiet window that restarts when another payout or loss occurs, with a maximum settlement duration so the turn cannot remain open forever.

## Skin milestones

Every 50 lifetime coins won creates one skin milestone. A maximum of one milestone resolves per completed turn. Additional crossed milestones remain pending for later completed turns.

In shared wallet mode, a resolved milestone is submitted through the Yokefellow trigger `coin_pusher.random_skin_drop`. Yokefellow selects the random output from the `Random Coin Skin Drop` offering. Local fallback mode still records the milestone without submitting an NFT event.

## Automated checks

Run:

```powershell
npm test
npm run build
```

The tests verify the turn state sequence, scoring ownership, cycle-boundary finish, settlement, and one-skin-per-turn milestone rule.
