# YES DROP — Launch Product Spec

**Status:** Authoritative launch product target  
**YD-1 baseline:** `main@d1dfd7874dc17e59f0818df5a36da6659db2d375`  
**Public App name:** YES DROP  
**Launch machine:** Rainbow's End

This document captures the current launch decisions for YES DROP. It supersedes older YES Pusher / Coin Pusher product assumptions where they conflict. `00_BASE_FIRST_LAUNCH_GUARDRAILS.md` remains applicable for Base-first infrastructure and preservation of working systems where it does not conflict with this spec.

## 1. Product shape

YES DROP is a shared live coin-pusher App. "Coin pusher" describes the game type; YES DROP is the product.

Rainbow's End is the launch machine and may keep its own strong theme. YES DROP does not need to make this first machine generic. If usage later exceeds what one shared machine can reasonably serve, additional themed machines may be introduced. Future machines may have their own fields, toys, skins, powers, and collectible sets.

The launch goal is one polished shared Rainbow's End machine, not a generalized multi-machine system.

## 2. Turn rules

A paid turn costs **10 YES** and drops **10 coins**.

The authoritative shared machine determines physical outcomes. Coins that qualify through the payout area determine YES winnings.

### Hourly free turn

Each player receives exactly **one free turn per hour**.

Rules:

- one free turn maximum;
- free turns do not stack;
- the refill interval is one hour;
- the next hour starts only after the free turn has been successfully accepted/started by the authoritative system;
- a request that fails before a turn exists must not consume the free turn;
- the player gets a visible live countdown until the next free turn;
- at zero, the state becomes **FREE DROP READY**;
- paid play remains available.

A free turn is otherwise identical to a paid turn:

- 10 coins;
- same physics;
- same YES payout;
- same skin progress;
- same toy behavior;
- same NFT eligibility;
- same milestones and powers.

The only difference is that the turn costs 0 YES.

## 3. Rainbow's End collectible families

The launch machine uses these five families:

- Horseshoe
- Four-Leaf Clover
- Leprechaun
- Pot of Gold
- Treasure Chest

The current gameplay powers remain the starting point for launch work. They may be repaired where implementation quality is poor, but YD-1 does not redesign them.

## 4. Coin Skin NFTs

Every **100 lifetime coins successfully paid out** earns one random Coin Skin NFT result.

The player should be able to see progress toward the next milestone, for example:

> NEXT COIN SKIN — 74 / 100

Rules:

- the result is random;
- duplicates are allowed;
- skins are transferable;
- skins are Auction-eligible;
- a player may equip a skin they currently own;
- an equipped skin determines which matching physical toy enters that player's turn.

If an equipped skin is transferred or sold away, YES DROP must fall back to the default YES coin when ownership is next authoritatively checked. An equipped preference must never create ownership rights.

## 5. Skin-to-toy rule

Equipping a Rainbow's End Coin Skin causes the matching physical toy to enter that player's turn.

Examples:

- Horseshoe skin -> Horseshoe physical toy;
- Four-Leaf Clover skin -> Four-Leaf Clover physical toy;
- and so on for all five families.

The physical toy/power is determined by family. Collectible size progression does not alter which toy enters the machine or what its power does.

## 6. Toy NFT earning

A qualifying physical toy catch during the player's turn awards that family's **Small Toy NFT**.

Rules:

- only a qualifying catch awards the Toy NFT;
- the Small Toy NFT is transferable;
- the Small Toy NFT is Auction-eligible;
- a failed/lost/non-qualifying toy does not award the NFT.

## 7. Toy progression: burn + craft

Toy progression exists to demonstrate Yokefellow burn and craft mechanics while creating visible collection progression.

Each family has three collectible sizes:

**Small -> Medium -> Large**

Craft rules:

- burn 3 Small of the same family -> craft 1 Medium;
- burn 3 Medium of the same family -> craft 1 Large.

Medium and Large Toy NFTs are also transferable and Auction-eligible.

The ladder is intentionally internal/simple. It is not a complicated gameplay skill tree.

### Gameplay boundary

Toy size does **not** affect:

- the physical toy inserted into the machine;
- the toy power;
- power strength;
- payout rules.

Toy size affects the player's collectible/showcase presentation only.

## 8. Active-player social presentation

The machine should make the current dropper feel like a real person to everyone else watching.

For the active player, every viewer sees:

### Canonical Yokefellow Profile Card

YES DROP consumes the canonical Yokefellow Profile Card rail rather than creating an App-specific identity model.

Use the portable `profile_card.v1` data/presentation source so the active player can be represented consistently with Yokefellow.

### Active player's Toy showcase

The showcase displays the **current dropper's actual owned Rainbow's End Toy NFTs**.

It does not default to the viewer's collection.

Examples:

- Zack is dropping -> everyone sees Zack's Yokefellow profile card and Zack's Toy collection;
- the queue advances -> the same machine remains loaded while the profile/showcase transitions to the next player.

Small, Medium, and Large toys should be visibly distinct in the showcase so burn/craft progression creates a social status/achievement effect.

A separate personal collection overlay may exist for the viewer to inspect their own collection while waiting, but that is secondary to the active-player showcase.

## 9. Persistent App shell and menus

The shared machine should remain loaded. Menus/results should be overlays or shell layers rather than repeatedly destroying and recreating the machine.

Working launch structure:

- **Home / Entry**
- **Machine**
- **Toy collection overlay**
- **Turn result / reward overlay**
- **How to Play**

### Machine layer

The machine view should include or support:

- authoritative shared Rainbow's End machine;
- current active player;
- canonical Yokefellow Profile Card;
- active player's Toy showcase;
- queue state;
- equipped Coin Skin;
- free-drop availability/countdown;
- paid/free turn controls;
- concise turn/settlement result state.

## 10. Game-field quality target

The existing Rainbow's End concept is retained, but the current field is not considered launch-finished.

Known target issues:

- field currently feels clunky;
- coins can get stuck/rest on top of guards;
- object flow needs improvement;
- toys and coins need a quality pass;
- payout/capture exit behavior needs improvement;
- spectator readability needs improvement.

The objective is to repair and polish the existing game rather than replace the coin-pusher concept.

## 11. Capture and result presentation

Physical authoritative capture determines the outcome.

After capture is authoritatively decided, presentation should make the result clear instead of relying on awkward post-capture physics.

For a toy:

1. toy crosses the qualifying capture boundary;
2. authoritative server records the catch;
3. toy power resolves;
4. settlement/NFT action begins;
5. the UI clearly acknowledges the catch;
6. the object exits/cleans up cleanly;
7. the result overlay explains the reward.

A player should not have to infer whether a visibly captured object was counted.

## 12. Art/NFT consistency

Rainbow's End remains the launch theme.

The launch quality pass must align:

- cabinet;
- playfield;
- guards;
- YES coins;
- physical toys;
- Coin Skin NFT art;
- Small/Medium/Large Toy NFT art;
- active-player showcase;
- reward presentation.

The in-game object, NFT representation, and showcase representation should clearly read as the same collectible family.

## 13. Launch boundaries

YD-1 does not add:

- additional machines;
- additional toy families;
- ad-wall mechanics;
- social-task free turns;
- large progression trees;
- power scaling from Toy NFT size;
- unrelated future game modes.

The current launch path after YD-1 is:

1. persistent App shell + active-player presentation;
2. hourly free drop + countdown;
3. Toy burn/craft progression;
4. Rainbow's End field/physics cleanup;
5. capture/result presentation;
6. art/NFT alignment;
7. YokefellowNetwork cutover;
8. full launch acceptance.

## 14. Acceptance principles

The final launch build must preserve these invariants:

- one authoritative shared machine;
- 10 YES = 10-coin paid turn;
- one non-stacking hourly free turn;
- free and paid turns share identical gameplay/reward rules;
- skin ownership controls equip eligibility;
- equipped skin selects the matching physical toy;
- caught toy awards Small Toy NFT;
- 3 Small -> Medium and 3 Medium -> Large through burn/craft;
- Toy size changes showcase status only;
- current dropper's Yokefellow profile + Toy collection is visible to everyone;
- machine remains loaded across player transitions;
- skins and toys are transferable and Auction-eligible;
- transferred-away equipped skin falls back to default on authoritative ownership refresh;
- gameplay results remain server-authoritative and recoverable.
