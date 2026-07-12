# YES Pusher — Corrected Machine and Turn Rules

## 1. Machine layout

The machine has two different physical areas:

### Moving pusher shelf

The pusher is a moving upper shelf located toward the rear of the machine.

It is:

* Smaller than the full play board.
* Centered beneath the peg board.
* Wide enough to receive the dropped coins.
* Shorter and narrower than the fixed lower board.
* Retracts completely behind the rear scraper wall at the back of every cycle.
* Cycles continuously while a turn is active, then pauses at the rear handoff position while the machine is ready.

Coins coming through the peg board land **on top of the moving pusher shelf**, or on coins and toys already resting on that shelf.

### Fixed main board

The main board is larger than the moving pusher shelf.

It:

* Extends farther forward.
* Extends beyond the pusher on the left and right.
* Holds the large persistent pile of coins and toys.
* Contains the front scoring edge.
* Contains the side-loss areas.
* Supports the persistent flat starting field and later player-created objects.

The pusher does not occupy the entire machine floor.

---

## 2. How the pusher moves coins

The rear wall remains fixed.

The moving pusher shelf repeatedly travels through this cycle:

1. The shelf retracts completely behind the rear scraper wall.
2. Coins fall through the peg board and land on the shelf.
3. The shelf moves forward.
4. Coins on the shelf press against the existing pile.
5. The shelf retracts again.
6. The fixed rear wall prevents coins from following the shelf backward.
7. The wall strips or pushes those coins off the moving shelf and onto the fixed main board.
8. The shelf begins another forward push.

This repeats throughout the active turn.

Coins can:

* Land directly on the moving shelf.
* Land on top of other coins already on the shelf.
* Stack temporarily on the shelf.
* Be pushed forward during extension.
* Be scraped off the shelf by the rear wall during retraction.
* Fall onto the fixed board.
* Remain in the shared machine for future turns.

The rear wall and moving shelf must work together like a real coin-pusher mechanism. Coins should not simply spawn in front of the pusher.

---

## 3. Drop path

Each player chooses between 1 and 10 coins.

The machine assigns each coin a random entry chute. A batch is spread across the available chutes: for batches of seven or fewer, chutes do not repeat; larger batches use shuffled chute cycles so the coins do not all enter from the same place.

The path is:

```text
Random top chute
→ short insertion roll
→ glass-enclosed rear peg board
→ coin stays flat and pings through pegs
→ lower transfer hood turns it onto the moving shelf
→ repeated pusher cycles move it into the shared pile
```

Coins release with a short stagger rather than all occupying the same position in the same frame.

The last coin in the batch must be tracked by the server.

---

## 4. Turn timing

A turn has two timing stages.

### Queue request stage

The player chooses:

* Coin count from 1 through 10.
* Any available pre-drop power.

Pressing **Drop Coins** submits one queued turn request. When it reaches the front of the queue, the server starts the batch automatically; no second confirmation is required.

### Active machine stage

The main turn timer begins immediately when the server starts the queued 1–10 coin batch.

Coin insertion is part of the 30-second turn. The coins continue releasing one at a time with the normal two-second spacing while the clock runs. The timer does not wait for the final coin to reach the pusher receiving area.

The normal active-machine time is:

> 30 seconds from automatic queued-turn start.

During those 30 seconds:

* The pusher keeps extending and retracting.
* Several complete pusher cycles can occur.
* Coins can continue moving between shelves.
* Towers can destabilize and collapse.
* Toys can move toward the edge.
* The active player receives credit for valid front-edge exits.
* The player may activate earned toy powers while time remains.

The pusher does not perform only one push per player.

---

## 5. End of turn

When the 30-second timer reaches zero:

1. No additional normal player inputs are accepted.
2. The current pusher cycle must finish.
3. The pusher returns to the designated handoff position.
4. A short scoring-settle window remains open for objects already falling.
5. Front-edge coin and toy exits are finalized.
6. The world snapshot is saved.
7. The next player receives control.

The turn must never hand off:

* During a forward stroke.
* During a retraction.
* While the pusher is in an undefined middle position.
* Before already falling objects are attributed.

The active player owns all valid scoring exits from their confirmed drop until their turn is finalized.

---

## 6. Turn motion and scoring ownership

The pusher cycles continuously while a turn is inserting coins, active, finishing its current cycle, or settling payouts.

After settlement, it stops at the rear handoff position until the next queued turn begins. No physics or scoring advances while the machine is ready and unowned.

The active player owns every valid front-edge payout from the beginning of their confirmed turn through the end of its settlement window.

---

## 7. Toy powers and bonus time

When the active player pushes another player’s toy off the front edge:

* They earn the corresponding small trinket NFT.
* They receive that toy’s small power.
* Extra time is added to the current turn.
* The capture is recorded immediately.
* The physical toy is removed from the shared world.

A toy power adds time to the existing turn rather than starting a separate turn.

Example starting rule:

* Base active-machine time: 30 seconds.
* Toy capture bonus: 3 seconds.
* Maximum bonus time in one turn: 12 seconds.
* Maximum total turn time: 42 seconds.

The final values should be configurable.

Power-created coins or movements do not restart the 30-second base clock. The toy’s defined time bonus provides the extra opportunity.

At turn end, the current pusher cycle must still finish even when the bonus timer has expired.

---

## 8. Coin scoring

A coin scores when its authoritative physics object crosses the front scoring boundary during the active player’s scoring window.

Coins can include:

* Coins dropped during the current turn.
* Coins dropped during earlier turns.
* Coins released from later player-built piles.
* Coins moved by a valid toy power.

Coins lost through side drains do not score.

The server records:

```text
coins won during turn
lifetime coins won
YES credit value for the turn
world objects removed
large payout or object events
```

Physical coin score and YES value remain separate values.

---

## 9. Skin achievement progression

Coin skins are earned through cumulative scoring achievements.

Initial progression rule:

> Every 50 coins won creates one random skin-drop milestone.

Examples:

* 50 lifetime coins won: first skin milestone.
* 100 lifetime coins won: second skin milestone.
* 150 lifetime coins won: third skin milestone.
* 200 lifetime coins won: fourth skin milestone.

The total is based on coins pushed over the scoring edge, not coins dropped into the machine.

### Maximum one skin earned per turn

Only one random skin NFT can be earned from a single completed turn.

At turn finalization:

1. Add that turn’s scored coins to the player’s lifetime total.
2. Calculate how many new 50-coin milestones were crossed.
3. Resolve no more than one skin-drop milestone.
4. Preserve any additional crossed milestones as pending.
5. A later completed turn may resolve one pending milestone.

Example:

```text
Player starts at 40 lifetime coins.
Player wins 125 coins during one large payout wave.
New total: 165.
Milestones crossed: 50, 100, and 150.
Skin drops earned this turn: 1.
Pending skin milestones: 2.
```

On each later completed turn, no more than one pending milestone can produce another random skin.

This prevents one unusually large payout from issuing several skin NFTs simultaneously without taking away the achievements the player earned.

### Random skin resolution

Each resolved milestone sends the exact Yokefellow app/integration trigger key:

```text
coin_pusher.random_skin_drop
```

That trigger targets the earned offering named `Random Coin Skin Drop`. The game sends the achievement and permanent milestone event identity but does not choose an output. Yokefellow randomly resolves one of the offering's active `yes_drop.*` NFT outputs.

The following remains a separate configuration decision:

* Whether duplicate skins are possible.
* Whether the random pool excludes already-owned skins.
* What happens after a player owns every skin.

---

## 10. Equipped skins and toys

The starter coin remains available to every player and is not an NFT.

When a player equips an earned skin:

* Their dropped coins use that skin’s visual appearance.
* Coin physics remain identical to all other skins.
* One matching toy is added to the shared machine during their turn.
* The toy remains in the shared world until another player pushes it off.

The matching toy should enter the pusher receiving area during the same turn, after or near the player’s coin batch.

The toy is not part of the 1–10 coin count.

The toy must contain:

```text
toy instance ID
toy family
source skin
source wallet
spawn turn
power type
world-state position
```

The player who introduced the toy cannot earn its capture trinket by later pushing off their own toy.

---

## 11. Shared state versus personal state

### Shared across every player

* Moving pusher shelf.
* Fixed main board.
* Peg board.
* All loose coins.
* All physical toys.
* All previous-player effects.
* Current pusher cycle.
* Machine world revision.

### Personal to each player

* Equipped coin skin.
* Owned skin NFTs.
* Owned trinket NFTs.
* Crafted trinket tiers.
* Showcase arrangement.
* Lifetime coin score.
* Pending skin milestones.
* Available toy powers during the current turn.

The physical machine is the same for everyone.

The showcase surrounding the machine displays the currently active player’s owned trinkets and saved arrangement so every viewer sees the same player spotlight during that turn.

## Coin Skin NFT Rule

Every unlockable coin skin is an NFT-backed output issued through the YES Pusher bucket.

Players begin with a default starter coin appearance that is not an NFT.

When a player reaches a skin achievement milestone:

1. The game records the completed achievement.
2. Yokefellow resolves one eligible random coin skin.
3. The corresponding coin skin NFT enters the mint queue.
4. Once minted, the player can equip that NFT as their active coin skin.
5. The game verifies current NFT ownership before using the skin.

An equipped coin skin NFT controls:

* The visual appearance of the player’s dropped coins.
* The matching toy added to the shared machine during the player’s turn.
* The toy family used for any trinket NFT earned when another player pushes that toy off.
* The small power associated with that toy family.

Coin skin NFTs do not change:

* Coin size.
* Coin mass.
* Collision shape.
* Friction.
* Number of coins available.
* Scoring value.
* Payout probability.

All coin skins must use identical gameplay physics.

### Skin achievement progression

Every 50 lifetime coins won creates a random coin-skin milestone.

Only one coin skin NFT may be resolved during a single turn. Additional milestones crossed during that turn remain pending and can resolve during later completed turns.

Example:

* Player begins with 40 lifetime coins.
* Player wins 125 coins from a large payout wave.
* Player finishes with 165 lifetime coins.
* The player crossed the 50, 100, and 150 milestones.
* One random coin skin NFT is resolved.
* Two skin milestones remain pending.

### Duplicate handling

The skin collection needs one locked duplicate rule:

* Random skins may repeat, with duplicates potentially used in a future system; or
* The random pool excludes skins already owned until the player has collected every available skin.

The selected rule must be enforced by Yokefellow when the random output is chosen, not trusted to the game client.


---

## Wallet ownership and YES settlement

A verified wallet owns the player’s queue position, active turn, lifetime coin total, and pending skin milestones. The login signature identifies the player only and never spends YES.

Every scored turn creates one idempotent server settlement record. Physical coins won are converted to the configured raw YES credit amount per coin. The record may be:

- confirmed by a configured Yokefellow bucket-credit route;
- pending or retrying after a network failure; or
- recorded as owed when no direct credit route exists yet.

Recorded owed credit must never be displayed as transferred. Skin achievements use the separate Yokefellow offering-event path and remain NFT-backed outputs rather than YES-credit records.
