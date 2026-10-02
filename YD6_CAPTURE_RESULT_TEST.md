# YD-6 — Capture and Result Presentation

## Goal

A viewer should understand the outcome of a Rainbow's End turn without knowing how Yokefellow settlement, indexing, or NFT issuance works.

YD-6 changes presentation and cleanup only. It does not change the authoritative turn, payout, queue, free-turn, or NFT eligibility rules.

## Presentation flow

### During the turn

When a Toy reaches the payout:

```text
TOY CAUGHT!
Horseshoe reached the payout.
```

The cue appears for every connected viewer.

If the active player's currently displayed collection already contains two Small Toys from that family, the cue also shows:

```text
CRAFT AVAILABLE · 3 Small → 1 Medium
```

This is a presentation cue only. Craft execution remains in the outer Workshop.

The existing Toy-power presentation still follows the catch event.

### Result transition

When the authoritative machine locks scoring, all clients enter an explicit counting phase:

```text
COUNTING RESULT…
Checking the final payout area…
```

This happens before the final result card.

### Final turn result

The final card prioritizes the human outcome:

- player;
- coins that reached the payout;
- YES value;
- multiplier/bonus when applicable;
- missed coins when applicable;
- Toy caught;
- craft-available cue when applicable;
- Coin Skin NFT earned count when applicable;
- lifetime YES for the actual player.

It does not expose settlement IDs, transaction internals, retry IDs, or operator terminology.

### NFT result

The owner retains the large actionable NFT result presentation.

Toy and Skin outcomes use:

- TOY NFT
- COIN SKIN NFT
- NFT CONFIRMED when mint/confirmation is final;
- NFT RESULT while the final state is still pending.

Other connected viewers receive a smaller public presentation event when a Toy NFT or Coin Skin NFT is confirmed. Owner-only actions such as equipping a newly earned Skin remain private to the owner.

### Settlement/reconciliation copy

Public-facing messages are intentionally simple:

- Result saved. YES credit is still confirming.
- YES result confirmed. Coin Skin NFT is still reconciling.
- YES result confirmed. Toy NFT is still reconciling.
- Result confirmed: N YES credited.

The detailed failure/retry data remains in the authoritative settlement record; it is not shown as spectator-facing copy.

## Capture cleanup

Captured Toys now follow the same lifecycle as captured coins:

1. cross PayoutZone;
2. score once and activate their power;
3. continue falling naturally;
4. reach CleanupZone;
5. leave the authoritative physics world.

Previously a successful Toy capture could survive CleanupZone because the paid-Toy branch returned without freeing it.

Lost Toys still emit their loss event before removal.

## Local test mode

The Bucket/App/Paths do not need to be live for the YD-6 visual test.

Local presentation mode exposes the five current Coin Skin families so a test player can equip a family and put its matching Toy into the machine:

- Horseshoe
- Four Leaf Clover
- Leprechaun
- Pot of Gold
- Treasure Chest

The right-side player profile remains a local fixture. Real Profile Card and NFT ownership data will come from Yokefellow when the final integration is enabled.

Real Toy/Skin NFT confirmation presentation is implemented but cannot be fully accepted until the corresponding Yokefellow Paths are live.

## Gate

Run repeated turns with at least one equipped Toy family.

A successful test should let a spectator answer these questions without explanation:

1. Whose turn was it?
2. Was a Toy caught?
3. What Toy was it?
4. What did the Toy do?
5. How many coins reached the payout?
6. How much YES did the player win?
7. Was an NFT outcome earned/confirmed?
8. If final confirmation is still pending, is that clear without technical error language?
9. If three Small Toys are now available, is the Workshop/craft opportunity obvious?
10. Did the captured physical Toy disappear cleanly after leaving the visible machine?

The YD-6 gate is passed when the turn reads as a coherent sequence from capture through result, including for a spectator who does not understand Yokefellow's settlement architecture.
